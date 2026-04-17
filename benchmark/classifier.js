import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

export async function loadEnabledSessionIds(eventsPath) {
  const ids = new Set();
  let content;
  try {
    content = await readFile(eventsPath, "utf8");
  } catch {
    return ids;
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const sid = parsed.session ?? parsed.sessionId;
      if (typeof sid === "string" && sid.length > 0) ids.add(sid);
    } catch {
      // skip malformed lines
    }
  }
  return ids;
}

// Stream-read the first non-empty line from a file. For multi-MB transcripts
// this avoids buffering the whole file into memory just to peek at the first
// line's JSON. Returns "" when the file exists but has no non-empty lines.
// Throws (ENOENT/EACCES/etc.) when the file cannot be opened — the caller
// uses that to distinguish "missing file" (return null) from "present file
// with unparseable first line" (fall back to filename basename).
async function defaultFirstLineReader(filePath) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  // Surface open errors (ENOENT/EACCES) as a rejection so the caller can
  // tell the file apart from present-but-unreadable content.
  const openError = new Promise((_, reject) => {
    stream.once("error", reject);
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    const iterator = rl[Symbol.asyncIterator]();
    while (true) {
      const nextPromise = iterator.next();
      const result = await Promise.race([nextPromise, openError]);
      if (result.done) return "";
      const trimmed = result.value.trim();
      if (trimmed) return trimmed;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

let firstLineReaderImpl = defaultFirstLineReader;

// Test seam mirroring src/transcript.ts's _setCreateReadStreamForTests.
// Pass `null` to restore the default stream-based reader.
export function _setFirstLineReaderForTests(impl) {
  firstLineReaderImpl = impl ?? defaultFirstLineReader;
}

export async function extractSessionId(transcriptPath) {
  let firstLine = "";
  try {
    firstLine = await firstLineReaderImpl(transcriptPath);
  } catch {
    return null;
  }
  if (firstLine) {
    try {
      const parsed = JSON.parse(firstLine);
      const sid = parsed.sessionId ?? parsed.session;
      if (typeof sid === "string" && sid.length > 0) return sid;
    } catch {
      // fall through to filename
    }
  }
  const base = path.basename(transcriptPath, path.extname(transcriptPath));
  return base.length > 0 ? base : null;
}

export function classifySession(sessionId, enabledIds) {
  if (!sessionId) return "unknown";
  return enabledIds.has(sessionId) ? "enabled" : "disabled";
}
