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

所有日志文件位于 `~/.claude/logs/` 目录下。overwatch 的 `environment.ts` 按日期 + 会话起始时间过滤并渲染。

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

#### `research-first-guard.sh` — 先研究���编辑

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

### settings.json 配置

在 `~/.claude/settings.json` 中注册 hook（脚本路径需指向你本地的实际文件）：

```json
{
  "hooks": {
    "Stop": [
      { "matcher": "", "hooks": ["bash ~/.claude/hooks/stop-phrase-guard.sh"] }
    ],
    "PreToolUse": [
      { "matcher": "Edit|Write", "hooks": ["bash ~/.claude/hooks/research-first-guard.sh"] },
      { "matcher": "Bash", "hooks": ["bash ~/.claude/hooks/effort-max-enforcer.sh"] },
      { "matcher": "Agent", "hooks": ["bash ~/.claude/hooks/agent-opus-enforcer.sh"] }
    ],
    "PostToolUse": [
      { "matcher": "Read", "hooks": ["bash ~/.claude/hooks/read-tracker.sh"] },
      { "matcher": "Edit|Write", "hooks": ["bash ~/.claude/hooks/auto-format.sh"] }
    ],
    "UserPromptSubmit": [
      { "matcher": "", "hooks": ["bash ~/.claude/hooks/session-init.sh"] }
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

### 效果验证：量化数据

以下数据基于实际使用统计（2,234 个 JSONL 会话，4,207 个思维块），验证 Hook + CLAUDE.md 防护体系的实际效果。

#### 分阶段行为指标对比

| 指标 | 遮蔽期 (3/20-4/6) | 过渡期 (4/7) | 可见期 (4/8-4/10) | 趋势 |
|------|-------------------|-------------|-------------------|------|
| 会话数 | 202 | 7 | 42 | — |
| 思维遮蔽率 | 98.8% | 68.0% | 0.0% | 完全可见 |
| Read:Edit 比率 | 4.2 | 4.8 | 5.9 | +40% |
| Research:Mutation 比率 | 4.9 | 7.0 | 9.5 | +93.9% |
| Write%（整文件重写） | 15.7% | 3.6% | 2.4% | -84.7% |
| 签名均值（思维深度代理） | 2,272 | 3,367 | 3,341 | +47% |
| 可见 thinking 均值字符 | 905 | 1,722 | 1,259 | +39% |

#### 与 Issue #42796 报告的对比

| 指标 | Issue 报告（好→差） | 本地实测（遮蔽→可见） |
|------|--------------------|-----------------------|
| Read:Edit | 6.6 → 2.0（-70%） | 4.2 → 5.9（+40%） |
| Write% | 4.9% → 11.1%（+127%） | 15.7% → 2.4%（-85%） |
| Signature-Thinking r | 0.971 | 0.959 |

#### 关键发现

- **签名-思维相关性 Pearson r = 0.959**（571 样本）— 与 issue 报告的 0.971 高度一致，证实思维编辑现象的普遍性
- **Write% 从 15.7% 降至 2.4%** — "完整文件写入限制"规则 + research-first hook 共同作用，模型改用精确 Edit 而非整文件重写
- **Research:Mutation 比率从 4.9 提升至 9.5** — 研究力度几乎翻倍，模型更多地"先读再改"
- **思维遮蔽率从 98.8% 降至 0%** — 4/8 起启用 `showThinkingSummaries` 后效果立竿见影

Issue #42796 中记录的退化趋势（Read:Edit 下降、Write% 上升）在本地通过系统性 Hook + CLAUDE.md 规则被有效逆转。

## 许可证

MIT — 详见 [LICENSE](LICENSE)

## 致谢

感谢 [Jarrod Watts](https://github.com/jarrodwatts) 创建了 [claude-hud](https://github.com/jarrodwatts/claude-hud) 原始项目。
