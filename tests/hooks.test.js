import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

function sessionScopeKey(sessionId = '', transcriptPath = '') {
  return createHash('sha256')
    .update(`${sessionId}|${transcriptPath}`)
    .digest('hex');
}

function getCompletionGatePendingEditsFlagPath(homeDir, sessionId, transcriptPath) {
  return path.join(
    homeDir,
    '.claude',
    'logs',
    'completion-gate',
    `pending-edits-${sessionScopeKey(sessionId, transcriptPath)}.flag`,
  );
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
  const sessionId = 'session-dotnet-sln';
  const transcriptPath = 'C:/tmp/session-dotnet-sln.jsonl';
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
    await mkdir(path.dirname(getCompletionGatePendingEditsFlagPath(homeDir, sessionId, transcriptPath)), { recursive: true });
    await writeFile(getCompletionGatePendingEditsFlagPath(homeDir, sessionId, transcriptPath), 'dirty', 'utf8');

    const result = runHook('completion-gate.sh', {
      input: JSON.stringify({
        session_id: sessionId,
        transcript_path: transcriptPath,
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
  const sessionId = 'session-completion';
  const transcriptPath = 'C:/tmp/session-completion.jsonl';
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
    await mkdir(path.dirname(getCompletionGatePendingEditsFlagPath(homeDir, sessionId, transcriptPath)), { recursive: true });
    await writeFile(getCompletionGatePendingEditsFlagPath(homeDir, sessionId, transcriptPath), 'dirty', 'utf8');

    const result = runHook('completion-gate.sh', {
      input: JSON.stringify({
        session_id: sessionId,
        transcript_path: transcriptPath,
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

test('research-first guard blocks Write on an existing file without requiring a prior Read', async (t) => {
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

    assert.equal(writeResult.status, 2, `Write on an existing scratch file should require a prior Read\n${writeResult.stdout}\n${writeResult.stderr}`);
    assert.match(writeResult.stdout, /read the file now/i);
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('research-first guard allows Write on an existing file after a prior Read in the same session', async (t) => {
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
    const sessionId = 'session-writer';
    const transcriptPath = 'C:/tmp/session-writer.jsonl';
    await writeFile(targetFile, 'print("hello")\n', 'utf8');

    const readResult = runHook('read-tracker.sh', {
      input: JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: targetFile },
        session_id: sessionId,
        transcript_path: transcriptPath,
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(readResult, t)) return;

    assert.equal(readResult.status, 0, readResult.stderr || 'read-tracker should succeed');

    const writeResult = runHook('research-first-guard.sh', {
      input: JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: targetFile },
        session_id: sessionId,
        transcript_path: transcriptPath,
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    assert.equal(writeResult.status, 0, `Write should be allowed after a prior Read in the same session\n${writeResult.stdout}\n${writeResult.stderr}`);
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
  const sessionId = 'session-completion-argv';
  const transcriptPath = 'C:/tmp/session-completion-argv.jsonl';
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
    await mkdir(path.dirname(getCompletionGatePendingEditsFlagPath(homeDir, sessionId, transcriptPath)), { recursive: true });
    await writeFile(getCompletionGatePendingEditsFlagPath(homeDir, sessionId, transcriptPath), 'dirty', 'utf8');

    const result = runHook('completion-gate.sh', {
      input: JSON.stringify({
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd: workspaceDir,
      }),
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
  const sessionId = 'session-completion-fail';
  const transcriptPath = 'C:/tmp/session-completion-fail.jsonl';
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
    await mkdir(path.dirname(getCompletionGatePendingEditsFlagPath(homeDir, sessionId, transcriptPath)), { recursive: true });
    await writeFile(getCompletionGatePendingEditsFlagPath(homeDir, sessionId, transcriptPath), 'dirty', 'utf8');

    const result = runHook('completion-gate.sh', {
      input: JSON.stringify({
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd: workspaceDir,
        last_assistant_message: 'All done.',
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, `completion-gate should return structured block JSON instead of a hook error\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Running completion-gate: npm test/i);

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

test('completion-gate only runs after an Edit or Write in the current session and clears the pending marker after running', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-completion-dirty-home-'));
  const workspaceDir = path.join(homeDir, 'workspace');
  const runMarkerPath = path.join(homeDir, 'completion-gate-runs.log');
  const editedFilePath = path.join(workspaceDir, 'notes.md');
  const sessionId = 'session-completion-dirty';
  const transcriptPath = 'C:/tmp/session-completion-dirty.jsonl';
  const otherSessionId = 'session-completion-other';
  const otherTranscriptPath = 'C:/tmp/session-completion-other.jsonl';
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(path.join(workspaceDir, 'package.json'), JSON.stringify({
      name: 'completion-gate-dirty',
      version: '1.0.0',
      scripts: {
        test: 'node -e "require(\'node:fs\').appendFileSync(process.env.TEST_RUN_MARKER, \'run\\\\n\')"',
      },
    }, null, 2), 'utf8');
    await writeFile(editedFilePath, '# Notes\n', 'utf8');

    const stopInput = (activeSessionId, activeTranscriptPath) => JSON.stringify({
      session_id: activeSessionId,
      transcript_path: activeTranscriptPath,
      cwd: workspaceDir,
      last_assistant_message: 'All done.',
    });

    const initialStop = runHook('completion-gate.sh', {
      input: stopInput(sessionId, transcriptPath),
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        TEST_RUN_MARKER: runMarkerPath,
      },
    });

    if (skipIfSpawnUnavailable(initialStop, t)) return;

    assert.equal(initialStop.status, 0, initialStop.stderr || initialStop.stdout || 'completion-gate should skip when no edits happened in this session');
    assert.equal(initialStop.stdout, '');
    assert.equal(initialStop.stderr, '');
    assert.equal(existsSync(runMarkerPath), false, 'tests should not run before any edit/write marker exists');

    const markDirty = runHook('auto-format.sh', {
      input: JSON.stringify({
        session_id: sessionId,
        transcript_path: transcriptPath,
        tool_input: { file_path: editedFilePath },
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    assert.equal(markDirty.status, 0, markDirty.stderr || markDirty.stdout || 'auto-format should succeed while marking the session dirty');

    const otherSessionStop = runHook('completion-gate.sh', {
      input: stopInput(otherSessionId, otherTranscriptPath),
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        TEST_RUN_MARKER: runMarkerPath,
      },
    });

    assert.equal(otherSessionStop.status, 0, otherSessionStop.stderr || otherSessionStop.stdout || 'completion-gate should not reuse a different session marker');
    assert.equal(existsSync(runMarkerPath), false, 'tests should remain skipped for a different session');

    const sessionFlagPath = getCompletionGatePendingEditsFlagPath(homeDir, sessionId, transcriptPath);
    assert.equal(existsSync(sessionFlagPath), true, 'auto-format should mark the current session as having pending edits');

    const runStop = runHook('completion-gate.sh', {
      input: stopInput(sessionId, transcriptPath),
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        TEST_RUN_MARKER: runMarkerPath,
      },
    });

    assert.equal(runStop.status, 0, runStop.stderr || runStop.stdout || 'completion-gate should run tests after an edit/write in the same session');
    assert.equal(runStop.stdout, '');
    assert.match(runStop.stderr, /Running completion-gate: npm test/i);
    assert.match(runStop.stderr, /workspace/i);

    const runContent = await waitForFileContains(runMarkerPath, 'run');
    assert.equal(runContent.trim().split(/\r?\n/).length, 1, runContent);
    assert.equal(existsSync(sessionFlagPath), false, 'completion-gate should clear the pending edit marker after running tests');

    const harnessContent = await waitForFileContains(
      path.join(homeDir, '.claude', 'logs', 'harness-events.jsonl'),
      '"source":"completion-gate"',
    );
    assert.ok(harnessContent.includes('"category":"tests_running"'), harnessContent);
    assert.ok(harnessContent.includes('"category":"tests_passed"'), harnessContent);

    const secondStop = runHook('completion-gate.sh', {
      input: stopInput(sessionId, transcriptPath),
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        TEST_RUN_MARKER: runMarkerPath,
      },
    });

    assert.equal(secondStop.status, 0, secondStop.stderr || secondStop.stdout || 'completion-gate should skip after the pending marker has been cleared');
    assert.equal(secondStop.stdout, '');
    assert.equal(secondStop.stderr, '');
    assert.equal(await readFile(runMarkerPath, 'utf8'), runContent);
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

test('safety-gate allows destructive root deletion commands because safety enforcement is disabled', async (t) => {
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

    assert.equal(result.status, 0, `safety-gate should no longer block Bash commands\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');

    const harnessContent = await waitForFileContains(
      path.join(homeDir, '.claude', 'logs', 'harness-events.jsonl'),
      '"source":"safety-gate"',
    );
    assert.ok(harnessContent.includes('"category":"safe_command"'), harnessContent);
    assert.ok(!harnessContent.includes('"category":"recursive_delete"'), harnessContent);
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

test('linter protection allows edits to lint and formatter config files', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-linter-home-'));
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);

    const result = runHook('linter-config-protection.sh', {
      input: JSON.stringify({
        tool_name: 'Edit',
        tool_input: { file_path: 'C:/workspace/tsconfig.json' },
        session_id: 'session-linter-allow',
        transcript_path: 'C:/tmp/session-linter-allow.jsonl',
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, `linter protection should no longer block config edits\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('settings allow unrestricted Bash and no longer deny env or secrets access', async () => {
  const settingsPath = path.join(REAL_HOME, '.claude', 'settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  const allow = settings.permissions?.allow ?? [];
  const deny = settings.permissions?.deny ?? [];

  assert.ok(allow.includes('Bash'));
  assert.ok(!allow.some(entry => /^Bash\(.+\)$/.test(entry)), JSON.stringify(allow));
  assert.ok(!deny.some(entry => /(^|\/)\.env(\.\*|\)|$)|secrets\/\*\*|cat \.env|cat \.\/secrets/i.test(entry)), JSON.stringify(deny));
});

test('settings do not route Bash through safety-gate or Edit|Write through linter protection', async () => {
  const settingsPath = path.join(REAL_HOME, '.claude', 'settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  const preToolUse = settings.hooks?.PreToolUse ?? [];
  const safetyGroups = preToolUse.filter(group =>
    Array.isArray(group?.hooks)
    && group.hooks.some(hook => String(hook?.command ?? '').includes('safety-gate.sh')),
  );
  const linterGroups = preToolUse.filter(group =>
    Array.isArray(group?.hooks)
    && group.hooks.some(hook => String(hook?.command ?? '').includes('linter-config-protection.sh')),
  );

  assert.equal(safetyGroups.length, 0, JSON.stringify(preToolUse));
  assert.equal(linterGroups.length, 0, JSON.stringify(preToolUse));
});

test('settings do not route Read through the cbm discovery gate', async () => {
  const settingsPath = path.join(REAL_HOME, '.claude', 'settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  const cbmGroup = settings.hooks?.PreToolUse?.find(group =>
    Array.isArray(group?.hooks)
    && group.hooks.some(hook => String(hook?.command ?? '').includes('cbm-code-discovery-gate')),
  );

  assert.ok(cbmGroup, 'expected to find cbm discovery gate hook registration');
  assert.equal(cbmGroup.matcher, 'Grep|Glob|Search');
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

test('cbm gate allows reading markdown docs before MCP discovery is used', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cbm-home-'));
  const workspaceDir = path.join(homeDir, 'workspace');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await mkdir(path.join(workspaceDir, 'docs'), { recursive: true });

    const result = runHook('cbm-code-discovery-gate', {
      input: JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: path.join(workspaceDir, 'docs', 'design.md') },
        session_id: 'session-cbm-doc-read',
        transcript_path: path.join(workspaceDir, 'session.jsonl'),
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, `cbm gate should not block markdown reads\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test('cbm gate allows code reads before MCP discovery is used', async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cbm-home-'));
  const workspaceDir = path.join(homeDir, 'workspace');
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    await prepareHookHome(homeDir);
    await mkdir(path.join(workspaceDir, 'src'), { recursive: true });

    const result = runHook('cbm-code-discovery-gate', {
      input: JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: path.join(workspaceDir, 'src', 'feature.ts') },
        session_id: 'session-cbm-code-read',
        transcript_path: path.join(workspaceDir, 'session.jsonl'),
      }),
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
    });

    if (skipIfSpawnUnavailable(result, t)) return;

    assert.equal(result.status, 0, `cbm gate should not block code reads\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  } finally {
    restoreEnvVar('HOME', originalHome);
    restoreEnvVar('USERPROFILE', originalUserProfile);
    await rm(homeDir, { recursive: true, force: true });
  }
});
