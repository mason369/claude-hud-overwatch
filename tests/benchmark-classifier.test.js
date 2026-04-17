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

test("extractSessionId stops after the first line and ignores trailing bytes", async () => {
  // Write a valid first line, then a large amount of content that would
  // throw on JSON.parse and waste I/O. If extractSessionId still returns
  // the first-line sessionId, it proves we are not reading the entire
  // file — we only pull the first non-empty line off the stream.
  const dir = await mkdtemp(path.join(tmpdir(), "cls-"));
  const file = path.join(dir, "session-large.jsonl");
  const firstLine = JSON.stringify({ sessionId: "sid-first-line" });
  // ~1 MiB of garbage. Loading this via readFile+JSON.parse would reject
  // cleanly, but loading it at all is exactly the wasted I/O the stream
  // change aims to eliminate. We can't assert I/O volume directly from
  // node:test, but we can at least prove the first-line value resolves
  // even though subsequent lines are intentionally malformed.
  const garbageChunk = "{".repeat(1024) + "\n";
  const garbage = garbageChunk.repeat(1024); // ~1 MiB
  await writeFile(file, firstLine + "\n" + garbage, "utf8");
  assert.equal(await extractSessionId(file), "sid-first-line");
  await rm(dir, { recursive: true, force: true });
});

test("extractSessionId uses the pluggable stream-read hook", async () => {
  // Regression guard for the stream-read fix: the function must route
  // file reads through _setFirstLineReaderForTests so that callers can
  // verify only the first line is consumed. A readFile-based impl has
  // no such hook; the stream impl exposes one the same way
  // src/transcript.ts exposes _setCreateReadStreamForTests.
  const mod = await import("../benchmark/classifier.js");
  assert.equal(
    typeof mod._setFirstLineReaderForTests,
    "function",
    "extractSessionId must use an injectable first-line reader",
  );

  const calls = [];
  mod._setFirstLineReaderForTests(async (p) => {
    calls.push(p);
    return JSON.stringify({ sessionId: "stub-sid" });
  });
  try {
    const sid = await mod.extractSessionId("/any/path.jsonl");
    assert.equal(sid, "stub-sid");
    assert.deepEqual(calls, ["/any/path.jsonl"]);
  } finally {
    mod._setFirstLineReaderForTests(null);
  }
});
