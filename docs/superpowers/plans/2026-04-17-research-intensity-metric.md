# Research Intensity Metric + Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 HUD 中新增广义研究密度指标 **R/M (Research:Mutation)**，并提供带统计显著性检验（Mann-Whitney U + Cliff's δ）的 benchmark 工具链，从真实会话历史自动输出对比报告，替换 README 的自报数据。

**Architecture:** R/M 沿用 R/E 的纯函数 + 渲染行模式（`computeResearchRatio` → `HarnessHealth.researchRatio` → `renderResearchRatioLine`），与 R/E 并存不冲突。Benchmark 为一套独立 ESM 脚本，位于 `benchmark/` 根目录，入口 `npm run benchmark`；按 `harness-events.jsonl` 中 session_id 存在性自动分组 enabled/disabled，对 7 项指标做非参检验后输出 Markdown 报告。

**Tech Stack:** TypeScript 5（HUD 扩展）/ Node 18+ ESM / node:test + node:assert/strict / 纯 JS 无新依赖（Mann-Whitney U 自实现）。

**Reference Spec:** `docs/superpowers/specs/2026-04-17-research-intensity-metric-design.md`

---

## Task 1: 新增 HarnessResearchRatio 类型

**Files:**
- Modify: `src/types.ts:137-173`

- [ ] **Step 1: 在 `HarnessReadEditRatio` 接口之后插入新接口**

编辑 `src/types.ts`，在第 142 行（`HarnessReadEditRatio` 闭合 `}` 之后）插入：

```typescript
export interface HarnessResearchRatio {
  ratio: number;
  research: number;
  mutation: number;
  breakdown: {
    reads: number;
    greps: number;
    globs: number;
    bashes: number;
    cbm: number;
    edits: number;
    writes: number;
    notebookEdits: number;
  };
}
```

- [ ] **Step 2: 向 `HarnessHealth` 接口追加 `researchRatio` 字段**

在 `src/types.ts` 的 `HarnessHealth` 接口的 `interruptRate?: HarnessInterruptRate;` 这一行之后追加：

```typescript
  /** Read+Grep+Glob+Bash+CBM / Edit+Write+NotebookEdit ratio; undefined when no tools yet. */
  researchRatio?: HarnessResearchRatio;
```

- [ ] **Step 3: 构建验证通过**

Run: `npm run build`
Expected: 无 TypeScript 错误，`dist/types.js` 重新生成

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add HarnessResearchRatio interface for R/M metric"
```

---

## Task 2: 实现 computeResearchRatio 函数（TDD RED）

**Files:**
- Create: `tests/research-ratio.test.js`
- Modify: `src/render/lines/harness.ts:823-833`

- [ ] **Step 1: 写失败测试**

创建 `tests/research-ratio.test.js`：

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeResearchRatio } from '../dist/render/lines/harness.js';

test('computeResearchRatio returns null for undefined toolCounts', () => {
  assert.equal(computeResearchRatio(undefined), null);
});

test('computeResearchRatio returns null when research + mutation = 0', () => {
  assert.equal(computeResearchRatio({}), null);
  assert.equal(computeResearchRatio({ TodoWrite: 5 }), null);
});

test('computeResearchRatio counts Read+Grep+Glob+Bash as research', () => {
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

test('computeResearchRatio sums codebase-memory-mcp tools into cbm', () => {
  const result = computeResearchRatio({
    'mcp__codebase-memory-mcp__search_graph': 3,
    'mcp__codebase-memory-mcp__trace_path': 2,
    'mcp__codebase-memory-mcp__get_code_snippet': 1,
    Edit: 1,
  });
  assert.equal(result.breakdown.cbm, 6);
  assert.equal(result.research, 6);
  assert.equal(result.mutation, 1);
  assert.equal(result.ratio, 6);
});

test('computeResearchRatio counts NotebookEdit as mutation', () => {
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

test('computeResearchRatio divides by max(mutation, 1) when mutation is 0', () => {
  const result = computeResearchRatio({ Read: 7 });
  assert.equal(result.ratio, 7);
  assert.equal(result.mutation, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && node --test tests/research-ratio.test.js`
Expected: FAIL，所有 6 个 test 报错 `computeResearchRatio is not a function` 或 import 失败

- [ ] **Step 3: 实现 computeResearchRatio（GREEN）**

在 `src/render/lines/harness.ts` 第 833 行（`computeReadEditRatio` 闭合 `}` 之后）插入：

```typescript
export function computeResearchRatio(
  toolCounts: Record<string, number> | undefined,
): HarnessResearchRatio | null {
  if (!toolCounts) return null;
  const reads = toolCounts.Read ?? 0;
  const greps = toolCounts.Grep ?? 0;
  const globs = toolCounts.Glob ?? 0;
  const bashes = toolCounts.Bash ?? 0;
  const cbm = Object.entries(toolCounts)
    .filter(([name]) => name.startsWith("mcp__codebase-memory-mcp__"))
    .reduce((sum, [, n]) => sum + (Number.isFinite(n) ? n : 0), 0);
  const edits = toolCounts.Edit ?? 0;
  const writes = toolCounts.Write ?? 0;
  const notebookEdits = toolCounts.NotebookEdit ?? 0;
  const research = reads + greps + globs + bashes + cbm;
  const mutation = edits + writes + notebookEdits;
  if (research + mutation === 0) return null;
  return {
    ratio: research / Math.max(mutation, 1),
    research,
    mutation,
    breakdown: { reads, greps, globs, bashes, cbm, edits, writes, notebookEdits },
  };
}
```

并在 `src/render/lines/harness.ts` 顶部的 `import type` 语句中追加 `HarnessResearchRatio`（搜索 `HarnessReadEditRatio` 所在的 import 行即可找到位置）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run build && node --test tests/research-ratio.test.js`
Expected: PASS，6/6

- [ ] **Step 5: Commit**

```bash
git add src/render/lines/harness.ts tests/research-ratio.test.js
git commit -m "feat(harness): add computeResearchRatio for R/M metric"
```

---

## Task 3: 将 researchRatio 接入 HarnessHealth

**Files:**
- Modify: `src/render/lines/harness.ts:1289-1316`

- [ ] **Step 1: 在 getHarnessHealth 中计算并填充 researchRatio**

在 `src/render/lines/harness.ts` 第 1289 行附近，`computeReadEditRatio` 调用之后追加：

```typescript
  const researchRatio =
    computeResearchRatio(transcript?.toolCounts) ?? undefined;
```

并在 return 对象（约第 1300-1315 行）中添加 `researchRatio,` 字段（紧跟 `readEditRatio,` 之后即可）。

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/render/lines/harness.ts
git commit -m "feat(harness): wire researchRatio into HarnessHealth"
```

---

## Task 4: 新增 researchRatio 配置 Schema 与默认值

**Files:**
- Modify: `src/config.ts:134-149`, `src/config.ts:210-230`, `src/config.ts:604-670`

- [ ] **Step 1: 在 HudConfig 类型定义中追加 researchRatio**

在 `src/config.ts` 中找到现有 `interruptRate?: {...}` 类型定义（约第 149 行），紧接其后追加：

```typescript
    researchRatio?: {
      show?: boolean;
      warning?: number;
      critical?: number;
    };
```

- [ ] **Step 2: 在 DEFAULT_CONFIG.harness 中追加默认值**

在 `src/config.ts` 中找到 `DEFAULT_CONFIG` 的 `interruptRate: { ... }` 块（约第 225 行），紧接其后追加：

```typescript
    researchRatio: {
      show: true,
      warning: 5,
      critical: 3,
    },
```

- [ ] **Step 3: 在 mergeConfig 中追加验证路径**

在 `src/config.ts` 中找到 `interruptRate: { ... }` 的 mergeConfig 块（约第 654-670 行），在其后追加：

```typescript
    researchRatio: {
      show:
        typeof migrated.harness?.researchRatio?.show === "boolean"
          ? migrated.harness.researchRatio.show
          : DEFAULT_CONFIG.harness.researchRatio!.show,
      warning:
        typeof migrated.harness?.researchRatio?.warning === "number" &&
        Number.isFinite(migrated.harness.researchRatio.warning) &&
        migrated.harness.researchRatio.warning >= 0
          ? migrated.harness.researchRatio.warning
          : DEFAULT_CONFIG.harness.researchRatio!.warning,
      critical:
        typeof migrated.harness?.researchRatio?.critical === "number" &&
        Number.isFinite(migrated.harness.researchRatio.critical) &&
        migrated.harness.researchRatio.critical >= 0
          ? migrated.harness.researchRatio.critical
          : DEFAULT_CONFIG.harness.researchRatio!.critical,
    },
```

- [ ] **Step 4: 构建 + 运行现有 config 测试**

Run: `npm run build && node --test tests/config.test.js`
Expected: PASS，不引入回归

- [ ] **Step 5: Commit**

```bash
git add src/config.ts
git commit -m "feat(config): add researchRatio config schema and defaults"
```

---

## Task 5: 新增 i18n 键（R/M、Research、Mutation）

**Files:**
- Modify: `src/i18n/types.ts:79-97`
- Modify: `src/i18n/zh.ts:94-116`
- Modify: `src/i18n/en.ts:91-113`

- [ ] **Step 1: 在 MessageKey 联合类型中追加新 key**

编辑 `src/i18n/types.ts`，在 `harnessInterruptUnit` 行之后追加：

```typescript
  // Harness R/M metric
  | "harnessResearchRatio"
  | "harnessResearchLabel"
  | "harnessMutationLabel"
```

- [ ] **Step 2: 中文翻译**

编辑 `src/i18n/zh.ts`，在 `harnessInterruptUnit: "...",` 这一行之后追加：

```typescript
  // Harness R/M metric
  harnessResearchRatio: "R/M",
  harnessResearchLabel: "\u7814\u7A76",
  harnessMutationLabel: "\u53D8\u66F4",
```

（`\u7814\u7A76` = "研究"，`\u53D8\u66F4` = "变更"）

- [ ] **Step 3: 英文翻译**

编辑 `src/i18n/en.ts`，在 `harnessInterruptUnit: "...",` 这一行之后追加：

```typescript
  // Harness R/M metric
  harnessResearchRatio: "R/M",
  harnessResearchLabel: "Research",
  harnessMutationLabel: "Mutation",
```

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: 无 TypeScript 错误（所有语言版本必须包含所有 key）

- [ ] **Step 5: Commit**

```bash
git add src/i18n/types.ts src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(i18n): add R/M metric translations (zh/en)"
```

---

## Task 6: 实现 renderResearchRatioLine 渲染函数

**Files:**
- Modify: `src/render/lines/harness.ts:972-1003`（模仿 `renderInterruptRateLine`）
- Modify: `src/render/lines/harness.ts:1177-1185`（在 renderHarnessLines 中调用）

- [ ] **Step 1: 在 renderInterruptRateLine 之后插入 renderResearchRatioLine**

在 `src/render/lines/harness.ts` 第 1003 行（`renderInterruptRateLine` 闭合 `}` 之后）插入：

```typescript
function renderResearchRatioLine(
  ratio: HarnessResearchRatio,
  config: HudConfig,
): string | null {
  const ratioConfig = config.harness?.researchRatio;
  if (ratioConfig?.show === false) return null;

  const warningThreshold = ratioConfig?.warning ?? 5;
  const criticalThreshold = ratioConfig?.critical ?? 3;

  const { ratio: value, research, mutation } = ratio;
  const ratioStr = value.toFixed(1);
  const label = t("harnessResearchRatio");
  const researchLabel = t("harnessResearchLabel");
  const mutationLabel = t("harnessMutationLabel");
  const body = `${label}: ${ratioStr} | ${researchLabel}:${research} ${mutationLabel}:${mutation}`;
  const prefix = "\uD83D\uDD2C ";

  if (research + mutation === 0) {
    return `  ${dim(prefix + body)}`;
  }

  if (value < criticalThreshold) {
    return `  ${red(prefix + body)}`;
  }

  if (value < warningThreshold) {
    return `  ${yellow(prefix + body)}`;
  }

  return `  ${green(prefix + body)}`;
}
```

- [ ] **Step 2: 在 renderHarnessLines 中调用**

在 `src/render/lines/harness.ts` 第 1185 行（`if (health.interruptRate) { ... }` 块闭合之后、`if (health.violationBreakdown)` 之前）插入：

```typescript
  if (health.researchRatio) {
    const line = renderResearchRatioLine(health.researchRatio, config);
    if (line) lines.push(line);
  }
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/render/lines/harness.ts
git commit -m "feat(render): add renderResearchRatioLine with 🔬 prefix and thresholds"
```

---

## Task 7: 扩展 integration-phase2 集成测试

**Files:**
- Modify: `tests/integration-phase2.test.js:33-72`（fixture 追加工具调用）
- Modify: `tests/integration-phase2.test.js:215-222`（追加 R/M 断言）

- [ ] **Step 1: 扩充 fixture transcript 加入 Grep / Bash / CBM 工具调用**

打开 `tests/integration-phase2.test.js`，在第 72 行 `await writeFile(transcriptPath, ...)` 之前插入：

```javascript
  for (let i = 0; i < 3; i += 1) {
    transcriptLines.push(
      JSON.stringify({
        timestamp: `2026-04-17T10:${String(13 + i).padStart(2, "0")}:00.000Z`,
        message: {
          content: [
            {
              type: "tool_use",
              id: `grep-${i}`,
              name: "Grep",
              input: { pattern: `todo-${i}` },
            },
          ],
        },
      }),
    );
  }
  for (let i = 0; i < 2; i += 1) {
    transcriptLines.push(
      JSON.stringify({
        timestamp: `2026-04-17T10:${String(16 + i).padStart(2, "0")}:00.000Z`,
        message: {
          content: [
            {
              type: "tool_use",
              id: `bash-${i}`,
              name: "Bash",
              input: { command: `ls -la dir${i}` },
            },
          ],
        },
      }),
    );
  }
  transcriptLines.push(
    JSON.stringify({
      timestamp: `2026-04-17T10:18:00.000Z`,
      message: {
        content: [
          {
            type: "tool_use",
            id: "cbm-0",
            name: "mcp__codebase-memory-mcp__search_graph",
            input: { project: "demo" },
          },
        ],
      },
    }),
  );
```

- [ ] **Step 2: 在现有 R/E 断言之后追加 R/M 断言**

找到第 222 行（`assert.match(readEditLine, /写:0/);` 之后）追加：

```javascript
    // R/M: research = Read(10) + Grep(3) + Bash(2) + CBM(1) = 16; mutation = Edit(3) = 3; ratio = 5.33
    const researchLine = lines.find((line) => /R\/M:\s*5\.3/.test(line));
    assert.ok(
      researchLine,
      `missing R/M ratio line matching 5.3:\n${plainOutput}`,
    );
    assert.match(researchLine, /\u7814\u7A76:16/);
    assert.match(researchLine, /\u53D8\u66F4:3/);
```

- [ ] **Step 3: 构建 + 运行 integration 测试**

Run: `npm run build && node --test tests/integration-phase2.test.js`
Expected: PASS，R/M 5.3 行可见且标签正确

- [ ] **Step 4: Commit**

```bash
git add tests/integration-phase2.test.js
git commit -m "test(integration): assert R/M 5.3 line renders with research/mutation labels"
```

---

## Task 8: 实现 benchmark/stats.js（Mann-Whitney U + Cliff's δ）

**Files:**
- Create: `tests/benchmark-stats.test.js`
- Create: `benchmark/stats.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/benchmark-stats.test.js`：

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mannWhitneyU,
  cliffDelta,
  cliffEffect,
  median,
  iqr,
} from '../benchmark/stats.js';

test('median handles odd and even length arrays', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('iqr returns [q1, q3] for known data', () => {
  const [q1, q3] = iqr([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(q1, 2.5);
  assert.equal(q3, 6.5);
});

test('mannWhitneyU returns U and p for distinct groups', () => {
  const xs = [10, 12, 14, 16, 18];
  const ys = [1, 2, 3, 4, 5];
  const { U, p } = mannWhitneyU(xs, ys);
  // xs dominates ys → U should be minimum possible (0 or close)
  assert.ok(U <= 1, `expected U <= 1, got ${U}`);
  assert.ok(p < 0.05, `expected p < 0.05 for strongly separated groups, got ${p}`);
});

test('mannWhitneyU handles ties with average ranks', () => {
  const xs = [3, 3, 3];
  const ys = [3, 3, 3];
  const { U, p } = mannWhitneyU(xs, ys);
  // Identical distributions → p should be near 1
  assert.ok(p > 0.5, `expected p > 0.5 for identical groups, got ${p}`);
  assert.ok(Number.isFinite(U));
});

test('mannWhitneyU returns p=NaN for empty inputs', () => {
  const { p } = mannWhitneyU([], [1, 2]);
  assert.ok(Number.isNaN(p));
});

test('cliffDelta ranges in [-1, 1]', () => {
  assert.equal(cliffDelta([10, 20, 30], [1, 2, 3]), 1);
  assert.equal(cliffDelta([1, 2, 3], [10, 20, 30]), -1);
  assert.equal(cliffDelta([1, 2, 3], [1, 2, 3]), 0);
});

test('cliffEffect classifies by magnitude', () => {
  assert.equal(cliffEffect(0.1), '\u5C0F');   // 小 small
  assert.equal(cliffEffect(0.2), '\u4E2D');   // 中 medium
  assert.equal(cliffEffect(0.4), '\u5927');   // 大 large
  assert.equal(cliffEffect(-0.4), '\u5927');  // absolute value
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/benchmark-stats.test.js`
Expected: FAIL，import 解析失败（文件不存在）

- [ ] **Step 3: 实现 benchmark/stats.js（GREEN）**

创建 `benchmark/stats.js`：

```javascript
export function median(xs) {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

export function iqr(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  return [quantile(sorted, 0.25), quantile(sorted, 0.75)];
}

function rankWithTies(values) {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j += 1;
    const avg = (i + j) / 2 + 1; // ranks are 1-based
    for (let k = i; k <= j; k += 1) ranks[indexed[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}

function erf(x) {
  // Abramowitz & Stegun 7.1.26, accurate to ~1.5e-7
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

export function mannWhitneyU(xs, ys) {
  const n1 = xs.length;
  const n2 = ys.length;
  if (n1 === 0 || n2 === 0) return { U: NaN, p: NaN };

  const combined = [...xs, ...ys];
  const ranks = rankWithTies(combined);
  const r1 = ranks.slice(0, n1).reduce((s, r) => s + r, 0);
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const U = Math.min(u1, u2);

  const meanU = (n1 * n2) / 2;
  const stdU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  if (stdU === 0) return { U, p: 1 };
  const z = (U - meanU) / stdU;
  const p = 2 * Math.min(normalCdf(z), 1 - normalCdf(z));
  return { U, p };
}

export function cliffDelta(xs, ys) {
  const n1 = xs.length;
  const n2 = ys.length;
  if (n1 === 0 || n2 === 0) return 0;
  let gt = 0;
  let lt = 0;
  for (const x of xs) {
    for (const y of ys) {
      if (x > y) gt += 1;
      else if (x < y) lt += 1;
    }
  }
  return (gt - lt) / (n1 * n2);
}

export function cliffEffect(delta) {
  const d = Math.abs(delta);
  if (d < 0.15) return '\u5C0F'; // 小 small
  if (d < 0.33) return '\u4E2D'; // 中 medium
  return '\u5927'; // 大 large
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/benchmark-stats.test.js`
Expected: PASS，7/7

- [ ] **Step 5: Commit**

```bash
git add benchmark/stats.js tests/benchmark-stats.test.js
git commit -m "feat(benchmark): implement Mann-Whitney U and Cliff's delta"
```

---

## Task 9: 实现 benchmark/classifier.js（会话分组）

**Files:**
- Create: `tests/benchmark-classifier.test.js`
- Create: `benchmark/classifier.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/benchmark-classifier.test.js`：

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadEnabledSessionIds,
  classifySession,
  extractSessionId,
} from '../benchmark/classifier.js';

test('loadEnabledSessionIds returns empty Set when file missing', async () => {
  const ids = await loadEnabledSessionIds('/nonexistent/path.jsonl');
  assert.ok(ids instanceof Set);
  assert.equal(ids.size, 0);
});

test('loadEnabledSessionIds parses session ids from jsonl', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cls-'));
  const file = path.join(dir, 'events.jsonl');
  const lines = [
    JSON.stringify({ event: 'lifecycle', session: 'aaa' }),
    JSON.stringify({ event: 'violation', session: 'bbb' }),
    JSON.stringify({ event: 'lifecycle', session: 'aaa' }),
    'not-json',
    JSON.stringify({ event: 'lifecycle' }), // no session
  ];
  await writeFile(file, lines.join('\n'), 'utf8');
  const ids = await loadEnabledSessionIds(file);
  assert.equal(ids.size, 2);
  assert.ok(ids.has('aaa'));
  assert.ok(ids.has('bbb'));
  await rm(dir, { recursive: true, force: true });
});

test('classifySession returns enabled when id matches', () => {
  const enabled = new Set(['aaa']);
  assert.equal(classifySession('aaa', enabled), 'enabled');
  assert.equal(classifySession('ccc', enabled), 'disabled');
});

test('classifySession returns unknown for null id', () => {
  assert.equal(classifySession(null, new Set()), 'unknown');
  assert.equal(classifySession(undefined, new Set()), 'unknown');
});

test('extractSessionId prefers first-line sessionId field', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cls-'));
  const file = path.join(dir, 'abc-def.jsonl');
  await writeFile(file, JSON.stringify({ sessionId: 'from-field' }) + '\n', 'utf8');
  assert.equal(await extractSessionId(file), 'from-field');
  await rm(dir, { recursive: true, force: true });
});

test('extractSessionId falls back to filename without extension', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cls-'));
  const file = path.join(dir, 'uuid-aaa-bbb.jsonl');
  await writeFile(file, 'garbage\n', 'utf8');
  assert.equal(await extractSessionId(file), 'uuid-aaa-bbb');
  await rm(dir, { recursive: true, force: true });
});

test('extractSessionId returns null when file does not exist', async () => {
  assert.equal(await extractSessionId('/definitely/not/here.jsonl'), null);
});

test('extractSessionId uses filename even when file has garbage content', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cls-'));
  const file = path.join(dir, 'session-123.jsonl');
  await writeFile(file, 'not-json\n', 'utf8');
  assert.equal(await extractSessionId(file), 'session-123');
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/benchmark-classifier.test.js`
Expected: FAIL，import 无法解析

- [ ] **Step 3: 实现 benchmark/classifier.js（GREEN）**

创建 `benchmark/classifier.js`：

```javascript
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadEnabledSessionIds(eventsPath) {
  const ids = new Set();
  let content;
  try {
    content = await readFile(eventsPath, 'utf8');
  } catch {
    return ids;
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const sid = parsed.session ?? parsed.sessionId;
      if (typeof sid === 'string' && sid.length > 0) ids.add(sid);
    } catch {
      // skip malformed lines
    }
  }
  return ids;
}

export async function extractSessionId(transcriptPath) {
  let content;
  try {
    content = await readFile(transcriptPath, 'utf8');
  } catch {
    return null;
  }
  const firstLine = content.split('\n', 1)[0]?.trim() ?? '';
  if (firstLine) {
    try {
      const parsed = JSON.parse(firstLine);
      const sid = parsed.sessionId ?? parsed.session;
      if (typeof sid === 'string' && sid.length > 0) return sid;
    } catch {
      // fall through to filename
    }
  }
  const base = path.basename(transcriptPath, path.extname(transcriptPath));
  return base.length > 0 ? base : null;
}

export function classifySession(sessionId, enabledIds) {
  if (!sessionId) return 'unknown';
  return enabledIds.has(sessionId) ? 'enabled' : 'disabled';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/benchmark-classifier.test.js`
Expected: PASS，6/6

- [ ] **Step 5: Commit**

```bash
git add benchmark/classifier.js tests/benchmark-classifier.test.js
git commit -m "feat(benchmark): add session classifier by harness-events.jsonl"
```

---

## Task 10: 实现 benchmark/metrics.js（单会话指标向量）

**Files:**
- Create: `benchmark/metrics.js`

- [ ] **Step 1: 实现 benchmark/metrics.js**

创建 `benchmark/metrics.js`：

```javascript
import { readFile } from 'node:fs/promises';

const RESEARCH_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];
const MUTATION_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
const CBM_PREFIX = 'mcp__codebase-memory-mcp__';

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
  return content.filter((b) => b && b.type === 'tool_use' && typeof b.name === 'string');
}

function isInterruptEntry(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (b) =>
      b &&
      typeof b.text === 'string' &&
      /Request interrupted/i.test(b.text),
  );
}

export async function computeMetrics(transcriptPath) {
  let text;
  try {
    text = await readFile(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const toolCounts = {};
  let interrupts = 0;

  for (const line of text.split('\n')) {
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
    if (event.event === 'violation' && event.session === sessionId) count += 1;
  }
  return count;
}

export async function loadEvents(eventsPath) {
  let text;
  try {
    text = await readFile(eventsPath, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
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
```

- [ ] **Step 2: 快速冒烟验证**

Run: `node -e "import('./benchmark/metrics.js').then(m => console.log(typeof m.computeMetrics))"`
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add benchmark/metrics.js
git commit -m "feat(benchmark): implement per-session metrics extractor"
```

---

## Task 11: 实现 benchmark/report.js（Markdown 报告生成）

**Files:**
- Create: `benchmark/report.js`

- [ ] **Step 1: 实现 benchmark/report.js**

创建 `benchmark/report.js`：

```javascript
import {
  mannWhitneyU,
  cliffDelta,
  cliffEffect,
  median,
  iqr,
} from './stats.js';

const METRICS = [
  { key: 're_ratio', label: 'R/E', digits: 2 },
  { key: 'rm_ratio', label: 'R/M', digits: 2 },
  { key: 'write_pct', label: 'Write%', digits: 3, isPercent: true },
  { key: 'violations_per_session', label: '\u8FDD\u89C4\u6570', digits: 1 },
  { key: 'interrupts_per_1k', label: '\u4E2D\u65AD\u7387(/1k)', digits: 2 },
  { key: 'tool_diversity', label: '\u5DE5\u5177\u591A\u6837\u6027', digits: 1 },
  { key: 'session_length', label: '\u4F1A\u8BDD\u957F\u5EA6', digits: 0 },
];

function formatValue(v, digits, isPercent) {
  if (!Number.isFinite(v)) return 'NaN';
  return isPercent
    ? `${(v * 100).toFixed(digits === 3 ? 1 : digits)}%`
    : v.toFixed(digits);
}

function formatSummary(values, digits, isPercent) {
  if (values.length === 0) return '-';
  const m = median(values);
  const [q1, q3] = iqr(values);
  const formatOne = (x) => formatValue(x, digits, isPercent);
  return `${formatOne(m)} [${formatOne(q1)}-${formatOne(q3)}]`;
}

export function buildReport({ enabled, disabled, date }) {
  const lines = [];
  lines.push(`# Benchmark Report ${date}`);
  lines.push('');
  lines.push(`**Sample**: enabled n=${enabled.length}, disabled n=${disabled.length}`);
  lines.push('');
  lines.push('| \u6307\u6807 | enabled median [IQR] | disabled median [IQR] | U | p | Cliff\'s \u03B4 | \u6548\u5E94 |');
  lines.push('|---|---|---|---|---|---|---|');

  const smallSample = enabled.length < 10 || disabled.length < 10;

  for (const { key, label, digits, isPercent } of METRICS) {
    const xs = enabled.map((s) => s[key]).filter(Number.isFinite);
    const ys = disabled.map((s) => s[key]).filter(Number.isFinite);
    const { U, p } = mannWhitneyU(xs, ys);
    const delta = cliffDelta(xs, ys);
    const effect = cliffEffect(delta);
    const sampleMark = smallSample ? ' \u26A0\ufe0f' : '';
    lines.push(
      `| ${label}${sampleMark} | ${formatSummary(xs, digits, isPercent)} | ${formatSummary(ys, digits, isPercent)} | ${Number.isFinite(U) ? U.toFixed(1) : '-'} | ${Number.isFinite(p) ? p.toFixed(4) : '-'} | ${delta.toFixed(3)} | ${effect} |`,
    );
  }

  lines.push('');
  if (smallSample) {
    lines.push('**Note**: \u4EFB\u4E00\u7EC4 n<10 \u65F6\u6807\u6CE8 \u26A0\ufe0f \u6837\u672C\u4E0D\u8DB3 (p-value may be unreliable, but Cliff\'s \u03B4 remains interpretable).');
  }
  lines.push('');
  lines.push('**Effect sizes**: |\u03B4| < 0.15 \u5C0F / < 0.33 \u4E2D / \u2265 0.33 \u5927');
  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 2: 冒烟验证**

Run: `node -e "import('./benchmark/report.js').then(m => console.log(m.buildReport({ enabled: [{re_ratio:5,rm_ratio:8,write_pct:0.1,violations_per_session:1,interrupts_per_1k:2,tool_diversity:5,session_length:50}], disabled: [{re_ratio:3,rm_ratio:5,write_pct:0.2,violations_per_session:3,interrupts_per_1k:5,tool_diversity:4,session_length:30}], date: '2026-04-17' })))"`
Expected: 输出包含 `| R/E`、`| R/M`、`⚠️`（因样本<10）的 Markdown 表格

- [ ] **Step 3: Commit**

```bash
git add benchmark/report.js
git commit -m "feat(benchmark): add Markdown report builder with stats table"
```

---

## Task 12: 实现 benchmark/run-benchmark.js（主入口）

**Files:**
- Create: `benchmark/run-benchmark.js`

- [ ] **Step 1: 实现入口脚本**

创建 `benchmark/run-benchmark.js`：

```javascript
#!/usr/bin/env node
import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {
  loadEnabledSessionIds,
  extractSessionId,
  classifySession,
} from './classifier.js';
import { computeMetrics, loadEvents, countViolations } from './metrics.js';
import { buildReport } from './report.js';

async function walkJsonl(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonl(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const home = os.homedir();
  const projectsDir = path.join(home, '.claude', 'projects');
  const eventsPath = path.join(home, '.claude', 'logs', 'harness-events.jsonl');

  console.log(`Scanning ${projectsDir} ...`);
  const transcripts = await walkJsonl(projectsDir);
  console.log(`Found ${transcripts.length} transcript(s)`);

  const enabledIds = await loadEnabledSessionIds(eventsPath);
  console.log(`Loaded ${enabledIds.size} enabled session id(s) from ${eventsPath}`);

  const events = await loadEvents(eventsPath);

  const enabled = [];
  const disabled = [];
  let skipped = 0;

  for (const t of transcripts) {
    const sid = await extractSessionId(t);
    if (!sid) {
      skipped += 1;
      continue;
    }
    const metrics = await computeMetrics(t);
    if (!metrics) {
      skipped += 1;
      continue;
    }
    metrics.violations_per_session = countViolations(events, sid);
    const group = classifySession(sid, enabledIds);
    if (group === 'enabled') enabled.push(metrics);
    else if (group === 'disabled') disabled.push(metrics);
    else skipped += 1;
  }

  console.log(`Enabled: ${enabled.length}  Disabled: ${disabled.length}  Skipped: ${skipped}`);

  const date = new Date().toISOString().slice(0, 10);
  const report = buildReport({ enabled, disabled, date });

  const outDir = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.join(outDir, `report-${date}.md`);
  await writeFile(outPath, report, 'utf8');
  console.log(`Report written: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: 验证脚本在无 events 时不崩溃**

Run: `HOME=/tmp/empty-benchmark USERPROFILE=/tmp/empty-benchmark node benchmark/run-benchmark.js`
Expected: 输出 `Scanning /tmp/empty-benchmark/.claude/projects ... Found 0 transcript(s) ... Report written: ...`；无抛错；生成空报告文件

- [ ] **Step 3: Commit**

```bash
git add benchmark/run-benchmark.js
git commit -m "feat(benchmark): add run-benchmark.js entry point"
```

---

## Task 13: 注册 npm script 并跑真实 benchmark

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 在 package.json scripts 追加 benchmark 入口**

打开 `package.json`，在 `"scripts"` 对象中添加一行：

```json
    "benchmark": "node benchmark/run-benchmark.js",
```

（位置放在 `"test"` 之后即可，注意保持合法 JSON 格式）

- [ ] **Step 2: 运行真实 benchmark**

Run: `npm run benchmark`
Expected: 扫描真实 `~/.claude/projects`，输出会话计数、写出 `benchmark/report-YYYY-MM-DD.md`；过程无 NaN/Infinity/负数异常

- [ ] **Step 3: 人工检查报告**

Run: `cat benchmark/report-$(date -u +%Y-%m-%d).md`
Expected: Markdown 表格结构正确，R/E 与 R/M 两行均有数据；sample size 合理；effect size 列为 小/中/大 之一

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(package): add npm run benchmark script"
```

（注意：生成的 `benchmark/report-*.md` 不 commit；在下一步 README 更新时顺便在 `.gitignore` 加入忽略规则）

---

## Task 14: 更新 README.md 替换自报数据

**Files:**
- Modify: `README.md:880-911`
- Modify: `.gitignore`

- [ ] **Step 1: 先用 Read 完整读取当前 README 880-911 段**

Run: (使用 Read 工具读取 `README.md` 第 870-920 行) — 确认自报段起止行号，以便精准 Edit。

- [ ] **Step 2: 用 Edit 工具替换该段**

将 `README.md:880-911` 自报段替换为：

```markdown
## 效果评估（Benchmark）

本插件**不对外承诺固定的效果数字**。实际效果取决于你的会话风格、任务复杂度、工具安装完成度。要评估在你的环境下的真实效果，请运行 benchmark：

```bash
npm run benchmark
```

脚本会扫描 `~/.claude/projects/**/*.jsonl` 中的所有会话 transcript，根据 `~/.claude/logs/harness-events.jsonl` 中记录的 session_id 自动分为「启用 harness」与「未启用」两组，然后对以下 7 项指标做 Mann-Whitney U 非参检验（带 Cliff's δ 效应量）：

| 指标 | 含义 |
|---|---|
| R/E | Read / (Edit + Write) — 狭义 Read-to-Mutation |
| R/M | (Read + Grep + Glob + Bash + CBM) / (Edit + Write + NotebookEdit) — 广义研究密度 |
| Write% | Write / (Edit + Write) — 是否爱用大面积重写替代精准编辑 |
| 违规数 | 每会话 harness-events.jsonl 中违规事件数 |
| 中断率(/1k) | 每 1000 次工具调用触发用户中断次数 |
| 工具多样性 | 会话中使用过的不同工具数 |
| 会话长度 | 工具调用总数 |

报告写入 `benchmark/report-YYYY-MM-DD.md`。任一组 n<10 时指标名旁会标注 `⚠️`，此时 p-value 不可靠，但 Cliff's δ 仍可解读：

- `|δ| < 0.15` 小效应
- `|δ| < 0.33` 中效应
- `|δ| ≥ 0.33` 大效应

不附带样例报告。因为每个用户的会话分布不同，作者本地的数字对你没有代表性——请跑自己的数据。
```

- [ ] **Step 3: .gitignore 忽略报告产物**

编辑 `.gitignore`，在末尾追加：

```
# Benchmark reports (per-user, not committed)
benchmark/report-*.md
```

- [ ] **Step 4: Commit**

```bash
git add README.md .gitignore
git commit -m "docs(readme): replace self-reported stats with benchmark instructions"
```

---

## Task 15: 最终验证（全测试 + 行为验证）

**Files:**
- 无（仅验证）

- [ ] **Step 1: 全量构建 + 测试**

Run: `npm run build && npm test`
Expected: 所有测试通过（原 385 条 + 新增 6 + 7 + 6 + 新 R/M 断言 ≈ 405 条左右）；无红色失败

- [ ] **Step 2: 真实 HUD 渲染验证**

Run (使用实际会话 transcript 路径):
```bash
echo '{"session_id":"demo","model":{"display_name":"Opus"},"context_window":{"context_window_size":200000,"current_usage":{"input_tokens":45000}},"transcript_path":"~/.claude/projects/<some-existing>.jsonl"}' | node dist/index.js
```
Expected: 输出同时包含 `📐 R/E:` 行 与 `🔬 R/M:` 行；颜色符合阈值（<3 红 / <5 黄 / ≥5 绿）

- [ ] **Step 3: Benchmark 端到端**

Run: `npm run benchmark`
Expected: 生成 `benchmark/report-YYYY-MM-DD.md`；肉眼检查 7 行全部有数据（除非该指标在某组全 NaN）

- [ ] **Step 4: README 抽查**

Run: 打开 `README.md` 搜索 "15.7%" 或 "4.9 → 9.5" 等旧自报数字
Expected: 均不存在（已被 benchmark 说明替换）

- [ ] **Step 5: 提交最终 checkpoint（如有 uncommit 变更）**

```bash
git status
# 如有未提交变更，按 conventional prefix 分类提交
```

若全部已 commit：无操作。

---

## 完成条件（来自 spec 验证标准）

- [x] Task 1-15 全部 commit 完成
- [x] `npm test` 全绿
- [x] `npm run benchmark` 在无 events.jsonl 时不崩溃（Task 12 Step 2 验证）
- [x] HUD 显示 R/E + R/M 两行，数值正确着色（Task 15 Step 2 验证）
- [x] README 不再包含自报统计数字（Task 15 Step 4 验证）
