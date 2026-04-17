import { readFile } from "node:fs/promises";

const RESEARCH_TOOLS = ["Read", "Grep", "Glob", "Bash"];
const MUTATION_TOOLS = ["Edit", "Write", "NotebookEdit"];
const CBM_PREFIX = "mcp__codebase-memory-mcp__";

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractToolCalls(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter(
    (b) => b && b.type === "tool_use" && typeof b.name === "string",
  );
}

// Parity with src/transcript.ts:365-374 — interrupts are only counted when:
//   entry.type === "user" AND block.type === "text" AND
//   block.text starts with the literal "[Request interrupted by user" prefix.
// Matching the prefix (not a substring) excludes assistant quotations and
// tool_result blocks that may quote the phrase mid-text.
function isInterruptEntry(entry) {
  if (!entry || entry.type !== "user") return false;
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (b) =>
      b &&
      b.type === "text" &&
      typeof b.text === "string" &&
      b.text.startsWith("[Request interrupted by user"),
  );
}

export async function computeMetrics(transcriptPath) {
  let text;
  try {
    text = await readFile(transcriptPath, "utf8");
  } catch {
    return null;
  }

  const toolCounts = {};
  let interrupts = 0;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = parseLine(trimmed);
    if (!entry) continue;

    for (const tool of extractToolCalls(entry)) {
      toolCounts[tool.name] = (toolCounts[tool.name] ?? 0) + 1;
    }
    if (isInterruptEntry(entry)) interrupts += 1;
  }

  const reads = toolCounts.Read ?? 0;
  const greps = toolCounts.Grep ?? 0;
  const globs = toolCounts.Glob ?? 0;
  const bashes = toolCounts.Bash ?? 0;
  const cbm = Object.entries(toolCounts)
    .filter(([name]) => name.startsWith(CBM_PREFIX))
    .reduce((s, [, n]) => s + n, 0);
  const edits = toolCounts.Edit ?? 0;
  const writes = toolCounts.Write ?? 0;
  const notebookEdits = toolCounts.NotebookEdit ?? 0;

  const research = reads + greps + globs + bashes + cbm;
  const mutation = edits + writes + notebookEdits;
  const totalTools = Object.values(toolCounts).reduce((s, n) => s + n, 0);

  if (totalTools === 0) return null;

  const re_ratio = reads / Math.max(edits + writes, 1);
  const rm_ratio = research / Math.max(mutation, 1);
  const write_pct = writes / Math.max(edits + writes, 1);
  const interrupts_per_1k = (interrupts * 1000) / Math.max(totalTools, 1);
  const tool_diversity = Object.keys(toolCounts).length;
  const session_length = totalTools;

  return {
    re_ratio,
    rm_ratio,
    write_pct,
    interrupts_per_1k,
    tool_diversity,
    session_length,
  };
}

export function countViolations(events, sessionId) {
  let count = 0;
  for (const event of events) {
    if (event.event === "violation" && event.session === sessionId) count += 1;
  }
  return count;
}

// One-pass O(N) aggregation of violation counts per session id. Callers that
// need counts for many sessions (e.g. run-benchmark iterating 1800+ transcripts)
// build this once and look up per-session via `map.get(sid) ?? 0`, turning the
// previous O(sessions × events) outer loop into O(events + sessions).
export function buildViolationMap(events) {
  const map = new Map();
  for (const event of events) {
    if (event?.event !== "violation") continue;
    const sid = event.session;
    if (typeof sid !== "string" || sid.length === 0) continue;
    map.set(sid, (map.get(sid) ?? 0) + 1);
  }
  return map;
}

export async function loadEvents(eventsPath) {
  let text;
  try {
    text = await readFile(eventsPath, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // skip
    }
  }
  return out;
}
