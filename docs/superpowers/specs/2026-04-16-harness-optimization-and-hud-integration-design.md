# Harness 优化 + HUD 仪表盘融合 — 设计规格书

**日期**: 2026-04-16
**状态**: Approved
**范围**: 全部 15 项 Harness 优化 + claude-hud-zh Harness 仪表盘模块

---

## 1. 概述

### 1.1 目标

将当前 Claude Code 的 Harness 体系从"部分覆盖"提升到"完整覆盖"（对照 Martin Fowler 的 Harness Engineering 框架），同时在 claude-hud-zh 中构建全新的 Harness 仪表盘模块，实时显示 Harness 健康度、Guard/Sensor 状态、违规统计和运行趋势。

### 1.2 核心公式

```
Agent = Model + Harness
Harness = Guides (前馈) + Sensors (反馈) + Data Pipeline (数据管道) + Dashboard (可视化)
```

### 1.3 成功标准

- 所有 15 项优化项实施完毕并可验证
- HUD 仪表盘准确显示 Harness 全部组件的实时状态
- 健康度评分正确反映配置完整性和运行时表现
- 新增 Hook 的阻止逻辑经过测试验证
- 日志统一到 `harness-events.jsonl`，含自动轮转

---

## 2. 数据管道设计

### 2.1 统一日志文件

**路径**: `~/.claude/logs/harness-events.jsonl`
**格式**: JSON Lines（每行一个事件）

```jsonl
{"ts":"2026-04-16T14:32:01.123Z","event":"guard.block","source":"safety-gate","session":"abc123","category":"destructive_command","detail":"rm -rf /","severity":"critical"}
```

### 2.2 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ts` | ISO 8601 字符串 | 是 | UTC 时间戳 |
| `event` | enum | 是 | 事件类型（见 2.3） |
| `source` | enum | 是 | 产生事件的 Hook 名（见 2.4） |
| `session` | string | 是 | 会话 ID（来自 hook-metadata.sh 的 `HOOK_SESSION_ID`） |
| `transcript` | string | 否 | 会话 transcript 路径（来自 hook-metadata.sh 的 `HOOK_TRANSCRIPT_PATH`）。用于 session_id 不可用时的备选匹配 |
| `category` | string | 是 | 事件分类（自由文本，按 source 约定） |
| `detail` | string | 否 | 详细信息 |
| `severity` | enum | 否 | `info` | `warning` | `high` | `critical`，默认 `info` |

### 2.3 事件类型枚举

| event | 含义 | 触发场景 |
|-------|------|----------|
| `guard.pass` | 前馈守卫通过 | Agent opus 检查通过、research-first 通过等 |
| `guard.block` | 前馈守卫阻止 | 阻止非 opus 模型、阻止未读文件编辑等 |
| `sensor.trigger` | 反馈传感器正常触发 | auto-format 执行、read-tracker 记录等 |
| `sensor.block` | 反馈传感器阻止完成 | completion-gate 测试失败阻止停止 |
| `violation` | 违规检测 | stop-phrase-guard 检测到违规短语 |
| `config.repair` | 配置自动修复 | effort-max-enforcer 恢复设置 |
| `lifecycle` | 生命周期事件 | subagent start/stop、post-compact、session init |

### 2.4 Source 枚举

| source | Hook 文件 | 类型 |
|--------|-----------|------|
| `agent-opus` | agent-opus-enforcer.sh | Guard |
| `research-first` | research-first-guard.sh | Guard |
| `effort-max` | effort-max-enforcer.sh | Guard |
| `safety-gate` | safety-gate.sh (新增) | Guard |
| `linter-protection` | linter-config-protection.sh (新增) | Guard |
| `cbm-gate` | cbm-code-discovery-gate | Guard |
| `auto-format` | auto-format.sh | Sensor |
| `completion-gate` | completion-gate.sh (新增) | Sensor |
| `stop-phrase-guard` | stop-phrase-guard.sh | Sensor |
| `teammate-idle` | teammate-idle-gate.sh | Sensor |
| `task-completed` | task-completed-gate.sh | Sensor |
| `subagent-logger` | subagent-logger.sh | Lifecycle |
| `post-compact` | post-compact-reinject.sh | Lifecycle |
| `read-tracker` | read-tracker.sh | Sensor |
| `session-init` | session-init.sh | Lifecycle |
| `log-rotation` | harness-event.sh (内置) | Maintenance |

### 2.5 写入工具库

**新建文件**: `~/.claude/hooks/harness-event.sh`

**并发安全设计**：多个 async hook 会并发调用 `emit_harness_event`。使用 `flock` 文件锁保证
`>>` 追加和轮转操作的原子性。启动时确保日志目录存在。

```bash
#!/usr/bin/env bash
# Harness Event Emitter — 统一事件写入工具库
# 所有 Hook 通过 source 此文件并调用 emit_harness_event 来记录事件
# 并发安全：使用 flock 保护写入和轮转

HARNESS_LOG_DIR="$HOME/.claude/logs"
HARNESS_LOG="$HARNESS_LOG_DIR/harness-events.jsonl"
HARNESS_LOCK="$HARNESS_LOG_DIR/.harness-events.lock"
HARNESS_MAX_LINES=5000
HARNESS_TRIM_TO=3000

# 确保日志目录存在（幂等）
mkdir -p "$HARNESS_LOG_DIR" 2>/dev/null

emit_harness_event() {
  local event="$1" source="$2" category="$3" detail="$4" severity="${5:-info}"
  local session="${HOOK_SESSION_ID:-unknown}"
  local transcript="${HOOK_TRANSCRIPT_PATH:-}"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

  # JSON 转义 detail 中的特殊字符
  detail=$(printf '%s' "$detail" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr '\n' ' ')

  # Windows 路径转义：反斜杠 → 正斜杠（避免 JSON 非法字符）
  transcript="${transcript//\\//}"

  # 构建 JSON（transcript 为可选字段，仅当非空时包含）
  local line
  if [[ -n "$transcript" ]]; then
    line=$(printf '{"ts":"%s","event":"%s","source":"%s","session":"%s","transcript":"%s","category":"%s","detail":"%s","severity":"%s"}' \
      "$ts" "$event" "$source" "$session" "$transcript" "$category" "$detail" "$severity")
  else
    line=$(printf '{"ts":"%s","event":"%s","source":"%s","session":"%s","category":"%s","detail":"%s","severity":"%s"}' \
      "$ts" "$event" "$source" "$session" "$category" "$detail" "$severity")
  fi

  # flock 保护写入 + 轮转（fd 9 用作锁文件描述符）
  (
    flock -w 2 9 || return 0  # 超时 2 秒则放弃（不阻塞 hook）
    echo "$line" >> "$HARNESS_LOG"
    _harness_rotate_locked
  ) 9>"$HARNESS_LOCK"
}

_harness_rotate_locked() {
  # 仅在持有 flock 时调用，无需额外加锁
  if [[ -f "$HARNESS_LOG" ]]; then
    local line_count
    line_count=$(wc -l < "$HARNESS_LOG" 2>/dev/null || echo 0)
    if (( line_count > HARNESS_MAX_LINES )); then
      local tmp="${HARNESS_LOG}.rotate.$$"
      tail -n "$HARNESS_TRIM_TO" "$HARNESS_LOG" > "$tmp" && mv "$tmp" "$HARNESS_LOG"
    fi
  fi
}
```

**注意**: Windows Git Bash 环境下 `flock` 来自 MSYS2。若不可用，回退为直接 `>>` 追加
（单行 `echo >> file` 在大多数文件系统上对短行是原子的）。

### 2.6 向后兼容策略

过渡期内，现有 Hook 同时写入旧日志文件和新 harness-events.jsonl（双写）。HUD 仅读取 harness-events.jsonl。旧日志文件保留但不再作为 HUD 数据源。

---

## 3. Hook 优化清单

### 3.1 Critical — Bug 修复

#### 3.1.1 修复 post-compact-reinject.sh

**当前问题**: additionalContext 包含已废弃的 Codex 委派和红蓝对抗规则。
**修复**: 替换为当前实际规则：

```
1. 所有 Agent 子任务必须指定 model: opus
2. 满足条件时自动创建 Agent Team（2-5人并行）
3. 编辑文件前必须先 Read 该文件（研究优先原则）
4. 修改源码后检查单元测试
5. Git 提交禁止出现 Claude/AI/bot/Co-Authored-By 字样
6. 按 CLAUDE.md Skill 链表调用所有必需 Skill
```

同时添加 `emit_harness_event "lifecycle" "post-compact" "reinject" "rules reinjected"`.

#### 3.1.2 安全 deny 规则补全

当前 `settings.json` 的 `permissions.deny` 是**字符串数组格式**（非按工具分组的对象）。
现有规则仅覆盖 Read：

```json
"deny": [
  "Read(./.env)",
  "Read(./.env.*)",
  "Read(./secrets/**)"
]
```

追加以下条目到同一数组（保持现有格式）：

```json
"deny": [
  "Read(./.env)",
  "Read(./.env.*)",
  "Read(./secrets/**)",
  "Edit(./.env)",
  "Edit(./.env.*)",
  "Edit(./secrets/**)",
  "Write(./.env)",
  "Write(./.env.*)",
  "Write(./secrets/**)",
  "Bash(cat .env*)",
  "Bash(cat ./secrets/*)"
]
```

### 3.2 High — 新增关键传感器

**settings.json Hook 注册**：每个新 Hook 脚本写完后，必须在 `settings.json` 的 `hooks` 对象中注册，
否则脚本不会被 Claude Code 执行。具体注册项：

```json
// Stop 事件中追加 completion-gate（在现有 stop-phrase-guard 之后）
"Stop": [
  { "matcher": "", "hooks": [
    { "type": "command", "command": "bash /c/Users/Administrator/.claude/hooks/stop-phrase-guard.sh" },
    { "type": "command", "command": "bash /c/Users/Administrator/.claude/hooks/completion-gate.sh" }
  ]}
],
// PreToolUse 事件中追加两个新 Guard
"PreToolUse": [
  // ...现有 Agent, Edit|Write, Grep|Glob|Read|Search 条目...
  { "matcher": "Edit|Write", "hooks": [
    { "type": "command", "command": "bash /c/Users/Administrator/.claude/hooks/research-first-guard.sh" },
    { "type": "command", "command": "bash /c/Users/Administrator/.claude/hooks/linter-config-protection.sh" }
  ]},
  { "matcher": "Bash", "hooks": [
    { "type": "command", "command": "bash /c/Users/Administrator/.claude/hooks/safety-gate.sh" }
  ]}
]
```

**Agent 2 (critical-fixes) 负责注册**：Agent 2 已拥有 settings.json 的 deny 部分编辑权，
扩展其职责为同时负责 settings.json 的 hooks 注册部分。

#### 3.2.1 completion-gate.sh (Stop Hook)

**事件**: Stop
**逻辑**:
1. 检测当前工作目录的项目类型
2. 查找测试命令：`package.json` → `npm test`、`pytest.ini`/`pyproject.toml` → `pytest`、`*.csproj` → `dotnet test`
3. 如果找到测试命令且有测试文件，执行测试（timeout 60s）
4. 测试通过 → exit 0，emit `sensor.trigger`
5. 测试失败 → exit 1，emit `sensor.block`，输出失败摘要
6. 无测试框架 → exit 0，emit `sensor.trigger` + `category: "no_tests"`

#### 3.2.2 linter-config-protection.sh (PreToolUse:Edit|Write)

**事件**: PreToolUse
**Matcher**: `Edit|Write`（注册在 research-first-guard 之后，同一 matcher 组）

**两级保护策略**（解决 pyproject.toml/Cargo.toml 的矛盾）：

- **全文件阻止**（basename 匹配即阻止）：
  `.eslintrc*`, `eslint.config*`, `biome.json`, `.prettierrc*`,
  `tsconfig.json`, `.golangci.yml`, `.swiftlint.yml`, `.pre-commit-config.yaml`, `lefthook.yml`

- **内容感知阻止**（匹配文件名后，进一步检查 `old_string`/`new_string` 内容）：
  - `pyproject.toml`：仅当 Edit 的 `old_string` 或 `new_string` 包含 `[tool.ruff]`、`[tool.black]`、
    `[tool.isort]`、`select =`、`ignore =`、`fixable =` 时阻止
  - `Cargo.toml`：仅当包含 `[lints]`、`[workspace.lints]` 时阻止

**实现方式**：从 stdin JSON 中提取 `tool_input.old_string` 和 `tool_input.new_string`
（Edit 工具）或 `tool_input.content`（Write 工具）来判断。

匹配时 exit 2 硬阻止，emit `guard.block`。

#### 3.2.3 safety-gate.sh (PreToolUse:Bash)

**事件**: PreToolUse
**Matcher**: `Bash`
**阻止命令模式**:
```
rm -rf /                    # 根目录删除
rm -rf ~                    # 主目录删除
rm -rf /*                   # 根目录通配
git push --force.*main      # 强推到 main
git push --force.*master    # 强推到 master
git reset --hard            # 硬重置
git clean -fd               # 强制清理
drop\s+table                # SQL 删表
truncate\s+table            # SQL 截断表
drop\s+database             # SQL 删库
:(){ :|:& };:               # Fork 炸弹
mkfs\.                      # 格式化文件系统
dd if=.* of=/dev/           # 磁盘覆写
```
**阻止逻辑**: 对 Bash 命令做正则匹配。匹配时 exit 2 硬阻止，emit `guard.block`。

### 3.3 Medium — 现有 Hook 改进

#### 3.3.1 日志轮转

在 `session-init.sh` 中添加旧日志文件轮转：
- `hook-counters.csv`: 超 10000 行截断到 5000
- `hook-events.log`: 超 10000 行截断到 5000
- `subagent.log`: 超 10000 行截断到 5000
- `stop-phrase-violations.log`: 超 5000 行截断到 3000

#### 3.3.2 auto-format.sh 反馈格式

改为输出 JSON：
```json
{
  "hookSpecificOutput": {
    "additionalContext": "ruff format: 2 files reformatted | ruff check: 1 fixable error auto-fixed"
  }
}
```
同时 emit `sensor.trigger` 到 harness-events.jsonl。

#### 3.3.3 security-reviewer.md 补全

```yaml
---
name: security-reviewer
description: 审计代码的安全隐患，包括注入、认证绕过、敏感数据泄露等
model: opus
effort: high
tools: Read, Grep, Glob, Bash
permissionMode: auto
memory: project
color: red
---
```

#### 3.3.4 cbm-code-discovery-gate 迁移

将 PPID-based gating 改为 session_id-based：
- Source `hook-metadata.sh`
- 使用 `session_scope_key()` 生成 gate 文件名
- Gate 文件路径改为 `/tmp/cbm-gate-$(session_scope_key).flag`

#### 3.3.5 auto-format.sh 加速

`npx prettier --write` → `bunx prettier --write`

#### 3.3.6 项目级 CLAUDE.md

为 `~/openclaw/` 创建 `.claude/CLAUDE.md`（< 50 行），包含项目特定规范。

### 3.4 Low — 进阶优化

#### 3.4.1 enableAllProjectMcpServers

settings.json 中改为 `false`。

#### 3.4.2 统一事件写入

所有 16 个现有 Hook 添加 `source harness-event.sh` + `emit_harness_event` 调用。

#### 3.4.3 settings.json deny 规则整理

按工具类型分组重新组织 deny 列表。

#### 3.4.4 memory 文件重命名

`feedback_codex_delegation_mandatory.md` → `feedback_codex_removed.md`

---

## 4. HUD Harness 仪表盘模块

### 4.1 文件变更清单

**新建**：
- `src/render/lines/harness.ts` — 主模块（数据读取、评分计算、渲染）

**必须修改**：
- `src/types.ts` — 在 `RenderContext` 接口中添加 `harness?: HarnessHealth` 字段
- `src/config.ts` — 四处修改：(1) `HudElement` 联合类型添加 `'harness'`；(2) `HudConfig` 接口添加 `harness` 配置段；(3) `DEFAULT_CONFIG` 添加 harness 默认值 + `elementOrder` 数组添加 `'harness'`；(4) `mergeConfig()` 函数添加 harness 配置的白名单合并逻辑（参照现有 `gitStatus`/`display` 的合并模式）；(5) `KNOWN_ELEMENTS` Set 和 `validateElementOrder()` 会自动兼容（它们基于 `DEFAULT_ELEMENT_ORDER`）
- `src/render/index.ts` — 在 `renderElementLine()` 的 switch/if 分支中添加 `'harness'` 分支，调用 `renderHarnessLines()`
- `src/render/lines/index.ts` — 添加 `export * from './harness.js'` 导出
- `src/i18n/types.ts` — 在 `MessageKey` 联合类型中添加所有 harness 相关键
- `src/i18n/zh.ts` — 添加中文翻译
- `src/i18n/en.ts` — 添加英文翻译
- `src/index.ts` — 在 `RenderContext` 构建过程中添加 harness 数据的读取调用

**现有 environment 行的处理**：
- `src/render/lines/environment.ts` 保留，但其 hook 监控功能标记为 deprecated
- 新 `harness.ts` 模块完全替代 environment.ts 的 hook 状态显示
- 两者数据源不同：environment.ts 读旧日志文件，harness.ts 读新 harness-events.jsonl
- **隐藏条件（复合判断，无死角）**：environment.ts 隐藏 hook 部分当且仅当
  **同时满足**以下两个条件：
  1. `elementOrder` 数组包含 `'harness'`
  2. `config.harness?.enabled !== false`
  
  如果任一条件不满足，environment 行照旧显示全部 hook 信息。
  
  边界场景覆盖：
  - `'harness'` 在 elementOrder + enabled=true → harness 渲染，environment 隐藏 hook 部分 ✓
  - `'harness'` 在 elementOrder + enabled=false → harness 不渲染，environment 保留 hook 部分 ✓
  - `'harness'` 不在 elementOrder → environment 保留 hook 部分（无论 enabled 值）✓

**测试文件**：
- `tests/harness.test.js` — 新建，覆盖评分算法、渲染输出、事件解析、会话隔离
- `tests/config.test.js` — 更新：默认 `elementOrder` 断言需包含 `'harness'`，
  `HudConfig` 类型断言需包含 `harness` 配置段，`mergeConfig()` 测试需覆盖 harness 合并逻辑
- `tests/render.test.js` — 更新：`renderElementLine()` 测试需覆盖 `'harness'` 分支，
  默认 elementOrder 断言需包含 `'harness'`，确保现有 environment 行测试在 harness 启用时
  正确隐藏 hook 部分

### 4.2 数据结构

```typescript
// === 组件注册表 ===
interface HarnessComponent {
  id: string;              // source 枚举值
  label: string;           // 显示名（i18n key）
  type: 'guard' | 'sensor' | 'lifecycle' | 'maintenance';
  priority: 'critical' | 'high' | 'normal';
  weight: number;          // critical=3, high=2, normal=1
}

// 全部组件清单（硬编码，作为评分基准）
// 注意：仅 guard 和 sensor 参与健康度评分和状态显示。
// lifecycle 和 maintenance 类型不参与评分，但会在事件日志中记录。
const HARNESS_COMPONENTS: HarnessComponent[] = [
  // === Guards (前馈控制) ===
  { id: 'agent-opus',         label: 'Opus锁定',    type: 'guard',   priority: 'normal',   weight: 1 },
  { id: 'research-first',     label: '研究优先',    type: 'guard',   priority: 'high',     weight: 2 },
  { id: 'effort-max',         label: '努力锁定',    type: 'guard',   priority: 'normal',   weight: 1 },
  { id: 'safety-gate',        label: '安全门',      type: 'guard',   priority: 'critical', weight: 3 },
  { id: 'linter-protection',  label: 'Lint保护',    type: 'guard',   priority: 'high',     weight: 2 },
  { id: 'cbm-gate',           label: 'CBM门',       type: 'guard',   priority: 'normal',   weight: 1 },
  // === Sensors (反馈控制) ===
  { id: 'auto-format',        label: '自动格式',    type: 'sensor',  priority: 'normal',   weight: 1 },
  { id: 'completion-gate',    label: '完成门',      type: 'sensor',  priority: 'critical', weight: 3 },
  { id: 'stop-phrase-guard',  label: '停止短语',    type: 'sensor',  priority: 'high',     weight: 2 },
  { id: 'read-tracker',       label: '读取追踪',    type: 'sensor',  priority: 'normal',   weight: 1 },
  { id: 'teammate-idle',      label: '队友空闲',    type: 'sensor',  priority: 'normal',   weight: 1 },
  { id: 'task-completed',     label: '任务完成',    type: 'sensor',  priority: 'normal',   weight: 1 },
];

// lifecycle/maintenance 组件不参与评分，仅用于日志分析：
// - subagent-logger (lifecycle)
// - post-compact (lifecycle)
// - session-init (lifecycle)
// - log-rotation (maintenance)

// === 运行时状态 ===
interface HarnessHealth {
  score: number;
  guards: ComponentStatus[];
  sensors: ComponentStatus[];
  violations: { total: number; byCategory: Record<string, number> };
  stats: { guardTriggers: number; sensorTriggers: number; blocks: number };
  trend: 'up' | 'down' | 'stable';
}

interface ComponentStatus {
  component: HarnessComponent;
  installed: boolean;
  triggered: number;
  blocked: number;
  lastEvent?: string;
}
```

### 4.3 健康度评分算法

**设计原则**：
- 阻止(block)是中性事件——表示 harness 在正常工作，不应加分也不应扣分
- 违规(violation)是负面事件——表示有不当行为被检测到
- 安装覆盖率是基础分——安装越全面，基础分越高
- 运行分基于"活跃度"——组件被触发过说明在正常工作

```
// === 基础分 (60分) — 配置完整度 ===
已安装加权总分 = Σ(installed ? weight : 0)  // 仅 guard + sensor
可能加权总分 = Σ(weight)                     // 仅 guard + sensor
基础分 = (已安装加权总分 / 可能加权总分) × 60

// === 活跃分 (20分) — 组件运行时是否活跃 ===
// 本会话中至少触发过一次事件的已安装组件数
活跃组件数 = count(installed && (triggered > 0 || blocked > 0))
已安装组件数 = count(installed)
if (已安装组件数 > 0) {
  活跃分 = (活跃组件数 / 已安装组件数) × 20
} else {
  活跃分 = 0
}

// === 违规惩罚 (最多扣20分) ===
// 违规 = stop-phrase-guard 检测到的违规行为
// 注意：guard.block 不是违规，是正常拦截
违规惩罚 = min(violations.total × 5, 20)

// === 稳定性奖励 (20分) — 无违规运行的持续性 ===
// 统计本会话中连续无违规的 guard/sensor 触发次数
totalNonViolationEvents = count(guard.pass + guard.block + sensor.trigger)
稳定性奖励 = min(totalNonViolationEvents / 10, 1) × 20

// === 最终评分 ===
总分 = clamp(基础分 + 活跃分 + 稳定性奖励 - 违规惩罚, 0, 100)
```

**权重合计**：1+2+1+3+2+1+1+3+2+1+1+1 = **19**

**示例**：
- 全部 12 组件安装、全部活跃、0 违规 → (19/19)×60 + (12/12)×20 - 0 = 60+20 = 80
  注：满分是 80，因为 0 违规 = 不扣分但也不加分。设计如此——100 分需要时间证明。
  **修正**：为了使满分可达 100，增加 **稳定性奖励分 (20分)**：
  连续 N 次触发无违规时，稳定性奖励 = min(N/10, 1) × 20
- 全部安装但无触发（新会话刚开始）→ (19/19)×60 + 0 + 0 - 0 = 60
- 缺少 2 个 critical 组件(weight=3×2=6)、其余活跃 → (13/19)×60 + (10/10)×20 - 0 = 41+20 = 61
- 全部安装活跃但有 3 次违规 → 60 + 20 + 0 - 15 = 65

### 4.4 组件安装检测

HUD 通过读取 **多级配置** 的 hooks 来判断哪些 Hook 已安装。
复用现有 `config-reader.ts` 中的 `getClaudeConfigDir()` 和配置文件发现逻辑，
检查以下路径（与现有 MCP/rules 计数逻辑保持一致）：

1. `$CLAUDE_CONFIG_DIR/settings.json`（或默认 `~/.claude/settings.json`）
2. `$CLAUDE_CONFIG_DIR/settings.local.json`
3. `{cwd}/.claude/settings.json`（项目级）
4. `{cwd}/.claude/settings.local.json`（项目级本地）

**检测逻辑**：
- 合并所有配置文件中的 `hooks` 对象
- 遍历所有 hook entry 的 `command` 字段
- 从 command 中提取脚本文件名（取最后一个路径组件，去掉 `bash ` 前缀）
- 建立文件名到 `HarnessComponent.id` 的映射表：
  ```
  agent-opus-enforcer.sh      → agent-opus
  research-first-guard.sh     → research-first
  effort-max-enforcer.sh      → effort-max
  safety-gate.sh              → safety-gate
  linter-config-protection.sh → linter-protection
  cbm-code-discovery-gate     → cbm-gate
  auto-format.sh              → auto-format
  completion-gate.sh          → completion-gate
  stop-phrase-guard.sh        → stop-phrase-guard
  read-tracker.sh             → read-tracker
  teammate-idle-gate.sh       → teammate-idle
  task-completed-gate.sh      → task-completed
  ```
- 匹配到的标记为 `installed: true`

### 4.5 渲染逻辑

```
─── Harness 仪表盘 ───
健康度: ████████░░ 85% | Guides 6/6 ✓ | Sensors 5/6
⛨ Guard: opus✓ research✓ effort✓ safety✓ lint-cfg✓ cbm✓
⚙ Sensor: format✓ complete✓ stop✓ read✓ idle✓ task✗ | 违规: 0
📊 今日: Guard×12 Sensor×8 Block×2 | 趋势: ↗
```

行数：
- 标题行（可选分隔符）
- 健康度总览行
- Guard 详情行
- Sensor 详情行
- 统计趋势行

颜色规则：
| 条件 | 颜色 |
|------|------|
| 健康度 ≥ 90% | green |
| 70% ≤ 健康度 < 90% | yellow |
| 健康度 < 70% | red |
| 组件 installed + active | green ✓ |
| 组件 not installed | red ✗ |
| 违规 > 0 | red + bold |
| 趋势 up | green ↗ |
| 趋势 down | red ↘ |
| 趋势 stable | dim → |

### 4.6 趋势计算

比较当前会话前半段和后半段的事件密度：
- 前半段 block 率 > 后半段 → 趋势 up（改善中）
- 前半段 block 率 < 后半段 → 趋势 down（恶化中）
- 差异 < 10% → stable

### 4.7 i18n 翻译键

在 `i18n/zh.ts` 和 `i18n/en.ts` 中添加：

```typescript
// zh.ts
harnessDashboard: 'Harness 仪表盘',
harnessHealth: '健康度',
harnessGuards: 'Guard',
harnessSensors: 'Sensor',
harnessViolations: '违规',
harnessToday: '今日',
harnessTrend: '趋势',
harnessTrendUp: '↗',
harnessTrendDown: '↘',
harnessTrendStable: '→',
harnessGuides: 'Guides',
harnessSensorsLabel: 'Sensors',
harnessBlock: 'Block',
```

### 4.8 配置项

在 `HudConfig` 接口中添加：

```typescript
harness?: {
  enabled?: boolean;          // 默认 true
  showScore?: boolean;        // 默认 true
  showGuards?: boolean;       // 默认 true
  showSensors?: boolean;      // 默认 true
  showStats?: boolean;        // 默认 true
  scoreThresholds?: {
    warning?: number;         // 默认 70
    critical?: number;        // 默认 50
  };
};
```

`HudElement` 联合类型定义在 `src/config.ts:20`（不是 types.ts），添加 `'harness'`。
`DEFAULT_ELEMENT_ORDER` 定义在 `src/config.ts:48`，将 `'harness'` 插入 `'environment'` 之后。
`KNOWN_ELEMENTS` Set 在 `src/config.ts:59` 基于 `DEFAULT_ELEMENT_ORDER` 自动同步。

### 4.9 会话隔离规则

harness-events.jsonl 是全局文件，包含所有会话的事件。HUD 必须按当前会话过滤。

**隔离策略**（严格复用 `environment.ts:195` 的 `matchesHookSession()` 模型）：

事件 schema 现包含 `session`（session_id）和 `transcript`（transcript_path）两个字段。
HUD 从 stdin JSON 获得当前会话的 `session_id` 和 `transcript_path`。

匹配优先级：
1. **session_id 精确匹配**：事件的 `session` === stdin 的 `session_id`。最可靠。
2. **transcript_path 精确匹配**：事件的 `transcript` === stdin 的 `transcript_path`。
   用于 session_id 不可用或不一致时的备选。
3. **SessionStart 时间回退**：以上均无法匹配时，检查事件的 `ts` 是否在当前会话的
   SessionStart 事件（`event: "lifecycle"`, `source: "session-init"`）之后。
   如果找到 SessionStart 事件且其 session/transcript 匹配，则该事件之后的
   `session: "unknown"` 事件归入当前会话。

**不使用"进程启动后 N 分钟"的模糊匹配**——这会引入跨会话污染。

**实现方式**：将 `environment.ts` 中 `matchesHookSession()` 提取为共享函数
放在 `src/utils/session-match.ts`，harness.ts 和 environment.ts 共同引用。

### 4.10 缓存策略

与现有 transcript 缓存类似：
- 以 `harness-events.jsonl` 的 mtime+size 为缓存键
- 解析结果缓存到内存（单次调用周期内有效）
- 不写磁盘缓存（文件变化频率高，磁盘缓存意义不大）

---

## 5. 并行执行策略

### 5.1 Agent Team 组成

| Agent | 名称 | 职责 | 依赖 |
|-------|------|------|------|
| 1 | data-pipeline | harness-event.sh 工具库 | 无 |
| 2 | critical-fixes | post-compact-reinject.sh 修复 + deny 规则 + security-reviewer.md | 依赖 Agent 1 |
| 3 | new-hooks | completion-gate + safety-gate + linter-protection | 依赖 Agent 1 |
| 4 | hook-migration | 所有现有 Hook 添加 emit_harness_event + auto-format 反馈 + cbm 迁移 + 日志轮转 | 依赖 Agent 1 |
| 5 | hud-dashboard | harness.ts + types.ts + i18n + config.ts + 测试 | 依赖 Agent 1（格式定义）|

### 5.2 执行顺序

```
Phase 0: Agent 1 完成 harness-event.sh（前置依赖）
Phase 1: Agent 2-5 全部并行启动
Phase 2: 集成测试 + 验证
```

### 5.3 文件锁定（避免冲突）

| Agent | 独占文件 | 只读文件 |
|-------|----------|----------|
| 1 | `hooks/harness-event.sh` | — |
| 2 | `hooks/post-compact-reinject.sh`, `settings.json` (deny + hooks 注册), `agents/security-reviewer.md`, `memory/feedback_codex_removed.md` | `hooks/harness-event.sh` |
| 3 | `hooks/completion-gate.sh`, `hooks/safety-gate.sh`, `hooks/linter-config-protection.sh` | `hooks/harness-event.sh` |
| 4 | `hooks/auto-format.sh`, `hooks/cbm-code-discovery-gate`, `hooks/session-init.sh`, 其他现有 hooks（不含 Agent 2/3 负责的） | `hooks/harness-event.sh` |
| 5 | `claude-hud-zh/` 下：`src/render/lines/harness.ts`(新建), `src/utils/session-match.ts`(新建), `src/render/lines/environment.ts`(改), `src/render/lines/index.ts`(改), `src/render/index.ts`(改), `src/types.ts`(改), `src/config.ts`(改), `src/index.ts`(改), `src/i18n/types.ts`(改), `src/i18n/zh.ts`(改), `src/i18n/en.ts`(改), `tests/harness.test.js`(新建), `tests/config.test.js`(改), `tests/render.test.js`(改) | `hooks/harness-event.sh` |

### 5.4 StatusLine 生效路径

**当前状态**：`settings.json` 中 statusLine 指向 marketplace 安装目录：
```
~/.claude/plugins/marketplaces/claude-hud/src/index.ts
```

这**不是** claude-hud-zh 仓库路径（`~/.claude/claude-hud-zh/`）。

**解决方案**：Agent 5 完成 HUD 开发后，需要执行以下步骤使改动生效：

1. 在 claude-hud-zh 仓库中执行 `npm run build` 编译 TypeScript
2. 将 `settings.json` 的 `statusLine.command` 改为指向 claude-hud-zh 仓库。
   **必须使用绝对路径的 bun 可执行文件**（当前 bash 环境下 `bun` 不在 PATH）：
   ```json
   "statusLine": {
     "type": "command",
     "command": "bash -c '\"/c/Users/Administrator/.bun/bin/bun.exe\" \"/c/Users/Administrator/.claude/claude-hud-zh/src/index.ts\"'"
   }
   ```
   （bun 可直接运行 .ts 文件，无需先编译到 dist/）
3. 切换后立即验证 HUD 能正常渲染（执行一次手动 stdin 测试）
4. 如验证失败，立即回退到原始 marketplace 路径

**此步骤由 Agent 2 执行**（其已拥有 settings.json 编辑权）。
**回退命令**（保存在 spec 中以防万一）：
```json
"command": "bash -c '\"/c/Users/Administrator/.bun/bin/bun.exe\" \"/c/Users/Administrator/.claude/plugins/marketplaces/claude-hud/src/index.ts\"'"
```

---

## 6. 验证计划

- [ ] 每个新 Hook 在隔离环境中测试（模拟 stdin JSON）
- [ ] Completion gate 测试：有测试项目 → 执行并阻止/通过；无测试 → 放行
- [ ] Safety gate 测试：模拟 `rm -rf /` → 阻止；正常 `rm file.tmp` → 放行
- [ ] Linter protection 测试：模拟编辑 `.eslintrc` → 阻止；编辑 `src/index.ts` → 放行
- [ ] HUD 仪表盘测试：模拟 harness-events.jsonl 数据 → 验证渲染输出
- [ ] 健康度评分测试：满分场景、零分场景、中间场景
- [ ] 日志轮转测试：超限后自动截断
- [ ] 双写验证：旧日志和新日志同时产生
- [ ] post-compact-reinject.sh 验证：不再包含 Codex 引用
