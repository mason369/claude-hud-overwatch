import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { calculateHealth, getHarnessHealth, renderHarnessLines, computeReadEditRatio, loadBaseline, computeBaselineZScore } from '../dist/render/lines/harness.js';
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
    'edit-quality', 'grep-tracker', 'prompt-rescuer', 'session-summary',
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
  // Total weight: 25 (all 16 components), installed weight: 6
  // Base: (6/25) * 60 = 14.4
  const installed = new Set(['safety-gate', 'completion-gate']);
  const score = calculateHealth({
    installedIds: installed,
    activeIds: new Set(),
    nonViolationCount: 0,
    violationCount: 0,
  });
  // Base: round((6/25)*60) = round(14.4) with no active/stability bonus
  assert.ok(score >= 13 && score <= 15, `expected base score around 14, got ${score}`);
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
    'edit-quality', 'grep-tracker', 'prompt-rescuer', 'session-summary',
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

test('calculateHealth only counts active components that are also installed', () => {
  const score = calculateHealth({
    installedIds: new Set(['agent-opus']),
    activeIds: new Set(['agent-opus', 'safety-gate']),
    nonViolationCount: 0,
    violationCount: 0,
  });

  // Base: (1/25) * 60 = 2.4 => rounds to 2
  // Active bonus should be 1/1 * 20 = 20, not 2/1 * 20 = 40
  assert.equal(score, 22, 'uninstalled active components should not inflate the active bonus');
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

// --- Phase 2: R/E ratio ---------------------------------------------------

test('computeReadEditRatio returns 2.0 when Read:10 Edit:5', () => {
  const result = computeReadEditRatio({ Read: 10, Edit: 5 });
  assert.ok(result, 'expected ratio object');
  assert.equal(result.ratio, 2);
  assert.equal(result.reads, 10);
  assert.equal(result.edits, 5);
  assert.equal(result.writes, 0);
});

test('computeReadEditRatio combines Edit and Write in denominator', () => {
  // Read:10, Edit:3, Write:2 => denom=5 => ratio=2.0
  const result = computeReadEditRatio({ Read: 10, Edit: 3, Write: 2 });
  assert.ok(result);
  assert.equal(result.ratio, 2);
  assert.equal(result.edits, 3);
  assert.equal(result.writes, 2);
});

test('computeReadEditRatio returns null when toolCounts is undefined', () => {
  assert.equal(computeReadEditRatio(undefined), null);
});

test('computeReadEditRatio returns null when toolCounts has no Read/Edit/Write', () => {
  assert.equal(computeReadEditRatio({}), null);
  assert.equal(computeReadEditRatio({ Bash: 5 }), null);
});

test('computeReadEditRatio uses denom=1 when no edits/writes (reads-only)', () => {
  // Read:8, Edit:0, Write:0 => denom=max(0,1)=1 => ratio=8
  const result = computeReadEditRatio({ Read: 8 });
  assert.ok(result);
  assert.equal(result.ratio, 8);
  assert.equal(result.edits, 0);
  assert.equal(result.writes, 0);
});

test('renderHarnessLines renders R/E line in yellow when ratio below warning threshold', () => {
  setLanguage('zh');

  // ratio 2.0 < warning 2.5 but > critical 1.5 => yellow
  const ctx = baseRenderContext({
    harness: {
      score: 80,
      trend: 'stable',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 0,
      recentEvents: [],
      readEditRatio: { ratio: 2.0, reads: 10, edits: 5, writes: 0 },
    },
  });

  const rawLines = renderHarnessLines(ctx);
  const plain = rawLines.map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));

  const rELine = plain.find(line => line.includes('R/E: 2.0'));
  assert.ok(rELine, `expected R/E line, got ${JSON.stringify(plain)}`);
  assert.ok(rELine.includes('读:10'), rELine);
  assert.ok(rELine.includes('改:5'), rELine);
  assert.ok(rELine.includes('写:0'), rELine);

  const rawRELine = rawLines.find(line => line.replace(/\x1b\[[0-9;]*m/g, '').includes('R/E: 2.0'));
  assert.ok(rawRELine.includes('\x1b[33m'), `expected yellow ANSI, got ${JSON.stringify(rawRELine)}`);
});

test('renderHarnessLines renders R/E in red when ratio below critical threshold', () => {
  setLanguage('zh');

  // ratio 1.0 < critical 1.5 => red
  const ctx = baseRenderContext({
    harness: {
      score: 60,
      trend: 'down',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 0,
      recentEvents: [],
      readEditRatio: { ratio: 1.0, reads: 4, edits: 4, writes: 0 },
    },
  });

  const rawLines = renderHarnessLines(ctx);
  const rawRELine = rawLines.find(line => line.replace(/\x1b\[[0-9;]*m/g, '').includes('R/E: 1.0'));
  assert.ok(rawRELine, `expected R/E line; got ${JSON.stringify(rawLines)}`);
  assert.ok(rawRELine.includes('\x1b[31m'), `expected red ANSI, got ${JSON.stringify(rawRELine)}`);
});

test('renderHarnessLines renders R/E in green when ratio at/above warning threshold', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 95,
      trend: 'up',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 0,
      recentEvents: [],
      readEditRatio: { ratio: 3.0, reads: 9, edits: 3, writes: 0 },
    },
  });

  const rawLines = renderHarnessLines(ctx);
  const rawRELine = rawLines.find(line => line.replace(/\x1b\[[0-9;]*m/g, '').includes('R/E: 3.0'));
  assert.ok(rawRELine, 'expected R/E line');
  assert.ok(rawRELine.includes('\x1b[32m'), `expected green ANSI, got ${JSON.stringify(rawRELine)}`);
});

test('renderHarnessLines omits R/E line when readEditRatio is absent (empty toolCounts)', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 80,
      trend: 'stable',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 0,
      recentEvents: [],
      // No readEditRatio — matches computeReadEditRatio({}) returning null
    },
  });

  const plain = renderHarnessLines(ctx).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
  assert.ok(!plain.some(line => line.includes('R/E:')), `no R/E line expected, got ${JSON.stringify(plain)}`);
});

test('renderHarnessLines omits R/E line when show=false', () => {
  setLanguage('zh');

  const config = mergeConfig({
    harness: { readEditRatio: { show: false } },
  });

  const ctx = baseRenderContext({
    config,
    harness: {
      score: 80,
      trend: 'stable',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 0,
      recentEvents: [],
      readEditRatio: { ratio: 2.0, reads: 10, edits: 5, writes: 0 },
    },
  });

  const plain = renderHarnessLines(ctx).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
  assert.ok(!plain.some(line => line.includes('R/E:')), `no R/E line expected when show=false, got ${JSON.stringify(plain)}`);
});

// --- Phase 2: violation breakdown -----------------------------------------

test('renderHarnessLines renders violation breakdown with translated category labels', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 55,
      trend: 'down',
      components: [],
      totalEvents: 3,
      totalViolations: 3,
      sessionEvents: 3,
      recentEvents: [],
      violationBreakdown: {
        'premature-stop': 2,
        'ownership-deflection': 1,
      },
    },
  });

  const plain = renderHarnessLines(ctx).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
  const vLine = plain.find(line => line.includes('⚠') && line.includes('违规:'));
  assert.ok(vLine, `expected violation breakdown line, got ${JSON.stringify(plain)}`);
  assert.ok(vLine.includes('过早停×2'), `expected premature-stop translation, got ${vLine}`);
  assert.ok(vLine.includes('逃避×1'), `expected ownership-deflection translation, got ${vLine}`);
});

test('renderHarnessLines omits violation breakdown line when breakdown is empty', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 90,
      trend: 'up',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 0,
      recentEvents: [],
      violationBreakdown: {},
    },
  });

  const plain = renderHarnessLines(ctx).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
  // The breakdown line starts with the warning glyph + violations label
  assert.ok(
    !plain.some(line => line.includes('⚠') && line.includes('违规:')),
    `no breakdown line expected for empty breakdown, got ${JSON.stringify(plain)}`,
  );
});

test('renderHarnessLines omits violation breakdown line when all counts are 0', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 90,
      trend: 'stable',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 0,
      recentEvents: [],
      violationBreakdown: { 'premature-stop': 0, 'ownership-deflection': 0 },
    },
  });

  const plain = renderHarnessLines(ctx).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
  assert.ok(
    !plain.some(line => line.includes('⚠') && line.includes('违规:')),
    `no breakdown line expected when all counts are zero, got ${JSON.stringify(plain)}`,
  );
});

test('renderHarnessLines falls back to raw category id when translation is missing', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 55,
      trend: 'down',
      components: [],
      totalEvents: 1,
      totalViolations: 1,
      sessionEvents: 1,
      recentEvents: [],
      violationBreakdown: { 'totally-unknown-category': 1 },
    },
  });

  const plain = renderHarnessLines(ctx).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
  const vLine = plain.find(line => line.includes('⚠') && line.includes('违规:'));
  assert.ok(vLine, `expected violation breakdown line, got ${JSON.stringify(plain)}`);
  assert.ok(vLine.includes('totally-unknown-category×1'), vLine);
});

// --- Phase 2: baseline ------------------------------------------------------

test('loadBaseline returns null when session-summary.jsonl does not exist', async () => {
  await withTempHome(async () => {
    const config = mergeConfig({});
    const baseline = loadBaseline(config);
    assert.equal(baseline, null);
  });
});

test('loadBaseline returns collecting state when fewer than minSessions entries', async () => {
  await withTempHome(async homeDir => {
    const logDir = path.join(homeDir, '.claude', 'logs');
    await mkdir(logDir, { recursive: true });
    // Write 3 entries when minSessions=5
    await writeFile(
      path.join(logDir, 'session-summary.jsonl'),
      [
        JSON.stringify({ r_e_ratio: 2.1 }),
        JSON.stringify({ r_e_ratio: 2.2 }),
        JSON.stringify({ r_e_ratio: 2.3 }),
      ].join('\n'),
      'utf8',
    );

    const config = mergeConfig({});
    const baseline = loadBaseline(config);
    assert.ok(baseline, 'expected baseline object');
    assert.equal(baseline.rEMedian, null);
    assert.equal(baseline.rEMad, null);
    assert.equal(baseline.sessionCount, 3);
  });
});

test('loadBaseline computes median and MAD from last windowSize entries', async () => {
  await withTempHome(async homeDir => {
    const logDir = path.join(homeDir, '.claude', 'logs');
    await mkdir(logDir, { recursive: true });
    // Ratios: [4.0, 4.5, 4.5, 5.0, 5.5] => median=4.5
    // Residuals: [0.5, 0, 0, 0.5, 1.0] => median(sorted [0,0,0.5,0.5,1.0]) = 0.5
    await writeFile(
      path.join(logDir, 'session-summary.jsonl'),
      [
        JSON.stringify({ r_e_ratio: 4.0 }),
        JSON.stringify({ r_e_ratio: 4.5 }),
        JSON.stringify({ r_e_ratio: 4.5 }),
        JSON.stringify({ r_e_ratio: 5.0 }),
        JSON.stringify({ r_e_ratio: 5.5 }),
      ].join('\n'),
      'utf8',
    );

    const config = mergeConfig({});
    const baseline = loadBaseline(config);
    assert.ok(baseline, 'expected baseline');
    assert.equal(baseline.sessionCount, 5);
    assert.equal(baseline.rEMedian, 4.5);
    assert.equal(baseline.rEMad, 0.5);
  });
});

test('loadBaseline ignores malformed JSON lines', async () => {
  await withTempHome(async homeDir => {
    const logDir = path.join(homeDir, '.claude', 'logs');
    await mkdir(logDir, { recursive: true });
    await writeFile(
      path.join(logDir, 'session-summary.jsonl'),
      [
        'not-json',
        JSON.stringify({ r_e_ratio: 3.0 }),
        '{broken',
        JSON.stringify({ r_e_ratio: 3.0 }),
        JSON.stringify({ r_e_ratio: 3.0 }),
        JSON.stringify({ r_e_ratio: 3.0 }),
        JSON.stringify({ r_e_ratio: 3.0 }),
      ].join('\n'),
      'utf8',
    );

    const config = mergeConfig({});
    const baseline = loadBaseline(config);
    assert.ok(baseline);
    assert.equal(baseline.sessionCount, 5);
    assert.equal(baseline.rEMedian, 3.0);
    assert.equal(baseline.rEMad, 0);
  });
});

test('loadBaseline returns null when baseline.enabled=false', async () => {
  await withTempHome(async homeDir => {
    const logDir = path.join(homeDir, '.claude', 'logs');
    await mkdir(logDir, { recursive: true });
    await writeFile(
      path.join(logDir, 'session-summary.jsonl'),
      [
        JSON.stringify({ r_e_ratio: 3.0 }),
        JSON.stringify({ r_e_ratio: 3.0 }),
        JSON.stringify({ r_e_ratio: 3.0 }),
        JSON.stringify({ r_e_ratio: 3.0 }),
        JSON.stringify({ r_e_ratio: 3.0 }),
      ].join('\n'),
      'utf8',
    );

    const config = mergeConfig({ harness: { baseline: { enabled: false } } });
    const baseline = loadBaseline(config);
    assert.equal(baseline, null);
  });
});

test('computeBaselineZScore returns null when median or mad is null', () => {
  assert.equal(
    computeBaselineZScore(2.0, { rEMedian: null, rEMad: 0.5, rEZScore: null, sessionCount: 10 }),
    null,
  );
  assert.equal(
    computeBaselineZScore(2.0, { rEMedian: 4.5, rEMad: null, rEZScore: null, sessionCount: 10 }),
    null,
  );
});

test('computeBaselineZScore returns null when mad is zero (no variance)', () => {
  assert.equal(
    computeBaselineZScore(2.0, { rEMedian: 4.5, rEMad: 0, rEZScore: null, sessionCount: 10 }),
    null,
  );
});

test('computeBaselineZScore produces the documented z≈-3.37 for deviation fixture', () => {
  // median=4.5, mad=0.5, current=2.0 => z = (2.0 - 4.5) / (1.4826 * 0.5) ≈ -3.373
  const z = computeBaselineZScore(2.0, {
    rEMedian: 4.5,
    rEMad: 0.5,
    rEZScore: null,
    sessionCount: 10,
  });
  assert.ok(z !== null, 'expected z-score');
  assert.ok(Math.abs(z - -3.373) < 0.01, `expected z≈-3.37, got ${z}`);
});

test('renderHarnessLines renders baseline collecting state with dim color', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 80,
      trend: 'stable',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 0,
      recentEvents: [],
      baseline: { rEMedian: null, rEMad: null, rEZScore: null, sessionCount: 2 },
    },
  });

  const rawLines = renderHarnessLines(ctx);
  const plain = rawLines.map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
  const baseLine = plain.find(line => line.includes('基线:') && line.includes('收集中'));
  assert.ok(baseLine, `expected collecting baseline line, got ${JSON.stringify(plain)}`);
  assert.ok(baseLine.includes('(2/5)'), baseLine);

  const rawBaseLine = rawLines.find(line => line.replace(/\x1b\[[0-9;]*m/g, '').includes('收集中'));
  assert.ok(rawBaseLine.includes('\x1b[2m'), `expected dim ANSI, got ${JSON.stringify(rawBaseLine)}`);
});

test('renderHarnessLines renders baseline deviation in red with down arrow for z=-3.37', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 40,
      trend: 'down',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 0,
      recentEvents: [],
      readEditRatio: { ratio: 2.0, reads: 10, edits: 5, writes: 0 },
      baseline: { rEMedian: 4.5, rEMad: 0.5, rEZScore: null, sessionCount: 10 },
    },
  });

  const rawLines = renderHarnessLines(ctx);
  const plain = rawLines.map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
  const baseLine = plain.find(line => line.includes('基线:') && line.includes('4.5'));
  assert.ok(baseLine, `expected baseline deviation line, got ${JSON.stringify(plain)}`);
  assert.ok(baseLine.includes('↓'), `expected down arrow, got ${baseLine}`);
  assert.ok(baseLine.includes('-3.4σ'), `expected z≈-3.4σ, got ${baseLine}`);
  assert.ok(baseLine.includes('当前偏离'), baseLine);

  const rawBaseLine = rawLines.find(line => line.replace(/\x1b\[[0-9;]*m/g, '').includes('当前偏离'));
  assert.ok(rawBaseLine.includes('\x1b[31m'), `expected red ANSI, got ${JSON.stringify(rawBaseLine)}`);
});

test('renderHarnessLines renders baseline deviation in yellow when |z| between warnZ and criticalZ', () => {
  setLanguage('zh');

  // median=4.0, mad=0.5 => z for 3.0 = (3.0-4.0)/(1.4826*0.5) ≈ -1.35 (|z| between 1 and 2)
  const ctx = baseRenderContext({
    harness: {
      score: 70,
      trend: 'stable',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 0,
      recentEvents: [],
      readEditRatio: { ratio: 3.0, reads: 6, edits: 2, writes: 0 },
      baseline: { rEMedian: 4.0, rEMad: 0.5, rEZScore: null, sessionCount: 10 },
    },
  });

  const rawLines = renderHarnessLines(ctx);
  const rawBaseLine = rawLines.find(line => line.replace(/\x1b\[[0-9;]*m/g, '').includes('当前偏离'));
  assert.ok(rawBaseLine, 'expected baseline deviation line');
  assert.ok(rawBaseLine.includes('\x1b[33m'), `expected yellow ANSI, got ${JSON.stringify(rawBaseLine)}`);
});

test('renderHarnessLines omits baseline line when baseline.enabled=false', () => {
  setLanguage('zh');

  const config = mergeConfig({ harness: { baseline: { enabled: false } } });

  const ctx = baseRenderContext({
    config,
    harness: {
      score: 80,
      trend: 'stable',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 0,
      recentEvents: [],
      baseline: { rEMedian: 4.5, rEMad: 0.5, rEZScore: null, sessionCount: 10 },
    },
  });

  const plain = renderHarnessLines(ctx).map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
  assert.ok(!plain.some(line => line.includes('基线:')), `no baseline line expected, got ${JSON.stringify(plain)}`);
});

// --- Phase 2: backward compatibility --------------------------------------

test('mergeConfig keeps Phase 2 defaults when user provides only top-level harness flags', () => {
  const config = mergeConfig({ harness: { enabled: true } });
  assert.equal(config.harness.readEditRatio.show, true);
  assert.equal(config.harness.readEditRatio.warning, 2.5);
  assert.equal(config.harness.readEditRatio.critical, 1.5);
  assert.equal(config.harness.violationBreakdown.show, true);
  assert.equal(config.harness.baseline.enabled, true);
  assert.equal(config.harness.baseline.windowSize, 30);
  assert.equal(config.harness.baseline.minSessions, 5);
  assert.equal(config.harness.baseline.warnZ, 1);
  assert.equal(config.harness.baseline.criticalZ, 2);
});

test('mergeConfig accepts partial Phase 2 overrides without discarding defaults', () => {
  const config = mergeConfig({
    harness: {
      readEditRatio: { warning: 3.0 },
      baseline: { windowSize: 50 },
    },
  });
  assert.equal(config.harness.readEditRatio.warning, 3.0);
  // Defaults retained:
  assert.equal(config.harness.readEditRatio.show, true);
  assert.equal(config.harness.readEditRatio.critical, 1.5);
  assert.equal(config.harness.baseline.windowSize, 50);
  assert.equal(config.harness.baseline.enabled, true);
  assert.equal(config.harness.baseline.minSessions, 5);
});

test('renderHarnessLines does not crash on bare harness health without Phase 2 fields', () => {
  setLanguage('zh');

  const ctx = baseRenderContext({
    harness: {
      score: 80,
      trend: 'stable',
      components: [],
      totalEvents: 0,
      totalViolations: 0,
      sessionEvents: 0,
      recentEvents: [],
      // No readEditRatio, no violationBreakdown, no baseline — legacy shape
    },
  });

  const lines = renderHarnessLines(ctx);
  assert.ok(Array.isArray(lines), 'expected lines array');
  assert.ok(lines.length >= 1, 'expected at least the summary line');
  const plain = lines.map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
  assert.ok(!plain.some(line => line.includes('R/E:')), 'no R/E line');
  assert.ok(!plain.some(line => line.includes('基线:')), 'no baseline line');
  assert.ok(!plain.some(line => line.includes('⚠') && line.includes('违规:')), 'no breakdown line');
});
