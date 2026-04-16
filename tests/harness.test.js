import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { calculateHealth, getHarnessHealth, renderHarnessLines } from '../dist/render/lines/harness.js';
import { mergeConfig } from '../dist/config.js';
import { setLanguage } from '../dist/i18n/index.js';
import { matchesSession } from '../dist/utils/session-match.js';

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function withTempHome(fn) {
  const tempHome = await mkdtemp(path.join(tmpdir(), 'claude-harness-home-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  delete process.env.CLAUDE_CONFIG_DIR;

  try {
    await fn(tempHome);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    await rm(tempHome, { recursive: true, force: true });
  }
}

function harnessConfig() {
  return mergeConfig({});
}

function eventLine(fields) {
  return JSON.stringify({
    severity: 'info',
    ...fields,
  });
}

function hookGroup(...commands) {
  return [{
    matcher: '',
    hooks: commands.map(command => ({
      type: 'command',
      command,
    })),
  }];
}

function baseRenderContext(overrides = {}) {
  return {
    stdin: {},
    transcript: { tools: [], agents: [], todos: [] },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    sessionDuration: '',
    gitStatus: null,
    usageData: null,
    memoryUsage: null,
    extraLabel: null,
    outputStyle: undefined,
    claudeCodeVersion: undefined,
    config: mergeConfig({}),
    ...overrides,
  };
}

test('calculateHealth returns 0 when no components are installed', () => {
  const score = calculateHealth({
    installedIds: new Set(),
    activeIds: new Set(),
    nonViolationCount: 0,
    violationCount: 0,
  });
  assert.equal(score, 0);
});

test('renderHarnessLines explains block reasons in Chinese instead of raw category codes', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 72,
      trend: 'stable',
      components: [
        { id: 'cbm-gate', name: 'CBM Gate', type: 'guard', status: 'active', eventCount: 6, blockCount: 4, weight: 1 },
        { id: 'completion-gate', name: 'Completion Gate', type: 'sensor', status: 'active', eventCount: 3, blockCount: 1, weight: 3 },
      ],
      totalEvents: 9,
      totalViolations: 0,
      sessionEvents: 9,
      recentEvents: [
        {
          ts: '2026-04-16T09:49:00.000Z',
          event: 'guard.block',
          source: 'cbm-gate',
          category: 'awaiting_mcp_usage',
          detail: '',
          severity: 'warning',
        },
        {
          ts: '2026-04-16T09:26:00.000Z',
          event: 'sensor.block',
          source: 'completion-gate',
          category: 'tests_failed',
          detail: 'pytest: exit 124',
          severity: 'high',
        },
      ],
    },
  });

  const lines = renderHarnessLines(ctx).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));

  assert.ok(lines.some(line => line.includes('CBM') && line.includes('codebase-memory-mcp')), JSON.stringify(lines));
  assert.ok(lines.some(line => line.includes('search_graph') || line.includes('trace_path')), JSON.stringify(lines));
  assert.ok(lines.some(line => line.includes('测试超时') || (line.includes('pytest') && line.includes('60s'))), JSON.stringify(lines));
  assert.ok(!lines.some(line => line.includes('awaiting_mcp_usage')), JSON.stringify(lines));
});

test('calculateHealth returns maximum with all components installed, active, and clean', () => {
  const allIds = new Set([
    'agent-opus', 'research-first', 'effort-max', 'safety-gate', 'linter-protection', 'cbm-gate',
    'auto-format', 'completion-gate', 'stop-phrase-guard', 'read-tracker', 'teammate-idle', 'task-completed',
  ]);
  const score = calculateHealth({
    installedIds: allIds,
    activeIds: allIds,
    nonViolationCount: 100,
    violationCount: 0,
  });
  assert.equal(score, 100);
});

test('calculateHealth applies violation penalty', () => {
  const allIds = new Set([
    'agent-opus', 'research-first', 'effort-max', 'safety-gate', 'linter-protection', 'cbm-gate',
    'auto-format', 'completion-gate', 'stop-phrase-guard', 'read-tracker', 'teammate-idle', 'task-completed',
  ]);
  const scoreClean = calculateHealth({
    installedIds: allIds,
    activeIds: allIds,
    nonViolationCount: 100,
    violationCount: 0,
  });
  const scoreWithViolations = calculateHealth({
    installedIds: allIds,
    activeIds: allIds,
    nonViolationCount: 100,
    violationCount: 2,
  });
  assert.ok(scoreWithViolations < scoreClean, 'violations should reduce score');
  assert.equal(scoreClean - scoreWithViolations, 10, 'each violation costs 5 points');
});

test('calculateHealth caps violation penalty at 20', () => {
  const allIds = new Set([
    'agent-opus', 'research-first', 'effort-max', 'safety-gate', 'linter-protection', 'cbm-gate',
    'auto-format', 'completion-gate', 'stop-phrase-guard', 'read-tracker', 'teammate-idle', 'task-completed',
  ]);
  const score4 = calculateHealth({
    installedIds: allIds,
    activeIds: allIds,
    nonViolationCount: 100,
    violationCount: 4,
  });
  const score10 = calculateHealth({
    installedIds: allIds,
    activeIds: allIds,
    nonViolationCount: 100,
    violationCount: 10,
  });
  // Both should have max penalty of 20
  assert.equal(score4, score10, 'penalty should be capped at 20 (4 violations = 20 penalty)');
});

test('calculateHealth weights installed components correctly', () => {
  // Only install safety-gate (weight 3) and completion-gate (weight 3)
  // Total weight: 19, installed weight: 6
  // Base: (6/19) * 60 ≈ 18.9
  const installed = new Set(['safety-gate', 'completion-gate']);
  const score = calculateHealth({
    installedIds: installed,
    activeIds: new Set(),
    nonViolationCount: 0,
    violationCount: 0,
  });
  // Base: round((6/19)*60) = round(18.9) with no active/stability bonus
  assert.ok(score >= 18 && score <= 20, `expected base score around 19, got ${score}`);
});

test('calculateHealth gives stability bonus for non-violation events', () => {
  const installed = new Set(['agent-opus']);
  const scoreNoEvents = calculateHealth({
    installedIds: installed,
    activeIds: new Set(),
    nonViolationCount: 0,
    violationCount: 0,
  });
  const scoreWithEvents = calculateHealth({
    installedIds: installed,
    activeIds: new Set(),
    nonViolationCount: 15,
    violationCount: 0,
  });
  assert.ok(scoreWithEvents > scoreNoEvents, 'non-violation events should increase score via stability bonus');
});

test('calculateHealth clamps score between 0 and 100', () => {
  // Test lower bound
  const scoreLow = calculateHealth({
    installedIds: new Set(),
    activeIds: new Set(),
    nonViolationCount: 0,
    violationCount: 100,
  });
  assert.equal(scoreLow, 0, 'score should not go below 0');

  // Test upper bound (all components, all active, lots of events, no violations)
  const allIds = new Set([
    'agent-opus', 'research-first', 'effort-max', 'safety-gate', 'linter-protection', 'cbm-gate',
    'auto-format', 'completion-gate', 'stop-phrase-guard', 'read-tracker', 'teammate-idle', 'task-completed',
  ]);
  const scoreHigh = calculateHealth({
    installedIds: allIds,
    activeIds: allIds,
    nonViolationCount: 1000,
    violationCount: 0,
  });
  assert.equal(scoreHigh, 100, 'score should not exceed 100');
});

test('calculateHealth active bonus requires installed components', () => {
  // activeIds without being installed should not add bonus
  const score = calculateHealth({
    installedIds: new Set(),
    activeIds: new Set(['agent-opus']),
    nonViolationCount: 10,
    violationCount: 0,
  });
  // Active bonus: 0 installed, so 0/0 — should not contribute
  // Only stability bonus: min(10/10, 1) * 20 = 20
  assert.equal(score, 20, 'active bonus should be 0 when no components installed');
});

test('matchesSession requires exact identity matches and normalizes transcript paths', () => {
  assert.equal(matchesSession('session-alpha', undefined, { sessionId: 'session-alpha' }), true);
  assert.equal(matchesSession('session-alpha-extra', undefined, { sessionId: 'session-alpha' }), false);
  assert.equal(
    matchesSession('unknown', 'C:\\tmp\\alpha.jsonl', { transcriptPath: 'C:/tmp/alpha.jsonl' }),
    true,
  );
});

test('getHarnessHealth keeps blocked events separate from violations and merges installed hooks across settings scopes', async () => {
  await withTempHome(async homeDir => {
    const claudeDir = path.join(homeDir, '.claude');
    const logDir = path.join(claudeDir, 'logs');
    const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-harness-project-'));
    const projectClaudeDir = path.join(projectDir, '.claude');
    const sessionId = 'session-alpha';
    const transcriptPath = 'C:/tmp/session-alpha.jsonl';

    await mkdir(logDir, { recursive: true });
    await mkdir(projectClaudeDir, { recursive: true });

    await writeFile(path.join(claudeDir, 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: hookGroup(
          'bash /c/Users/Administrator/.claude/hooks/agent-opus-enforcer.sh',
          'bash /c/Users/Administrator/.claude/hooks/safety-gate.sh',
          '~/.claude/hooks/cbm-code-discovery-gate',
        ),
      },
    }, null, 2), 'utf8');

    await writeFile(path.join(projectClaudeDir, 'settings.local.json'), JSON.stringify({
      hooks: {
        Stop: hookGroup('bash /c/Users/Administrator/.claude/hooks/stop-phrase-guard.sh'),
        TaskCompleted: hookGroup('bash /c/Users/Administrator/.claude/hooks/task-completed-gate.sh'),
      },
    }, null, 2), 'utf8');

    await writeFile(path.join(logDir, 'harness-events.jsonl'), [
      eventLine({
        ts: '2026-04-16T08:00:00.000Z',
        event: 'lifecycle',
        source: 'session-init',
        session: sessionId,
        transcript: transcriptPath,
        category: 'session_started',
        detail: '',
      }),
      eventLine({
        ts: '2026-04-16T08:00:01.000Z',
        event: 'guard.pass',
        source: 'agent-opus',
        session: sessionId,
        transcript: transcriptPath,
        category: 'model_check',
        detail: '',
      }),
      eventLine({
        ts: '2026-04-16T08:00:02.000Z',
        event: 'sensor.trigger',
        source: 'task-completed',
        session: sessionId,
        transcript: transcriptPath,
        category: 'task_done',
        detail: 'ship it',
      }),
      eventLine({
        ts: '2026-04-16T08:00:03.000Z',
        event: 'guard.block',
        source: 'safety-gate',
        session: sessionId,
        transcript: transcriptPath,
        category: 'recursive_delete',
        detail: 'rm -rf /',
        severity: 'critical',
      }),
    ].join('\n'), 'utf8');

    const health = getHarnessHealth({
      session_id: sessionId,
      transcript_path: transcriptPath,
      cwd: projectDir,
    }, harnessConfig());

    assert.ok(health, 'expected harness health to be computed');

    const byId = new Map(health.components.map(component => [component.id, component]));
    assert.equal(byId.get('agent-opus')?.status, 'active');
    assert.equal(byId.get('safety-gate')?.status, 'active');
    assert.equal(byId.get('cbm-gate')?.status, 'installed');
    assert.equal(byId.get('task-completed')?.status, 'active');
    assert.equal(byId.get('stop-phrase-guard')?.status, 'installed');
    assert.equal(byId.get('safety-gate')?.blockCount, 1);
    assert.equal(health.totalViolations, 0);
    assert.equal(health.sessionEvents, 4);

    await rm(projectDir, { recursive: true, force: true });
  });
});

test('getHarnessHealth assigns unknown-session events using the matching session-init boundary', async () => {
  await withTempHome(async homeDir => {
    const claudeDir = path.join(homeDir, '.claude');
    const logDir = path.join(claudeDir, 'logs');
    const sessionId = 'session-fallback';
    const transcriptPath = 'C:/tmp/session-fallback.jsonl';

    await mkdir(logDir, { recursive: true });

    await writeFile(path.join(claudeDir, 'settings.json'), JSON.stringify({
      hooks: {
        TaskCompleted: hookGroup('bash /c/Users/Administrator/.claude/hooks/task-completed-gate.sh'),
      },
    }, null, 2), 'utf8');

    await writeFile(path.join(logDir, 'harness-events.jsonl'), [
      eventLine({
        ts: '2026-04-16T08:59:59.000Z',
        event: 'sensor.trigger',
        source: 'task-completed',
        session: 'unknown',
        category: 'task_done',
        detail: 'too-early',
      }),
      eventLine({
        ts: '2026-04-16T09:00:00.000Z',
        event: 'lifecycle',
        source: 'session-init',
        session: sessionId,
        transcript: transcriptPath,
        category: 'session_started',
        detail: '',
      }),
      eventLine({
        ts: '2026-04-16T09:00:01.000Z',
        event: 'sensor.trigger',
        source: 'task-completed',
        session: 'unknown',
        category: 'task_done',
        detail: 'current-session-task',
      }),
      eventLine({
        ts: '2026-04-16T09:00:02.000Z',
        event: 'sensor.trigger',
        source: 'task-completed',
        session: 'session-other',
        transcript: 'C:/tmp/session-other.jsonl',
        category: 'task_done',
        detail: 'other-session-task',
      }),
    ].join('\n'), 'utf8');

    const health = getHarnessHealth({
      session_id: sessionId,
      transcript_path: transcriptPath,
    }, harnessConfig());

    assert.ok(health, 'expected harness health to be computed');

    const taskCompleted = health.components.find(component => component.id === 'task-completed');
    assert.equal(taskCompleted?.status, 'active');
    assert.equal(taskCompleted?.eventCount, 1);
    assert.equal(health.sessionEvents, 2);
  });
});

test('getHarnessHealth does not attribute unlabeled events past another session-init to the earlier session', async () => {
  await withTempHome(async homeDir => {
    const claudeDir = path.join(homeDir, '.claude');
    const logDir = path.join(claudeDir, 'logs');
    const sessionA = 'session-a';
    const transcriptA = 'C:/tmp/session-a.jsonl';
    const sessionB = 'session-b';
    const transcriptB = 'C:/tmp/session-b.jsonl';

    await mkdir(logDir, { recursive: true });

    await writeFile(path.join(claudeDir, 'settings.json'), JSON.stringify({
      hooks: {
        Stop: hookGroup('bash /c/Users/Administrator/.claude/hooks/stop-phrase-guard.sh'),
      },
    }, null, 2), 'utf8');

    await writeFile(path.join(logDir, 'harness-events.jsonl'), [
      eventLine({
        ts: '2026-04-16T09:00:00.000Z',
        event: 'lifecycle',
        source: 'session-init',
        session: sessionA,
        transcript: transcriptA,
        category: 'session_started',
        detail: '',
      }),
      eventLine({
        ts: '2026-04-16T09:00:01.000Z',
        event: 'lifecycle',
        source: 'session-init',
        session: sessionB,
        transcript: transcriptB,
        category: 'session_started',
        detail: '',
      }),
      eventLine({
        ts: '2026-04-16T09:00:02.000Z',
        event: 'violation',
        source: 'stop-phrase-guard',
        category: 'phrase_detected',
        detail: 'unlabeled violation',
        severity: 'warning',
      }),
    ].join('\n'), 'utf8');

    const healthA = getHarnessHealth({
      session_id: sessionA,
      transcript_path: transcriptA,
    }, harnessConfig());
    const healthB = getHarnessHealth({
      session_id: sessionB,
      transcript_path: transcriptB,
    }, harnessConfig());

    assert.ok(healthA && healthB, 'expected harness health for both sessions');
    assert.equal(healthA.totalViolations, 0);
    assert.equal(healthA.sessionEvents, 1);
    assert.equal(healthB.totalViolations, 1);
    assert.equal(healthB.sessionEvents, 2);
  });
});

test('getHarnessHealth keeps trend stable when only violation density changes', async () => {
  await withTempHome(async homeDir => {
    const claudeDir = path.join(homeDir, '.claude');
    const logDir = path.join(claudeDir, 'logs');
    const sessionId = 'session-trend-stable';
    const transcriptPath = 'C:/tmp/session-trend-stable.jsonl';

    await mkdir(logDir, { recursive: true });

    await writeFile(path.join(claudeDir, 'settings.json'), JSON.stringify({
      hooks: {
        Stop: hookGroup('bash /c/Users/Administrator/.claude/hooks/stop-phrase-guard.sh'),
        TaskCompleted: hookGroup('bash /c/Users/Administrator/.claude/hooks/task-completed-gate.sh'),
      },
    }, null, 2), 'utf8');

    await writeFile(path.join(logDir, 'harness-events.jsonl'), [
      eventLine({
        ts: '2026-04-16T10:00:00.000Z',
        event: 'lifecycle',
        source: 'session-init',
        session: sessionId,
        transcript: transcriptPath,
        category: 'session_started',
        detail: '',
      }),
      eventLine({
        ts: '2026-04-16T10:00:01.000Z',
        event: 'sensor.trigger',
        source: 'task-completed',
        session: sessionId,
        transcript: transcriptPath,
        category: 'task_done',
        detail: 'warmup',
      }),
      eventLine({
        ts: '2026-04-16T10:00:02.000Z',
        event: 'violation',
        source: 'stop-phrase-guard',
        session: sessionId,
        transcript: transcriptPath,
        category: 'phrase_detected',
        detail: 'legacy phrase',
      }),
      eventLine({
        ts: '2026-04-16T10:00:03.000Z',
        event: 'sensor.trigger',
        source: 'task-completed',
        session: sessionId,
        transcript: transcriptPath,
        category: 'task_done',
        detail: 'step-1',
      }),
      eventLine({
        ts: '2026-04-16T10:00:04.000Z',
        event: 'sensor.trigger',
        source: 'task-completed',
        session: sessionId,
        transcript: transcriptPath,
        category: 'task_done',
        detail: 'step-2',
      }),
      eventLine({
        ts: '2026-04-16T10:00:05.000Z',
        event: 'sensor.trigger',
        source: 'task-completed',
        session: sessionId,
        transcript: transcriptPath,
        category: 'task_done',
        detail: 'step-3',
      }),
    ].join('\n'), 'utf8');

    const health = getHarnessHealth({
      session_id: sessionId,
      transcript_path: transcriptPath,
    }, harnessConfig());

    assert.ok(health, 'expected harness health to be computed');
    assert.equal(health.trend, 'stable');
  });
});

test('getHarnessHealth includes recent notable events for the current session only', async () => {
  await withTempHome(async homeDir => {
    const claudeDir = path.join(homeDir, '.claude');
    const logDir = path.join(claudeDir, 'logs');
    const sessionId = 'session-recent-events';
    const transcriptPath = 'C:/tmp/session-recent-events.jsonl';

    await mkdir(logDir, { recursive: true });

    await writeFile(path.join(claudeDir, 'settings.json'), JSON.stringify({
      hooks: {
        Stop: hookGroup('bash /c/Users/Administrator/.claude/hooks/stop-phrase-guard.sh'),
        TaskCompleted: hookGroup('bash /c/Users/Administrator/.claude/hooks/task-completed-gate.sh'),
      },
    }, null, 2), 'utf8');

    await writeFile(path.join(logDir, 'harness-events.jsonl'), [
      eventLine({
        ts: '2026-04-16T10:00:00.000Z',
        event: 'lifecycle',
        source: 'session-init',
        session: sessionId,
        transcript: transcriptPath,
        category: 'session_started',
        detail: '',
      }),
      eventLine({
        ts: '2026-04-16T10:00:01.000Z',
        event: 'sensor.trigger',
        source: 'task-completed',
        session: sessionId,
        transcript: transcriptPath,
        category: 'task_done',
        detail: 'ship current task',
      }),
      eventLine({
        ts: '2026-04-16T10:00:02.000Z',
        event: 'sensor.block',
        source: 'completion-gate',
        session: sessionId,
        transcript: transcriptPath,
        category: 'tests_failed',
        detail: 'pytest: exit 124',
        severity: 'high',
      }),
      eventLine({
        ts: '2026-04-16T10:00:03.000Z',
        event: 'violation',
        source: 'stop-phrase-guard',
        session: sessionId,
        transcript: transcriptPath,
        category: 'phrase_detected',
        detail: '请求许可',
        severity: 'warning',
      }),
      eventLine({
        ts: '2026-04-16T10:00:04.000Z',
        event: 'sensor.trigger',
        source: 'read-tracker',
        session: sessionId,
        transcript: transcriptPath,
        category: 'file_read',
        detail: 'C:/tmp/noisy.ts',
      }),
      eventLine({
        ts: '2026-04-16T10:00:05.000Z',
        event: 'sensor.block',
        source: 'completion-gate',
        session: 'other-session',
        transcript: 'C:/tmp/other-session.jsonl',
        category: 'tests_failed',
        detail: 'other-session failure',
      }),
    ].join('\n'), 'utf8');

    const health = getHarnessHealth({
      session_id: sessionId,
      transcript_path: transcriptPath,
    }, harnessConfig());

    assert.ok(health, 'expected harness health to be computed');
    assert.deepEqual(
      health.recentEvents?.map(event => event.source),
      ['stop-phrase-guard', 'completion-gate', 'task-completed'],
    );
    assert.equal(health.recentEvents?.[0]?.detail, '请求许可');
    assert.equal(health.recentEvents?.[1]?.detail, 'pytest: exit 124');
    assert.equal(health.recentEvents?.[2]?.detail, 'ship current task');
  });
});

test('getHarnessHealth suppresses stale block entries when a source later reports a safe pass', async () => {
  await withTempHome(async homeDir => {
    const claudeDir = path.join(homeDir, '.claude');
    const logDir = path.join(claudeDir, 'logs');
    const sessionId = 'session-stale-block';
    const transcriptPath = 'C:/tmp/session-stale-block.jsonl';

    await mkdir(logDir, { recursive: true });

    await writeFile(path.join(claudeDir, 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: hookGroup('bash /c/Users/Administrator/.claude/hooks/safety-gate.sh'),
        TaskCompleted: hookGroup('bash /c/Users/Administrator/.claude/hooks/task-completed-gate.sh'),
      },
    }, null, 2), 'utf8');

    await writeFile(path.join(logDir, 'harness-events.jsonl'), [
      eventLine({
        ts: '2026-04-16T10:00:00.000Z',
        event: 'lifecycle',
        source: 'session-init',
        session: sessionId,
        transcript: transcriptPath,
        category: 'session_started',
        detail: '',
      }),
      eventLine({
        ts: '2026-04-16T10:00:01.000Z',
        event: 'guard.block',
        source: 'safety-gate',
        session: sessionId,
        transcript: transcriptPath,
        category: 'recursive_delete',
        detail: 'rm -rf /',
        severity: 'critical',
      }),
      eventLine({
        ts: '2026-04-16T10:00:02.000Z',
        event: 'guard.pass',
        source: 'safety-gate',
        session: sessionId,
        transcript: transcriptPath,
        category: 'safe_command',
        detail: '',
      }),
      eventLine({
        ts: '2026-04-16T10:00:03.000Z',
        event: 'sensor.trigger',
        source: 'task-completed',
        session: sessionId,
        transcript: transcriptPath,
        category: 'task_done',
        detail: 'post-fix verification',
      }),
    ].join('\n'), 'utf8');

    const health = getHarnessHealth({
      session_id: sessionId,
      transcript_path: transcriptPath,
    }, harnessConfig());

    assert.ok(health, 'expected harness health to be computed');
    assert.deepEqual(
      health.recentEvents?.map(event => event.source),
      ['task-completed'],
    );
  });
});

test('renderHarnessLines honors configured thresholds and dims stable trend', () => {
  const ctx = baseRenderContext({
    config: mergeConfig({
      harness: {
        showGuards: false,
        showSensors: false,
        showStats: false,
        scoreThresholds: {
          warning: 80,
          critical: 40,
        },
      },
    }),
    harness: {
      score: 45,
      trend: 'stable',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 3,
      recentEvents: [],
    },
  });

  const [line] = renderHarnessLines(ctx);

  assert.ok(line.includes('\x1b[33m45\x1b[0m'), `expected score to use warning color: ${JSON.stringify(line)}`);
  assert.match(line, /\x1b\[2m→\x1b\[0m/, `expected stable trend arrow to be dimmed: ${JSON.stringify(line)}`);
});

test('renderHarnessLines hides score bar and numeric score when showScore is false', () => {
  setLanguage('en');

  const ctx = baseRenderContext({
    config: mergeConfig({
      harness: {
        showScore: false,
        showGuards: false,
        showSensors: false,
        showStats: false,
      },
    }),
    harness: {
      score: 88,
      trend: 'stable',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 3,
      recentEvents: [],
    },
  });

  const [line] = renderHarnessLines(ctx).map(entry => entry.replace(/\x1b\[[0-9;]*m/g, ''));

  assert.ok(line.includes('Harness'), `expected harness header to remain visible: ${JSON.stringify(line)}`);
  assert.ok(line.includes('Session:3'), `expected session count to remain visible: ${JSON.stringify(line)}`);
  assert.ok(!line.includes('88'), `score should be hidden when showScore=false: ${JSON.stringify(line)}`);
  assert.ok(!line.includes('█') && !line.includes('░'), `score bar should be hidden when showScore=false: ${JSON.stringify(line)}`);
});

test('renderHarnessLines uses Chinese labels when language is zh', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 87,
      trend: 'stable',
      components: [
        { id: 'agent-opus', name: 'Agent Opus', type: 'guard', status: 'active', eventCount: 10, blockCount: 0, weight: 1 },
        { id: 'research-first', name: 'Research First', type: 'guard', status: 'active', eventCount: 9, blockCount: 1, weight: 2 },
        { id: 'auto-format', name: 'Auto Format', type: 'sensor', status: 'active', eventCount: 4, blockCount: 0, weight: 1 },
        { id: 'read-tracker', name: 'Read Tracker', type: 'sensor', status: 'installed', eventCount: 0, blockCount: 0, weight: 1 },
      ],
      totalEvents: 14,
      totalViolations: 0,
      sessionEvents: 14,
      recentEvents: [],
    },
  });

  const lines = renderHarnessLines(ctx).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));

  assert.ok(lines[0].includes('防护'), `expected Chinese dashboard label: ${JSON.stringify(lines)}`);
  assert.ok(lines[0].includes('本会话:14'), `expected Chinese session label: ${JSON.stringify(lines)}`);
  assert.ok(lines[1].includes('守护:'), `expected Chinese guards label: ${JSON.stringify(lines)}`);
  assert.ok(lines[1].includes('研究'), `expected translated component name: ${JSON.stringify(lines)}`);
  assert.ok(lines[2].includes('传感:'), `expected Chinese sensors label: ${JSON.stringify(lines)}`);
  assert.ok(lines[2].includes('格式'), `expected translated sensor name: ${JSON.stringify(lines)}`);
  assert.ok(lines[3].includes('拦截:1'), `expected Chinese block label: ${JSON.stringify(lines)}`);
  assert.ok(lines[3].includes('趋势:→'), `expected Chinese trend label: ${JSON.stringify(lines)}`);
});

test('renderHarnessLines shows recent detailed trigger information in Chinese', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 83,
      trend: 'stable',
      components: [
        { id: 'completion-gate', name: 'Completion Gate', type: 'sensor', status: 'active', eventCount: 3, blockCount: 1, weight: 3 },
        { id: 'stop-phrase-guard', name: 'Stop Phrase', type: 'sensor', status: 'active', eventCount: 2, blockCount: 0, weight: 2 },
        { id: 'task-completed', name: 'Task Completed', type: 'sensor', status: 'active', eventCount: 6, blockCount: 0, weight: 1 },
      ],
      totalEvents: 11,
      totalViolations: 1,
      sessionEvents: 11,
      recentEvents: [
        {
          ts: '2026-04-16T10:03:00.000Z',
          event: 'violation',
          source: 'stop-phrase-guard',
          category: 'phrase_detected',
          detail: '请求许可',
          severity: 'warning',
        },
        {
          ts: '2026-04-16T10:02:00.000Z',
          event: 'sensor.block',
          source: 'completion-gate',
          category: 'tests_failed',
          detail: 'pytest: exit 124',
          severity: 'high',
        },
        {
          ts: '2026-04-16T10:01:00.000Z',
          event: 'sensor.trigger',
          source: 'task-completed',
          category: 'task_done',
          detail: '优化左侧面板 UI',
          severity: 'info',
        },
      ],
    },
  });

  const lines = renderHarnessLines(ctx).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));

  assert.ok(lines.some(line => line.includes('↳ 违规[') && line.includes('停止') && line.includes('请求许可')), JSON.stringify(lines));
  assert.ok(lines.some(line => line.includes('↳ 拦截[') && line.includes('完成') && line.includes('pytest: exit 124')), JSON.stringify(lines));
  assert.ok(lines.some(line => line.includes('↳ 任务[') && line.includes('优化左侧面板 UI')), JSON.stringify(lines));
});

test('renderHarnessLines explains a running completion-gate event in Chinese', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 91,
      trend: 'up',
      components: [
        { id: 'completion-gate', name: 'Completion Gate', type: 'sensor', status: 'active', eventCount: 2, blockCount: 0, weight: 3 },
      ],
      totalEvents: 2,
      totalViolations: 0,
      sessionEvents: 2,
      recentEvents: [
        {
          ts: '2026-04-16T10:05:00.000Z',
          event: 'sensor.trigger',
          source: 'completion-gate',
          category: 'tests_running',
          detail: 'npm test @ D:\\Auto-STN\\EnPro',
          severity: 'info',
        },
      ],
    },
  });

  const lines = renderHarnessLines(ctx).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));

  assert.ok(lines.some(line => line.includes('↳ 事件[') && line.includes('完成') && line.includes('正在运行测试') && line.includes('npm test')), JSON.stringify(lines));
});
