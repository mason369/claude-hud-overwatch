import { readFile } from "node:fs/promises";
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

export async function extractSessionId(transcriptPath) {
  let content;
  try {
    content = await readFile(transcriptPath, "utf8");
  } catch {
    return null;
  }
  const firstLine = content.split("\n", 1)[0]?.trim() ?? "";
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
