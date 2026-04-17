import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { computeMetrics, countViolations } from "../benchmark/metrics.js";

async function writeTranscript(lines) {
  const dir = await mkdtemp(path.join(tmpdir(), "met-"));
  const file = path.join(dir, "session.jsonl");
  await writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
  return { dir, file };
}

test("computeMetrics counts interrupt only on user text starting with marker", async () => {
  // Parity with src/transcript.ts:365-374:
  //   entry.type === "user" AND block.type === "text" AND
  //   block.text.startsWith("[Request interrupted by user")
  const { dir, file } = await writeTranscript([
    // 1) Real interrupt — must count.
    {
      type: "user",
      message: {
        content: [
          {
            type: "text",
            text: "[Request interrupted by user for tool use]",
          },
        ],
      },
    },
    // 2) Assistant mentioning the phrase — must NOT count (wrong role).
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "[Request interrupted by user] was the last message",
          },
        ],
      },
    },
    // 3) User mentioning phrase mid-string — must NOT count (not anchored).
    {
      type: "user",
      message: {
        content: [
          {
            type: "text",
            text: "Previously: [Request interrupted by user]",
          },
        ],
      },
    },
    // 4) User block with matching text but wrong block type — must NOT count.
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            text: "[Request interrupted by user]",
          },
        ],
      },
    },
    // Give computeMetrics at least one tool so it doesn't return null.
    {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", id: "t1", input: {} }],
      },
    },
  ]);

  const m = await computeMetrics(file);
  assert.ok(m, "metrics should not be null");
  // Only entry 1 should count.
  // interrupts_per_1k = (1 * 1000) / totalTools(1) = 1000
  assert.equal(m.interrupts_per_1k, 1000);
  await rm(dir, { recursive: true, force: true });
});

test("countViolations remains backward-compatible", () => {
  const events = [
    { event: "violation", session: "a" },
    { event: "violation", session: "b" },
    { event: "violation", session: "a" },
  ];
  assert.equal(countViolations(events, "a"), 2);
  assert.equal(countViolations(events, "b"), 1);
  assert.equal(countViolations(events, "c"), 0);
});
