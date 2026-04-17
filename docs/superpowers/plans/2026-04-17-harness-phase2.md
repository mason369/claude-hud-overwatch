# Harness Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Five parallel agents (A/B/C/D/E). Agent D depends on Agent A completion.

**Goal:** 实施 Phase 2 spec 中的 6 项优化：R/E 比率、违规分类 UI、跨会话基线、Edit 质量拦截、Prompt 救援、Read 时间窗口。

**Architecture:** Hook 侧新增 4 个脚本 + 改 2 个现有脚本；HUD 侧扩展 transcript 统计、渲染、i18n、基线计算。严格复用 `harness-event.sh` / `hook-metadata.sh` 工具库。

**Tech Stack:** Bash (Git Bash on Windows), TypeScript (Node/Bun), Vitest/Jest

**Spec:** `docs/superpowers/specs/2026-04-17-harness-phase2-optimizations-design.md`

---

## 执行阶段

```
Phase 1 (并行): Agent A + Agent B + Agent C
Phase 2 (A 完成后): Agent D 启动
Phase 3 (A/B/C/D 全部完成): Agent E 集成测试
```

---

## Agent A: Data Layer — transcript toolCounts

**独占文件**:
- Modify: `~/.claude/claude-hud-zh/src/transcript.ts`
- Modify: `~/.claude/claude-hud-zh/src/types.ts`
- Create: `~/.claude/claude-hud-zh/tests/transcript-tool-counts.test.js`

### Task A.1: types.ts 加 toolCounts 字段

- [ ] 在 `TranscriptData` 接口加 `toolCounts: Record<string, number>`
- [ ] 在 `HarnessHealth` 接口加三个可选字段：
  ```typescript
  readEditRatio?: { ratio: number; reads: number; edits: number; writes: number };
  violationBreakdown?: Record<string, number>;
  baseline?: {
    rEMedian: number | null;
    rEMad: number | null;
    rEZScore: number | null;
    sessionCount: number;
  };
  ```
- [ ] 运行 `cd ~/.claude/claude-hud-zh && npm run build` 确认无类型错误

### Task A.2: transcript.ts 累计 toolCounts

- [ ] 在 `createEmptyResult()`（或初始化位置）添加 `toolCounts: {}`
- [ ] 找到 `tool_use` block 解析处，**在 slice(-20) 之前**累加：
  ```typescript
  if (block.type === 'tool_use') {
    const name = block.name ?? 'unknown';
    result.toolCounts[name] = (result.toolCounts[name] ?? 0) + 1;
  }
  ```
- [ ] 运行 `npm run build` 确认通过

### Task A.3: 测试 TDD

- [ ] 写 `tests/transcript-tool-counts.test.js`：
  - 模拟含 10 Read + 5 Edit + 2 Write 的 JSONL
  - 断言 `result.toolCounts.Read === 10`, `.Edit === 5`, `.Write === 2`
  - 断言 30+ 条工具时仍准确（不被 slice 影响）
- [ ] 运行 `npm test tests/transcript-tool-counts.test.js` 通过
- [ ] 运行全量 `npm test` 确认未破坏现有测试

### Task A.4: 提交

- [ ] Git diff review
- [ ] `git -C ~/.claude/claude-hud-zh add src/transcript.ts src/types.ts tests/transcript-tool-counts.test.js`
- [ ] `git commit -m "feat: add toolCounts reducer to transcript parser"`

---

## Agent B: Hook 三件套 + settings.json 注册

**独占文件**:
- Create: `~/.claude/hooks/session-summary.sh`
- Create: `~/.claude/hooks/edit-quality-guard.sh`
- Create: `~/.claude/hooks/grep-tracker.sh`
- Create: `~/.claude/hooks/prompt-rescuer.sh`
- Modify: `~/.claude/settings.json`

### Task B.1: session-summary.sh

- [ ] 创建脚本，`source` harness-event.sh + hook-metadata.sh
- [ ] 读 `HOOK_SESSION_ID` / `HOOK_TRANSCRIPT_PATH` 定位本会话
- [ ] 从 transcript.jsonl 用 `jq` 统计 Read/Edit/Write 次数
- [ ] 从 harness-events.jsonl 用 `jq` 过滤本会话的 guard.block/sensor.trigger/violation 事件计数
- [ ] 计算 `r_e_ratio = read_count / max(edit_count + write_count, 1)`
- [ ] 构造 JSON 行（见 spec §5.2.A schema）追加到 `~/.claude/logs/session-summary.jsonl`
- [ ] 超 500 行截断到 300（仿 harness-event.sh 轮转）
- [ ] emit `sensor.trigger` source=`session-summary` category=`session_closed`
- [ ] chmod +x
- [ ] 隔离测试：构造假 transcript + harness-events 子集，验证 summary JSON 正确

### Task B.2: edit-quality-guard.sh

- [ ] 创建脚本，`source` harness-event.sh + hook-metadata.sh
- [ ] 从 stdin 读 JSON，提取 `tool_name` / `tool_input.old_string` / `.new_string` / `.content` / `.replace_all` / `.file_path`
- [ ] **R1**（Edit）: `old_string` 长度 < 10 且不含换行 → `exit 2` + 输出 suggestion 到 stderr，emit `guard.block` category=`r1`
- [ ] **R2**（Edit）: `replace_all=true` 且本会话 `grep-searches-{sha256}.log` 不含 old_string → `exit 2` category=`r2`
- [ ] **R3**（Write）: 目标文件已存在（Windows 下 `test -f`）且本会话 `reads-{sha256}.log` 不含该路径 → `exit 2` category=`r3`
- [ ] 全部放行 → `exit 0` emit `guard.pass` category=`allowed`
- [ ] chmod +x
- [ ] 隔离测试：4 场景各构造 stdin JSON，验证 exit code + stderr 内容

### Task B.3: grep-tracker.sh

- [ ] 创建脚本，`source` harness-event.sh + hook-metadata.sh
- [ ] 从 stdin 读 `tool_input.pattern`，追加到 `~/.claude/logs/read-tracker/grep-searches-{session_scope_key}.log`
- [ ] 超 500 行截到 300
- [ ] emit `sensor.trigger` source=`grep-tracker` category=`pattern_logged`
- [ ] chmod +x

### Task B.4: prompt-rescuer.sh

- [ ] 创建脚本，`source` harness-event.sh + hook-metadata.sh
- [ ] 从 stdin 读 `prompt`（前 200 字符）
- [ ] 追加到 `~/.claude/logs/prompt-history-{session_scope_key}.log`（超 100 行截到 50）
- [ ] **T1**: grep 最近 3 条 prompt 含挫败词正则 `继续\|没完成\|没做完\|重来\|为什么\|又错\|还是不行`，匹配 ≥2 次
- [ ] **T2**: 本次 prompt 长度 > 100 且含 ≥3 个动作词 `实现\|重构\|修复\|新增\|删除\|优化\|集成\|测试\|部署`
- [ ] **T3**: 本次 prompt 含 `上次\|之前\|回到\|撤回\|revert`
- [ ] 任一命中 → 输出 JSON `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}` 到 stdout，内容见 spec §7.2
- [ ] emit `sensor.trigger` source=`prompt-rescuer` category=`t1|t2|t3`
- [ ] chmod +x

### Task B.5: settings.json 注册新 hooks

- [ ] Read `~/.claude/settings.json` 确认现有 hooks 结构
- [ ] PreToolUse 的 Edit|Write matcher 在 `research-first-guard.sh` 之后插入 `edit-quality-guard.sh`
- [ ] PostToolUse 新增 matcher `Grep`，挂 `grep-tracker.sh`
- [ ] UserPromptSubmit 在 `session-init.sh` 之后插入 `prompt-rescuer.sh`
- [ ] Stop 在 `completion-gate.sh` 之后追加 `session-summary.sh`
- [ ] JSON 保存前验证：`python -c "import json; json.load(open('settings.json'))"`

### Task B.6: 提交

- [ ] `cd ~/.claude && git add settings.json hooks/session-summary.sh hooks/edit-quality-guard.sh hooks/grep-tracker.sh hooks/prompt-rescuer.sh` （若 `.claude` 是 git repo；否则跳过）
- [ ] 否则记录变更到日志

---

## Agent C: read-tracker 时间窗口升级

**独占文件**:
- Modify: `~/.claude/hooks/read-tracker.sh`
- Modify: `~/.claude/hooks/research-first-guard.sh`

### Task C.1: read-tracker.sh 加时间戳

- [ ] Read 现脚本确认当前格式
- [ ] 把追加行改为 `printf '%s\t%s\n' "$(date +%s)" "$norm_path"`
- [ ] 轮转逻辑不变（只改行内容）
- [ ] 隔离测试：模拟 3 次 Read，日志每行格式为 `<unix_ts>\t<path>`

### Task C.2: research-first-guard.sh 时间窗口过滤

- [ ] 顶部加 `READ_FRESHNESS_SECONDS="${HARNESS_READ_FRESHNESS_SECONDS:-1800}"`
- [ ] 计算 `cutoff=$(($(date +%s) - READ_FRESHNESS_SECONDS))`
- [ ] 改 grep 逻辑：先 `awk -F'\t' -v c="$cutoff" '$1>c {print $2}' "$TRACK_FILE"` 得到新鲜路径列表，在此列表中 grep
- [ ] 保留向后兼容：若某行无 `\t`（老格式），直接视为"无时间戳"，不纳入新鲜集合（会被阻断，但因为老数据已读过，阻断后用户重新 Read 即可自愈）
- [ ] 阻断时 stderr 输出 "文件 $file_path 最近 $READ_FRESHNESS_SECONDS 秒内未读，请重新 Read 获取最新上下文"
- [ ] 隔离测试：
  - 30 分钟前时间戳 + 同路径 Edit → 阻断
  - 10 分钟前时间戳 + 同路径 Edit → 放行
  - 老格式无时间戳 → 阻断（并在 stderr 提示）

### Task C.3: 提交

- [ ] 若是 git repo 提交；否则记录

---

## Agent D: HUD 渲染层（依赖 Agent A 完成 types.ts）

**独占文件**:
- Modify: `~/.claude/claude-hud-zh/src/config.ts`
- Modify: `~/.claude/claude-hud-zh/src/render/lines/harness.ts`
- Modify: `~/.claude/claude-hud-zh/src/i18n/zh.ts`
- Modify: `~/.claude/claude-hud-zh/src/i18n/en.ts`
- Modify: `~/.claude/claude-hud-zh/src/i18n/types.ts`
- Modify: `~/.claude/claude-hud-zh/tests/harness.test.js`

### Task D.1: config.ts 扩展 harness 段

- [ ] 在 `HudConfig.harness` 接口加三个可选子段：`readEditRatio`, `violationBreakdown`, `baseline`（字段见 spec §3.2.C / §4.2.D / §5.2.D）
- [ ] 在 `DEFAULT_CONFIG.harness` 加对应默认值
- [ ] `mergeConfig()` 白名单合并加这三段
- [ ] 运行 `npm run build` 通过

### Task D.2: HARNESS_COMPONENTS 注册 4 新组件

- [ ] 在 `harness.ts` 的 `HARNESS_COMPONENTS` 数组追加：edit-quality, grep-tracker, prompt-rescuer, session-summary（定义见 spec §9.1）
- [ ] `COMPONENT_LABEL_KEY_BY_ID` 映射加对应 i18n key

### Task D.3: i18n 三文件扩展

- [ ] zh.ts 加：
  - `harnessReadEdit: 'R/E'` 等 4 个 R/E 键
  - `harnessViolationCategory` 对象（5 类别短名）
  - `harnessBaseline: '基线'`, `harnessBaselineDeviation: '当前偏离'`, `harnessBaselineSessions: '会话'`
  - `harnessComponent.editQuality: '编辑质量'` 等 4 个组件标签
  - `harnessReason.editQuality.{r1,r2,r3}` / `harnessReason.promptRescuer.{t1,t2,t3}`
- [ ] en.ts 对应英文
- [ ] types.ts 的 `MessageKey` 联合类型补全

### Task D.4: harness.ts 渲染扩展

- [ ] 新增 `computeReadEditRatio(toolCounts)`: 返回 `{ratio, reads, edits, writes}` 或 null
- [ ] 新增 `loadBaseline(config)`: 从 `~/.claude/logs/session-summary.jsonl` 读最近 windowSize 行，计算 median + MAD + z-score
- [ ] 新增 `renderReadEditLine(ctx)`: 按阈值着色
- [ ] 新增 `renderViolationBreakdown(ctx)`: 仅当任一类别 > 0 时渲染
- [ ] 新增 `renderBaselineLine(ctx)`: 冷启动隐藏，偏离着色
- [ ] 在 `renderHarnessLines()` 主函数按 config 开关插入新行（顺序：现有统计行 → R/E 行 → 违规分类行 → 基线行）

### Task D.5: 测试 TDD

- [ ] 扩展 `tests/harness.test.js`：
  - R/E 计算：toolCounts={Read:10, Edit:5} → ratio=2
  - R/E 颜色：1.5 红、2 黄、3 绿
  - 违规分类：byCategory={premature-stop:2, ownership-deflection:1} → 分类行含两条
  - 冷启动：session-summary 空 → baseline 行不渲染
  - 基线偏离：模拟 summary 中位数 4.5、MAD 0.5、当前 2.0 → z=-3.37 红色 ↓↓
  - 向后兼容：旧 config 无 readEditRatio 段 → 默认启用不崩
- [ ] 运行 `npm test` 全部通过

### Task D.6: 提交

- [ ] `git -C ~/.claude/claude-hud-zh add -A && git commit -m "feat: HUD Phase 2 — R/E ratio, violation breakdown, baseline z-score"`

---

## Agent E: 集成测试 + 文档

**依赖**: A/B/C/D 全部完成

**独占文件**:
- Create: `~/.claude/claude-hud-zh/tests/integration/harness-phase2.test.js`

### Task E.1: 端到端 HUD stdin 测试

- [ ] 构造完整 stdin JSON（含 transcript_path 指向准备好的 fixture）
- [ ] fixture transcript.jsonl 含 10 Read + 3 Edit
- [ ] fixture harness-events.jsonl 含 2 次 premature-stop 违规
- [ ] fixture session-summary.jsonl 含 10 条历史（r_e_ratio 均值 4.5）
- [ ] 执行 `bun src/index.ts < fixture-stdin.json`
- [ ] 断言输出含：`R/E: 3.3`、`过早停×2`、`基线: R/E 4.5`、`-1.2σ`

### Task E.2: Hook 端到端

- [ ] 模拟 Stop 触发：`echo '{"session_id":"test"}' | bash session-summary.sh`
- [ ] 验证 session-summary.jsonl 新增一行符合 schema

### Task E.3: 验证清单逐项勾选

- [ ] 按 spec §12 逐条 check，失败立即回报

---

## 全局验证

- [ ] `cd ~/.claude/claude-hud-zh && npm test` 全通过
- [ ] `npm run build` 无错误
- [ ] HUD 手动 stdin 测试输出符合预期
- [ ] 所有新 hook chmod +x 验证：`ls -l ~/.claude/hooks/{session-summary,edit-quality-guard,grep-tracker,prompt-rescuer}.sh`
- [ ] settings.json JSON 合法性验证通过
- [ ] 最终 `git log --oneline` 显示 4-5 个提交（A/B/C/D 各一个，E 最后）
