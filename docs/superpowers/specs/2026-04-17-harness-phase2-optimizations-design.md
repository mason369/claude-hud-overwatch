# Harness Phase 2 优化 — 设计规格书

**日期**: 2026-04-17
**状态**: Approved
**范围**: 6 项用户侧 Harness 增强（对抗 issue #42796 症状）
**依赖**: 2026-04-16-harness-optimization-and-hud-integration-design.md 已完成

---

## 1. 背景

Issue #42796 报告自 2026-02 起 Claude Code 质量回归：Read:Edit 比率从 6.6→2.0，盲编辑率 6.2%→33.7%，Stop hook 违规 0→173。根因（thinking token redaction）在 Anthropic 侧，但**用户侧可通过拦截 + 观测闭环约 75% 症状**。

Phase 1（2026-04-16 spec）已建成：`harness-event.sh` 工具库、HUD 健康度评分、12 组件注册、`stop-phrase-guard.sh` 5 类违规检测、`research-first-guard.sh` 文件级拦截。

Phase 2 针对剩余缺口：**实时指标可视化 + 纵向基线 + 深度反模式拦截 + 主动防御**。

---

## 2. 6 项优化总览

| 编号 | 名称 | 类型 | 优先级 | 新增/改动 |
|------|------|------|--------|----------|
| F1 | Read:Edit 比率实时显示 | HUD | 高 | `transcript.ts` + `harness.ts` |
| F2 | 违规分类 HUD 分流渲染 | HUD | 高 | `harness.ts` 读现有 category |
| F3 | 跨会话基线 + z-score 告警 | Hook + HUD | 高 | 新 `session-summary.sh` + `harness.ts` |
| F4 | Edit 质量反模式拦截 | Hook | 中 | 新 `edit-quality-guard.sh` |
| F5 | UserPromptSubmit 主动重注入 | Hook | 中 | 新 `prompt-rescuer.sh` |
| F6 | research-first 时间窗口增强 | Hook | 低 | 改 `research-first-guard.sh` + `read-tracker.sh` |

---

## 3. F1 — Read:Edit 比率实时显示

### 3.1 问题

HUD 的 `harness.ts` 已统计 guard/sensor 触发次数，但 **没有 Read/Edit 次数比率**。Issue #42796 首要指标（6.6→2.0）未被可视化。

### 3.2 方案

**A. 数据采集** — `src/transcript.ts`

`processEntry` 遍历时新增独立 reducer（不受 `.slice(-20)` 影响）：

```typescript
// types.ts 在 TranscriptData 接口增加字段
interface TranscriptData {
  // ...现有字段...
  toolCounts: Record<string, number>;  // 每种工具的累计调用次数
}
```

```typescript
// transcript.ts 在流式解析循环中
if (block.type === 'tool_use') {
  const name = block.name ?? 'unknown';
  result.toolCounts[name] = (result.toolCounts[name] ?? 0) + 1;
}
```

**关键**：必须在 `slice(-20)` **之前**累加，保证全会话计数。

**B. 渲染** — `src/render/lines/harness.ts`

在现有「📊 守护/传感/拦截/违规」行之后新增：

```
📐 R/E: 3.2 | Read:64 Edit:20 Write:2
```

计算：`reads / max(edits + writes, 1)`。

**C. 颜色阈值**（`config.ts` harness 段新增）：

```typescript
readEditRatio?: {
  warning?: number;    // 默认 2.5（<2.5 黄）
  critical?: number;   // 默认 1.5（<1.5 红）
  show?: boolean;      // 默认 true
};
```

颜色规则：
- `ratio >= warning` → green
- `warning > ratio >= critical` → yellow
- `ratio < critical` → red + bold
- `edit + write == 0` → dim gray（无数据，不判断）

### 3.3 i18n

```typescript
// zh.ts
harnessReadEdit: 'R/E',
harnessReadLabel: '读',
harnessEditLabel: '改',
harnessWriteLabel: '写',

// en.ts
harnessReadEdit: 'R/E',
harnessReadLabel: 'Read',
harnessEditLabel: 'Edit',
harnessWriteLabel: 'Write',
```

---

## 4. F2 — 违规分类 HUD 分流渲染

### 4.1 问题

`stop-phrase-guard.sh` 已具备 5 类 category（ownership-deflection / permission-seeking / premature-stop / known-limitation-excuse / session-excuse），但 HUD 仅显示总数 `违规:0`。

### 4.2 方案

**A. 事件数据**（已就绪）

`stop-phrase-guard.sh` 在阻断时已调用：
```bash
emit_harness_event "violation" "stop-phrase-guard" "$violation_category" "$matched_pattern" "high"
```

HUD 读 harness-events.jsonl 时，`category` 字段即违规类别。

**B. HUD 统计** — `harness.ts`

现有 `computeHarnessHealth()` 中的 `violations.byCategory` 已按 category 累计（未被渲染）。新增渲染行：

```
⚠ 违规: 逃避×2 短语×1 过早停止×0 借口×0 会话×0
```

仅当至少一类 > 0 时显示；所有为 0 则隐藏该行。

**C. i18n 类别短名**（zh.ts 新增，en.ts 对应）

```typescript
harnessViolationCategory: {
  'ownership-deflection': '逃避',
  'permission-seeking': '征询',
  'premature-stop': '过早停',
  'known-limitation-excuse': '借口',
  'session-excuse': '会话托辞',
},
```

**D. 配置开关** — `config.ts`

```typescript
violationBreakdown?: {
  show?: boolean;  // 默认 true
};
```

### 4.3 颜色

任何类别 > 0 → 红色 + bold。0 → dim。

---

## 5. F3 — 跨会话基线 + z-score 告警

### 5.1 问题

Issue #42796 关键信号是**纵向退化**，单会话数值无参照系。

### 5.2 方案

**A. 新 Hook: `session-summary.sh`**（Stop 事件）

**位置**：`~/.claude/hooks/session-summary.sh`
**事件**：Stop
**注册位置**：`settings.json` Stop 数组末尾（在 `completion-gate.sh` 之后）

**职责**：会话结束时读取本会话 harness-events + transcript，计算摘要写入 `~/.claude/logs/session-summary.jsonl`。

**摘要 schema**：

```jsonl
{"ts":"2026-04-17T10:30:00.000Z","session":"abc123","transcript":"/path/to/transcript.jsonl","duration_s":3600,"read_count":64,"edit_count":20,"write_count":2,"r_e_ratio":2.91,"guard_blocks":2,"sensor_triggers":15,"violations_total":1,"violations_by_category":{"premature-stop":1}}
```

**实现要点**：
- 使用 `hook-metadata.sh` 的 `session_scope_key` 筛选本会话事件
- 从 `HOOK_TRANSCRIPT_PATH` 读 transcript.jsonl，grep `"type":"tool_use"` 后 `jq` 提取 `name` 字段计数
- 日志轮转：`session-summary.jsonl` 超 500 行截断到 300

**B. HUD 基线计算** — `harness.ts`

新增 `loadBaseline()` 函数：
- 读 `~/.claude/logs/session-summary.jsonl` 最近 30 条（约 30 个会话 ≈ 1-2 周）
- 计算 `r_e_ratio` 的中位数和 MAD（Median Absolute Deviation，比 σ 对离群值更稳健）
- 计算当前会话 `r_e_ratio` 的 z-score（用 MAD 近似：`(当前 - 中位数) / (1.4826 × MAD)`）

**C. HUD 渲染**

在 R/E 行之后追加：

```
📊 基线: R/E 4.5 (30会话) | 当前偏离: -1.8σ ⚠
```

阈值：
- `|z| < 1` → 正常，dim 显示或隐藏
- `1 <= |z| < 2` → 黄色警告
- `|z| >= 2` → 红色告警 + bold
- 负向 z（低于基线）→ 加 ↓ 箭头；正向 → ↑

**D. 配置** — `config.ts`

```typescript
baseline?: {
  enabled?: boolean;         // 默认 true
  windowSize?: number;       // 默认 30 最近会话
  minSessions?: number;      // 默认 5 会话才显示基线（冷启动保护）
  warnZ?: number;            // 默认 1
  criticalZ?: number;        // 默认 2
};
```

冷启动：`session-summary.jsonl` 不足 `minSessions` 条 → 不显示基线行，仅记录当前会话用于未来对比。

### 5.3 隐私

`session-summary.jsonl` 仅存数值指标，不含 transcript 内容、文件路径、用户提示词。

---

## 6. F4 — Edit 质量反模式拦截

### 6.1 问题

`research-first-guard.sh` 只管"是否读过"。Edit **参数本身**可能是低质量的（短 `old_string` 易误匹配、`replace_all` 未先 Grep、Write 覆盖未读文件）。

### 6.2 方案

**新 Hook: `edit-quality-guard.sh`**（PreToolUse: Edit|Write）

**位置**：`~/.claude/hooks/edit-quality-guard.sh`
**事件**：PreToolUse
**Matcher**：`Edit|Write`
**注册顺序**：`research-first-guard.sh` 之后，`linter-config-protection.sh` 之前

**阻断规则**（严格模式）：

| 规则 | 触发条件 | 处理 |
|------|---------|------|
| R1 | Edit.old_string 长度 < 10 字符 | `exit 2` + 建议"提供更多上下文" |
| R2 | Edit.replace_all=true 且本会话未 Grep 过 old_string | `exit 2` + 建议"先 Grep 确认范围" |
| R3 | Write 目标文件已存在且本会话未 Read 过 | `exit 2` + 建议"先 Read 再决定 Edit 还是 Write" |

**例外**：
- R1 例外：`old_string` 含换行（多行 pattern 通常够独特）
- R2 例外：`replace_all=false`（单次 Edit 不需要）
- R3 例外：文件不存在（新建）或已在本会话被 Read（`reads-*.log` 中命中）

**实现**：
- stdin 读 `tool_input.old_string` / `.new_string` / `.content` / `.replace_all` / `.file_path`
- Grep 本会话 `reads-{sha256}.log` 判断 R3
- Grep 本会话 `grep-searches-{sha256}.log`（**新文件**）判断 R2：需配套扩展 Grep PostToolUse 追加

**配套扩展**：
- 新 Hook `grep-tracker.sh`（PostToolUse: Grep）：把 `tool_input.pattern` 追加到 `grep-searches-{sha256}.log`

**settings.json 注册**：

```json
"PreToolUse": [
  {"matcher": "Edit|Write", "hooks": [
    {"type": "command", "command": "bash /c/Users/Administrator/.claude/hooks/research-first-guard.sh"},
    {"type": "command", "command": "bash /c/Users/Administrator/.claude/hooks/edit-quality-guard.sh"},
    {"type": "command", "command": "bash /c/Users/Administrator/.claude/hooks/linter-config-protection.sh"}
  ]}
],
"PostToolUse": [
  {"matcher": "Grep", "hooks": [
    {"type": "command", "command": "bash /c/Users/Administrator/.claude/hooks/grep-tracker.sh"}
  ]}
]
```

**事件**：

每次阻断 emit `guard.block` source=`edit-quality` category=`r1|r2|r3`。
放行 emit `guard.pass` source=`edit-quality` category=`allowed`。

---

## 7. F5 — UserPromptSubmit 主动重注入

### 7.1 问题

`post-compact-reinject.sh` 仅在 compact 后触发。用户在**挫败循环**中（连续"继续""没完成""为什么又错"）时，规则早已被对话"稀释"。

### 7.2 方案

**新 Hook: `prompt-rescuer.sh`**（UserPromptSubmit）

**位置**：`~/.claude/hooks/prompt-rescuer.sh`
**事件**：UserPromptSubmit
**注册顺序**：在 `session-init.sh` 之后（`effort-max-enforcer.sh` 之前，避免与 effort 巡检冲突）

**触发条件**（任一命中）：

| 触发 | 检测逻辑 |
|------|---------|
| T1 挫败词连续 | 本会话 `~/.claude/logs/prompt-history-{sha256}.log` 最近 3 条 prompt 含"继续/没完成/没做完/重来/为什么/又错/还是不行" ≥2 |
| T2 多步骤复杂任务 | 本次 prompt 字符数 > 100 且含 ≥3 个动作词（实现/重构/修复/新增/删除/优化/集成/测试/部署） |
| T3 明显回溯 | prompt 含"上次/之前/回到/撤回/revert" |

**输出**（hookSpecificOutput.additionalContext）：

```
━━━ Harness 反简化规则重注入（{{trigger}}） ━━━
1. 先研究再编辑：任何 Edit 前必须先 Read 目标文件
2. 禁止"最简单修复"：选正确方案，不选省力方案
3. 禁止过早停止：任务未完成不得停，不说"检查点"
4. 禁止逃避所有权：遇问题就修，不说"预先存在"
5. 复杂任务按 Skill 链执行：brainstorming → writing-plans → subagent-driven-development
参照 CLAUDE.md 反简化章节全文。
```

**实现要点**：
- 用 `hook-metadata.sh::session_scope_key` 生成日志路径
- 追加当前 prompt（前 200 字）到 `prompt-history-{sha256}.log`；轮转超 100 行截到 50
- emit `sensor.trigger` source=`prompt-rescuer` category=`{{trigger}}`

---

## 8. F6 — research-first 时间窗口增强

### 8.1 问题

`research-first-guard.sh` 仅检查"会话内任何时间读过"。若用户早期读过 `foo.ts`，2 小时后无 context 直接 Edit，仍会放行——**旧 read 已出 context window**。

### 8.2 方案

**A. `read-tracker.sh` 改记录格式**

当前：
```
/c/path/to/file.ts
```

改为（每行）：
```
{{unix_timestamp}}\t/c/path/to/file.ts
```

**B. `research-first-guard.sh` 时间窗口检查**

新配置常量（脚本顶部）：
```bash
READ_FRESHNESS_SECONDS=1800   # 30 分钟；可通过 env 覆盖
```

匹配逻辑：
- 读取 `reads-{sha256}.log` 所有行
- 过滤 `timestamp > now - READ_FRESHNESS_SECONDS` 的行
- 在过滤结果中做 `grep -qF "$norm_path"`
- 命中 → pass；未命中 → block，提示"文件可能已出上下文，请重新 Read"

**C. 环境变量覆盖**（用户可调）

```bash
export HARNESS_READ_FRESHNESS_SECONDS=3600  # 改为 1 小时
```

**D. 向后兼容**

`read-tracker.sh` 切换格式时，`research-first-guard.sh` 同时支持两种格式：行含 `\t` 则按新格式；否则视为无时间戳、放行（兼容旧数据，直到下次会话）。

---

## 9. 组件注册表扩展

### 9.1 新增 HARNESS_COMPONENTS 条目

在 `~/.claude/claude-hud-zh/src/render/lines/harness.ts` L38-51 `HARNESS_COMPONENTS` 数组追加：

```typescript
{ id: 'edit-quality',   label: '编辑质量', type: 'guard',   priority: 'high',   weight: 2 },
{ id: 'grep-tracker',   label: 'Grep追踪', type: 'sensor',  priority: 'normal', weight: 1 },
{ id: 'prompt-rescuer', label: '提示救援', type: 'sensor',  priority: 'high',   weight: 2 },
{ id: 'session-summary',label: '会话摘要', type: 'sensor',  priority: 'normal', weight: 1 },
```

权重合计由 19 升至 25。`computeHarnessHealth()` 的基础分分母自动更新。

### 9.2 COMPONENT_LABEL_KEY_BY_ID 同步

在 `harness.ts` L59-72 `COMPONENT_LABEL_KEY_BY_ID` 映射追加对应 i18n key。

### 9.3 i18n 同步

`zh.ts` / `en.ts` 的 `harnessComponent.*` 和 `harnessReason.*` 追加 4 个组件的翻译。

---

## 10. 文件变更清单

### 10.1 新建文件

| 文件 | Agent |
|------|-------|
| `~/.claude/hooks/session-summary.sh` | B (Hook 三件套) |
| `~/.claude/hooks/edit-quality-guard.sh` | B |
| `~/.claude/hooks/grep-tracker.sh` | B |
| `~/.claude/hooks/prompt-rescuer.sh` | B |

### 10.2 修改文件

| 文件 | 变更 | Agent |
|------|------|-------|
| `~/.claude/hooks/read-tracker.sh` | 行格式加时间戳 | C |
| `~/.claude/hooks/research-first-guard.sh` | 加时间窗口过滤 | C |
| `~/.claude/settings.json` | 注册 4 个新 hook + 1 个 PostToolUse:Grep + Stop 追加 session-summary | B（完成新 hook 后统一注册）|
| `~/.claude/claude-hud-zh/src/transcript.ts` | 加 toolCounts reducer | A (数据层) |
| `~/.claude/claude-hud-zh/src/types.ts` | TranscriptData 加 toolCounts 字段；HarnessHealth 加 readEditRatio / violationBreakdown / baseline 字段 | A |
| `~/.claude/claude-hud-zh/src/config.ts` | harness 段加 readEditRatio / violationBreakdown / baseline 三配置段 | D |
| `~/.claude/claude-hud-zh/src/render/lines/harness.ts` | 加 loadBaseline / render R/E / render 违规分类 / render 基线 / 4 新组件注册 | D |
| `~/.claude/claude-hud-zh/src/i18n/zh.ts` | R/E / 违规类别 / 基线 / 4 组件 / 新 harnessReason 翻译 | D |
| `~/.claude/claude-hud-zh/src/i18n/en.ts` | 同上英文 | D |
| `~/.claude/claude-hud-zh/src/i18n/types.ts` | MessageKey 联合类型扩展 | D |

### 10.3 测试文件

| 文件 | Agent |
|------|-------|
| `~/.claude/claude-hud-zh/tests/harness.test.js` | 扩展 R/E / 违规分类 / 基线测试 | D |
| `~/.claude/claude-hud-zh/tests/transcript.test.js` | toolCounts 测试 | A |

---

## 11. Agent Team 分工

| Agent | 独占文件 | 只读依赖 | 依赖完成前 |
|-------|----------|----------|-----------|
| **A (data-layer)** | `transcript.ts`, `types.ts`, `tests/transcript.test.js` | 无 | 独立启动 |
| **B (new-hooks)** | `session-summary.sh`, `edit-quality-guard.sh`, `grep-tracker.sh`, `prompt-rescuer.sh`, `settings.json` | `harness-event.sh`, `hook-metadata.sh` | 独立启动 |
| **C (read-tracker-upgrade)** | `read-tracker.sh`, `research-first-guard.sh` | `harness-event.sh`, `hook-metadata.sh` | 独立启动 |
| **D (hud-render)** | `config.ts`, `render/lines/harness.ts`, `i18n/zh.ts`, `i18n/en.ts`, `i18n/types.ts`, `tests/harness.test.js` | A 的 `types.ts` 完成后 | 等待 A 完成 |
| **E (integration-test)** | 新 `tests/integration/` 目录 | A/B/C/D 全部 | 最终 |

**执行顺序**：
- Phase 1：A + B + C 并行启动
- Phase 2：A 完成后启动 D（D 依赖 A 的 types）
- Phase 3：A/B/C/D 全部完成后启动 E

---

## 12. 验证计划

- [ ] transcript toolCounts 单元测试：模拟含 10 Read + 3 Edit 的 JSONL → toolCounts.Read=10
- [ ] session-summary Stop 触发测试：模拟 Stop → session-summary.jsonl 新增一行符合 schema
- [ ] edit-quality R1 测试：old_string="foo" → 阻断；含换行 → 放行
- [ ] edit-quality R2 测试：replace_all=true 未 Grep → 阻断；Grep 过 → 放行
- [ ] edit-quality R3 测试：Write 已存在文件未 Read → 阻断；新文件 → 放行
- [ ] prompt-rescuer T1 测试：3 条挫败词 prompt → 重注入规则
- [ ] research-first 时间窗口测试：31 分钟前读过 → 阻断；25 分钟前读过 → 放行
- [ ] HUD R/E 渲染测试：toolCounts={Read:10, Edit:5} → 显示 R/E: 2.0 黄色
- [ ] HUD 违规分类测试：byCategory={premature-stop:2} → 显示 过早停×2 红色
- [ ] HUD 基线测试：<5 会话 → 隐藏基线行；>=5 且偏离 -2σ → 显示 ↓↓ 红色
- [ ] 向后兼容：旧 reads-log 无 \t → research-first 放行不崩

---

## 13. 回滚策略

每个新 hook 独立注册，失败可在 settings.json 注释掉单条：

```bash
# 禁用 edit-quality-guard
sed -i 's|bash /c/Users/Administrator/.claude/hooks/edit-quality-guard.sh|# &|' ~/.claude/settings.json
```

HUD 改动通过 `HudConfig.harness.{readEditRatio|violationBreakdown|baseline}.enabled=false` 关闭，无需回滚代码。

---

## 14. 成功标准

- 6 项优化全部实施并单元测试通过
- HUD 状态栏能看到：R/E 比率、违规分类、基线偏离
- 模拟低质量 Edit（短 old_string / 盲 replace_all / Write 覆盖未读）被阻断
- 挫败循环被检测并自动重注规则
- 30 分钟前读过的文件 Edit 被阻断并提示重新 Read
