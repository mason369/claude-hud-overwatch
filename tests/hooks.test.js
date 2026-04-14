import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

const REAL_HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
const HOOKS_DIR = path.join(REAL_HOME, '.claude', 'hooks');
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

async function prepareHookHome(homeDir) {
  const targetDir = path.join(homeDir, '.claude', 'hooks');
  await mkdir(targetDir, { recursive: true });

  for (const entry of await readdir(HOOKS_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    await copyFile(
      path.join(HOOKS_DIR, entry.name),
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

  return spawnSync(BASH_COMMAND, [toBashPath(path.join(HOOKS_DIR, scriptName)), ...args], {
    cwd: path.resolve(process.cwd()),
    input,
    encoding: 'utf8',
    env,
  });
}

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
