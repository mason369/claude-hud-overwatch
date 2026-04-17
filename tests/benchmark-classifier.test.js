import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  loadEnabledSessionIds,
  classifySession,
  extractSessionId,
} from "../benchmark/classifier.js";

test("loadEnabledSessionIds returns empty Set when file missing", async () => {
  const ids = await loadEnabledSessionIds("/nonexistent/path.jsonl");
  assert.ok(ids instanceof Set);
  assert.equal(ids.size, 0);
});

test("loadEnabledSessionIds parses session ids from jsonl", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cls-"));
  const file = path.join(dir, "events.jsonl");
  const lines = [
    JSON.stringify({ event: "lifecycle", session: "aaa" }),
    JSON.stringify({ event: "violation", session: "bbb" }),
    JSON.stringify({ event: "lifecycle", session: "aaa" }),
    "not-json",
    JSON.stringify({ event: "lifecycle" }),
  ];
  await writeFile(file, lines.join("\n"), "utf8");
  const ids = await loadEnabledSessionIds(file);
  assert.equal(ids.size, 2);
  assert.ok(ids.has("aaa"));
  assert.ok(ids.has("bbb"));
  await rm(dir, { recursive: true, force: true });
});

test("classifySession returns enabled when id matches", () => {
  const enabled = new Set(["aaa"]);
  assert.equal(classifySession("aaa", enabled), "enabled");
  assert.equal(classifySession("ccc", enabled), "disabled");
});

test("classifySession returns unknown for null id", () => {
  assert.equal(classifySession(null, new Set()), "unknown");
  assert.equal(classifySession(undefined, new Set()), "unknown");
});

test("extractSessionId prefers first-line sessionId field", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cls-"));
  const file = path.join(dir, "abc-def.jsonl");
  await writeFile(
    file,
    JSON.stringify({ sessionId: "from-field" }) + "\n",
    "utf8",
  );
  assert.equal(await extractSessionId(file), "from-field");
  await rm(dir, { recursive: true, force: true });
});

test("extractSessionId falls back to filename without extension", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cls-"));
  const file = path.join(dir, "uuid-aaa-bbb.jsonl");
  await writeFile(file, "garbage\n", "utf8");
  assert.equal(await extractSessionId(file), "uuid-aaa-bbb");
  await rm(dir, { recursive: true, force: true });
});

test("extractSessionId returns null when file does not exist", async () => {
  assert.equal(await extractSessionId("/definitely/not/here.jsonl"), null);
});

test("extractSessionId uses filename even when file has garbage content", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cls-"));
  const file = path.join(dir, "session-123.jsonl");
  await writeFile(file, "not-json\n", "utf8");
  assert.equal(await extractSessionId(file), "session-123");
  await rm(dir, { recursive: true, force: true });
});
