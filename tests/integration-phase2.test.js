import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

function stripAnsi(text) {
  return text.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><]/g,
    "",
  );
}

function skipIfSpawnBlocked(result, t) {
  if (result.error?.code === "EPERM") {
    t.skip("spawnSync is blocked by sandbox policy in this environment");
    return true;
  }
  return false;
}

async function setupPhase2Fixture(homeDir) {
  const claudeDir = path.join(homeDir, ".claude");
  const logsDir = path.join(claudeDir, "logs");
  const hooksDir = path.join(claudeDir, "hooks");
  await mkdir(logsDir, { recursive: true });
  await mkdir(hooksDir, { recursive: true });

  const sessionId = "integration-phase2-session";
  const transcriptPath = path.join(claudeDir, "transcript.jsonl");

  const transcriptLines = [];
  for (let i = 0; i < 10; i += 1) {
    transcriptLines.push(
      JSON.stringify({
        timestamp: `2026-04-17T10:${String(i).padStart(2, "0")}:00.000Z`,
        message: {
          content: [
            {
              type: "tool_use",
              id: `read-${i}`,
              name: "Read",
              input: { file_path: `/tmp/file${i}.js` },
            },
          ],
        },
      }),
    );
  }
  for (let i = 0; i < 3; i += 1) {
    transcriptLines.push(
      JSON.stringify({
        timestamp: `2026-04-17T10:${String(10 + i).padStart(2, "0")}:00.000Z`,
        message: {
          content: [
            {
              type: "tool_use",
              id: `edit-${i}`,
              name: "Edit",
              input: {
                file_path: `/tmp/edit${i}.js`,
                old_string: "abcdefghij",
                new_string: "klmnopqrst",
              },
            },
          ],
        },
      }),
    );
  }
  await writeFile(transcriptPath, transcriptLines.join("\n") + "\n", "utf8");

  const eventsLines = [
    JSON.stringify({
      ts: "2026-04-17T10:00:00.000Z",
      event: "lifecycle",
      source: "session-init",
      session: sessionId,
      transcript: transcriptPath,
      category: "boundary",
      detail: "session-start",
      severity: "info",
    }),
    JSON.stringify({
      ts: "2026-04-17T10:01:00.000Z",
      event: "violation",
      source: "stop-phrase-guard",
      session: sessionId,
      transcript: transcriptPath,
      category: "premature-stop",
      detail: "detected_checkpoint_phrase",
      severity: "warning",
    }),
    JSON.stringify({
      ts: "2026-04-17T10:02:00.000Z",
      event: "violation",
      source: "stop-phrase-guard",
      session: sessionId,
      transcript: transcriptPath,
      category: "premature-stop",
      detail: "detected_checkpoint_phrase",
      severity: "warning",
    }),
    JSON.stringify({
      ts: "2026-04-17T10:03:00.000Z",
      event: "violation",
      source: "stop-phrase-guard",
      session: sessionId,
      transcript: transcriptPath,
      category: "ownership-deflection",
      detail: "pre_existing_claim",
      severity: "warning",
    }),
  ];
  await writeFile(
    path.join(logsDir, "harness-events.jsonl"),
    eventsLines.join("\n") + "\n",
    "utf8",
  );

  const summarySessions = [4.5, 4.8, 5.0, 5.0, 5.2, 5.5];
  const summaryLines = summarySessions.map((ratio, idx) =>
    JSON.stringify({
      ts: `2026-04-1${idx}T10:00:00.000Z`,
      session: `baseline-${idx}`,
      transcript: "",
      duration_s: 3600,
      read_count: Math.round(ratio * 10),
      edit_count: 10,
      write_count: 0,
      r_e_ratio: ratio,
      guard_blocks: 0,
      sensor_triggers: 0,
      violations_total: 0,
      violations_by_category: {},
    }),
  );
  await writeFile(
    path.join(logsDir, "session-summary.jsonl"),
    summaryLines.join("\n") + "\n",
    "utf8",
  );

  const settings = {
    hooks: {
      PreToolUse: [
        { command: `${hooksDir}/research-first-guard.sh` },
        { command: `${hooksDir}/edit-quality-guard.sh` },
        { command: `${hooksDir}/safety-gate.sh` },
      ],
      PostToolUse: [
        { command: `${hooksDir}/read-tracker.sh` },
        { command: `${hooksDir}/grep-tracker.sh` },
        { command: `${hooksDir}/auto-format.sh` },
      ],
      UserPromptSubmit: [{ command: `${hooksDir}/prompt-rescuer.sh` }],
      Stop: [
        { command: `${hooksDir}/stop-phrase-guard.sh` },
        { command: `${hooksDir}/session-summary.sh` },
      ],
    },
  };
  await writeFile(
    path.join(claudeDir, "settings.json"),
    JSON.stringify(settings, null, 2),
    "utf8",
  );

  return { sessionId, transcriptPath, claudeDir };
}

test("Phase 2 HUD renders R/E ratio, violation breakdown, and baseline drift", async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-phase2-"));
  const projectDir = path.join(homeDir, "dev", "apps", "integration-project");
  await mkdir(projectDir, { recursive: true });

  try {
    const { sessionId, transcriptPath } = await setupPhase2Fixture(homeDir);

    const stdin = JSON.stringify({
      session_id: sessionId,
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: transcriptPath,
      cwd: projectDir,
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        CLAUDE_CONFIG_DIR: path.join(homeDir, ".claude"),
      },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || "non-zero exit");

    const plainOutput = stripAnsi(result.stdout).replace(/\u00A0/g, " ");
    const lines = plainOutput.split("\n");

    const dashboardLine = lines.find((line) => line.includes("防护"));
    assert.ok(dashboardLine, `missing harness dashboard line:\n${plainOutput}`);

    const readEditLine = lines.find((line) => /R\/E:\s*3\.3/.test(line));
    assert.ok(
      readEditLine,
      `missing R/E ratio line matching 3.3:\n${plainOutput}`,
    );
    assert.match(readEditLine, /读:10/);
    assert.match(readEditLine, /改:3/);
    assert.match(readEditLine, /写:0/);

    const breakdownLine = lines.find(
      (line) => line.includes("\u26A0") && line.includes("违规:"),
    );
    assert.ok(
      breakdownLine,
      `missing violation breakdown line:\n${plainOutput}`,
    );
    assert.match(breakdownLine, /过早停[\u00D7x]2/);
    assert.match(breakdownLine, /逃避[\u00D7x]1/);

    const baselineLine = lines.find(
      (line) => line.includes("基线:") && line.includes("R/E"),
    );
    assert.ok(baselineLine, `missing baseline line:\n${plainOutput}`);
    assert.match(baselineLine, /R\/E\s+5\.0/);
    assert.match(baselineLine, /6会话/);
    assert.match(baselineLine, /σ/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("Phase 2 HUD shows baseline collecting message with fewer than minSessions", async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "claude-hud-phase2-"));
  const projectDir = path.join(homeDir, "dev", "apps", "integration-project");
  await mkdir(projectDir, { recursive: true });

  try {
    const { sessionId, transcriptPath } = await setupPhase2Fixture(homeDir);
    const logsDir = path.join(homeDir, ".claude", "logs");
    const summaryLines = [
      JSON.stringify({
        ts: "2026-04-10T10:00:00.000Z",
        session: "baseline-only-one",
        transcript: "",
        duration_s: 3600,
        read_count: 50,
        edit_count: 10,
        write_count: 0,
        r_e_ratio: 5.0,
        guard_blocks: 0,
        sensor_triggers: 0,
        violations_total: 0,
        violations_by_category: {},
      }),
    ];
    await writeFile(
      path.join(logsDir, "session-summary.jsonl"),
      summaryLines.join("\n") + "\n",
      "utf8",
    );

    const stdin = JSON.stringify({
      session_id: sessionId,
      model: { display_name: "Opus" },
      context_window: {
        context_window_size: 200000,
        current_usage: { input_tokens: 45000 },
      },
      transcript_path: transcriptPath,
      cwd: projectDir,
    });

    const result = spawnSync("node", ["dist/index.js"], {
      cwd: path.resolve(process.cwd()),
      input: stdin,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        CLAUDE_CONFIG_DIR: path.join(homeDir, ".claude"),
      },
    });

    if (skipIfSpawnBlocked(result, t)) return;

    assert.equal(result.status, 0, result.stderr || "non-zero exit");

    const plainOutput = stripAnsi(result.stdout).replace(/\u00A0/g, " ");
    const baselineLine = plainOutput
      .split("\n")
      .find((line) => line.includes("基线:"));
    assert.ok(baselineLine, `missing baseline line:\n${plainOutput}`);
    assert.match(baselineLine, /收集中/);
    assert.match(baselineLine, /\(1\/5\)/);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
