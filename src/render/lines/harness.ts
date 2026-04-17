import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  RenderContext,
  HarnessHealth,
  HarnessComponentState,
  HarnessRecentEvent,
  HarnessReadEditRatio,
  HarnessBaseline,
  HarnessInterruptRate,
  ComponentStatus,
  HealthTrend,
  StdinData,
  TranscriptData,
} from "../../types.js";
import type { HudConfig } from "../../config.js";
import { dim, green, red, yellow } from "../colors.js";
import { t } from "../../i18n/index.js";
import {
  matchesSession,
  normalizeTranscriptPath,
  type SessionContext,
} from "../../utils/session-match.js";
import {
  getClaudeConfigDir,
  getClaudeConfigJsonPath,
} from "../../claude-config-dir.js";

type HarnessComponentType = "guard" | "sensor";
type HarnessPriority = "critical" | "high" | "normal";

interface HarnessComponentDef {
  id: string;
  name: string;
  type: HarnessComponentType;
  priority: HarnessPriority;
  weight: number;
  scripts: string[];
}

const HARNESS_COMPONENTS: HarnessComponentDef[] = [
  {
    id: "agent-opus",
    name: "Agent Opus",
    type: "guard",
    priority: "normal",
    weight: 1,
    scripts: ["agent-opus-enforcer.sh"],
  },
  {
    id: "research-first",
    name: "Research First",
    type: "guard",
    priority: "high",
    weight: 2,
    scripts: ["research-first-guard.sh"],
  },
  {
    id: "effort-max",
    name: "Effort Max",
    type: "guard",
    priority: "normal",
    weight: 1,
    scripts: ["effort-max-enforcer.sh"],
  },
  {
    id: "safety-gate",
    name: "Safety Gate",
    type: "guard",
    priority: "critical",
    weight: 3,
    scripts: ["safety-gate.sh"],
  },
  {
    id: "linter-protection",
    name: "Linter Protection",
    type: "guard",
    priority: "high",
    weight: 2,
    scripts: ["linter-config-protection.sh"],
  },
  {
    id: "cbm-gate",
    name: "CBM Gate",
    type: "guard",
    priority: "normal",
    weight: 1,
    scripts: ["cbm-code-discovery-gate"],
  },
  {
    id: "auto-format",
    name: "Auto Format",
    type: "sensor",
    priority: "normal",
    weight: 1,
    scripts: ["auto-format.sh"],
  },
  {
    id: "completion-gate",
    name: "Completion Gate",
    type: "sensor",
    priority: "critical",
    weight: 3,
    scripts: ["completion-gate.sh"],
  },
  {
    id: "stop-phrase-guard",
    name: "Stop Phrase",
    type: "sensor",
    priority: "high",
    weight: 2,
    scripts: ["stop-phrase-guard.sh"],
  },
  {
    id: "read-tracker",
    name: "Read Tracker",
    type: "sensor",
    priority: "normal",
    weight: 1,
    scripts: ["read-tracker.sh"],
  },
  {
    id: "teammate-idle",
    name: "Teammate Idle",
    type: "sensor",
    priority: "normal",
    weight: 1,
    scripts: ["teammate-idle-gate.sh"],
  },
  {
    id: "task-completed",
    name: "Task Completed",
    type: "sensor",
    priority: "normal",
    weight: 1,
    scripts: ["task-completed-gate.sh"],
  },
  {
    id: "edit-quality",
    name: "Edit Quality",
    type: "guard",
    priority: "high",
    weight: 2,
    scripts: ["edit-quality-guard.sh"],
  },
  {
    id: "grep-tracker",
    name: "Grep Tracker",
    type: "sensor",
    priority: "normal",
    weight: 1,
    scripts: ["grep-tracker.sh"],
  },
  {
    id: "prompt-rescuer",
    name: "Prompt Rescuer",
    type: "sensor",
    priority: "high",
    weight: 2,
    scripts: ["prompt-rescuer.sh"],
  },
  {
    id: "session-summary",
    name: "Session Summary",
    type: "sensor",
    priority: "normal",
    weight: 1,
    scripts: ["session-summary.sh"],
  },
];

const TOTAL_WEIGHT = HARNESS_COMPONENTS.reduce(
  (sum, component) => sum + component.weight,
  0,
);
const COMPONENT_BY_ID = new Map(
  HARNESS_COMPONENTS.map((component) => [component.id, component]),
);
const SCRIPT_TO_COMPONENT_ID = new Map(
  HARNESS_COMPONENTS.flatMap((component) =>
    component.scripts.map(
      (script) => [script.toLowerCase(), component.id] as const,
    ),
  ),
);

const COMPONENT_LABEL_KEY_BY_ID = {
  "agent-opus": "harnessComponent.agent-opus",
  "research-first": "harnessComponent.research-first",
  "effort-max": "harnessComponent.effort-max",
  "safety-gate": "harnessComponent.safety-gate",
  "linter-protection": "harnessComponent.linter-protection",
  "cbm-gate": "harnessComponent.cbm-gate",
  "auto-format": "harnessComponent.auto-format",
  "completion-gate": "harnessComponent.completion-gate",
  "stop-phrase-guard": "harnessComponent.stop-phrase-guard",
  "read-tracker": "harnessComponent.read-tracker",
  "teammate-idle": "harnessComponent.teammate-idle",
  "task-completed": "harnessComponent.task-completed",
  "edit-quality": "harnessComponent.edit-quality",
  "grep-tracker": "harnessComponent.grep-tracker",
  "prompt-rescuer": "harnessComponent.prompt-rescuer",
  "session-summary": "harnessComponent.session-summary",
} as const;

function getComponentLabel(componentId: string, fallback: string): string {
  const key =
    COMPONENT_LABEL_KEY_BY_ID[
      componentId as keyof typeof COMPONENT_LABEL_KEY_BY_ID
    ];
  return key ? t(key) : fallback;
}

interface HarnessEvent {
  ts: string;
  event: string;
  source: string;
  session?: string;
  transcript?: string;
  category?: string;
  detail?: string;
  severity?: string;
}

interface ParsedEventsCache {
  filePath: string;
  mtimeMs: number;
  size: number;
  events: HarnessEvent[];
}

let parsedEventsCache: ParsedEventsCache | null = null;
const MAX_RECENT_EVENTS = 3;
const RECENT_EVENT_SOURCES = new Set([
  "task-completed",
  "completion-gate",
  "auto-format",
  "teammate-idle",
  "subagent-logger",
  "post-compact",
]);

function normalizeComparablePath(inputPath: string): string {
  const normalized = path.normalize(path.resolve(inputPath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathsReferToSameLocation(pathA: string, pathB: string): boolean {
  return normalizeComparablePath(pathA) === normalizeComparablePath(pathB);
}

function normalizeSessionId(sessionId?: string): string | undefined {
  if (!sessionId) {
    return undefined;
  }

  const trimmed = sessionId.trim();
  if (!trimmed || trimmed === "unknown") {
    return undefined;
  }

  return trimmed;
}

function parseHarnessEventLine(line: string): HarnessEvent | null {
  try {
    const parsed = JSON.parse(line) as Partial<HarnessEvent>;
    if (
      typeof parsed.ts !== "string" ||
      typeof parsed.event !== "string" ||
      typeof parsed.source !== "string"
    ) {
      return null;
    }

    return {
      ts: parsed.ts,
      event: parsed.event,
      source: parsed.source,
      session: typeof parsed.session === "string" ? parsed.session : undefined,
      transcript:
        typeof parsed.transcript === "string" ? parsed.transcript : undefined,
      category:
        typeof parsed.category === "string" ? parsed.category : undefined,
      detail: typeof parsed.detail === "string" ? parsed.detail : undefined,
      severity:
        typeof parsed.severity === "string" ? parsed.severity : undefined,
    };
  } catch {
    return null;
  }
}

function readHarnessEvents(): HarnessEvent[] {
  const logDir = path.join(os.homedir(), ".claude", "logs");
  const eventsFile = path.join(logDir, "harness-events.jsonl");

  try {
    const stat = fs.statSync(eventsFile);
    if (
      parsedEventsCache &&
      parsedEventsCache.filePath === eventsFile &&
      parsedEventsCache.mtimeMs === stat.mtimeMs &&
      parsedEventsCache.size === stat.size
    ) {
      return parsedEventsCache.events;
    }

    const events = fs
      .readFileSync(eventsFile, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseHarnessEventLine)
      .filter((event): event is HarnessEvent => event !== null);

    parsedEventsCache = {
      filePath: eventsFile,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      events,
    };

    return events;
  } catch {
    return [];
  }
}

function eventBelongsToCurrentSession(
  event: HarnessEvent,
  ctx: SessionContext,
  latestBoundaryMatchesCurrentSession: boolean,
): boolean {
  if (matchesSession(event.session, event.transcript, ctx)) {
    return true;
  }

  if (
    normalizeSessionId(event.session) ||
    normalizeTranscriptPath(event.transcript)
  ) {
    return false;
  }

  return latestBoundaryMatchesCurrentSession;
}

function parseHarnessEvents(
  sessionId?: string,
  transcriptPath?: string,
): HarnessEvent[] {
  const ctx: SessionContext = { sessionId, transcriptPath };
  const events = readHarnessEvents();
  let latestBoundaryMatchesCurrentSession = false;

  return events.filter((event) => {
    if (event.event === "lifecycle" && event.source === "session-init") {
      latestBoundaryMatchesCurrentSession = matchesSession(
        event.session,
        event.transcript,
        ctx,
      );
    }

    return eventBelongsToCurrentSession(
      event,
      ctx,
      latestBoundaryMatchesCurrentSession,
    );
  });
}

function isViolationEvent(event: HarnessEvent): boolean {
  return event.event === "violation";
}

function isBlockEvent(event: HarnessEvent): boolean {
  return event.event.endsWith(".block");
}

function contributesToStability(event: HarnessEvent): boolean {
  return (
    event.event === "guard.pass" ||
    event.event === "guard.block" ||
    event.event === "sensor.trigger"
  );
}

function isRecentNotableEvent(event: HarnessEvent): boolean {
  if (
    isViolationEvent(event) ||
    isBlockEvent(event) ||
    event.event === "config.repair"
  ) {
    return true;
  }

  if (!RECENT_EVENT_SOURCES.has(event.source)) {
    return false;
  }

  return typeof event.detail === "string" && event.detail.trim().length > 0;
}

function toRecentEvent(event: HarnessEvent): HarnessRecentEvent {
  return {
    ts: event.ts,
    event: event.event,
    source: event.source,
    category: event.category,
    detail: event.detail,
    severity: event.severity,
  };
}

function getRecentNotableEvents(events: HarnessEvent[]): HarnessRecentEvent[] {
  const seenSources = new Set<string>();
  const recentEvents: HarnessRecentEvent[] = [];

  for (const event of [...events].sort(
    (a, b) => Date.parse(b.ts) - Date.parse(a.ts),
  )) {
    if (seenSources.has(event.source)) {
      continue;
    }

    seenSources.add(event.source);
    if (!isRecentNotableEvent(event)) {
      continue;
    }

    recentEvents.push(toRecentEvent(event));

    if (recentEvents.length >= MAX_RECENT_EVENTS) {
      break;
    }
  }

  return recentEvents;
}

function extractHookCommands(config: unknown): string[] {
  if (!config || typeof config !== "object") {
    return [];
  }

  const parsedConfig = config as Record<string, unknown>;
  if (!parsedConfig.hooks || typeof parsedConfig.hooks !== "object") {
    return [];
  }

  const commands: string[] = [];
  const hookGroups = parsedConfig.hooks as Record<string, unknown>;

  for (const group of Object.values(hookGroups)) {
    if (!Array.isArray(group)) {
      continue;
    }

    for (const entry of group) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const directCommand = (entry as Record<string, unknown>).command;
      if (typeof directCommand === "string") {
        commands.push(directCommand);
      }

      const nestedHooks = (entry as Record<string, unknown>).hooks;
      if (!Array.isArray(nestedHooks)) {
        continue;
      }

      for (const hook of nestedHooks) {
        if (!hook || typeof hook !== "object") {
          continue;
        }

        const command = (hook as Record<string, unknown>).command;
        if (typeof command === "string") {
          commands.push(command);
        }
      }
    }
  }

  return commands;
}

function resolveComponentIdFromCommand(command: string): string | undefined {
  const normalized = command.replace(/\\/g, "/").toLowerCase();
  for (const [scriptName, componentId] of SCRIPT_TO_COMPONENT_ID.entries()) {
    if (normalized.includes(scriptName)) {
      return componentId;
    }
  }
  return undefined;
}

function collectSettingsPaths(cwd?: string): string[] {
  const homeDir = os.homedir();
  const claudeDir = getClaudeConfigDir(homeDir);
  const settingsPaths = [
    path.join(claudeDir, "settings.json"),
    path.join(claudeDir, "settings.local.json"),
    getClaudeConfigJsonPath(homeDir),
  ];

  if (cwd) {
    const projectClaudeDir = path.join(cwd, ".claude");
    const overlapsUserScope = pathsReferToSameLocation(
      projectClaudeDir,
      claudeDir,
    );
    if (!overlapsUserScope) {
      settingsPaths.push(path.join(projectClaudeDir, "settings.json"));
    }
    settingsPaths.push(path.join(projectClaudeDir, "settings.local.json"));
  }

  return settingsPaths;
}

function detectInstalledComponents(cwd?: string): Set<string> {
  const installed = new Set<string>();

  for (const settingsPath of collectSettingsPaths(cwd)) {
    try {
      if (!fs.existsSync(settingsPath)) {
        continue;
      }

      const parsed = JSON.parse(
        fs.readFileSync(settingsPath, "utf8"),
      ) as unknown;
      for (const command of extractHookCommands(parsed)) {
        const componentId = resolveComponentIdFromCommand(command);
        if (componentId) {
          installed.add(componentId);
        }
      }
    } catch {
      // Ignore malformed config files.
    }
  }

  return installed;
}

interface HealthInput {
  installedIds: Set<string>;
  activeIds: Set<string>;
  nonViolationCount: number;
  violationCount: number;
}

export function calculateHealth(input: HealthInput): number {
  const { installedIds, activeIds, nonViolationCount, violationCount } = input;

  let installedWeight = 0;
  for (const component of HARNESS_COMPONENTS) {
    if (installedIds.has(component.id)) {
      installedWeight += component.weight;
    }
  }

  let activeInstalledCount = 0;
  for (const componentId of activeIds) {
    if (installedIds.has(componentId)) {
      activeInstalledCount += 1;
    }
  }

  const baseScore = (installedWeight / TOTAL_WEIGHT) * 60;
  const activeScore =
    installedIds.size > 0 ? (activeInstalledCount / installedIds.size) * 20 : 0;
  const stabilityScore = Math.min(nonViolationCount / 10, 1) * 20;
  const violationPenalty = Math.min(violationCount * 5, 20);

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(baseScore + activeScore + stabilityScore - violationPenalty),
    ),
  );
}

function calculateTrend(events: HarnessEvent[]): HealthTrend {
  if (events.length < 2) {
    return "stable";
  }

  const midpoint = Math.floor(events.length / 2);
  const firstHalf = events.slice(0, midpoint);
  const secondHalf = events.slice(midpoint);
  const firstBlocks = firstHalf.filter((event) =>
    event.event.endsWith(".block"),
  ).length;
  const secondBlocks = secondHalf.filter((event) =>
    event.event.endsWith(".block"),
  ).length;
  const firstDensity =
    firstHalf.length > 0 ? firstBlocks / firstHalf.length : 0;
  const secondDensity =
    secondHalf.length > 0 ? secondBlocks / secondHalf.length : 0;

  if (secondDensity < firstDensity - 0.1) {
    return "up";
  }

  if (secondDensity > firstDensity + 0.1) {
    return "down";
  }

  return "stable";
}

function getHarnessThresholds(config: HudConfig): {
  warning: number;
  critical: number;
} {
  const warning = config.harness?.scoreThresholds?.warning ?? 70;
  const critical = config.harness?.scoreThresholds?.critical ?? 50;
  return {
    warning: Math.max(warning, critical),
    critical: Math.min(critical, warning),
  };
}

function scoreBar(
  score: number,
  thresholds: { warning: number; critical: number },
  width = 10,
): string {
  const safeScore = Math.max(0, Math.min(100, score));
  const filled = Math.round((safeScore / 100) * width);
  const empty = width - filled;
  const filledStr = "\u2588".repeat(filled);
  const emptyStr = "\u2591".repeat(empty);

  if (score >= thresholds.warning) {
    return green(filledStr) + dim(emptyStr);
  }

  if (score >= thresholds.critical) {
    return yellow(filledStr) + dim(emptyStr);
  }

  return red(filledStr) + dim(emptyStr);
}

function scoreColor(
  text: string,
  score: number,
  thresholds: { warning: number; critical: number },
): string {
  if (score >= thresholds.warning) {
    return green(text);
  }

  if (score >= thresholds.critical) {
    return yellow(text);
  }

  return red(text);
}

function formatRecentEventTime(ts: string): string {
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed)
    ? "--:--"
    : new Date(parsed).toISOString().slice(11, 16);
}

function trimEventDetail(event: HarnessRecentEvent): string {
  return event.detail?.trim() || "";
}

function formatRecentEventDetail(event: HarnessRecentEvent): string {
  const detail = trimEventDetail(event);

  if (
    event.source === "cbm-gate" &&
    (event.category === "awaiting_mcp_usage" ||
      event.category === "first_use_redirect")
  ) {
    return `${t("harnessReason.cbmAwaitingMcpUsage")}；${t("harnessReason.cbmHint")}`;
  }

  if (event.source === "completion-gate") {
    if (event.category === "tests_running") {
      return detail
        ? `${t("harnessReason.testsRunning")}: ${detail}`
        : t("harnessReason.testsRunning");
    }
    if (detail && (/\bexit 124\b/i.test(detail) || /timed out/i.test(detail))) {
      return `${t("harnessReason.testsTimedOut")}: ${detail}`;
    }
    if (detail) {
      return `${t("harnessReason.testsFailed")}: ${detail}`;
    }
    return t("harnessReason.testsFailed");
  }

  if (event.source === "safety-gate") {
    if (event.category === "recursive_delete") {
      return detail
        ? `${t("harnessReason.safetyRecursiveDelete")}: ${detail}`
        : t("harnessReason.safetyRecursiveDelete");
    }
    if (event.category === "force_push_main") {
      return detail
        ? `${t("harnessReason.safetyForcePushMain")}: ${detail}`
        : t("harnessReason.safetyForcePushMain");
    }
    if (event.category === "hard_reset") {
      return detail
        ? `${t("harnessReason.safetyHardReset")}: ${detail}`
        : t("harnessReason.safetyHardReset");
    }
    if (event.category === "git_clean") {
      return detail
        ? `${t("harnessReason.safetyGitClean")}: ${detail}`
        : t("harnessReason.safetyGitClean");
    }
    if (
      event.category === "database_destructive" ||
      event.category === "sql_destructive"
    ) {
      return detail
        ? `${t("harnessReason.safetyDatabaseDestructive")}: ${detail}`
        : t("harnessReason.safetyDatabaseDestructive");
    }
  }

  if (event.source === "linter-protection") {
    if (event.category === "full_file_block") {
      return detail
        ? `${t("harnessReason.linterConfigProtected")}: ${detail}`
        : t("harnessReason.linterConfigProtected");
    }
    if (event.category === "content_aware_block") {
      return detail
        ? `${t("harnessReason.linterContentProtected")}: ${detail}`
        : t("harnessReason.linterContentProtected");
    }
  }

  if (event.source === "stop-phrase-guard") {
    return detail
      ? `${t("harnessReason.phraseDetected")}: ${detail}`
      : t("harnessReason.phraseDetected");
  }

  return detail || event.category || event.source;
}

function getRecentEventLabel(event: HarnessRecentEvent): string {
  if (event.event === "violation") {
    return t("harnessRecentViolation");
  }

  if (event.event.endsWith(".block")) {
    return t("harnessRecentBlock");
  }

  if (event.event === "config.repair") {
    return t("harnessRecentRepair");
  }

  if (event.source === "task-completed") {
    return t("harnessRecentTask");
  }

  if (event.source === "teammate-idle") {
    return t("harnessRecentIdle");
  }

  if (event.source === "subagent-logger") {
    return t("harnessRecentAgent");
  }

  const component = COMPONENT_BY_ID.get(event.source);
  return component?.type === "guard"
    ? t("harnessRecentGuard")
    : t("harnessRecentEvent");
}

function renderRecentEventLine(event: HarnessRecentEvent): string {
  const timeLabel = formatRecentEventTime(event.ts);
  const component = COMPONENT_BY_ID.get(event.source);
  const componentLabel = component
    ? getComponentLabel(component.id, component.name)
    : event.source;
  const detail = formatRecentEventDetail(event);
  const eventLabel = getRecentEventLabel(event);

  if (event.event === "violation") {
    return red(
      `  \u21b3 ${eventLabel}[${timeLabel}] ${componentLabel} \u2192 ${detail}`,
    );
  }

  if (event.event.endsWith(".block")) {
    return yellow(
      `  \u21b3 ${eventLabel}[${timeLabel}] ${componentLabel} \u2192 ${detail}`,
    );
  }

  if (event.source === "task-completed") {
    return dim(`  \u21b3 ${eventLabel}[${timeLabel}] ${detail}`);
  }

  return dim(
    `  \u21b3 ${eventLabel}[${timeLabel}] ${componentLabel} \u2192 ${detail}`,
  );
}

export function computeReadEditRatio(
  toolCounts: Record<string, number> | undefined,
): HarnessReadEditRatio | null {
  if (!toolCounts) return null;
  const reads = toolCounts.Read ?? 0;
  const edits = toolCounts.Edit ?? 0;
  const writes = toolCounts.Write ?? 0;
  if (reads + edits + writes === 0) return null;
  const denom = Math.max(edits + writes, 1);
  return { ratio: reads / denom, reads, edits, writes };
}

export function computeInterruptRate(
  toolCounts: Record<string, number> | undefined,
  interruptCount: number | undefined,
): HarnessInterruptRate | null {
  if (!toolCounts) return null;
  const toolCalls = Object.values(toolCounts).reduce(
    (sum, n) => sum + (Number.isFinite(n) ? n : 0),
    0,
  );
  const interrupts = Math.max(0, interruptCount ?? 0);
  if (toolCalls === 0 && interrupts === 0) return null;
  const rate = toolCalls > 0 ? (interrupts * 1000) / toolCalls : 0;
  return { rate, interrupts, toolCalls };
}

function computeViolationBreakdown(
  events: HarnessEvent[],
): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const event of events) {
    if (!isViolationEvent(event)) continue;
    const category = event.category?.trim();
    if (!category) continue;
    breakdown[category] = (breakdown[category] ?? 0) + 1;
  }
  return breakdown;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

export function loadBaseline(config: HudConfig): HarnessBaseline | null {
  const baselineConfig = config.harness?.baseline;
  if (baselineConfig?.enabled === false) return null;
  const windowSize = baselineConfig?.windowSize ?? 30;
  const minSessions = baselineConfig?.minSessions ?? 5;

  const summaryPath = path.join(
    os.homedir(),
    ".claude",
    "logs",
    "session-summary.jsonl",
  );

  let content: string;
  try {
    content = fs.readFileSync(summaryPath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  const recent = lines.slice(-windowSize);
  const ratios: number[] = [];
  for (const line of recent) {
    try {
      const parsed = JSON.parse(line) as { r_e_ratio?: unknown };
      if (
        typeof parsed.r_e_ratio === "number" &&
        Number.isFinite(parsed.r_e_ratio)
      ) {
        ratios.push(parsed.r_e_ratio);
      }
    } catch {
      // Ignore malformed lines.
    }
  }

  if (ratios.length < minSessions) {
    return {
      rEMedian: null,
      rEMad: null,
      rEZScore: null,
      sessionCount: ratios.length,
    };
  }

  const med = median(ratios);
  const mad = median(ratios.map((r) => Math.abs(r - med)));

  return {
    rEMedian: med,
    rEMad: mad,
    rEZScore: null,
    sessionCount: ratios.length,
  };
}

export function computeBaselineZScore(
  current: number,
  baseline: HarnessBaseline,
): number | null {
  if (baseline.rEMedian === null || baseline.rEMad === null) return null;
  if (baseline.rEMad === 0) return null;
  return (current - baseline.rEMedian) / (1.4826 * baseline.rEMad);
}

function renderReadEditLine(
  ratio: HarnessReadEditRatio,
  config: HudConfig,
): string | null {
  const ratioConfig = config.harness?.readEditRatio;
  if (ratioConfig?.show === false) return null;

  const warningThreshold = ratioConfig?.warning ?? 2.5;
  const criticalThreshold = ratioConfig?.critical ?? 1.5;

  const { ratio: value, reads, edits, writes } = ratio;
  const ratioStr = value.toFixed(1);
  const label = t("harnessReadEdit");
  const readLabel = t("harnessReadLabel");
  const editLabel = t("harnessEditLabel");
  const writeLabel = t("harnessWriteLabel");
  const body = `${label}: ${ratioStr} | ${readLabel}:${reads} ${editLabel}:${edits} ${writeLabel}:${writes}`;
  const prefix = "\uD83D\uDCD0 ";

  if (edits + writes === 0) {
    return `  ${dim(prefix + body)}`;
  }

  if (value < criticalThreshold) {
    return `  ${red(prefix + body)}`;
  }

  if (value < warningThreshold) {
    return `  ${yellow(prefix + body)}`;
  }

  return `  ${green(prefix + body)}`;
}

function renderInterruptRateLine(
  rate: HarnessInterruptRate,
  config: HudConfig,
): string | null {
  const rateConfig = config.harness?.interruptRate;
  if (rateConfig?.show === false) return null;

  const warningThreshold = rateConfig?.warning ?? 2;
  const criticalThreshold = rateConfig?.critical ?? 5;

  const { rate: value, interrupts, toolCalls } = rate;
  const rateStr = value.toFixed(1);
  const label = t("harnessInterruptRate");
  const intLabel = t("harnessInterruptLabel");
  const unit = t("harnessInterruptUnit");
  const body = `${label}: ${rateStr}${unit} | ${intLabel}:${interrupts}/${toolCalls}`;
  const prefix = "\u26A1 ";

  if (interrupts === 0) {
    return `  ${dim(prefix + body)}`;
  }

  if (value >= criticalThreshold) {
    return `  ${red(prefix + body)}`;
  }

  if (value >= warningThreshold) {
    return `  ${yellow(prefix + body)}`;
  }

  return `  ${green(prefix + body)}`;
}

function renderViolationBreakdownLine(
  breakdown: Record<string, number>,
  config: HudConfig,
): string | null {
  if (config.harness?.violationBreakdown?.show === false) return null;
  const entries = Object.entries(breakdown).filter(([, count]) => count > 0);
  if (entries.length === 0) return null;

  const parts = entries.map(([category, count]) => {
    const translationKey = `harnessViolationCategory.${category}`;
    const translated = t(translationKey as any);
    // `t()` returns the raw key when the translation is missing; in that case fall back to the category id.
    const label = translated === translationKey ? category : translated;
    return `${label}\u00D7${count}`;
  });

  const prefix = "\u26A0 ";
  return `  ${red(prefix + t("harnessViolations") + ": " + parts.join(" "))}`;
}

function renderBaselineLine(
  baseline: HarnessBaseline,
  current: HarnessReadEditRatio | null,
  config: HudConfig,
): string | null {
  const baselineConfig = config.harness?.baseline;
  if (baselineConfig?.enabled === false) return null;

  const minSessions = baselineConfig?.minSessions ?? 5;
  const warnZ = baselineConfig?.warnZ ?? 1;
  const criticalZ = baselineConfig?.criticalZ ?? 2;

  if (baseline.sessionCount < minSessions) {
    const collecting = t("harnessBaselineCollecting");
    return `  ${dim(
      `\uD83D\uDCCA ${t("harnessBaseline")}: ${collecting} (${baseline.sessionCount}/${minSessions})`,
    )}`;
  }

  if (baseline.rEMedian === null) return null;

  const medianStr = baseline.rEMedian.toFixed(1);
  const sessions = baseline.sessionCount;
  const base = `\uD83D\uDCCA ${t("harnessBaseline")}: ${t("harnessReadEdit")} ${medianStr} (${sessions}${t("harnessBaselineSessions")})`;

  if (!current || current.edits + current.writes === 0) {
    return `  ${dim(base)}`;
  }

  const z = computeBaselineZScore(current.ratio, baseline);
  if (z === null) {
    if (
      baseline.rEMad === 0 &&
      baseline.rEMedian !== null &&
      Math.abs(current.ratio - baseline.rEMedian) >= 0.1
    ) {
      const arrow = current.ratio < baseline.rEMedian ? "\u2193" : "\u2191";
      const full = `${base} | ${t("harnessBaselineDeviation")}: ${arrow}`;
      return `  ${yellow(full)}`;
    }
    return `  ${dim(base)}`;
  }

  const absZ = Math.abs(z);
  const arrow = z < 0 ? "\u2193" : "\u2191";
  const zStr = `${z >= 0 ? "+" : ""}${z.toFixed(1)}\u03C3`;
  const deviation = `${t("harnessBaselineDeviation")}: ${zStr} ${arrow}`;
  const full = `${base} | ${deviation}`;

  if (absZ >= criticalZ) {
    return `  ${red(full)}`;
  }

  if (absZ >= warnZ) {
    return `  ${yellow(full)}`;
  }

  return `  ${dim(full)}`;
}

export function renderHarnessLines(ctx: RenderContext): string[] {
  const config = ctx.config;
  if (!config.harness?.enabled || !ctx.harness) {
    return [];
  }

  const health = ctx.harness;
  const lines: string[] = [];
  const thresholds = getHarnessThresholds(config);
  const trendSymbol =
    health.trend === "up"
      ? t("harnessTrendUp")
      : health.trend === "down"
        ? t("harnessTrendDown")
        : t("harnessTrendStable");

  const bar = scoreBar(health.score, thresholds);
  const scoreText = scoreColor(String(health.score), health.score, thresholds);
  const trendText =
    health.trend === "up"
      ? green(trendSymbol)
      : health.trend === "down"
        ? red(trendSymbol)
        : dim(trendSymbol);
  const summaryParts = [`${t("harnessGuardLabel")} ${t("harnessDashboard")}`];
  if (config.harness.showScore !== false) {
    summaryParts.push(bar, scoreText);
  }
  summaryParts.push(trendText, `${t("harnessToday")}:${health.sessionEvents}`);
  lines.push(summaryParts.join(" "));

  if (config.harness.showGuards) {
    const guards = health.components.filter(
      (component) => component.type === "guard",
    );
    const guardParts = guards.map((component) => {
      const shortName = getComponentLabel(component.id, component.name);
      if (component.status === "missing") {
        return red(`\u2717${shortName}`);
      }
      if (component.status === "active") {
        return green(`\u2713${shortName}`);
      }
      return `\u2713${shortName}`;
    });

    if (guardParts.length > 0) {
      lines.push(`  ${t("harnessGuards")}: ${guardParts.join(" ")}`);
    }
  }

  if (config.harness.showSensors) {
    const sensors = health.components.filter(
      (component) => component.type === "sensor",
    );
    const sensorParts = sensors.map((component) => {
      const shortName = getComponentLabel(component.id, component.name);
      if (component.status === "missing") {
        return red(`\u2717${shortName}`);
      }
      if (component.status === "active") {
        return green(`\u2713${shortName}`);
      }
      return `\u2713${shortName}`;
    });

    if (sensorParts.length > 0) {
      lines.push(`  ${t("harnessSensors")}: ${sensorParts.join(" ")}`);
    }
  }

  if (config.harness.showStats) {
    const blockCount = health.components.reduce(
      (sum, component) => sum + component.blockCount,
      0,
    );
    const guardEventCount = health.components
      .filter((component) => component.type === "guard")
      .reduce((sum, component) => sum + component.eventCount, 0);
    const sensorEventCount = health.components
      .filter((component) => component.type === "sensor")
      .reduce((sum, component) => sum + component.eventCount, 0);
    const violationText =
      health.totalViolations > 0
        ? red(`${t("harnessViolations")}:${health.totalViolations}`)
        : `${t("harnessViolations")}:0`;

    lines.push(
      `  ${t("harnessStatsLabel")} ${t("harnessGuards")}:${guardEventCount} ${t("harnessSensors")}:${sensorEventCount} ${t("harnessBlock")}:${blockCount} ${violationText} ${t("harnessTrend")}:${trendText}`,
    );
  }

  if (health.readEditRatio) {
    const line = renderReadEditLine(health.readEditRatio, config);
    if (line) lines.push(line);
  }

  if (health.interruptRate) {
    const line = renderInterruptRateLine(health.interruptRate, config);
    if (line) lines.push(line);
  }

  if (health.violationBreakdown) {
    const line = renderViolationBreakdownLine(
      health.violationBreakdown,
      config,
    );
    if (line) lines.push(line);
  }

  if (health.baseline) {
    const line = renderBaselineLine(
      health.baseline,
      health.readEditRatio ?? null,
      config,
    );
    if (line) lines.push(line);
  }

  for (const event of health.recentEvents ?? []) {
    lines.push(renderRecentEventLine(event));
  }

  return lines;
}

export function getHarnessHealth(
  stdinData: StdinData,
  config: HudConfig,
  transcript?: TranscriptData,
): HarnessHealth | undefined {
  if (!config.harness?.enabled) {
    return undefined;
  }

  const events = parseHarnessEvents(
    stdinData.session_id,
    stdinData.transcript_path,
  );
  const installedIds = detectInstalledComponents(stdinData.cwd);
  const componentEventCounts = new Map<string, number>();
  const componentBlockCounts = new Map<string, number>();
  let totalViolations = 0;

  for (const event of events) {
    const component = COMPONENT_BY_ID.get(event.source);
    if (!component) {
      continue;
    }

    componentEventCounts.set(
      event.source,
      (componentEventCounts.get(event.source) ?? 0) + 1,
    );
    if (event.event.endsWith(".block")) {
      componentBlockCounts.set(
        event.source,
        (componentBlockCounts.get(event.source) ?? 0) + 1,
      );
    }

    if (isViolationEvent(event)) {
      totalViolations += 1;
    }
  }

  const activeIds = new Set<string>();
  for (const component of HARNESS_COMPONENTS) {
    if ((componentEventCounts.get(component.id) ?? 0) > 0) {
      activeIds.add(component.id);
    }
  }

  const components: HarnessComponentState[] = HARNESS_COMPONENTS.map(
    (component) => {
      const eventCount = componentEventCounts.get(component.id) ?? 0;
      const blockCount = componentBlockCounts.get(component.id) ?? 0;
      let status: ComponentStatus = "missing";
      if (installedIds.has(component.id)) {
        status = activeIds.has(component.id) ? "active" : "installed";
      }

      return {
        id: component.id,
        name: component.name,
        type: component.type,
        status,
        eventCount,
        blockCount,
        weight: component.weight,
      };
    },
  );

  const nonViolationCount = events.filter(
    (event) => !isViolationEvent(event),
  ).length;
  const score = calculateHealth({
    installedIds,
    activeIds,
    nonViolationCount,
    violationCount: totalViolations,
  });

  const readEditRatio =
    computeReadEditRatio(transcript?.toolCounts) ?? undefined;
  const interruptRate =
    computeInterruptRate(transcript?.toolCounts, transcript?.interruptCount) ??
    undefined;
  const violationBreakdown = computeViolationBreakdown(events);
  const baseline = loadBaseline(config) ?? undefined;
  if (baseline && readEditRatio) {
    baseline.rEZScore = computeBaselineZScore(readEditRatio.ratio, baseline);
  }

  return {
    score,
    trend: calculateTrend(events),
    components,
    totalEvents: events.length,
    totalViolations,
    sessionEvents: events.length,
    recentEvents: getRecentNotableEvents(events),
    readEditRatio,
    violationBreakdown:
      Object.keys(violationBreakdown).length > 0
        ? violationBreakdown
        : undefined,
    baseline,
    interruptRate,
  };
}
