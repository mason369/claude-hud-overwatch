# claude-hud-overwatch

> Claude Code 全视状态栏 — 全功能默认开启、Hook 防护监控、违规检测、子代理追踪

Fork 自 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud) v0.0.12，MIT 协议。

## 与官方版本的区别

### 功能增强

| 特性 | 官方 claude-hud | overwatch |
|------|----------------|-----------|
| 默认功能开关 | 大部分关闭，需手动开启 | **全部默认开启** |
| Hook 防护监控 | 无 | **防护类/事件类分组统计** |
| 违规检测详情 | 无 | **最新违规模式 + 时间 + 分类** |
| 研究优先拦截 | 无 | **拦截文件 + 原因追踪** |
| 子代理活动追踪 | 无 | **启动/停止事件中文化显示** |
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

在上游 i18n 基础上新增 4 个 key（已同步上游 `label.cost`）：

| Key | 英文 | 中文 | 用途 |
|-----|------|------|------|
| `label.cost` | `Cost` | `费用` | 原生费用标签（同步上游） |
| `label.tokens` | `Tokens` | `词元` | 会话词元行标题 |
| `label.ccVersion` | `CC v` | `CC 版本` | Claude Code 版本前缀 |
| `label.sessionTokenPrefix` | `tok` | `词元` | 紧凑模式词元前缀 |

### 新增功能：Hook 触发统计与违规检测

`environment.ts` 大幅扩展，上游仅显示配置计数，本 fork 新增：

- **Hook 分组显示** — 防护类（停止短语、研究优先、努力锁定、代理验证）和事件类（自动格式、子代理、队友空闲、任务完成、压缩注入）分别计数
- **待机统计** — 已注册但今日未触发的 hook 数量
- **违规检测** — 按类别统计（逃避、求许可、早停、推脱、借口）
- **最新违规详情行**（红色）— 时间 + 分类 + 触发模式
- **研究优先拦截详情行**（黄色）— 时间 + 拦截文件和原因
- **子代理活动详情行**（灰色）— 时间 + 启动/停止 + 代理类型

数据来源（需配合对应 hook 脚本）：
- `~/.claude/logs/hook-counters.csv`
- `~/.claude/logs/stop-phrase-violations.log`
- `~/.claude/logs/research-first-violations.log`
- `~/.claude/logs/subagent.log`

### 会话词元行国际化

上游 `session-tokens.ts` 和 `session-line.ts` 使用硬编码英文，本 fork 改用 `t()` 函数实现多语言。

### 费用显示差异

上游已升级为 `resolveSessionCost()`，支持原生 `cost.total_cost_usd` 字段。本 fork 仍使用 `estimateSessionCost()`（`label.cost` i18n key 已同步，渲染逻辑待跟进）。

### 未修改的部分（与官方完全一致）

- 核心渲染引擎（project、identity、usage、memory 行）
- 配置系统（mergeConfig、loadConfig、迁移逻辑）
- transcript 解析 / stdin 解析
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

overwatch 增强后的环境行：

```
1 CLAUDE.md | 3 MCPs | 防护: 停止短语×53 研究优先×245 | 事件: 队友空闲×8 | 待机 3
| 停止防护 违规6 逃避×4 求许可×1 早停×1
  ↳ 最新违规[13:13:06] 逃避:「不是我导致的」 — 模型试图推卸责任
  ↳ 拦截[15:23:06] Edit file.ts — 编辑前未先Read文件
  ↳ 子代理[16:46:30] 停止 env-line-worker
```

- **防护/事件分组** — Hook 按类型分组显示触发次数
- **最新违规**（红色）— 停止防护拦截的具体模式 + 分类解释
- **拦截**（黄色）— 研究优先 hook 拦截的文件和原因
- **子代理**（灰色）— 最新子代理启动/停止事件

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

将以下 hook 脚本放置在 `~/.claude/hooks/` 目录下：

| 脚本 | Hook 类型 | 作用 |
|------|----------|------|
| `stop-phrase-guard.sh` | Stop | **核心防护**：拦截 5 类共 53 个停止短语，阻止模型停止并注入纠正消息 |
| `research-first-guard.sh` | PreToolUse | **先研究再编辑**：阻止对未 Read 过的文件执行 Edit/Write |
| `read-tracker.sh` | PostToolUse | 记录 Read 工具读取过的文件路径，供 research-first 检查 |
| `effort-max-enforcer.sh` | PreToolUse | 阻止任何降低 effortLevel 的操作 |
| `agent-opus-enforcer.sh` | PreToolUse | 强制 Agent 必须使用 model: "opus" |
| `hook-counter.sh` | （辅助） | 统计各 hook 触发次数，写入 `hook-counters.csv` |
| `subagent-logger.sh` | SubagentStart/Stop | 记录子代理启动/停止事件 |
| `auto-format.sh` | PostToolUse | 代码格式化自动执行 |
| `post-compact-reinject.sh` | PostCompact | 压缩后重新注入关键上下文 |
| `teammate-idle-gate.sh` | TeammateIdle | 队友空闲事件计数 |
| `task-completed-gate.sh` | TaskCompleted | 任务完成事件计数 |

### settings.json 配置

在 `~/.claude/settings.json` 中注册这些 hook：

```json
{
  "hooks": {
    "Stop": [
      { "matcher": "", "hooks": ["bash ~/.claude/hooks/stop-phrase-guard.sh"] }
    ],
    "PreToolUse": [
      { "matcher": "Edit|Write", "hooks": ["bash ~/.claude/hooks/research-first-guard.sh"] },
      { "matcher": "Agent", "hooks": ["bash ~/.claude/hooks/agent-opus-enforcer.sh"] },
      { "matcher": "Bash", "hooks": ["bash ~/.claude/hooks/effort-max-enforcer.sh"] }
    ],
    "PostToolUse": [
      { "matcher": "Read", "hooks": ["bash ~/.claude/hooks/read-tracker.sh"] },
      { "matcher": "", "hooks": ["bash ~/.claude/hooks/auto-format.sh"] }
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

### 效果

配置完成后，overwatch 环境行将实时显示：
- 各 hook 的触发次数（了解模型行为模式）
- 违规拦截详情（确认防护是否生效）
- 研究优先拦截记录（确保模型遵循"先读后编辑"）
- 子代理活动（监控代理调度行为）

这些数据帮助你量化模型的行为质量，及时发现退化趋势。

## 许可证

MIT — 详见 [LICENSE](LICENSE)

## 致谢

感谢 [Jarrod Watts](https://github.com/jarrodwatts) 创建了 [claude-hud](https://github.com/jarrodwatts/claude-hud) 原始项目。
