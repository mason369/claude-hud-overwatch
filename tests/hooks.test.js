import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REAL_HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
const HOOKS_FIXTURES_DIR = fileURLToPath(new URL('../../hooks/', import.meta.url));
const BASH_COMMAND = (() => {
  if (process.platform !== 'win32') {
    return 'bash';
  }

  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ];

  return candidates.find(candidate => existsSync(candidate)) ?? 'bash';
})();

function toBashPath(filePath) {
  if (process.platform !== 'win32') {
    return filePath;
  }

  return filePath
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

function skipIfSpawnUnavailable(result, t) {
  const code = result.error?.code;
  if (code === 'EPERM') {
    t.skip('spawnSync is blocked by sandbox policy in this environment');
    return true;
  }

  if (code === 'ENOENT') {
    t.skip(`required executable is unavailable: ${result.error?.message ?? code}`);
    return true;
  }

  return false;
}

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function waitForFileContains(filePath, expectedText, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const content = await readFile(filePath, 'utf8');
      if (content.includes(expectedText)) {
        return content;
      }
    } catch {
      // Ignore missing files while polling.
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for ${filePath} to contain ${expectedText}`);
}

function getHooksDirForHome(homeDir) {
  return path.join(homeDir, '.claude', 'hooks');
}

async function writeExecutable(filePath, content) {
  await writeFile(filePath, content, 'utf8');
  await chmod(filePath, 0o755);
}

function prependPath(directory, currentPath = process.env.PATH ?? '') {
  return currentPath ? `${directory}${path.delimiter}${currentPath}` : directory;
}

async function prepareHookHome(homeDir) {
  const targetDir = getHooksDirForHome(homeDir);
  await mkdir(targetDir, { recursive: true });

  for (const entry of await readdir(HOOKS_FIXTURES_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    await copyFile(
      path.join(HOOKS_FIXTURES_DIR, entry.name),
      path.join(targetDir, entry.name),
    );
  }
}

function runHook(scriptName, options = {}) {
  const {
    input = '',
    env = process.env,
    args = [],
  } = options;
  const hookHome = env.USERPROFILE ?? env.HOME ?? REAL_HOME;
  const hooksDir = getHooksDirForHome(hookHome);

  return spawnSync(BASH_COMMAND, [toBashPath(path.join(hooksDir, scriptName)), ...args], {
    cwd: path.resolve(process.cwd()),
    input,
    encoding: 'utf8',
    env,
  });
}

test('runHook executes the copied hook script from the temp HOME', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-hook-home-'));
  const markerPath = path.join(homeDir, 'copied-hook-marker.txt');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await writeExecutable(path.join(getHooksDirForHome(homeDir), 'task-completed-gate.sh'), [
      '#!/usr/bin/env bash',
      'printf \'temp-home-hook\' > "$HOOK_MARKER"',
      '',
    ].join('\n'));

    const result = runHook('task-completed-gate.sh', {
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        HOOK_MARKER: toBashPath(markerPath),
      },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, result.stderr || 'copied hook should execute successfully');
    assert.equal(await readFile(markerPath, 'utf8'), 'temp-home-hook');
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('task-completed hook writes session metadata into counter and event logs', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-hook-home-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    const logDir = path.join(homeDir, '.claude', 'logs');
    await mkdir(logDir, { recursive: true });
    const input = JSON.stringify({
      session_id: 'session-hook-a',
      transcript_path: 'C:/tmp/transcript-hook-a.jsonl',
      task_name: 'ship metadata',
    });

    const result = runHook('task-completed-gate.sh', {
      input,
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, result.stderr || 'task-completed hook should succeed');

    const counterContent = await waitForFileContains(
      path.join(logDir, 'hook-counters.csv'),
      '"session_id":"session-hook-a"',
    );
    const eventsContent = await waitForFileContains(
      path.join(logDir, 'hook-events.log'),
      '"session_id":"session-hook-a"',
    );

    assert.ok(counterContent.includes('"transcript_path":"C:/tmp/transcript-hook-a.jsonl"'), counterContent);
    assert.ok(eventsContent.includes('"transcript_path":"C:/tmp/transcript-hook-a.jsonl"'), eventsContent);
    assert.ok(eventsContent.includes('ship metadata'), eventsContent);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('completion-gate detects .NET solution roots that only contain a .sln file', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-completion-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-completion-project-'));
  const binDir = path.join(homeDir, 'bin');
  const markerPath = path.join(homeDir, 'dotnet-args.txt');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await mkdir(binDir, { recursive: true });
    await writeExecutable(path.join(binDir, 'dotnet'), [
      '#!/usr/bin/env bash',
      'printf \'%s\' "$*" > "$DOTNET_MARKER"',
      'exit 0',
      '',
    ].join('\n'));
    await writeFile(path.join(projectDir, 'Demo.sln'), '', 'utf8');

    const result = runHook('completion-gate.sh', {
      input: JSON.stringify({
        session_id: 'session-dotnet-sln',
        transcript_path: 'C:/tmp/session-dotnet-sln.jsonl',
        cwd: projectDir,
      }),
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        DOTNET_MARKER: toBashPath(markerPath),
        PATH: prependPath(binDir, process.env.PATH),
      },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, result.stderr || result.stdout || 'completion-gate should succeed');
    assert.match(await readFile(markerPath, 'utf8'), /^test\b/, 'expected completion-gate to run dotnet test');

    const harnessEvents = await waitForFileContains(
      path.join(homeDir, '.claude', 'logs', 'harness-events.jsonl'),
      '"source":"completion-gate"',
    );
    assert.ok(harnessEvents.includes('"category":"tests_passed"'), harnessEvents);
    assert.ok(!harnessEvents.includes('"category":"no_tests"'), harnessEvents);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('completion-gate detects a working npm test script from a Windows cwd', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows cwd normalization only applies on Windows');
  }

  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-completion-home-'));
  const projectDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-completion-project-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await writeFile(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'completion-gate-smoke',
      version: '1.0.0',
      scripts: {
        test: 'node --test',
      },
    }, null, 2), 'utf8');
    await writeFile(path.join(projectDir, 'smoke.test.js'), [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      '',
      "test('smoke', () => {",
      '  assert.equal(1, 1);',
      '});',
      '',
    ].join('\n'), 'utf8');

    const result = runHook('completion-gate.sh', {
      input: JSON.stringify({
        session_id: 'session-completion',
        transcript_path: 'C:/tmp/session-completion.jsonl',
        cwd: projectDir,
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, result.stderr || result.stdout || 'completion-gate should succeed');

    const harnessEvents = await waitForFileContains(
      path.join(homeDir, '.claude', 'logs', 'harness-events.jsonl'),
      '"source":"completion-gate"',
      10000,
    );

    assert.ok(harnessEvents.includes('"category":"tests_passed"'), harnessEvents);
    assert.ok(!harnessEvents.includes('"category":"no_tests"'), harnessEvents);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
});

test('auto-format uses bunx resolved from PATH instead of a workstation-specific absolute path', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-format-home-'));
  const workspaceDir = path.join(homeDir, 'workspace');
  const binDir = path.join(homeDir, 'bin');
  const markerPath = path.join(homeDir, 'bunx-args.txt');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await mkdir(workspaceDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeExecutable(path.join(binDir, 'bunx'), [
      '#!/usr/bin/env bash',
      'printf \'%s\' "$*" > "$BUNX_MARKER"',
      'exit 0',
      '',
    ].join('\n'));

    const filePath = path.join(workspaceDir, 'format-me.ts');
    await writeFile(filePath, 'export const value={answer:42};\n', 'utf8');

    const result = runHook('auto-format.sh', {
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        BUNX_MARKER: toBashPath(markerPath),
        PATH: prependPath(binDir, process.env.PATH),
      },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, result.stderr || result.stdout || 'auto-format should succeed');
    const bunxArgs = await readFile(markerPath, 'utf8');
    assert.match(bunxArgs, /^prettier --write /, `expected PATH bunx shim to be used, got: ${bunxArgs}`);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('research-first guard keeps read tracking session-scoped', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-research-home-'));
  const workspaceDir = path.join(homeDir, 'workspace');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await mkdir(workspaceDir, { recursive: true });
    const targetFile = path.join(workspaceDir, 'scoped.txt');
    await writeFile(targetFile, 'hello\n', 'utf8');

    const readResult = runHook('read-tracker.sh', {
      input: JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: targetFile },
        session_id: 'session-reader',
        transcript_path: 'C:/tmp/session-reader.jsonl',
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(readResult, t)) return;

    assert.equal(readResult.status, 0, readResult.stderr || 'read-tracker should succeed');

    const editResult = runHook('research-first-guard.sh', {
      input: JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: targetFile },
        session_id: 'session-editor',
        transcript_path: 'C:/tmp/session-editor.jsonl',
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    assert.equal(editResult.status, 2, `expected edit from another session to be blocked, got ${editResult.status}\n${editResult.stdout}\n${editResult.stderr}`);

    const violations = await waitForFileContains(
      path.join(homeDir, '.claude', 'logs', 'research-first-violations.log'),
      '"session_id":"session-editor"',
    );

    assert.ok(violations.includes('"transcript_path":"C:/tmp/session-editor.jsonl"'), violations);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('research-first guard allows Write on an existing file without requiring a prior Read', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-research-home-'));
  const workspaceDir = path.join(homeDir, 'workspace');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await mkdir(workspaceDir, { recursive: true });
    const targetFile = path.join(workspaceDir, 'scratch.py');
    await writeFile(targetFile, 'print("hello")\n', 'utf8');

    const writeResult = runHook('research-first-guard.sh', {
      input: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: targetFile },
        session_id: 'session-writer',
        transcript_path: 'C:/tmp/session-writer.jsonl',
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(writeResult, t)) return;

    assert.equal(writeResult.status, 0, `Write on an existing scratch file should not be blocked\n${writeResult.stdout}\n${writeResult.stderr}`);
    assert.equal(writeResult.stdout, '');
    assert.equal(writeResult.stderr, '');
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('subagent logger writes session metadata for lifecycle events', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-subagent-home-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    const result = runHook('subagent-logger.sh', {
      input: JSON.stringify({
        hook_event_name: 'SubagentStop',
        agent_type: 'reviewer',
        agent_id: 'abc123456789',
        session_id: 'session-subagent',
        transcript_path: 'C:/tmp/subagent-session.jsonl',
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, result.stderr || 'subagent logger should succeed');

    const content = await waitForFileContains(
      path.join(homeDir, '.claude', 'logs', 'subagent.log'),
      '"session_id":"session-subagent"',
    );

    assert.ok(content.includes('"transcript_path":"C:/tmp/subagent-session.jsonl"'), content);
    assert.ok(content.includes('reviewer'), content);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('completion-gate runs npm test without injecting extra argv', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-completion-home-'));
  const workspaceDir = path.join(homeDir, 'workspace');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(path.join(workspaceDir, 'package.json'), JSON.stringify({
      name: 'completion-gate-argv',
      version: '1.0.0',
      scripts: {
        test: 'node -e "if (process.argv.length > 1) { console.error(process.argv.slice(1).join(\' \')); process.exit(7); }"',
      },
    }, null, 2), 'utf8');

    const result = runHook('completion-gate.sh', {
      input: JSON.stringify({ cwd: workspaceDir }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, `completion-gate should allow npm tests without extra argv\n${result.stdout}\n${result.stderr}`);

    const harnessContent = await waitForFileContains(
      path.join(homeDir, '.claude', 'logs', 'harness-events.jsonl'),
      '"source":"completion-gate"',
    );
    assert.ok(harnessContent.includes('"category":"tests_passed"'), harnessContent);
    assert.ok(!harnessContent.includes('--reporter=dot'), harnessContent);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('completion-gate returns a structured Stop block when tests fail', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-completion-fail-home-'));
  const workspaceDir = path.join(homeDir, 'workspace');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(path.join(workspaceDir, 'package.json'), JSON.stringify({
      name: 'completion-gate-fail',
      version: '1.0.0',
      scripts: {
        test: 'node -e "console.error(\'boom\'); process.exit(5)"',
      },
    }, null, 2), 'utf8');

    const result = runHook('completion-gate.sh', {
      input: JSON.stringify({
        cwd: workspaceDir,
        last_assistant_message: 'All done.',
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, `completion-gate should return structured block JSON instead of a hook error\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr, '');

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.decision, 'block');
    assert.match(parsed.reason ?? '', /tests failed|stop blocked|fix/i);

    const harnessContent = await waitForFileContains(
      path.join(homeDir, '.claude', 'logs', 'harness-events.jsonl'),
      '"source":"completion-gate"',
    );
    assert.ok(harnessContent.includes('"category":"tests_failed"'), harnessContent);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('stop-phrase-guard returns a structured Stop block using last_assistant_message', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-stop-phrase-home-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);

    const result = runHook('stop-phrase-guard.sh', {
      input: JSON.stringify({
        session_id: 'session-stop-phrase',
        transcript_path: 'C:/tmp/session-stop-phrase.jsonl',
        last_assistant_message: 'Should I continue?',
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, `stop-phrase-guard should return structured block JSON instead of a hook error\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr, '');

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.decision, 'block');
    assert.match(parsed.reason ?? '', /permission|continue working|stop phrase/i);
    assert.match(parsed.reason ?? '', /should i continue/i);

    const harnessContent = await waitForFileContains(
      path.join(homeDir, '.claude', 'logs', 'harness-events.jsonl'),
      '"source":"stop-phrase-guard"',
    );
    assert.ok(harnessContent.includes('"category":"phrase_detected"'), harnessContent);
    assert.match(harnessContent, /should i continue/i);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('auto-format reports skipped instead of claiming success when no dotnet workspace is available', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-format-home-'));
  const workspaceDir = path.join(homeDir, 'workspace');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await mkdir(workspaceDir, { recursive: true });
    const filePath = path.join(workspaceDir, 'Program.cs');
    await writeFile(filePath, 'class   Program{static void Main(){}}', 'utf8');

    const result = runHook('auto-format.sh', {
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, result.stderr || 'auto-format should not crash when no formatter workspace exists');
    assert.doesNotThrow(() => JSON.parse(result.stdout), `expected hookSpecificOutput JSON, got: ${result.stdout}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.hookSpecificOutput?.hookEventName, 'PostToolUse');
    assert.match(parsed.hookSpecificOutput?.additionalContext ?? '', /skip|skipped|跳过/i);

    const harnessContent = await waitForFileContains(
      path.join(homeDir, '.claude', 'logs', 'harness-events.jsonl'),
      '"source":"auto-format"',
    );
    assert.ok(harnessContent.includes('"category":"format_skipped"'), harnessContent);
    assert.ok(!harnessContent.includes('"category":"format_applied"'), harnessContent);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('safety-gate returns a structured PreToolUse deny for destructive root deletion', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-safety-home-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);

    const result = runHook('safety-gate.sh', {
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /' },
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, `safety-gate should deny through structured JSON instead of failing the hook\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr, '');

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.hookSpecificOutput?.hookEventName, 'PreToolUse');
    assert.equal(parsed.hookSpecificOutput?.permissionDecision, 'deny');
    assert.match(parsed.hookSpecificOutput?.permissionDecisionReason ?? '', /rm -rf|destructive|danger/i);

    const harnessContent = await waitForFileContains(
      path.join(homeDir, '.claude', 'logs', 'harness-events.jsonl'),
      '"source":"safety-gate"',
    );
    assert.ok(harnessContent.includes('"category":"recursive_delete"'), harnessContent);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('safety-gate allows local sqlite FTS rebuild commands instead of blocking all DROP TABLE usage', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-safety-home-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);

    const result = runHook('safety-gate.sh', {
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: {
          command: "python3 -c \"import sqlite3; conn=sqlite3.connect('local.db'); conn.execute('DROP TABLE IF EXISTS nodes_fts')\"",
        },
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, `safety-gate should allow local sqlite repair commands\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');

    const harnessContent = await waitForFileContains(
      path.join(homeDir, '.claude', 'logs', 'harness-events.jsonl'),
      '"source":"safety-gate"',
    );
    assert.ok(harnessContent.includes('"category":"safe_command"'), harnessContent);
    assert.ok(!harnessContent.includes('"category":"sql_destructive"'), harnessContent);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('cbm gate allows code search tools after transcript shows codebase-memory-mcp usage', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cbm-home-'));
  const workspaceDir = path.join(homeDir, 'workspace');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await mkdir(workspaceDir, { recursive: true });
    const transcriptPath = path.join(workspaceDir, 'session.jsonl');
    await writeFile(transcriptPath, JSON.stringify({
      timestamp: '2026-04-16T09:00:00.000Z',
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_search_graph',
          name: 'mcp__codebase_memory_mcp__search_graph',
          input: { query: 'harness' },
        }],
      },
    }) + '\n', 'utf8');

    const result = runHook('cbm-code-discovery-gate', {
      input: JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: path.join(workspaceDir, 'example.ts') },
        session_id: 'session-cbm-after-mcp',
        transcript_path: transcriptPath,
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, `cbm gate should allow after MCP discovery usage\n${result.stdout}\n${result.stderr}`);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});
