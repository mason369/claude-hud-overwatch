# claude-hud-overwatch

> Claude Code 全视状态栏 — 全功能默认开启、Hook 防护监控、违规检测、子代理追踪

Fork 自 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud) v0.0.12，MIT 协议。

## 与官方版本的区别

### 功能增强

| 特性 | 官方 claude-hud | overwatch |
|------|----------------|-----------|
| 默认功能开关 | 大部分关闭，需手动开启 | **全部默认开启** |
| 推理深度显示 | 无 | **[Opus 4.6 \| Max]** 跟随 effort 配置 |
| Provider 标签 | 无 | **Bedrock / API** 自动识别 |
| Hook 防护监控 | 无 | **防护类/事件类分组统计 + ↳ 详情行** |
| 违规检测详情 | 无 | **最新违规模式 + 时间 + 分类 + 解释** |
| 研究优先拦截 | 无 | **拦截文件 + 原因追踪** |
| 子代理活动追踪 | 无 | **启动/停止事件中文化显示** |
| 详情行自动隐藏 | 无 | **10 分钟无新触发自动隐藏** |
| 会话词元标签 | 硬编码 `Tokens`/`in:`/`out:` | **i18n 国际化**（中文`词元`/英文`Tokens`） |
| 界面语言 | 默认英文 | **默认中文**（可切换英文） |

### 默认值变更

以下默认值与官方不同（均可通过配置覆盖）：

| 配置项 | 官方默认值 | overwatch 默认值 |
|--------|-----------|-----------------|
| `language` | `en` | `zh` |
| `showSeparators` | `false` | `true` |
| `pathLevels` | `1` | `2` |
| `contextValue` | `percent` | `both`（百分比+词元数） |
| `showConfigCounts` | `false` | `true` |
| `showCost` | `false` | `true` |
| `showDuration` | `false` | `true` |
| `showSpeed` | `false` | `true` |
| `showTools` | `false` | `true` |
| `showAgents` | `false` | `true` |
| `showTodos` | `false` | `true` |
| `showSessionName` | `false` | `true` |
| `showClaudeCodeVersion` | `false` | `true` |
| `showMemoryUsage` | `false` | `true` |
| `showSessionTokens` | `false` | `true` |
| `showOutputStyle` | `false` | `true` |
| `gitStatus.showAheadBehind` | `false` | `true` |
| `gitStatus.showFileStats` | `false` | `true` |
| `sevenDayThreshold` | `80` | `0`（始终显示） |

> 理念：上游以最小化显示为默认，本 fork 以"全量信息、开箱即用"为目标。

### i18n 扩展

在上游 18 个 key 基础上新增 5 个（另同步上游 `label.cost`，共 23 key）：

| Key | 英文 | 中文 | 用途 |
|-----|------|------|------|
| `label.cost` | `Cost` | `费用` | 原生费用标签（同步上游） |
| `label.tokens` | `Tokens` | `词元` | 会话词元行标题 |
| `label.ccVersion` | `CC v` | `CC 版本` | Claude Code 版本前缀 |
| `label.sessionTokenPrefix` | `tok` | `词元` | 紧凑模式词元前缀 |
| `format.minutes` | `m` | `分钟` | 时长分钟单位 |
| `format.hours` | `h` | `小时` | 时长小时单位 |

### 新增功能：推理深度（Effort）显示

`project.ts` 新增推理深度显示，在模型标签中追加 effort 等级：

- 读取优先级：`CLAUDE_CODE_EFFORT_LEVEL` 环境变量 > `~/.claude/settings.json` 的 `effortLevel`
- 显示格式：`[Opus 4.6 | Max]`、`[Opus 4.6 | High]`、`[Opus 4.6 | Medium]`、`[Opus 4.6 | Low]`
- `default` 值不显示
- 支持 Provider 标签：`[Opus 4.6 | Bedrock]`、`[Opus 4.6 | API]`

### 新增功能：Hook 触发统计与违规检测

`environment.ts` 大幅扩展，上游仅显示配置计数，本 fork 新增：

- **Hook 分组显示** — 防护类（停止短语、研究优先、努力锁定）和事件类（自动格式、子代理、队友空闲、任务完成、压缩注入）分别计数
- **待机统计** — 已注册但今日未触发的 hook 数量
- **违规检测** — 按类别统计（逃避、求许可、早停、推脱、借口）
- **6 种 ↳ 详情行**（全部 10 分钟 TTL 自动隐藏）：
  1. **最新违规**（红色）— 时间 + 分类 + 触发模式 + 解释
  2. **研究优先拦截**（黄色）— 时间 + 拦截文件和原因
  3. **子代理活动**（灰色）— 时间 + 启动/停止 + 代理类型
  4. **防护触发**（黄色）— 时间 + 防护类型 + 详情
  5. **事件触发**（灰色）— 时间 + 事件类型 + 详情
  6. **队友空闲**（灰色）— 时间 + 队友名称

数据来源（需配合对应 hook 脚本）：
- `~/.claude/logs/hook-counters.csv` — 各 hook 触发计数
- `~/.claude/logs/stop-phrase-violations.log` — 违规拦截记录
- `~/.claude/logs/research-first-violations.log` — 研究优先拦截记录
- `~/.claude/logs/subagent.log` — 子代理生命周期
- `~/.claude/logs/hook-events.log` — 防护/事件/空闲详情（新增）

### 会话词元行国际化

上游 `session-tokens.ts` 和 `session-line.ts` 使用硬编码英文，本 fork 改用 `t()` 函数实现多语言。

### 费用显示差异

上游已升级为 `resolveSessionCost()`，支持原生 `cost.total_cost_usd` 字段。本 fork 仍使用 `estimateSessionCost()`（`label.cost` i18n key 已同步，渲染逻辑待跟进）。

### 其他修改

- **transcript.ts** — Agent 类型 fallback 从 `'unknown'` 改为 `subagent_type → name → 'agent'` 三级回退，避免显示 `unknown`
- **project.ts** — 推理深度(Effort) Max/High/Medium/Low 显示 + Provider(Bedrock/API) 标签 + 时长/速度/费用拆分到独立的 `renderSessionInfoLine`
- **stdin.ts** — 新增 `getProviderLabel()` 检测 Bedrock 模型 ID 和 `ANTHROPIC_API_KEY` 环境变量
- **render/index.ts** — session info 行合并的集成逻辑

### 未修改的部分（与官方完全一致）

- 核心渲染引擎（identity、usage、memory 行）
- 配置系统（mergeConfig、loadConfig、迁移逻辑）
- stdin 解析
- Git 状态检测 / 颜色系统
- 所有 TypeScript 类型定义

## 特性

- 实时上下文健康度（进度条 + 百分比 + 词元数）
- 工具调用活动追踪（Edit、Read、Bash 等）
- 子代理状态监控（类型、用时、描述）
- 任务进度跟踪（待办/进行中/已完成）
- Git 分支状态（分支名、脏标记、领先/落后、文件统计）
- API 用量追踪（5 小时/7 天配额）
- 会话词元统计（输入、输出、缓存分类）
- 费用追踪
- 内存使用监控
- Hook 防护监控（防护类/事件类分组、待机计数）
- 违规检测（分类统计 + 最新详情 + 拦截追踪）
- 完整中文界面，默认中文

## 安装

### 方式一：作为 Claude Code 插件安装

```
/install-plugin https://github.com/mason369/claude-hud-overwatch
```

然后运行 setup 并重启 Claude Code：

```
/claude-hud-overwatch:setup
```

### 方式二：手动安装

1. 克隆仓库到 `~/.claude/claude-hud-overwatch/`
2. 安装依赖并构建：
   ```bash
   cd ~/.claude/claude-hud-overwatch
   npm ci && npm run build
   ```
3. 运行 `/claude-hud-overwatch:setup` 配置 statusLine

## 配置

配置文件位于 `~/.claude/plugins/claude-hud/config.json`

### 布局模式

| 模式 | 说明 |
|------|------|
| `expanded`（展开模式） | 多行显示，每个信息段独占一行 |
| `compact`（紧凑模式） | 单行显示，所有信息压缩到一行 |

### 显示选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `language` | string | `zh` | 界面语言：`zh` 或 `en` |
| `lineLayout` | string | `expanded` | 布局模式 |
| `showSeparators` | boolean | `true` | 显示分隔符 |
| `pathLevels` | 1-3 | `2` | 项目路径显示层级 |
| `display.showModel` | boolean | `true` | 显示模型名称 |
| `display.showProject` | boolean | `true` | 显示项目路径 |
| `display.showContextBar` | boolean | `true` | 显示上下文进度条 |
| `display.contextValue` | string | `both` | 上下文格式 |
| `display.showConfigCounts` | boolean | `true` | 显示配置计数 |
| `display.showCost` | boolean | `true` | 显示费用 |
| `display.showDuration` | boolean | `true` | 显示会话时长 |
| `display.showSpeed` | boolean | `true` | 显示输出速度 |
| `display.showTokenBreakdown` | boolean | `true` | 高上下文时显示词元明细 |
| `display.showUsage` | boolean | `true` | 显示用量限制 |
| `display.usageBarEnabled` | boolean | `true` | 用量进度条形式 |
| `display.showTools` | boolean | `true` | 显示工具活动行 |
| `display.showAgents` | boolean | `true` | 显示代理状态行 |
| `display.showTodos` | boolean | `true` | 显示任务进度行 |
| `display.showSessionName` | boolean | `true` | 显示会话名称 |
| `display.showClaudeCodeVersion` | boolean | `true` | 显示 CC 版本 |
| `display.showMemoryUsage` | boolean | `true` | 显示内存使用 |
| `display.showSessionTokens` | boolean | `true` | 显示会话词元统计 |
| `display.showOutputStyle` | boolean | `true` | 显示输出风格 |
| `display.autocompactBuffer` | string | `enabled` | 自动压缩缓冲 |
| `display.usageThreshold` | 0-100 | `0` | 用量显示阈值 |
| `display.sevenDayThreshold` | 0-100 | `0` | 7 天用量显示阈值 |
| `display.environmentThreshold` | 0-100 | `0` | 环境行显示阈值 |
| `display.modelFormat` | string | `full` | 模型名格式 |
| `display.modelOverride` | string | `""` | 自定义模型名 |
| `display.customLine` | string | `""` | 自定义行内容 |

### Git 状态

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `gitStatus.enabled` | `true` | 启用 Git 状态 |
| `gitStatus.showDirty` | `true` | 显示未提交更改 |
| `gitStatus.showAheadBehind` | `true` | 显示领先/落后 |
| `gitStatus.showFileStats` | `true` | 显示文件统计 |

### 颜色配置

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `colors.context` | `green` | 上下文进度条 |
| `colors.usage` | `brightBlue` | 用量进度条 |
| `colors.warning` | `yellow` | 警告色 |
| `colors.usageWarning` | `brightMagenta` | 用量警告 |
| `colors.critical` | `red` | 危险色 |
| `colors.model` | `cyan` | 模型标签 |
| `colors.project` | `yellow` | 项目路径 |
| `colors.git` | `magenta` | Git 标记 |
| `colors.gitBranch` | `cyan` | Git 分支名 |
| `colors.label` | `dim` | 标签 |
| `colors.custom` | `208` | 自定义行 |

支持：命名色、256 色索引（`0-255`）、十六进制（`#rrggbb`）。

## 环境行显示格式

overwatch 增强后的环境行（所有 ↳ 详情行在最后一次触发后 10 分钟自动隐藏）：

```
1 CLAUDE.md | 3 MCPs | 防护: 努力锁定×1 | 事件: 队友空闲×33 | 待机 9 | 停止防护 违规3 逃避×3
  ↳ 最新违规[17:11:01] 逃避:「不是我导致的」 — 模型试图推卸责任
  ↳ 拦截[16:44:40] Edit plan.md — 编辑前未先Read文件
  ↳ 子代理[18:59:42] 停止 test-analyzer
  ↳ 防护[19:02:43] 努力锁定 → 恢复 effortLevel=max
  ↳ 事件[19:02:43] 任务 → 修复认证Bug
  ↳ 待机[19:02:56] 最新空闲队友: test-analyzer (本会话共 33 次空闲)
```

| 详情行 | 颜色 | 数据来源 | 说明 |
|--------|------|----------|------|
| `↳ 最新违规` | 红色 | `stop-phrase-violations.log` | 违规分类 + 触发短语 + 解释 |
| `↳ 拦截` | 黄色 | `research-first-violations.log` | 拦截的操作 + 文件 + 原因 |
| `↳ 子代理` | 灰色 | `subagent.log` | 启动/停止 + 代理类型 |
| `↳ 防护` | 黄色 | `hook-events.log` | 防护类 hook 触发详情 |
| `↳ 事件` | 灰色 | `hook-events.log` | 事件类 hook 触发详情 |
| `↳ 待机` | 灰色 | `hook-events.log` | 最新空闲的队友名称 |

## 配套 Hook 配置（推荐）

overwatch 的 Hook 监控功能依赖本地 hook 脚本产生的日志数据。这些 hook 是对 [anthropics/claude-code#42796](https://github.com/anthropics/claude-code/issues/42796) 问题的系统性对策。

### 背景：Issue #42796

该 issue 记录了 Claude Code 在复杂工程任务中的行为退化，主要表现为：

- **逃避所有权** — 模型声称"不是我导致的""预先存在的问题"来推卸责任
- **反问请求许可** — 模型反复问"要我继续吗？"而非直接执行
- **过早停止** — 模型宣称"好的停顿点""自然检查点"来提前结束
- **标签化局限性** — 模型以"已知局限性""超出范围"为由拒绝尝试
- **会话借口** — 模型以"上下文太长""建议新会话"来放弃当前任务
- **盲编辑** — 模型未读取文件就直接编辑，导致错误修改

### Hook 脚本说明

> **重要**：Hook 脚本需要你自行部署。以下提供全部脚本的完整内容，复制到 `~/.claude/hooks/` 目录下即可使用。

| 脚本 | Hook 类型 | 作用 | 产出日志 |
|------|----------|------|----------|
| `hook-counter.sh` | （辅助） | 统计各 hook 触发次数 | `hook-counters.csv` |
| `hook-metadata.sh` | （辅助库） | session_id 提取 + session-scoped 日志路径 | — |
| `harness-event.sh` | （辅助库） | 统一事件写入（flock 并发安全，自动轮转） | `harness-events.jsonl` |
| `stop-phrase-guard.sh` | Stop | **核心防护**：拦截 5 类共 53 个停止短语 | `stop-phrase-violations.log` |
| `research-first-guard.sh` | PreToolUse | **先研究再编辑**：阻止盲编辑 | `research-first-violations.log` |
| `read-tracker.sh` | PostToolUse | 记录 Read 过的文件，供 research-first 检查 | `read-tracker/reads.log` |
| `effort-max-enforcer.sh` | PreToolUse | 强制 effortLevel=max | `hook-events.log` |
| `subagent-logger.sh` | SubagentStart/Stop | 记录子代理生命周期 | `subagent.log` |
| `teammate-idle-gate.sh` | TeammateIdle | 队友空闲事件追踪 | `hook-events.log` |
| `task-completed-gate.sh` | TaskCompleted | 任务完成事件追踪 | `hook-events.log` |
| `auto-format.sh` | PostToolUse | 自动格式化（ruff/prettier/dotnet） | — |
| `post-compact-reinject.sh` | PostCompact | 压缩后重注入关键指令 | — |
| `agent-opus-enforcer.sh` | PreToolUse | 强制 Agent 使用 Opus 模型 | `hook-counters.csv` |
| `session-init.sh` | UserPromptSubmit | 清理过期 read-tracker | — |
| `hook-stats.sh` | （CLI 工具） | Hook 统计仪表板 | — |
| `completion-gate.sh` | Stop | **完成验证**：pending edits 时运行测试，失败则阻断 | `harness-events.jsonl` |
| `edit-quality-guard.sh` | PreToolUse(Edit/Write) | R1/R2/R3 编辑反模式拦截（短 old_string、未 grep 的 replace_all、未读取的重写） | `harness-events.jsonl` |
| `grep-tracker.sh` | PostToolUse(Grep) | 记录 Grep pattern 供 R2 查询 | `read-tracker/grep-searches-*.log` |
| `linter-config-protection.sh` | PreToolUse(Edit/Write) | Linter 配置保护审计（事件记录） | `harness-events.jsonl` |
| `prompt-rescuer.sh` | UserPromptSubmit | T1/T2/T3 触发规则重注入（挫折语 / 长 prompt / 回退语） | `harness-events.jsonl` |
| `safety-gate.sh` | PreToolUse(Bash) | 危险命令守卫（审计通过） | `harness-events.jsonl` |
| `session-summary.sh` | Stop | 会话结束统计写入 session-summary.jsonl | `session-summary.jsonl` |

所有日志文件位于 `~/.claude/logs/` 目录下。overwatch 的 `environment.ts` 按日期 + 会话起始时间过滤并渲染。

> **harness 事件链路**：`harness-event.sh` 是 `completion-gate.sh` / `edit-quality-guard.sh` / `prompt-rescuer.sh` 等"操作型 hook"的共同依赖，它把事件（`sensor.trigger`、`guard.pass`、`violation` 等）写入 `~/.claude/logs/harness-events.jsonl`。`npm run benchmark` 的 `benchmark/classifier.js` 会读取该文件里出现过的 session_id，把它们标为「启用 harness」组，其它 transcript 归入「未启用」组。**如果上述 hook 未部署，harness-events.jsonl 将不存在，所有会话都会被归到"未启用"组，benchmark 将无法对比效果。**

### Hook 脚本完整内容

#### `hook-counter.sh` — 统一计数器（所有 hook 的基础依赖）

```bash
#!/bin/bash
# 统一 Hook 计数器 — 所有 hook 调用此脚本记录触发次数
# 用法: bash hook-counter.sh <hook名称>
# 每次触发写一条带时间戳的行，支持按会话起始时间过滤
# 格式: "YYYY-MM-DD HH:MM:SS,hookname,1"

HOOK_NAME="${1:-unknown}"
LOG_DIR="$HOME/.claude/logs"
COUNTER_FILE="$LOG_DIR/hook-counters.csv"

mkdir -p "$LOG_DIR"

# 追加一条带时间戳的记录
echo "$(date '+%Y-%m-%d %H:%M:%S'),${HOOK_NAME},1" >> "$COUNTER_FILE"
```

#### `hook-metadata.sh` — session_id 提取与 session-scoped 日志路径

所有"操作型 hook"（completion-gate、edit-quality-guard、prompt-rescuer、grep-tracker、session-summary 等）都通过 `source` 这个脚本来获取当前会话的 `session_id` 与 `transcript_path`，并把日志按会话隔离。

```bash
#!/bin/bash
# hook-metadata.sh — 共享元数据提取工具
# source 方式使用，不独立运行

# 从 stdin JSON 提取 session_id / transcript_path，写入同名环境变量
extract_hook_session() {
  local input="${1:-}"
  HOOK_SESSION_ID=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)
  HOOK_TRANSCRIPT_PATH=$(echo "$input" | jq -r '.transcript_path // empty' 2>/dev/null)
}

# 返回 session 作用域 key（8 位短 id，回退到 "global"）
session_scope_key() {
  local sid="${1:-$HOOK_SESSION_ID}"
  if [[ -n "$sid" ]]; then
    echo "${sid:0:8}"
  else
    echo "global"
  fi
}

# 生成 session-scoped 日志路径
# 用法: session_scoped_log_path <dir> <basename>
# 例如 session_scoped_log_path "$LOG_DIR/read-tracker" "grep-searches"
#      → $LOG_DIR/read-tracker/grep-searches-<key>.log
session_scoped_log_path() {
  local dir="$1"
  local base="$2"
  local key
  key=$(session_scope_key)
  mkdir -p "$dir"
  echo "${dir}/${base}-${key}.log"
}

# 返回 session-scoped pending-edits 标志文件路径
pending_edits_flag_path() {
  local key
  key=$(session_scope_key)
  echo "$HOME/.claude/logs/.pending-edits-${key}"
}
```

#### `harness-event.sh` — 统一事件写入（flock 并发安全）

把所有 hook 产生的结构化事件以 JSONL 形式写入 `~/.claude/logs/harness-events.jsonl`，是 `benchmark/classifier.js` 判定"启用 harness"的**唯一数据源**。

```bash
#!/bin/bash
# harness-event.sh — 所有 hook 共享的事件写入函数
# source 方式使用

HARNESS_EVENTS_LOG="$HOME/.claude/logs/harness-events.jsonl"
HARNESS_EVENTS_MAX_LINES=5000
HARNESS_EVENTS_KEEP_LINES=3000

# 写入一条事件到 harness-events.jsonl
# 用法: emit_harness_event <event_name> <json_payload>
# payload 应为合法 JSON（会被直接拼接到事件对象内）
emit_harness_event() {
  local event="$1"
  local payload="${2:-\{\}}"
  local sid="${HOOK_SESSION_ID:-}"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  mkdir -p "$(dirname "$HARNESS_EVENTS_LOG")"

  # 使用 flock 串行化并发写入（多个 hook 同时触发时避免交错）
  (
    flock -x 200
    printf '{"ts":"%s","session":"%s","event":"%s","payload":%s}\n' \
      "$ts" "$sid" "$event" "$payload" >> "$HARNESS_EVENTS_LOG"

    # 超过阈值后截断保留最新 KEEP_LINES 行
    local lines
    lines=$(wc -l < "$HARNESS_EVENTS_LOG" 2>/dev/null || echo 0)
    if (( lines > HARNESS_EVENTS_MAX_LINES )); then
      tail -n "$HARNESS_EVENTS_KEEP_LINES" "$HARNESS_EVENTS_LOG" > "${HARNESS_EVENTS_LOG}.tmp" \
        && mv "${HARNESS_EVENTS_LOG}.tmp" "$HARNESS_EVENTS_LOG"
    fi
  ) 200>"${HARNESS_EVENTS_LOG}.lock"
}

# 便捷包装：事件名 + key=value 列表转成 JSON 对象
# 用法: emit_harness_event_kv <event> k1 v1 k2 v2 ...
emit_harness_event_kv() {
  local event="$1"; shift
  local payload="{"
  local first=1
  while (( $# >= 2 )); do
    local k="$1"; local v="$2"; shift 2
    if (( first )); then first=0; else payload+=","; fi
    payload+="\"${k}\":\"${v}\""
  done
  payload+="}"
  emit_harness_event "$event" "$payload"
}
```

#### `stop-phrase-guard.sh` — 停止短语防护（核心）

```bash
#!/bin/bash
# Stop Phrase Guard Hook (基于 stellaraccident issue #42796)
# Hook 类型: Stop — 非零退出码阻止模型停止，stdout 作为纠正消息注入

bash "$HOME/.claude/hooks/hook-counter.sh" "stop-phrase-guard" &
input=$(cat)
lower_input=$(echo "$input" | tr '[:upper:]' '[:lower:]')

# ── 1. 逃避所有权 ──
ownership_patterns=(
  "not caused by my" "pre-existing issue" "pre-existing problem" "pre-existing bug"
  "already existed before" "was already broken" "not related to my changes" "not my fault"
  "existed prior to" "unrelated to the current" "outside my control"
)

# ── 2. 请求许可 ──
permission_patterns=(
  "should i continue" "would you like me to" "shall i proceed" "do you want me to"
  "want me to continue" "let me know if you" "if you'd like me to" "i can continue if"
  "would you prefer" "should i go ahead" "awaiting your" "waiting for your"
)

# ── 3. 过早停止 ──
stopping_patterns=(
  "good stopping point" "natural checkpoint" "good place to stop" "pause here"
  "leave it here" "stop here for now" "good point to pause" "take a break"
  "come back to this" "pick this up later" "reasonable stopping" "i'll stop here"
  "stopping for now"
)

# ── 4. 已知局限性 ──
limitation_patterns=(
  "known limitation" "known issue" "future work" "out of scope" "beyond the scope"
  "todo for later" "left as an exercise" "can be improved later" "for a future"
  "outside the scope" "not in scope"
)

# ── 5. 会话借口 ──
session_patterns=(
  "continue in a new session" "new conversation" "fresh session" "running too long"
  "context getting large" "context is getting" "start a new session" "context window"
  "running out of context"
)

LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/stop-phrase-violations.log"

check_patterns() {
  local category="$1"
  shift
  local patterns=("$@")
  for pattern in "${patterns[@]}"; do
    if echo "$lower_input" | grep -qi "$pattern"; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') [$category] 触发: \"$pattern\"" >> "$LOG_FILE"
      echo "$category"
      return 0
    fi
  done
  return 1
}

violation=""
violation=$(check_patterns "逃避所有权" "${ownership_patterns[@]}") ||
violation=$(check_patterns "请求许可" "${permission_patterns[@]}") ||
violation=$(check_patterns "过早停止" "${stopping_patterns[@]}") ||
violation=$(check_patterns "已知局限性" "${limitation_patterns[@]}") ||
violation=$(check_patterns "会话借口" "${session_patterns[@]}")

if [ -n "$violation" ]; then
  cat <<EOF
[Stop Phrase Guard] 检测到违规: $violation
你没有完成任务。不要停止，不要请求许可，不要逃避责任。
继续工作：
- 如果遇到错误，诊断并修复它
- 如果任务未完成，继续下一步
- 如果代码需要修改，先读取文件再编辑
- 不要声称问题是"已知局限性"或"预先存在的"
立即继续执行未完成的工作。
EOF
  exit 1
fi

exit 0
```

#### `research-first-guard.sh` — 先研究再编辑

```bash
#!/bin/bash
# Research-First Guard Hook v2 (issue #42796 Read:Edit ratio enforcement)
# PreToolUse hook for Edit/Write — blocks edits to files not recently Read
# Exit 0 = allow, Exit 2 = block with message

bash "$HOME/.claude/hooks/hook-counter.sh" "research-first" &
input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty')
file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)

if [ "$tool_name" != "Edit" ] && [ "$tool_name" != "Write" ]; then
  exit 0
fi

if [ -z "$file_path" ]; then
  exit 0
fi

# Write tool creating NEW files is allowed (file doesn't exist yet)
if [ "$tool_name" = "Write" ] && [ ! -f "$file_path" ]; then
  exit 0
fi

# Check the session's recent tool history for a Read of this file
# We track reads via a temp file updated by the read-tracker hook
TRACK_DIR="$HOME/.claude/logs/read-tracker"
mkdir -p "$TRACK_DIR"
TRACK_FILE="$TRACK_DIR/reads.log"

# Normalize the file path for comparison
norm_path=$(realpath "$file_path" 2>/dev/null || echo "$file_path")

if grep -qF "$norm_path" "$TRACK_FILE" 2>/dev/null; then
  exit 0
fi

# Also check basename match (handles different path representations)
basename_check=$(basename "$file_path")
if grep -qF "$basename_check" "$TRACK_FILE" 2>/dev/null; then
  exit 0
fi

# Block the edit with a corrective message
LOG_DIR="$HOME/.claude/logs"
echo "$(date '+%Y-%m-%d %H:%M:%S') [BLOCKED] $tool_name on $file_path (not read first)" >> "$LOG_DIR/research-first-violations.log"

cat <<EOF
[Research-First Guard] BLOCKED: $tool_name on $file_path
You have NOT read this file in the current session. Per issue #42796:
- Read the file first to understand its current content
- Check related references and dependencies
- Only then make your edit
Read the file now, then retry.
EOF

exit 2
```

#### `read-tracker.sh` — 记录 Read 过的文件

```bash
#!/bin/bash
# Read Tracker — PostToolUse hook for Read
# Records which files have been read in this session
# Used by research-first-guard.sh to verify reads before edits

input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty')

if [ "$tool_name" != "Read" ]; then
  exit 0
fi

file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)

if [ -z "$file_path" ]; then
  exit 0
fi

TRACK_DIR="$HOME/.claude/logs/read-tracker"
mkdir -p "$TRACK_DIR"
TRACK_FILE="$TRACK_DIR/reads.log"

# Normalize and record the path
norm_path=$(realpath "$file_path" 2>/dev/null || echo "$file_path")
echo "$norm_path" >> "$TRACK_FILE"

# Keep the tracker file from growing unbounded (keep last 500 entries)
if [ $(wc -l < "$TRACK_FILE" 2>/dev/null || echo 0) -gt 500 ]; then
  tail -300 "$TRACK_FILE" > "$TRACK_FILE.tmp" && mv "$TRACK_FILE.tmp" "$TRACK_FILE"
fi

exit 0
```

#### `effort-max-enforcer.sh` — 推理深度锁定

```bash
#!/bin/bash
# 确保 effortLevel 始终为 max，防止被 /effort 命令覆盖

bash "$HOME/.claude/hooks/hook-counter.sh" "effort-max" &
SETTINGS="$HOME/.claude/settings.json"

if [ ! -f "$SETTINGS" ]; then
  exit 0
fi

current_effort=$(jq -r '.effortLevel // empty' "$SETTINGS")
current_env_effort=$(jq -r '.env.CLAUDE_CODE_EFFORT_LEVEL // empty' "$SETTINGS")
dirty=0

if [ "$current_effort" != "max" ]; then
  jq '.effortLevel = "max"' "$SETTINGS" > "${SETTINGS}.tmp" && mv "${SETTINGS}.tmp" "$SETTINGS"
  dirty=1
fi

if [ "$current_env_effort" != "max" ]; then
  jq '.env.CLAUDE_CODE_EFFORT_LEVEL = "max"' "$SETTINGS" > "${SETTINGS}.tmp" && mv "${SETTINGS}.tmp" "$SETTINGS"
  dirty=1
fi

if [ "$dirty" -eq 1 ]; then
  LOG_DIR="$HOME/.claude/logs"
  mkdir -p "$LOG_DIR"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] effort-max: 恢复 effortLevel=max" >> "$LOG_DIR/hook-events.log"
  echo "[Effort Max] 已自动恢复: effortLevel=max"
fi

exit 0
```

#### `subagent-logger.sh` — 子代理生命周期记录

```bash
#!/bin/bash
# SubagentStart/Stop hook - 异步记录子 agent 生命周期
# stdin JSON 含: hook_event_name, agent_type, agent_id

INPUT=$(cat)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
EVENT_TYPE=$(echo "$INPUT" | jq -r '.hook_event_name // "unknown"' 2>/dev/null)
AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"' 2>/dev/null)
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // ""' 2>/dev/null)

LOG_FILE="$HOME/.claude/logs/subagent.log"
mkdir -p "$(dirname "$LOG_FILE")"

ID_SUFFIX=""
if [ -n "$AGENT_ID" ]; then
  ID_SUFFIX=" (${AGENT_ID:0:8})"
fi

echo "[${TIMESTAMP}] ${EVENT_TYPE}: ${AGENT_TYPE}${ID_SUFFIX}" >> "$LOG_FILE"
exit 0
```

#### `teammate-idle-gate.sh` — 队友空闲事件

```bash
#!/bin/bash
# Hook 类型: TeammateIdle — exit 2 发送反馈让队友继续

bash "$HOME/.claude/hooks/hook-counter.sh" "teammate-idle" &
INPUT=$(cat)
TEAMMATE=$(echo "$INPUT" | jq -r '.teammate_name // "unknown"' 2>/dev/null)

LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] teammate-idle: ${TEAMMATE}" >> "$LOG_DIR/hook-events.log"

echo "队友 ${TEAMMATE} 请确认所有任务已完成且通过验证后再停止工作。如果还有未完成的任务，请继续执行。"
exit 2
```

#### `task-completed-gate.sh` — 任务完成事件

```bash
#!/bin/bash
# Hook 类型: TaskCompleted — exit 0 允许标记完成

bash "$HOME/.claude/hooks/hook-counter.sh" "task-completed" &
INPUT=$(cat)

TASK_NAME=$(echo "$INPUT" | jq -r '
  .task_name // .subject // .taskSubject // .task_subject //
  .description // .tool_input.subject // .tool_input.description //
  "unknown"
' 2>/dev/null)

LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR"
if [ "$TASK_NAME" = "unknown" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] task-completed-debug: $(echo "$INPUT" | head -c 500)" >> "$LOG_DIR/hook-events.log"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] task-completed: ${TASK_NAME}" >> "$LOG_DIR/hook-events.log"
fi

exit 0
```

#### `agent-opus-enforcer.sh` — 强制 Agent 使用 Opus

```bash
#!/bin/bash
# Agent model: opus 强制 Hook
# 阻断所有未显式指定 model: "opus" 的 Agent 调用

bash "$HOME/.claude/hooks/hook-counter.sh" "agent-opus" &
input=$(cat)

model=$(echo "$input" | jq -r '.model // empty')

# model 缺失时继承全局设置 (opus)，放行
if [ -z "$model" ]; then
  exit 0
fi

if [ "$model" != "opus" ]; then
  cat <<EOF
[Agent Opus] model 必须为 opus (当前: $model)
操作: 将 model 改为 "opus" 后重试
EOF
  exit 1
fi

exit 0
```

#### `auto-format.sh` — 自动格式化

```bash
#!/bin/bash
# PostToolUse: 自动格式化被编辑的文件

input=$(cat)

file_path=$(echo "$input" | grep -oP '"file_path"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"file_path"\s*:\s*"//;s/"$//')

[ -z "$file_path" ] && exit 0
[ ! -f "$file_path" ] && exit 0

case "$file_path" in
  *.py)
    ruff format "$file_path" 2>/dev/null
    ruff check --fix "$file_path" 2>/dev/null
    ;;
  *.js|*.ts|*.tsx|*.jsx|*.vue|*.svelte|*.css|*.scss|*.json)
    npx prettier --write "$file_path" 2>/dev/null
    ;;
  *.cs)
    dotnet format --include "$file_path" 2>/dev/null
    ;;
esac

exit 0
```

#### `post-compact-reinject.sh` — 压缩后重注入

```bash
#!/bin/bash
# PostCompact hook - 压缩后重新注入关键上下文
# 防止长对话压缩后丢失重要指令

cat <<'JSONEOF'
{
  "hookSpecificOutput": {
    "additionalContext": "COMPACTION REMINDER:\n1. 所有 Agent 子任务必须指定 model: opus\n2. 满足条件时自动创建 Agent Team\n3. 编码任务委派 Codex 执行\n4. 修改源码后检查单元测试\n5. Git 提交禁止出现 Claude/AI/bot 字样\n6. 方案设计阶段使用红蓝对抗决策"
  }
}
JSONEOF
```

> **注意**：`additionalContext` 的内容请根据你自己的 CLAUDE.md 规则自定义。

#### `session-init.sh` — 会话初始化

```bash
#!/bin/bash
# Session Init — UserPromptSubmit hook (async)
# Clears stale read-tracker data at the start of each prompt cycle
# Only clears if the tracker is older than 4 hours (session boundary heuristic)

TRACK_FILE="$HOME/.claude/logs/read-tracker/reads.log"

if [ -f "$TRACK_FILE" ]; then
  # Check age: if older than 4 hours, likely a new session
  if [ "$(find "$TRACK_FILE" -mmin +240 2>/dev/null)" ]; then
    > "$TRACK_FILE"
  fi
fi

exit 0
```

#### `hook-stats.sh` — Hook 统计仪表板（CLI 工具）

```bash
#!/bin/bash
# Hook 统计仪表板
# 用法: bash hook-stats.sh [天数]
# 默认显示最近 7 天

DAYS="${1:-7}"
LOG_DIR="$HOME/.claude/logs"
COUNTER_FILE="$LOG_DIR/hook-counters.csv"
VIOLATION_FILE="$LOG_DIR/stop-phrase-violations.log"

echo "╔══════════════════════════════════════════════════╗"
echo "║          Claude Code Hook 统计仪表板            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── 1. Hook 触发次数 ──
echo "━━━ Hook 触发次数（最近 ${DAYS} 天）━━━"
if [ -f "$COUNTER_FILE" ]; then
  cutoff=$(date -d "-${DAYS} days" '+%Y-%m-%d' 2>/dev/null || date -v-${DAYS}d '+%Y-%m-%d' 2>/dev/null || echo "2000-01-01")
  echo ""
  printf "%-30s %-10s %-8s\n" "Hook" "日期" "次数"
  printf "%-30s %-10s %-8s\n" "──────────────────────────" "──────────" "────────"
  tail -n +2 "$COUNTER_FILE" | while IFS=',' read -r date hook count; do
    if [[ "$date" > "$cutoff" ]] || [[ "$date" == "$cutoff" ]]; then
      printf "%-30s %-10s %-8s\n" "$hook" "$date" "$count"
    fi
  done
  echo ""
  echo "总计:"
  tail -n +2 "$COUNTER_FILE" | while IFS=',' read -r date hook count; do
    if [[ "$date" > "$cutoff" ]] || [[ "$date" == "$cutoff" ]]; then
      echo "$hook $count"
    fi
  done | awk '{a[$1]+=$2} END {for(k in a) printf "  %-28s %d 次\n", k, a[k]}' | sort
else
  echo "  （暂无数据）"
fi

echo ""

# ── 2. Stop Phrase 违规详情 ──
echo "━━━ Stop Phrase Guard 违规记录 ━━━"
if [ -f "$VIOLATION_FILE" ] && [ -s "$VIOLATION_FILE" ]; then
  total=$(wc -l < "$VIOLATION_FILE")
  echo "  总违规次数: $total"
  echo ""
  echo "  按类别统计:"
  grep -oP '\[\K[^\]]+' "$VIOLATION_FILE" | sort | uniq -c | sort -rn | while read count cat; do
    bar=""
    for ((i=0; i<count; i++)); do bar+="█"; done
    printf "    %-16s %3d %s\n" "$cat" "$count" "$bar"
  done
  echo ""
  echo "  按日期统计:"
  cut -d' ' -f1 "$VIOLATION_FILE" | sort | uniq -c | sort | while read count date; do
    bar=""
    for ((i=0; i<count; i++)); do bar+="█"; done
    printf "    %s  %3d %s\n" "$date" "$count" "$bar"
  done
  echo ""
  echo "  最近 5 条违规:"
  tail -5 "$VIOLATION_FILE" | while read line; do
    echo "    $line"
  done
else
  echo "  （暂无违规记录 — 这是好事！）"
fi

echo ""

# ── 3. Subagent 活动 ──
SUBAGENT_LOG="$LOG_DIR/subagent.log"
echo "━━━ Subagent 活动 ━━━"
if [ -f "$SUBAGENT_LOG" ] && [ -s "$SUBAGENT_LOG" ]; then
  total=$(wc -l < "$SUBAGENT_LOG")
  echo "  总记录: $total"
  echo "  按类型:"
  awk -F': ' '{print $2}' "$SUBAGENT_LOG" | sort | uniq -c | sort -rn | head -10 | while read count name; do
    printf "    %-30s %d 次\n" "$name" "$count"
  done
else
  echo "  （暂无数据）"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "日志位置: $LOG_DIR/"
echo "查看命令: bash ~/.claude/hooks/hook-stats.sh [天数]"
```

#### `completion-gate.sh` — Stop 阶段完成验证

有 pending edits 标记时，触发对应语言的测试套件，测试失败则阻止模型"完成"。与 `verification-before-completion` skill 配合使用。

```bash
#!/bin/bash
# completion-gate.sh — Stop hook
# 有 pending edits 时运行测试，失败时阻断停止（退出码 2）
# 无 pending edits 时放行

bash "$HOME/.claude/hooks/hook-counter.sh" "completion-gate" &

HOOK_DIR="$HOME/.claude/hooks"
source "$HOOK_DIR/hook-metadata.sh"
source "$HOOK_DIR/harness-event.sh"

input=$(cat)
extract_hook_session "$input"

PENDING_FLAG=$(pending_edits_flag_path)

# 若无 pending 标记，直接放行
if [[ ! -f "$PENDING_FLAG" ]]; then
  emit_harness_event "gate.skip" '{"reason":"no_pending_edits"}'
  exit 0
fi

PROJECT_DIR=$(cat "$PENDING_FLAG" 2>/dev/null || echo "")
rm -f "$PENDING_FLAG"

if [[ -z "$PROJECT_DIR" || ! -d "$PROJECT_DIR" ]]; then
  emit_harness_event "gate.skip" '{"reason":"project_dir_missing"}'
  exit 0
fi

cd "$PROJECT_DIR" || exit 0

# 运行测试（按项目类型自动选择）
TEST_CMD=""
TEST_LABEL=""
if [[ -f "package.json" ]] && jq -e '.scripts.test' package.json >/dev/null 2>&1; then
  TEST_CMD="npm test --silent"
  TEST_LABEL="npm"
elif [[ -f "pyproject.toml" || -f "pytest.ini" || -f "setup.cfg" ]]; then
  if command -v pytest >/dev/null 2>&1; then
    TEST_CMD="pytest -q"
    TEST_LABEL="pytest"
  fi
elif compgen -G "*.csproj" >/dev/null || compgen -G "*.sln" >/dev/null; then
  TEST_CMD="dotnet test --nologo --verbosity quiet"
  TEST_LABEL="dotnet"
elif [[ -f "Cargo.toml" ]]; then
  TEST_CMD="cargo test --quiet"
  TEST_LABEL="cargo"
fi

if [[ -z "$TEST_CMD" ]]; then
  emit_harness_event "gate.skip" '{"reason":"no_test_runner"}'
  exit 0
fi

emit_harness_event_kv "sensor.trigger" "runner" "$TEST_LABEL" "phase" "start"

TEST_OUTPUT=$(mktemp)
if eval "$TEST_CMD" > "$TEST_OUTPUT" 2>&1; then
  emit_harness_event_kv "sensor.trigger" "runner" "$TEST_LABEL" "phase" "pass"
  rm -f "$TEST_OUTPUT"
  exit 0
fi

# 测试失败：输出尾部 40 行到 stderr + 阻止停止（退出码 2）
emit_harness_event_kv "sensor.trigger" "runner" "$TEST_LABEL" "phase" "fail"

{
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "completion-gate: ${TEST_LABEL} 测试失败 — 完成被阻止"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  tail -n 40 "$TEST_OUTPUT"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "必须修复上述测试再继续。"
} >&2

rm -f "$TEST_OUTPUT"
exit 2
```

> 触发方式：`edit-quality-guard.sh` 在 Edit/Write 放行时会 `touch` `pending_edits_flag_path`，把项目路径写入其中。此机制与 hook-metadata.sh 的 session-scoped 路径组合，确保多会话并行不会互相触发。

#### `edit-quality-guard.sh` — 编辑反模式拦截（R1/R2/R3）

在 PreToolUse(Edit|Write) 阶段对三种常见反模式发出拦截：

- **R1**：`old_string` 长度 < 12 字节 → 精度不足，极易误伤
- **R2**：`replace_all=true` 但无对应 Grep 记录 → 未先评估影响面
- **R3**：`Write` 目标文件已存在但从未 Read → 盲重写

```bash
#!/bin/bash
# edit-quality-guard.sh — PreToolUse(Edit|Write)
# 拦截 R1 短 old_string / R2 未查询的 replace_all / R3 未读取的 Write 重写

bash "$HOME/.claude/hooks/hook-counter.sh" "edit-quality-guard" &

HOOK_DIR="$HOME/.claude/hooks"
source "$HOOK_DIR/hook-metadata.sh"
source "$HOOK_DIR/harness-event.sh"

input=$(cat)
extract_hook_session "$input"

tool_name=$(echo "$input" | jq -r '.tool_name // empty')
tool_input=$(echo "$input" | jq -c '.tool_input // {}')

LOG_DIR="$HOME/.claude/logs"
READS_LOG=$(session_scoped_log_path "$LOG_DIR/read-tracker" "reads")
GREPS_LOG=$(session_scoped_log_path "$LOG_DIR/read-tracker" "grep-searches")

fail() {
  local code="$1"; local msg="$2"
  emit_harness_event_kv "violation" "rule" "$code" "tool" "$tool_name"
  {
    echo "━━━ edit-quality-guard: $code ━━━"
    echo "$msg"
  } >&2
  exit 2
}

# 记录 pending edits 标志（供 completion-gate 消费）
PROJECT_DIR=$(pwd)
echo "$PROJECT_DIR" > "$(pending_edits_flag_path)"

if [[ "$tool_name" == "Edit" ]]; then
  old_str=$(echo "$tool_input" | jq -r '.old_string // empty')
  replace_all=$(echo "$tool_input" | jq -r '.replace_all // false')
  file_path=$(echo "$tool_input" | jq -r '.file_path // empty')

  # R1: old_string 过短
  if (( ${#old_str} < 12 )); then
    fail "R1_SHORT_OLDSTRING" "Edit 的 old_string 只有 ${#old_str} 字节，精度不足，请扩大上下文（>=12 字节）。"
  fi

  # R2: replace_all=true 但未 Grep 过该 pattern
  if [[ "$replace_all" == "true" ]]; then
    if [[ ! -f "$GREPS_LOG" ]] || ! grep -Fq "$old_str" "$GREPS_LOG" 2>/dev/null; then
      fail "R2_BLIND_REPLACE_ALL" "replace_all=true 但未在本会话中 Grep 过该模式，请先评估影响面再全局替换。"
    fi
  fi

  emit_harness_event_kv "guard.pass" "tool" "Edit" "file" "$(basename "$file_path")"
  exit 0
fi

if [[ "$tool_name" == "Write" ]]; then
  file_path=$(echo "$tool_input" | jq -r '.file_path // empty')

  # R3: Write 目标文件已存在但未 Read 过
  if [[ -f "$file_path" ]]; then
    if [[ ! -f "$READS_LOG" ]] || ! grep -Fq "$file_path" "$READS_LOG" 2>/dev/null; then
      fail "R3_UNREAD_OVERWRITE" "Write 将覆盖已存在的文件 $file_path，但本会话从未 Read 过它。请先 Read 再重写。"
    fi
  fi

  emit_harness_event_kv "guard.pass" "tool" "Write" "file" "$(basename "$file_path")"
  exit 0
fi

exit 0
```

#### `grep-tracker.sh` — 记录 Grep pattern 供 R2 查询

PostToolUse(Grep) 阶段写入 pattern 到 session-scoped 日志，`edit-quality-guard.sh` 的 R2 规则从这里查。

```bash
#!/bin/bash
# grep-tracker.sh — PostToolUse(Grep)
# 记录本会话 Grep 过的 pattern，供 edit-quality-guard R2 检查

bash "$HOME/.claude/hooks/hook-counter.sh" "grep-tracker" &

HOOK_DIR="$HOME/.claude/hooks"
source "$HOOK_DIR/hook-metadata.sh"

input=$(cat)
extract_hook_session "$input"

pattern=$(echo "$input" | jq -r '.tool_input.pattern // empty')
if [[ -z "$pattern" ]]; then exit 0; fi

LOG_DIR="$HOME/.claude/logs"
GREPS_LOG=$(session_scoped_log_path "$LOG_DIR/read-tracker" "grep-searches")
echo "$pattern" >> "$GREPS_LOG"

exit 0
```

#### `linter-config-protection.sh` — Linter 配置保护审计

目前为事件记录型 hook：所有 Edit/Write 都发一条 `guard.pass`，未来可扩展为对 `.eslintrc` / `ruff.toml` 等关键配置的白名单校验。

```bash
#!/bin/bash
# linter-config-protection.sh — PreToolUse(Edit|Write)
# 审计事件型 hook（保留钩子点，当前不拦截）

HOOK_DIR="$HOME/.claude/hooks"
bash "$HOOK_DIR/hook-counter.sh" "linter-config-protection" >/dev/null 2>&1 &
source "$HOOK_DIR/hook-metadata.sh"
source "$HOOK_DIR/harness-event.sh"

input=$(cat)
extract_hook_session "$input"
emit_harness_event "guard.pass" '{"guard":"linter-config-protection"}'
exit 0
```

#### `prompt-rescuer.sh` — 挫折/长 prompt/回退语重注入

UserPromptSubmit 阶段检查用户输入，触发任一规则时通过 `hookSpecificOutput.additionalContext` 重新注入 `CLAUDE.md` 核心规则与当前 skill 链提醒。

- **T1**：挫折词命中（"烦""不行""怎么还"等）
- **T2**：长度 > 100 字且命中 3+ 动作词（"重构""实现""修复"等）
- **T3**：回退词命中（"撤销""回滚""回到之前"）

```bash
#!/bin/bash
# prompt-rescuer.sh — UserPromptSubmit
# T1/T2/T3 命中时通过 additionalContext 重新注入关键规则

bash "$HOME/.claude/hooks/hook-counter.sh" "prompt-rescuer" &

HOOK_DIR="$HOME/.claude/hooks"
source "$HOOK_DIR/hook-metadata.sh"
source "$HOOK_DIR/harness-event.sh"

input=$(cat)
extract_hook_session "$input"

prompt=$(echo "$input" | jq -r '.prompt // empty')
lower=$(echo "$prompt" | tr '[:upper:]' '[:lower:]')

# T1: 挫折词
frustration=("烦" "不行" "怎么还" "又错" "搞什么" "why" "still wrong" "this is frustrating")
# T3: 回退词
backtrack=("撤销" "回滚" "恢复到" "回到之前" "取消刚才" "undo" "revert" "rollback")
# T2: 动作词
actions=("重构" "实现" "修复" "添加" "删除" "修改" "部署" "refactor" "implement" "fix" "add" "remove")

trigger=""
reason=""

for w in "${frustration[@]}"; do
  if [[ "$lower" == *"$w"* ]]; then trigger="T1"; reason="frustration:$w"; break; fi
done

if [[ -z "$trigger" ]]; then
  for w in "${backtrack[@]}"; do
    if [[ "$lower" == *"$w"* ]]; then trigger="T3"; reason="backtrack:$w"; break; fi
  done
fi

if [[ -z "$trigger" && ${#prompt} -gt 100 ]]; then
  count=0
  for w in "${actions[@]}"; do
    if [[ "$lower" == *"$w"* ]]; then ((count++)); fi
  done
  if (( count >= 3 )); then
    trigger="T2"; reason="long_multi_action:${count}_verbs"
  fi
fi

if [[ -z "$trigger" ]]; then
  emit_harness_event "prompt.clean" '{}'
  exit 0
fi

emit_harness_event_kv "sensor.trigger" "rule" "$trigger" "reason" "$reason"

# 重注入提醒
reinject=$(cat <<'EOF'
⚠️ 规则重注入提醒（prompt-rescuer）：
1. 严格遵守 CLAUDE.md 的 Skill 链式调用
2. 反简化/反走捷径：先研究再编辑、禁止"最简单修复"、禁止过早停止
3. 编辑前必须 Read 文件；替换前必须 Grep pattern
4. 完成任务前必须跑测试（completion-gate 会强制验证）
EOF
)

jq -n --arg ctx "$reinject" \
  '{hookSpecificOutput: {additionalContext: $ctx}}'

exit 0
```

#### `safety-gate.sh` — 危险命令守卫（审计）

PreToolUse(Bash) 的占位审计 hook，所有 Bash 调用均放行并记录事件，便于后续以黑名单模式扩展。

```bash
#!/bin/bash
# safety-gate.sh — PreToolUse(Bash)
# 当前仅审计放行，保留事件钩子

bash "$HOME/.claude/hooks/hook-counter.sh" "safety-gate" &
HOOK_DIR="$HOME/.claude/hooks"
source "$HOOK_DIR/hook-metadata.sh"
source "$HOOK_DIR/harness-event.sh"

input=$(cat)
extract_hook_session "$input"
emit_harness_event "guard.pass" '{"guard":"safety-gate"}'
exit 0
```

#### `session-summary.sh` — 会话结束统计

Stop 阶段扫描 transcript，把工具使用分布、R/E 比、守卫拦截次数、违规次数等写入 `session-summary.jsonl`。这份汇总不参与 benchmark，仅供人工排查。

```bash
#!/bin/bash
# session-summary.sh — Stop hook
# 会话停止时写入聚合统计到 session-summary.jsonl

bash "$HOME/.claude/hooks/hook-counter.sh" "session-summary" &

HOOK_DIR="$HOME/.claude/hooks"
source "$HOOK_DIR/hook-metadata.sh"
source "$HOOK_DIR/harness-event.sh"

input=$(cat)
extract_hook_session "$input"

if [[ -z "$HOOK_TRANSCRIPT_PATH" || ! -f "$HOOK_TRANSCRIPT_PATH" ]]; then
  exit 0
fi

LOG_DIR="$HOME/.claude/logs"
SUMMARY_LOG="$LOG_DIR/session-summary.jsonl"
HARNESS_LOG="$LOG_DIR/harness-events.jsonl"
mkdir -p "$LOG_DIR"

# 使用 jq 解析 transcript — 单次扫描聚合所有计数
counts=$(jq -s '
  def count_tool(name):
    map(.message.content? // [])
    | map(select(type=="array"))
    | add // []
    | map(select(.type=="tool_use" and .name==name))
    | length;
  {
    reads:    count_tool("Read"),
    greps:    count_tool("Grep"),
    globs:    count_tool("Glob"),
    bashes:   count_tool("Bash"),
    edits:    count_tool("Edit"),
    writes:   count_tool("Write"),
    nbedits:  count_tool("NotebookEdit")
  }
' "$HOOK_TRANSCRIPT_PATH" 2>/dev/null)

if [[ -z "$counts" ]]; then
  counts='{"reads":0,"greps":0,"globs":0,"bashes":0,"edits":0,"writes":0,"nbedits":0}'
fi

# 从 harness-events 聚合当前会话的 guard/violation/sensor 计数
if [[ -f "$HARNESS_LOG" ]]; then
  gv=$(jq -s --arg sid "$HOOK_SESSION_ID" '
    map(select(.session==$sid))
    | {
        guard_blocks:    map(select(.event=="guard.pass"))    | length,
        sensor_triggers: map(select(.event=="sensor.trigger"))| length,
        violations_total:map(select(.event=="violation"))     | length
      }
  ' "$HARNESS_LOG" 2>/dev/null)
else
  gv='{"guard_blocks":0,"sensor_triggers":0,"violations_total":0}'
fi

# 计算 R/E（避免除零）
re=$(jq -n --argjson c "$counts" '
  ($c.reads) as $r |
  (($c.edits + $c.writes) | if . == 0 then 1 else . end) as $m |
  ($r / $m)
')

ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
jq -n \
  --arg ts "$ts" \
  --arg sid "$HOOK_SESSION_ID" \
  --argjson c "$counts" \
  --argjson gv "$gv" \
  --argjson re "$re" \
  '{ts:$ts, session:$sid, tools:$c, r_e_ratio:$re} + $gv' \
  >> "$SUMMARY_LOG"

exit 0
```

### settings.json 配置

在 `~/.claude/settings.json` 中注册 hook（脚本路径需指向你本地的实际文件）：

```json
{
  "hooks": {
    "Stop": [
      { "matcher": "", "hooks": [
        "bash ~/.claude/hooks/stop-phrase-guard.sh",
        "bash ~/.claude/hooks/completion-gate.sh",
        "bash ~/.claude/hooks/session-summary.sh"
      ]}
    ],
    "PreToolUse": [
      { "matcher": "Edit|Write", "hooks": [
        "bash ~/.claude/hooks/research-first-guard.sh",
        "bash ~/.claude/hooks/edit-quality-guard.sh",
        "bash ~/.claude/hooks/linter-config-protection.sh"
      ]},
      { "matcher": "Bash", "hooks": [
        "bash ~/.claude/hooks/effort-max-enforcer.sh",
        "bash ~/.claude/hooks/safety-gate.sh"
      ]},
      { "matcher": "Agent", "hooks": ["bash ~/.claude/hooks/agent-opus-enforcer.sh"] }
    ],
    "PostToolUse": [
      { "matcher": "Read", "hooks": ["bash ~/.claude/hooks/read-tracker.sh"] },
      { "matcher": "Grep", "hooks": ["bash ~/.claude/hooks/grep-tracker.sh"] },
      { "matcher": "Edit|Write", "hooks": ["bash ~/.claude/hooks/auto-format.sh"] }
    ],
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [
        "bash ~/.claude/hooks/session-init.sh",
        "bash ~/.claude/hooks/prompt-rescuer.sh"
      ]}
    ],
    "SubagentStart": [
      { "matcher": "", "hooks": ["bash ~/.claude/hooks/subagent-logger.sh"] }
    ],
    "SubagentStop": [
      { "matcher": "", "hooks": ["bash ~/.claude/hooks/subagent-logger.sh"] }
    ],
    "PostCompact": [
      { "matcher": "", "hooks": ["bash ~/.claude/hooks/post-compact-reinject.sh"] }
    ],
    "TeammateIdle": [
      { "matcher": "", "hooks": ["bash ~/.claude/hooks/teammate-idle-gate.sh"] }
    ],
    "TaskCompleted": [
      { "matcher": "", "hooks": ["bash ~/.claude/hooks/task-completed-gate.sh"] }
    ]
  }
}
```

> `hook-metadata.sh` 与 `harness-event.sh` 是**辅助库**，通过 `source` 在其他 hook 内部调用，**不需要在 settings.json 中单独登记**。

### 配套 CLAUDE.md 规则

在 `~/.claude/CLAUDE.md` 中添加行为约束规则，与 hook 配合使用：

```markdown
## 反简化 / 反走捷径（issue #42796 对策）
- **先研究再编辑**：编辑任何文件前，必须先 Read 该文件 + 检查相关引用
- **禁止"最简单修复"**：不选最省力的方案，选正确的方案
- **禁止过早停止**：任务未完成不得停止
- **禁止逃避所有权**：遇到问题就修复，不推卸
- **禁止会话借口**：不说"在新会话中继续"
- **完整文件写入限制**：优先使用 Edit，非必要不使用 Write 重写整个文件
```

### 架构说明

```
┌─────────────────────┐     日志文件              ┌─────────────────────┐
│  Hook 脚本（用户）   │ ───────────────────────→ │  overwatch（插件）   │
│                     │                          │  environment.ts     │
│  stop-phrase-guard  → violations.log           │  解析日志 → 渲染    │
│  research-first     → research-first-*.log     │  到状态栏           │
│  subagent-logger    → subagent.log             │                     │
│  hook-counter       → hook-counters.csv        │  5 个日志文件       │
│  effort-max         ┐                          │  按日期+会话过滤    │
│  teammate-idle      ├→ hook-events.log         │  10 分钟 TTL 详情   │
│  task-completed     ┘                          │                     │
└─────────────────────┘                          └─────────────────────┘
```

- **左侧**：用户自行编写的 hook 脚本，在 `~/.claude/settings.json` 中注册，由 Claude Code 在运行时触发
- **右侧**：overwatch 插件，每 ~300ms 读取日志文件并渲染到 HUD 状态栏
- **连接点**：`~/.claude/logs/` 下的日志文件是唯一接口

### 效果

配置完成后，overwatch 环境行将实时显示：
- 各 hook 的触发次数（了解模型行为模式）
- 违规拦截详情（确认防护是否生效）
- 研究优先拦截记录（确保模型遵循"先读后编辑"）
- 子代理活动（监控代理调度行为）

这些数据帮助你量化模型的行为质量，及时发现退化趋势。

### 效果评估（Benchmark）

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

## 许可证

MIT — 详见 [LICENSE](LICENSE)

## 致谢

感谢 [Jarrod Watts](https://github.com/jarrodwatts) 创建了 [claude-hud](https://github.com/jarrodwatts/claude-hud) 原始项目。
