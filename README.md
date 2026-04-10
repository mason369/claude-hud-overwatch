# claude-hud-zh

> Claude Code 实时状态栏插件 — 中文版

Fork 自 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud)，MIT 协议。

## 特性

- 实时上下文健康度显示（进度条 + 百分比）
- 工具调用活动追踪（Edit、Read、Bash 等）
- 子代理状态监控（类型、用时、描述）
- 任务进度跟踪（待办/进行中/已完成）
- Git 分支状态（分支名、脏标记、领先/落后）
- API 用量追踪（5 小时/7 天配额）
- 会话令牌统计（输入、输出、缓存分类）
- Hook 触发统计（防护类/事件类分组显示）
- 违规检测详情（最新触发的具体模式和时间）
- 内存使用监控
- 完整中文界面，默认中文

## 安装

### 方式一：作为 Claude Code 插件安装

在 Claude Code 中执行：

```
/install-plugin file:~/.claude/claude-hud-zh
```

然后运行 setup：

```
/claude-hud:setup
```

重启 Claude Code 使配置生效。

### 方式二：手动安装

1. 克隆仓库到 `~/.claude/claude-hud-zh/`
2. 安装依赖并构建：
   ```bash
   cd ~/.claude/claude-hud-zh
   npm ci && npm run build
   ```
3. 在 `~/.claude/settings.json` 中添加 `statusLine` 配置（运行 `/claude-hud:setup` 自动完成）

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
| `language` | string | `zh` | 界面语言：`zh`（中文）或 `en`（英文） |
| `lineLayout` | string | `expanded` | 布局模式：`expanded` 或 `compact` |
| `pathLevels` | 1-3 | 1 | 项目路径显示层级 |
| `display.showModel` | boolean | true | 显示模型名称 `[Opus]` |
| `display.showProject` | boolean | true | 显示项目路径 |
| `display.showContextBar` | boolean | true | 显示上下文进度条 |
| `display.contextValue` | string | `percent` | 上下文格式：`percent`、`tokens`、`remaining`、`both` |
| `display.showUsage` | boolean | true | 显示用量限制 |
| `display.usageBarEnabled` | boolean | true | 用量以进度条形式显示 |
| `display.showTokenBreakdown` | boolean | true | 高上下文时显示令牌明细 |
| `display.showTools` | boolean | false | 显示工具活动行 |
| `display.showAgents` | boolean | false | 显示代理状态行 |
| `display.showTodos` | boolean | false | 显示任务进度行 |
| `display.showConfigCounts` | boolean | false | 显示配置计数（CLAUDE.md、规则、MCP、Hook） |
| `display.showCost` | boolean | false | 显示费用 |
| `display.showDuration` | boolean | false | 显示会话时长 |
| `display.showSpeed` | boolean | false | 显示输出速度 |
| `display.showSessionName` | boolean | false | 显示会话名称 |
| `display.showClaudeCodeVersion` | boolean | false | 显示 Claude Code 版本 |
| `display.showMemoryUsage` | boolean | false | 显示系统内存使用 |
| `display.showSessionTokens` | boolean | false | 显示会话令牌统计 |
| `display.showOutputStyle` | boolean | false | 显示输出风格 |
| `display.autocompactBuffer` | string | `enabled` | 自动压缩缓冲：`enabled` 或 `disabled` |
| `display.usageThreshold` | 0-100 | 0 | 用量达到此百分比才显示 |
| `display.sevenDayThreshold` | 0-100 | 80 | 7 天用量达到此百分比才显示 |
| `display.environmentThreshold` | 0-100 | 0 | 环境行达到此计数才显示 |
| `display.modelFormat` | string | `full` | 模型名格式：`full`、`compact`、`short` |
| `display.modelOverride` | string | `""` | 自定义模型显示名 |
| `display.customLine` | string | `""` | 自定义行内容 |

### 颜色配置

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `colors.context` | `green` | 上下文进度条颜色 |
| `colors.usage` | `brightBlue` | 用量进度条颜色 |
| `colors.warning` | `yellow` | 警告色 |
| `colors.usageWarning` | `brightMagenta` | 用量警告色 |
| `colors.critical` | `red` | 危险色 |
| `colors.model` | `cyan` | 模型标签颜色 |
| `colors.project` | `yellow` | 项目路径颜色 |
| `colors.git` | `magenta` | Git 标记颜色 |
| `colors.gitBranch` | `cyan` | Git 分支名颜色 |
| `colors.label` | `dim` | 标签和元数据颜色 |
| `colors.custom` | `208` | 自定义行颜色 |

支持的颜色值：命名色（`dim`、`red`、`green`、`yellow`、`magenta`、`cyan`、`brightBlue`、`brightMagenta`）、256 色索引（`0-255`）、十六进制（`#rrggbb`）。

## 与上游的区别

- 默认中文界面（i18n 系统，可切换英文）
- Hook 触发统计与违规检测
- 防护类/事件类 hook 分组显示
- 最新触发详情行（`>` 行）
- 子代理日志增强
- 会话令牌中文标签

## 许可证

MIT — 详见 [LICENSE](LICENSE)

## 致谢

感谢 [Jarrod Watts](https://github.com/jarrodwatts) 创建了 claude-hud 原始项目。
