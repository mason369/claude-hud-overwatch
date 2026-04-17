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

function isInterruptEntry(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (b) =>
      b && typeof b.text === "string" && /Request interrupted/i.test(b.text),
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
