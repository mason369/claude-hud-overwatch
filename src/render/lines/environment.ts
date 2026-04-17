import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RenderContext } from "../../types.js";
import { label, red, yellow, dim } from "../colors.js";
import { t } from "../../i18n/index.js";

const HOOK_GUARD: Record<string, string> = {
  "stop-phrase-guard": "停止短语",
  "research-first": "研究优先",
  "effort-max": "努力锁定",
};

const HOOK_EVENT: Record<string, string> = {
  "auto-format": "自动格式",
  "subagent-logger": "子代理",
  "teammate-idle": "队友空闲",
  "task-completed": "任务完成",
  "post-compact": "压缩注入",
};

const HOOK_NAME_ZH: Record<string, string> = {
  ...HOOK_GUARD,
  ...HOOK_EVENT,
};

const VIOLATION_CAT_ZH: Record<string, string> = {
  "逃避所有权": "逃避",
  "请求许可": "求许可",
  "过早停止": "早停",
  "已知局限性": "推脱",
  "会话借口": "借口",
};

/** 违规分类的详细解释 — 显示在最新违规行中帮助理解 */
const VIOLATION_EXPLAIN: Record<string, string> = {
  "逃避所有权": "模型试图推卸责任",
  "请求许可": "模型反问用户而非直接执行",
  "过早停止": "模型试图提前结束任务",
  "已知局限性": "模型以局限性为由拒绝尝试",
  "会话借口": "模型以上下文为由建议新会话",
};

/** 停止短语英→中翻译（对应 stop-phrase-guard.sh 中定义的各类 pattern） */
const STOP_PHRASE_ZH: Record<string, string> = {
  // ── 逃避所有权 ──
  "not caused by my": "不是我导致的",
  "pre-existing issue": "预先存在的问题",
  "pre-existing problem": "预先存在的问题",
  "pre-existing bug": "预先存在的bug",
  "already existed before": "之前就已存在",
  "was already broken": "之前就已损坏",
  "not related to my changes": "与我的修改无关",
  "not my fault": "不是我的错",
  "existed prior to": "在此之前就存在",
  "unrelated to the current": "与当前无关",
  "outside my control": "超出我的控制",
  // ── 请求许可 ──
  "should i continue": "我应该继续吗",
  "would you like me to": "你希望我…吗",
  "shall i proceed": "我可以继续吗",
  "do you want me to": "你要我…吗",
  "want me to continue": "要我继续吗",
  "let me know if you": "如果你…请告诉我",
  "if you'd like me to": "如果你希望我…",
  "i can continue if": "如果需要我可以继续",
  "would you prefer": "你更喜欢…吗",
  "should i go ahead": "我要继续吗",
  "awaiting your": "等待你的…",
  "waiting for your": "等待你的…",
  // ── 过早停止 ──
  "good stopping point": "好的停顿点",
  "natural checkpoint": "自然检查点",
  "good place to stop": "停下来的好地方",
  "pause here": "在这里暂停",
  "leave it here": "就到这里",
  "stop here for now": "先停在这里",
  "good point to pause": "暂停的好时机",
  "take a break": "休息一下",
  "come back to this": "回头再看",
  "pick this up later": "稍后继续",
  "reasonable stopping": "合理的停顿",
  "i'll stop here": "我先停在这里",
  "stopping for now": "暂时停止",
  // ── 已知局限性 ──
  "known limitation": "已知局限性",
  "known issue": "已知问题",
  "future work": "未来工作",
  "out of scope": "超出范围",
  "beyond the scope": "超出范围",
  "todo for later": "以后再说",
  "left as an exercise": "留作练习",
  "can be improved later": "以后改进",
  "for a future": "留待以后",
  "outside the scope": "范围之外",
  "not in scope": "不在范围内",
  // ── 会话借口 ──
  "continue in a new session": "在新会话中继续",
  "new conversation": "新对话",
  "fresh session": "新会话",
  "running too long": "运行太久了",
  "context getting large": "上下文变大了",
  "context is getting": "上下文正在变…",
  "start a new session": "开始新会话",
  "context window": "上下文窗口",
  "running out of context": "上下文快用完了",
};

interface HookDetail {
  name: string;
  count: number;
}

interface ViolationDetail {
  category: string;
  count: number;
}

interface ViolationLogEntry {
  time: string;
  category: string;
  pattern: string;
}

interface HookLatestEntry {
  time: string;
  hook: string;
  detail: string;
}

interface HookLogMeta {
  sessionId?: string;
  transcriptPath?: string;
}

interface CurrentHookSession {
  sessionId?: string;
  transcriptPath?: string;
  sessionMs: number;
}

interface HookStats {
  hooks: HookDetail[];
  violations: ViolationDetail[];
  totalTriggers: number;
  totalViolations: number;
  latestViolation: ViolationLogEntry | null;
  latestResearchBlock: HookLatestEntry | null;
  latestSubagent: HookLatestEntry | null;
  latestGuard: HookLatestEntry | null;
  latestEvent: HookLatestEntry | null;
  latestIdle: HookLatestEntry | null;
}

/** 判断日志时间戳是否在 ttlMs 毫秒以内 */
function isRecent(timeStr: string, now: number, ttlMs: number): boolean {
  const ts = new Date(timeStr).getTime();
  return !isNaN(ts) && (now - ts) < ttlMs;
}

function parseLogLineMetadata(line: string): { baseLine: string; meta: HookLogMeta } {
  const [baseLine, metaJson] = line.split("\t", 2);
  if (!metaJson) {
    return { baseLine: line, meta: {} };
  }

  try {
    const parsed = JSON.parse(metaJson) as Record<string, unknown>;
    return {
      baseLine,
      meta: {
        sessionId: typeof parsed.session_id === "string" && parsed.session_id ? parsed.session_id : undefined,
        transcriptPath: typeof parsed.transcript_path === "string" && parsed.transcript_path ? parsed.transcript_path : undefined,
      },
    };
  } catch {
    return { baseLine: line, meta: {} };
  }
}

function normalizeTranscriptPath(transcriptPath?: string): string | null {
  if (!transcriptPath) {
    return null;
  }

  const trimmed = transcriptPath.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = path.normalize(trimmed).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function matchesHookSession(
  meta: HookLogMeta,
  session: CurrentHookSession,
  lineTime?: string,
): boolean {
  const hasCurrentIdentity = Boolean(session.sessionId || session.transcriptPath);
  const hasLineIdentity = Boolean(meta.sessionId || meta.transcriptPath);

  if (hasLineIdentity) {
    let compared = false;

    if (session.sessionId && meta.sessionId) {
      compared = true;
      if (session.sessionId !== meta.sessionId) {
        return false;
      }
    }

    const currentTranscriptPath = normalizeTranscriptPath(session.transcriptPath);
    const lineTranscriptPath = normalizeTranscriptPath(meta.transcriptPath);
    if (currentTranscriptPath && lineTranscriptPath) {
      compared = true;
      if (currentTranscriptPath !== lineTranscriptPath) {
        return false;
      }
    }

    if (compared) {
      return true;
    }

    if (hasCurrentIdentity) {
      return false;
    }
  }

  if (session.sessionMs > 0 && lineTime) {
    return isAfterSession(lineTime, session.sessionMs);
  }

  return false;
}

function parseViolationLine(line: string): ViolationLogEntry | null {
  // 格式: "2026-04-10 13:13:06 [逃避所有权] 触发: "not caused by my""
  const match = line.match(
    /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[([^\]]+)\] 触发: "(.+)"$/
  );
  if (!match) return null;
  const rawPattern = match[3];
  const patternZh = STOP_PHRASE_ZH[rawPattern] ?? rawPattern;
  return { time: match[1], category: match[2], pattern: patternZh };
}

function getLastSessionLine<T>(
  filePath: string,
  today: string,
  session: CurrentHookSession,
  parser: (line: string) => T | null,
): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    let last: T | null = null;
    for (const line of lines) {
      const { baseLine, meta } = parseLogLineMetadata(line);
      if (!baseLine.startsWith(today) && !baseLine.startsWith(`[${today}`)) continue;
      const timeMatch = baseLine.match(/\[?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
      if (!matchesHookSession(meta, session, timeMatch?.[1])) continue;
      const parsed = parser(baseLine);
      if (parsed) last = parsed;
    }
    return last;
  } catch {
    return null;
  }
}

const RESEARCH_REASON_ZH: Record<string, string> = {
  "not read first": "编辑前未先Read文件",
  "no references checked": "编辑前未检查引用",
  "file not in read tracker": "文件不在读取记录中",
  "basename mismatch": "文件名不匹配读取记录",
  "stale read": "读取记录已过期",
};

function parseResearchBlockLine(line: string): HookLatestEntry | null {
  // 格式: "2026-04-10 15:23:06 [BLOCKED] Edit on /path/file.ts (not read first)"
  const match = line.match(
    /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[BLOCKED\] (\w+) on (.+?) \((.+)\)$/
  );
  if (!match) return null;
  const filePath = match[3];
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  const reason = RESEARCH_REASON_ZH[match[4]] ?? match[4];
  return { time: match[1], hook: "research-first", detail: `${match[2]} ${fileName} — ${reason}` };
}

const SUBAGENT_EVENT_ZH: Record<string, string> = {
  SubagentStart: "启动",
  SubagentStop: "停止",
};

/** 防护类 hook 详情的中文描述 */
const GUARD_DETAIL_ZH: Record<string, string> = {
  "effort-max": "恢复推理深度",
  "stop-phrase-guard": "停止短语拦截",
};

/** 事件类 hook 详情的中文描述 */
const EVENT_DETAIL_ZH: Record<string, string> = {
  "teammate-idle": "队友",
  "task-completed": "任务",
  "auto-format": "自动格式化",
  "post-compact": "压缩注入",
};

function parseSubagentLine(line: string): HookLatestEntry | null {
  // 格式: "[2026-04-10 16:46:30] SubagentStart: explore (aba5ead0)"
  const match = line.match(
    /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] ([^:]+): (.+)$/
  );
  if (!match) return null;
  const eventZh = SUBAGENT_EVENT_ZH[match[2]] ?? match[2];
  // 去掉 agent ID 后缀（括号内的8位hex），只保留代理类型
  const agentInfo = match[3].replace(/\s*\([0-9a-f]+\)\s*$/, "").trim();
  return { time: match[1], hook: "subagent-logger", detail: `${eventZh} ${agentInfo}` };
}

function parseHookEventLine(line: string): HookLatestEntry | null {
  // 格式: "[2026-04-10 18:59:38] teammate-idle: some-agent-name"
  const match = line.match(
    /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] ([^:]+): (.+)$/
  );
  if (!match) return null;
  return { time: match[1], hook: match[2], detail: match[3] };
}

/** 从日志行提取时间戳并判断是否在 sessionStart 之后 */
function isAfterSession(lineTime: string, sessionStartMs: number): boolean {
  const ts = new Date(lineTime).getTime();
  return !isNaN(ts) && ts >= sessionStartMs;
}

function getLocalDateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getHookStats(session: CurrentHookSession): HookStats {
  const logDir = path.join(os.homedir(), ".claude", "logs");
  const today = getLocalDateStamp(new Date());
  const hookMap = new Map<string, number>();
  const violationMap = new Map<string, number>();
  let totalTriggers = 0;
  let totalViolations = 0;
  let latestViolation: ViolationLogEntry | null = null;
  let latestResearchBlock: HookLatestEntry | null = null;
  let latestSubagent: HookLatestEntry | null = null;

  try {
    const counterFile = path.join(logDir, "hook-counters.csv");
    if (fs.existsSync(counterFile)) {
      for (const line of fs.readFileSync(counterFile, "utf-8").split("\n")) {
        const { baseLine, meta } = parseLogLineMetadata(line);
        if (!baseLine.startsWith(today)) continue;
        const parts = baseLine.split(",");
        // 支持两种格式：
        //   带时间: "YYYY-MM-DD HH:MM:SS,hookname,1" — 可按会话过滤
        //   仅日期: "YYYY-MM-DD,hookname,count" — 按天聚合
        const hookName = parts[1] ?? "";
        const count = parseInt(parts[2] ?? "0", 10);
        if (isNaN(count) || !hookName) continue;

        const lineTime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(baseLine)
          ? baseLine.slice(0, 19)
          : undefined;
        if (!matchesHookSession(meta, session, lineTime)) {
          continue;
        }

        hookMap.set(hookName, (hookMap.get(hookName) ?? 0) + count);
        totalTriggers += count;
      }
    }
  } catch { /* ignore */ }

  try {
    const violationFile = path.join(logDir, "stop-phrase-violations.log");
    if (fs.existsSync(violationFile)) {
      for (const line of fs.readFileSync(violationFile, "utf-8").split("\n")) {
        const { baseLine, meta } = parseLogLineMetadata(line);
        if (!baseLine.startsWith(today)) continue;
        const lineTime = baseLine.slice(0, 19);
        if (!matchesHookSession(meta, session, lineTime)) {
          continue;
        }
        totalViolations++;
        const catMatch = baseLine.match(/\[([^\]]+)\]/);
        if (catMatch) {
          const cat = catMatch[1];
          violationMap.set(cat, (violationMap.get(cat) ?? 0) + 1);
        }
        const parsed = parseViolationLine(baseLine);
        if (parsed) {
          latestViolation = parsed;
        }
      }
    }
  } catch { /* ignore */ }

  // 研究优先拦截 — 会话内最新一条
  latestResearchBlock = getLastSessionLine(
    path.join(logDir, "research-first-violations.log"), today, session, parseResearchBlockLine
  );

  // 子代理活动 — 会话内最新一条
  latestSubagent = getLastSessionLine(
    path.join(logDir, "subagent.log"), today, session, parseSubagentLine
  );

  // hook-events.log — 提取防护/事件/空闲的最新条目
  let latestGuard: HookLatestEntry | null = null;
  let latestEvent: HookLatestEntry | null = null;
  let latestIdle: HookLatestEntry | null = null;

  try {
    const eventsFile = path.join(logDir, "hook-events.log");
    if (fs.existsSync(eventsFile)) {
      for (const line of fs.readFileSync(eventsFile, "utf-8").split("\n")) {
        const { baseLine, meta } = parseLogLineMetadata(line);
        if (!baseLine.startsWith(`[${today}`)) continue;
        const timeMatch = baseLine.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
        if (!matchesHookSession(meta, session, timeMatch?.[1])) {
          continue;
        }
        const parsed = parseHookEventLine(baseLine);
        if (!parsed) continue;
        if (HOOK_GUARD[parsed.hook]) {
          latestGuard = parsed;
        } else if (parsed.hook === "teammate-idle") {
          latestIdle = parsed;
        } else if (HOOK_EVENT[parsed.hook] || parsed.hook === "task-completed-debug") {
          latestEvent = parsed;
        }
      }
    }
  } catch { /* ignore */ }

  const hooks = Array.from(hookMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const violations = Array.from(violationMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return {
    hooks, violations, totalTriggers, totalViolations,
    latestViolation, latestResearchBlock, latestSubagent,
    latestGuard, latestEvent, latestIdle,
  };
}

export function renderEnvironmentLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const totalCounts =
    ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
  const threshold = display?.environmentThreshold ?? 0;
  const showCounts = display?.showConfigCounts !== false;
  const showOutputStyle = display?.showOutputStyle === true;
  const harnessActive = ctx.config.elementOrder.includes('harness')
    && ctx.config.harness?.enabled !== false;
  const parts: string[] = [];

  if (showCounts && totalCounts >= threshold && totalCounts > 0) {
    if (ctx.claudeMdCount > 0) {
      parts.push(`${ctx.claudeMdCount} CLAUDE.md`);
    }

    if (ctx.rulesCount > 0) {
      parts.push(`${ctx.rulesCount} ${t("label.rules")}`);
    }

    if (ctx.mcpCount > 0) {
      parts.push(`${ctx.mcpCount} MCPs`);
    }

  }

  if (showOutputStyle && ctx.outputStyle) {
    parts.push(`style: ${ctx.outputStyle}`);
  }

  // Hook 详情 — 当 harness 仪表盘激活时，由 harness 模块负责渲染防护/事件/违规
  if (harnessActive) {
    if (parts.length === 0) return null;
    return label(parts.join(" | "), ctx.config?.colors);
  }

  // Hook 详情 — 按防护/事件分组，只显示当前会话内的触发
  const stats = getHookStats({
    sessionId: ctx.stdin.session_id,
    transcriptPath: ctx.stdin.transcript_path,
    sessionMs: ctx.transcript.sessionStart?.getTime() ?? 0,
  });
  const hookCountMap = new Map(stats.hooks.map(h => [h.name, h.count]));

  const guardParts: string[] = [];
  const eventParts: string[] = [];
  let idleCount = 0;

  for (const [key, zhName] of Object.entries(HOOK_GUARD)) {
    const count = hookCountMap.get(key) ?? 0;
    if (count > 0) {
      guardParts.push(`${zhName}×${count}`);
    } else {
      idleCount++;
    }
  }

  for (const [key, zhName] of Object.entries(HOOK_EVENT)) {
    const count = hookCountMap.get(key) ?? 0;
    if (count > 0) {
      eventParts.push(`${zhName}×${count}`);
    } else {
      idleCount++;
    }
  }

  // 不在已知分组中但有触发记录的钩子
  for (const h of stats.hooks) {
    if (!HOOK_NAME_ZH[h.name]) {
      eventParts.push(`${h.name}×${h.count}`);
    }
  }

  // 未注册在分组中的 hook 也算入待机
  const extraIdle = Math.max(0, ctx.hooksCount - Object.keys(HOOK_NAME_ZH).length);
  idleCount += extraIdle;

  const hookSegments: string[] = [];
  if (guardParts.length > 0) {
    hookSegments.push(`防护: ${guardParts.join(" ")}`);
  }
  if (eventParts.length > 0) {
    hookSegments.push(`事件: ${eventParts.join(" ")}`);
  }
  if (idleCount > 0) {
    hookSegments.push(`待机 ${idleCount}`);
  }

  if (hookSegments.length > 0) {
    parts.push(hookSegments.join(" | "));
  }

  if (parts.length === 0 && stats.totalViolations === 0) {
    return null;
  }

  let line = parts.length > 0 ? label(parts.join(" | "), ctx.config?.colors) : "";

  if (stats.totalViolations > 0) {
    const details = stats.violations
      .map(v => `${VIOLATION_CAT_ZH[v.category] ?? v.category}×${v.count}`)
      .join(" ");
    const violationText = red(`停止防护 违规${stats.totalViolations} ${details}`);
    line = line ? `${line} | ${violationText}` : violationText;
  }

  // 各类最新触发详情 — 10 分钟内的才显示，过期自动隐藏
  const DETAIL_TTL_MS = 10 * 60 * 1000;
  const now = Date.now();

  // 1) 违规详情：紧跟在违规统计后面（红色）
  if (stats.latestViolation && isRecent(stats.latestViolation.time, now, DETAIL_TTL_MS)) {
    const v = stats.latestViolation;
    const catZh = VIOLATION_CAT_ZH[v.category] ?? v.category;
    const timeOnly = v.time.split(" ")[1] ?? v.time;
    const explain = VIOLATION_EXPLAIN[v.category] ?? "";
    const explainSuffix = explain ? ` — ${explain}` : "";
    const violationDetail = red(`  ↳ 最新违规[${timeOnly}] ${catZh}:「${v.pattern}」${explainSuffix}`);
    line = line ? `${line}\n${violationDetail}` : violationDetail;
  }

  // 2) 研究优先拦截：独立黄色提示行
  if (stats.latestResearchBlock && isRecent(stats.latestResearchBlock.time, now, DETAIL_TTL_MS)) {
    const r = stats.latestResearchBlock;
    const timeOnly = r.time.split(" ")[1] ?? r.time;
    const blockDetail = yellow(`  ↳ 拦截[${timeOnly}] ${r.detail}`);
    line = line ? `${line}\n${blockDetail}` : blockDetail;
  }

  // 3) 子代理活动：仅在 hook 区域有子代理计数时追加，灰色低优先级
  if (stats.latestSubagent && hookCountMap.get("subagent-logger") && isRecent(stats.latestSubagent.time, now, DETAIL_TTL_MS)) {
    const s = stats.latestSubagent;
    const timeOnly = s.time.split(" ")[1] ?? s.time;
    const subagentDetail = dim(`  ↳ 子代理[${timeOnly}] ${s.detail}`);
    line = line ? `${line}\n${subagentDetail}` : subagentDetail;
  }

  // 4) 防护类 hook 最新触发详情（黄色）
  if (stats.latestGuard && isRecent(stats.latestGuard.time, now, DETAIL_TTL_MS)) {
    const g = stats.latestGuard;
    const timeOnly = g.time.split(" ")[1] ?? g.time;
    const hookZh = HOOK_GUARD[g.hook] ?? g.hook;
    // 显示原始 detail 而非映射（detail 本身就是有意义的描述如"恢复 effortLevel=max"）
    const guardDetail = yellow(`  ↳ 防护[${timeOnly}] ${hookZh} → ${g.detail}`);
    line = line ? `${line}\n${guardDetail}` : guardDetail;
  }

  // 5) 事件类 hook 最新触发详情（灰色）
  if (stats.latestEvent && isRecent(stats.latestEvent.time, now, DETAIL_TTL_MS)) {
    const e = stats.latestEvent;
    const timeOnly = e.time.split(" ")[1] ?? e.time;
    const hookZh = HOOK_EVENT[e.hook] ?? e.hook;
    // 对 task-completed-debug 特殊处理：显示为原始 payload 调试信息
    const isDebug = e.hook === "task-completed-debug";
    const prefix = isDebug ? "任务完成(调试)" : (EVENT_DETAIL_ZH[e.hook] ?? hookZh);
    const eventDetail = dim(`  ↳ 事件[${timeOnly}] ${prefix} → ${e.detail}`);
    line = line ? `${line}\n${eventDetail}` : eventDetail;
  }

  // 6) 队友空闲最新详情（灰色）— 显示队友名和对应空闲次数
  if (stats.latestIdle && isRecent(stats.latestIdle.time, now, DETAIL_TTL_MS)) {
    const i = stats.latestIdle;
    const timeOnly = i.time.split(" ")[1] ?? i.time;
    const totalIdle = hookCountMap.get("teammate-idle") ?? 0;
    const idleSuffix = totalIdle > 0 ? ` (本会话共 ${totalIdle} 次空闲)` : "";
    const idleDetail = dim(`  ↳ 待机[${timeOnly}] 最新空闲队友: ${i.detail}${idleSuffix}`);
    line = line ? `${line}\n${idleDetail}` : idleDetail;
  }

  return line || null;
}
