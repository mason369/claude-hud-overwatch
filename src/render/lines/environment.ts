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
  "agent-opus": "代理验证",
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

interface HookStats {
  hooks: HookDetail[];
  violations: ViolationDetail[];
  totalTriggers: number;
  totalViolations: number;
  latestViolation: ViolationLogEntry | null;
  latestResearchBlock: HookLatestEntry | null;
  latestSubagent: HookLatestEntry | null;
}

function parseViolationLine(line: string): ViolationLogEntry | null {
  // 格式: "2026-04-10 13:13:06 [逃避所有权] 触发: "not caused by my""
  const match = line.match(
    /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[([^\]]+)\] 触发: "(.+)"$/
  );
  if (!match) return null;
  return { time: match[1], category: match[2], pattern: match[3] };
}

function getLastTodayLine(filePath: string, today: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    let last: string | null = null;
    for (const line of lines) {
      if (line.startsWith(today) || line.startsWith(`[${today}`)) {
        last = line;
      }
    }
    return last;
  } catch {
    return null;
  }
}

function parseResearchBlockLine(line: string): HookLatestEntry | null {
  // 格式: "2026-04-10 15:23:06 [BLOCKED] Edit on /path/file.ts (not read first)"
  const match = line.match(
    /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[BLOCKED\] (\w+) on (.+?) \((.+)\)$/
  );
  if (!match) return null;
  const filePath = match[3];
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  return { time: match[1], hook: "research-first", detail: `${match[2]}→${fileName}(${match[4]})` };
}

const SUBAGENT_EVENT_ZH: Record<string, string> = {
  SubagentStart: "启动",
  SubagentStop: "停止",
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

function getHookStats(): HookStats {
  const logDir = path.join(os.homedir(), ".claude", "logs");
  const today = new Date().toISOString().slice(0, 10);
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
        if (!line.startsWith(today)) continue;
        const parts = line.split(",");
        const hookName = parts[1] ?? "";
        const count = parseInt(parts[2] ?? "0", 10);
        if (!isNaN(count) && hookName) {
          hookMap.set(hookName, (hookMap.get(hookName) ?? 0) + count);
          totalTriggers += count;
        }
      }
    }
  } catch { /* ignore */ }

  try {
    const violationFile = path.join(logDir, "stop-phrase-violations.log");
    if (fs.existsSync(violationFile)) {
      for (const line of fs.readFileSync(violationFile, "utf-8").split("\n")) {
        if (!line.startsWith(today)) continue;
        totalViolations++;
        const catMatch = line.match(/\[([^\]]+)\]/);
        if (catMatch) {
          const cat = catMatch[1];
          violationMap.set(cat, (violationMap.get(cat) ?? 0) + 1);
        }
        const parsed = parseViolationLine(line);
        if (parsed) {
          latestViolation = parsed;
        }
      }
    }
  } catch { /* ignore */ }

  // 研究优先拦截 — 最新一条
  const rfLine = getLastTodayLine(
    path.join(logDir, "research-first-violations.log"), today
  );
  if (rfLine) {
    latestResearchBlock = parseResearchBlockLine(rfLine);
  }

  // 子代理活动 — 最新一条
  const saLine = getLastTodayLine(
    path.join(logDir, "subagent.log"), today
  );
  if (saLine) {
    latestSubagent = parseSubagentLine(saLine);
  }

  const hooks = Array.from(hookMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const violations = Array.from(violationMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return {
    hooks, violations, totalTriggers, totalViolations,
    latestViolation, latestResearchBlock, latestSubagent,
  };
}

export function renderEnvironmentLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const totalCounts =
    ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
  const threshold = display?.environmentThreshold ?? 0;
  const showCounts = display?.showConfigCounts !== false;
  const showOutputStyle = display?.showOutputStyle === true;
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

  // Hook 详情 — 按防护/事件分组，只显示有触发的
  const stats = getHookStats();
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

  // 各类最新触发详情 — 分开显示，不再混为一行
  // 1) 违规详情：紧跟在违规统计后面（红色）
  if (stats.latestViolation) {
    const v = stats.latestViolation;
    const catZh = VIOLATION_CAT_ZH[v.category] ?? v.category;
    const timeOnly = v.time.split(" ")[1] ?? v.time;
    const violationDetail = red(`  ↳ 最新违规[${timeOnly}] ${catZh}:「${v.pattern}」`);
    line = line ? `${line}\n${violationDetail}` : violationDetail;
  }

  // 2) 研究优先拦截：独立黄色提示行
  if (stats.latestResearchBlock) {
    const r = stats.latestResearchBlock;
    const timeOnly = r.time.split(" ")[1] ?? r.time;
    const blockDetail = yellow(`  ↳ 拦截[${timeOnly}] ${r.detail}`);
    line = line ? `${line}\n${blockDetail}` : blockDetail;
  }

  // 3) 子代理活动：仅在 hook 区域有子代理计数时追加，灰色低优先级
  if (stats.latestSubagent && hookCountMap.get("subagent-logger")) {
    const s = stats.latestSubagent;
    const timeOnly = s.time.split(" ")[1] ?? s.time;
    const subagentDetail = dim(`  ↳ 子代理[${timeOnly}] ${s.detail}`);
    line = line ? `${line}\n${subagentDetail}` : subagentDetail;
  }

  return line || null;
}

