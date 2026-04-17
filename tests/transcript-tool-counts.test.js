import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTranscript } from "../dist/transcript.js";

function buildToolUseLine(id, name, input = {}) {
  return JSON.stringify({
    timestamp: "2024-01-01T00:00:00.000Z",
    message: {
      content: [{ type: "tool_use", id, name, input }],
    },
  });
}

test("parseTranscript aggregates toolCounts for every tool_use block", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "claude-hud-tool-counts-"));
  const filePath = path.join(dir, "tool-counts.jsonl");

  const lines = [];
  // 10 Read
  for (let i = 0; i < 10; i++) {
    lines.push(
      buildToolUseLine(`read-${i}`, "Read", {
        file_path: `/tmp/file-${i}.txt`,
      }),
    );
  }
  // 5 Edit
  for (let i = 0; i < 5; i++) {
    lines.push(
      buildToolUseLine(`edit-${i}`, "Edit", {
        file_path: `/tmp/file-${i}.txt`,
      }),
    );
  }
  // 2 Write
  for (let i = 0; i < 2; i++) {
    lines.push(
      buildToolUseLine(`write-${i}`, "Write", {
        file_path: `/tmp/out-${i}.txt`,
      }),
    );
  }
  // 20 Bash (exceeds slice(-20) boundary — proves counts are independent)
  for (let i = 0; i < 20; i++) {
    lines.push(
      buildToolUseLine(`bash-${i}`, "Bash", { command: `echo step-${i}` }),
    );
  }

  await writeFile(filePath, lines.join("\n"), "utf8");

  try {
    const result = await parseTranscript(filePath);

    // toolCounts should be populated regardless of slice(-20)
    assert.ok(result.toolCounts, "toolCounts should be defined");
    assert.equal(result.toolCounts.Read, 10);
    assert.equal(result.toolCounts.Edit, 5);
    assert.equal(result.toolCounts.Write, 2);
    assert.equal(result.toolCounts.Bash, 20);

    // Sanity: tools array is still capped by slice(-20)
    assert.equal(result.tools.length, 20);

    // Cumulative count total must exceed slice cap → proves independence
    const total = Object.values(result.toolCounts).reduce((a, b) => a + b, 0);
    assert.equal(total, 37);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseTranscript toolCounts defaults to empty object when no tool_use blocks", async () => {
  const dir = await mkdtemp(
    path.join(tmpdir(), "claude-hud-tool-counts-empty-"),
  );
  const filePath = path.join(dir, "empty.jsonl");
  await writeFile(
    filePath,
    JSON.stringify({ type: "user", message: { content: [] } }),
    "utf8",
  );

  try {
    const result = await parseTranscript(filePath);
    assert.ok(result.toolCounts, "toolCounts should always be defined");
    assert.deepEqual(result.toolCounts, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseTranscript toolCounts returns empty object when transcript missing", async () => {
  const result = await parseTranscript("/tmp/does-not-exist-tool-counts.jsonl");
  assert.ok(
    result.toolCounts,
    "toolCounts should be defined even for missing file",
  );
  assert.deepEqual(result.toolCounts, {});
});

test("parseTranscript toolCounts handles blocks without name gracefully", async () => {
  const dir = await mkdtemp(
    path.join(tmpdir(), "claude-hud-tool-counts-nameless-"),
  );
  const filePath = path.join(dir, "nameless.jsonl");
  const lines = [
    JSON.stringify({
      timestamp: "2024-01-01T00:00:00.000Z",
      message: {
        content: [
          { type: "tool_use", id: "x-1" }, // no name
          {
            type: "tool_use",
            id: "x-2",
            name: "Grep",
            input: { pattern: "foo" },
          },
        ],
      },
    }),
  ];
  await writeFile(filePath, lines.join("\n"), "utf8");

  try {
    const result = await parseTranscript(filePath);
    // Grep counts; nameless block does NOT count (guarded by `block.id && block.name`)
    assert.equal(result.toolCounts.Grep, 1);
    assert.equal(result.toolCounts.unknown, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
