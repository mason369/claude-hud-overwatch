# Research Intensity Metric + Benchmark 设计规格

**日期**: 2026-04-17
**状态**: Design
**关联 issue**: [claude-code#42796](https://github.com/anthropics/claude-code/issues/42796)

## 背景

用户反馈现有防护系统存在两处尚未"完美解决" issue #42796 的缺口：

1. **R/E 指标过窄**: `src/render/lines/harness.ts:823-833` 的 `computeReadEditRatio` 只统计 `Read/Edit/Write`，漏掉 `Grep`、`Glob`、`Bash`、`mcp__codebase-memory-mcp__*`（CBM）等研究类工具。只算作"研究强度"的弱代理指标，一个大量用 `Grep + Edit` 的会话 R/E 会很低但研究力度并不差。
2. **效果数据自报**: `README.md:880-911` 贴出"Write% 15.7% → 2.4%""Research:Mutation 4.9 → 9.5"等对比，来源于作者本地 2,234 个 JSONL 会话的单方统计，**没有统计显著性检验，没有效应量，没有自动化复现脚本**。现有测试（`tests/integration-phase2.test.js:173`）只验证 HUD 能解析合成 fixture，不验证 hook 真能逆转行为退化。

## 目标

- 新增广义"研究密度"指标 **R/M (Research:Mutation)**，涵盖所有研究类工具
- 提供 **benchmark 工具链**，从本地会话历史自动分组（启用 hook vs 未启用）并输出带统计显著性检验的对比报告
- 替换 README 中的自报段落，改为运行 benchmark 的指引

## 非目标

- 不改变现有 R/E 指标（保留作为"狭义 Read-to-Mutation"对照）
- 不做历史 session_summary.jsonl 的补写（只对新会话生效 + 从 raw transcript 重算）
- 不做 benchmark 报告的跨机器聚合（仅限本地单用户）

## 决策记录

| 决策点 | 选项 | 理由 |
|---|---|---|
| R/M 分子范围 | Read + Grep + Glob + Bash + CBM | Bash 在实际会话中大多是 `git status/npm test/ls` 等研究类，少量 `rm/mv` 写操作不影响宏观比率；"全量"最贴近"研究强度"语义 |
| R/E 与 R/M 并存 | 保留 R/E + 新增 R/M 一行 | 不破坏历史 `r_e_ratio` 日志与 baseline 对照，两维度独立可见 |
| 会话分组方法 | 按 `harness-events.jsonl` 中是否存在 session_id 自动分组 | 全自动、可复现、无用户记忆依赖 |
| 统计检验 | Mann-Whitney U + Cliff's δ | 非参数，不要求正态分布；小样本可用；同时给显著性（p）与效应量（δ） |

## 架构

### 组件 1: R/M 指标（HUD 扩展）

**数据流**:
```
transcript.ts (已有) → toolCounts: Record<string, number>
                    ↓
harness.ts: computeResearchRatio(toolCounts) → HarnessResearchRatio | null
                    ↓
render/lines/harness.ts: renderResearchRatioLine → 🔬 R/M: 8.1 | Research:16 Mutation:2
```

**新增函数** (`src/render/lines/harness.ts`):
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
    .reduce((sum, [, n]) => sum + n, 0);
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

**新增类型** (`src/types.ts`):
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
`HarnessHealth` 增加 `researchRatio?: HarnessResearchRatio`。

**渲染行**: 插在 R/E 行之后，emoji `🔬`。阈值着色：
- `< critical (3)` → 红
- `< warning (5)` → 黄
- `≥ warning` → 绿
- `research + mutation === 0` → dim

**配置** (`src/config.ts`):
```typescript
researchRatio: {
  show: true,
  warning: 5,
  critical: 3,
}
```
默认进 `DEFAULT_CONFIG.harness.researchRatio`，走与 R/E 同样的 `mergeConfig` 验证路径。

**i18n**: 新增 3 个 MessageKey + zh/en 翻译：
- `harnessResearchRatio` → "R/M" / "R/M"
- `harnessResearchLabel` → "研究" / "Research"
- `harnessMutationLabel` → "变更" / "Mutation"

### 组件 2: Benchmark 工具链

**目录结构** (新增):
```
benchmark/
├── run-benchmark.js    # 入口
├── classifier.js       # 会话分组
├── metrics.js          # 单会话指标计算
├── stats.js            # Mann-Whitney U + Cliff's δ
└── report.js           # Markdown 报告生成
```

**入口命令**:
```bash
npm run benchmark
```
在 `package.json` 新增 script `"benchmark": "node benchmark/run-benchmark.js"`。

**流程**:
1. 扫描 `~/.claude/projects/**/*.jsonl` 取全部 transcript
2. 读取 `~/.claude/logs/harness-events.jsonl`，建立 `enabledSessionIds: Set<string>`
3. 对每个 transcript 提取 session_id（优先级：首行 JSON 的 `sessionId` 字段 → 文件名不含扩展名部分 → 跳过该会话并记 warning），归入 enabled/disabled
4. 对每个会话计算指标向量（见下）
5. 对每项指标做 Mann-Whitney U 检验 + Cliff's δ
6. 输出 `benchmark/report-YYYY-MM-DD.md`

**分组算法** (`classifier.js`):
```javascript
function classify(transcriptPath, enabledSessionIds) {
  const sessionId = extractSessionId(transcriptPath);
  return enabledSessionIds.has(sessionId) ? 'enabled' : 'disabled';
}
```

**指标清单** (`metrics.js`，每会话一个向量):
| 指标 | 公式 |
|---|---|
| `re_ratio` | `Read / max(Edit+Write, 1)` |
| `rm_ratio` | `(Read+Grep+Glob+Bash+CBM) / max(Edit+Write+NotebookEdit, 1)` |
| `write_pct` | `Write / max(Edit+Write, 1)` |
| `violations_per_session` | 该会话在 events.jsonl 中的 violation 事件数 |
| `interrupts_per_1k` | `#["Request interrupted" 文本] × 1000 / totalToolCalls` |
| `tool_diversity` | `keys(toolCounts).length` |
| `session_length` | `sum(toolCounts.values)` |

**统计** (`stats.js`):
- `mannWhitneyU(xs, ys) → { U, p }`:
  - 合并排序，平均秩处理 ties
  - normal approximation：`z = (U - n₁·n₂/2) / sqrt(n₁·n₂·(n₁+n₂+1)/12)`
  - p-value 从 z 查正态分布（双尾）
- `cliffDelta(xs, ys) → number ∈ [-1, +1]`:
  - `(count(x>y) − count(x<y)) / (n₁·n₂)`
  - 效应分级：`|δ| < 0.15` 小 / `< 0.33` 中 / `≥ 0.33` 大

**报告格式** (`report.js`)（*以下数字仅为格式示例，不是承诺数据*）:
```markdown
# Benchmark Report 2026-04-17

**Sample**: enabled n=X, disabled n=Y

| 指标 | enabled median [IQR] | disabled median [IQR] | U | p | Cliff's δ | 效应 |
|---|---|---|---|---|---|---|
| R/E | ... | ... | ... | ... | ... | ... |
| R/M | ... | ... | ... | ... | ... | ... |
| Write% | ... | ... | ... | ... | ... | ... |

**Note**: 任一组 n<10 时在该行标注 "⚠️ 样本不足"
```

实际运行 `npm run benchmark` 时数据全部来自本地真实会话。

### 组件 3: README 更新

删除 `README.md:880-911`（自报统计段），替换为：
- 运行 `npm run benchmark` 的说明
- 统计方法（Mann-Whitney U / Cliff's δ）解释
- 指标定义表
- "不直接报数字"的原则声明

### 组件 4: 测试

**单元测试**（TDD，每个函数先 RED 后 GREEN）:

| 文件 | 覆盖范围 |
|---|---|
| `tests/research-ratio.test.js` | `computeResearchRatio` 各种 toolCounts 分布、breakdown 正确性、null 边界 |
| `tests/benchmark-stats.test.js` | Mann-Whitney U 已知数据集、ties 处理、Cliff's δ 边界、样本不足标注 |
| `tests/benchmark-classifier.test.js` | 按 events.jsonl 正确分组、空/缺失文件容错 |

**集成测试扩展** (`tests/integration-phase2.test.js`):
- fixture 加入 3 条 Grep + 2 条 Bash + 1 条 CBM
- 断言输出含 R/M 行且数值为 `(10+3+2+1)/3 ≈ 5.3`

**端到端验证**:
- 跑 `npm run benchmark` 真实生成报告
- 人工检查无 NaN / Infinity / 负数

## 文件改动清单

**新增**（8）:
- `benchmark/run-benchmark.js`
- `benchmark/classifier.js`
- `benchmark/metrics.js`
- `benchmark/stats.js`
- `benchmark/report.js`
- `tests/research-ratio.test.js`
- `tests/benchmark-stats.test.js`
- `tests/benchmark-classifier.test.js`

**修改**（8）:
- `src/types.ts`
- `src/render/lines/harness.ts`
- `src/config.ts`
- `src/i18n/types.ts`
- `src/i18n/zh.ts`
- `src/i18n/en.ts`
- `tests/integration-phase2.test.js`
- `README.md`
- `package.json`

**合计**: 16 个文件，约 +800 行新代码。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Bash 混入写操作污染 R/M | 宏观比率层面可忽略；若用户反馈强烈，未来可加 command 白名单过滤 |
| 历史会话无 session_id | extractSessionId 降级：用文件名（通常含 session_id）或第一条 JSON 的 session_id 字段；都缺失则跳过 |
| events.jsonl 不存在 | classifier 容错返回空 enabled set，所有会话归 disabled（报告明确提示） |
| 小样本 p-value 不可靠 | `n<10` 时报告标注 "⚠️ 样本不足"，并给出 Cliff's δ（仍可用） |
| 会话历史中有损坏 JSONL | metrics 逐行 try/catch，损坏行跳过并记 warning |

## 验证标准

- [ ] `npm test` 全绿（385 + 新增 ~40 条测试）
- [ ] `npm run benchmark` 在无 events.jsonl 时不崩溃
- [ ] `npm run benchmark` 在有完整历史时输出合理报告
- [ ] HUD 显示 R/E + R/M 两行，数值正确着色
- [ ] README 不再包含自报统计数字
