import { test } from "node:test";
import assert from "node:assert/strict";
import { computeResearchRatio } from "../dist/render/lines/harness.js";

test("computeResearchRatio returns null for undefined toolCounts", () => {
  assert.equal(computeResearchRatio(undefined), null);
});

test("computeResearchRatio returns null when research + mutation = 0", () => {
  assert.equal(computeResearchRatio({}), null);
  assert.equal(computeResearchRatio({ TodoWrite: 5 }), null);
});

test("computeResearchRatio counts Read+Grep+Glob+Bash as research", () => {
  const result = computeResearchRatio({
    Read: 5,
    Grep: 3,
    Glob: 2,
    Bash: 4,
    Edit: 2,
  });
  assert.equal(result.research, 14);
  assert.equal(result.mutation, 2);
  assert.equal(result.ratio, 7);
  assert.equal(result.breakdown.reads, 5);
  assert.equal(result.breakdown.greps, 3);
  assert.equal(result.breakdown.globs, 2);
  assert.equal(result.breakdown.bashes, 4);
});

test("computeResearchRatio sums codebase-memory-mcp tools into cbm", () => {
  const result = computeResearchRatio({
    "mcp__codebase-memory-mcp__search_graph": 3,
    "mcp__codebase-memory-mcp__trace_path": 2,
    "mcp__codebase-memory-mcp__get_code_snippet": 1,
    Edit: 1,
  });
  assert.equal(result.breakdown.cbm, 6);
  assert.equal(result.research, 6);
  assert.equal(result.mutation, 1);
  assert.equal(result.ratio, 6);
});

test("computeResearchRatio counts NotebookEdit as mutation", () => {
  const result = computeResearchRatio({
    Read: 10,
    NotebookEdit: 2,
    Edit: 1,
    Write: 1,
  });
  assert.equal(result.mutation, 4);
  assert.equal(result.breakdown.notebookEdits, 2);
  assert.equal(result.ratio, 2.5);
});

test("computeResearchRatio divides by max(mutation, 1) when mutation is 0", () => {
  const result = computeResearchRatio({ Read: 7 });
  assert.equal(result.ratio, 7);
  assert.equal(result.mutation, 0);
});
