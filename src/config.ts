import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getHudPluginDir } from "./claude-config-dir.js";
import type { Language } from "./i18n/types.js";

export type LineLayoutType = "compact" | "expanded";

export type AutocompactBufferMode = "enabled" | "disabled";
export type ContextValueMode = "percent" | "tokens" | "remaining" | "both";

/**
 * Controls how the model name is displayed in the HUD badge.
 *
 *   full:    Show the raw display name as-is (e.g. "Opus 4.6 (1M context)")
 *   compact: Strip redundant context-window suffix (e.g. "Opus 4.6")
 *   short:   Strip context suffix AND "Claude " prefix (e.g. "Opus 4.6")
 */
export type ModelFormatMode = "full" | "compact" | "short";
export type HudElement =
  | "project"
  | "context"
  | "usage"
  | "memory"
  | "environment"
  | "harness"
  | "tools"
  | "agents"
  | "todos";
export type HudColorName =
  | "dim"
  | "red"
  | "green"
  | "yellow"
  | "magenta"
  | "cyan"
  | "brightBlue"
  | "brightMagenta";

/** A color value: named preset, 256-color index (0-255), or hex string (#rrggbb). */
export type HudColorValue = HudColorName | number | string;

export interface HudColorOverrides {
  context: HudColorValue;
  usage: HudColorValue;
  warning: HudColorValue;
  usageWarning: HudColorValue;
  critical: HudColorValue;
  model: HudColorValue;
  project: HudColorValue;
  git: HudColorValue;
  gitBranch: HudColorValue;
  label: HudColorValue;
  custom: HudColorValue;
}

export const DEFAULT_ELEMENT_ORDER: HudElement[] = [
  "project",
  "context",
  "usage",
  "memory",
  "environment",
  "harness",
  "tools",
  "agents",
  "todos",
];

const LEGACY_ELEMENT_ORDER: Exclude<HudElement, "harness">[] = [
  "project",
  "context",
  "usage",
  "memory",
  "environment",
  "tools",
  "agents",
  "todos",
];

const KNOWN_ELEMENTS = new Set<HudElement>(DEFAULT_ELEMENT_ORDER);

export interface HudConfig {
  language: Language;
  lineLayout: LineLayoutType;
  showSeparators: boolean;
  pathLevels: 1 | 2 | 3;
  elementOrder: HudElement[];
  gitStatus: {
    enabled: boolean;
    showDirty: boolean;
    showAheadBehind: boolean;
    showFileStats: boolean;
    pushWarningThreshold: number;
    pushCriticalThreshold: number;
  };
  display: {
    showModel: boolean;
    showProject: boolean;
    showContextBar: boolean;
    contextValue: ContextValueMode;
    showConfigCounts: boolean;
    showCost: boolean;
    showDuration: boolean;
    showSpeed: boolean;
    showTokenBreakdown: boolean;
    showUsage: boolean;
    usageBarEnabled: boolean;
    showTools: boolean;
    showAgents: boolean;
    showTodos: boolean;
    showSessionName: boolean;
    showClaudeCodeVersion: boolean;
    showMemoryUsage: boolean;
    showSessionTokens: boolean;
    showOutputStyle: boolean;
    autocompactBuffer: AutocompactBufferMode;
    usageThreshold: number;
    sevenDayThreshold: number;
    environmentThreshold: number;
    modelFormat: ModelFormatMode;
    modelOverride: string;
    customLine: string;
  };
  harness: {
    enabled: boolean;
    showScore: boolean;
    showGuards: boolean;
    showSensors: boolean;
    showStats: boolean;
    scoreThresholds: {
      warning: number;
      critical: number;
    };
    readEditRatio?: {
      show?: boolean;
      warning?: number;
      critical?: number;
    };
    violationBreakdown?: {
      show?: boolean;
    };
    baseline?: {
      enabled?: boolean;
      windowSize?: number;
      minSessions?: number;
      warnZ?: number;
      criticalZ?: number;
    };
    interruptRate?: {
      show?: boolean;
      warning?: number;
      critical?: number;
    };
    researchRatio?: {
      show?: boolean;
      warning?: number;
      critical?: number;
    };
  };
  colors: HudColorOverrides;
}

export const DEFAULT_CONFIG: HudConfig = {
  language: "zh",
  lineLayout: "expanded",
  showSeparators: true,
  pathLevels: 2,
  elementOrder: [...DEFAULT_ELEMENT_ORDER],
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: true,
    showFileStats: true,
    pushWarningThreshold: 0,
    pushCriticalThreshold: 0,
  },
  display: {
    showModel: true,
    showProject: true,
    showContextBar: true,
    contextValue: "both",
    showConfigCounts: true,
    showCost: true,
    showDuration: true,
    showSpeed: true,
    showTokenBreakdown: true,
    showUsage: true,
    usageBarEnabled: true,
    showTools: true,
    showAgents: true,
    showTodos: true,
    showSessionName: true,
    showClaudeCodeVersion: true,
    showMemoryUsage: true,
    showSessionTokens: true,
    showOutputStyle: true,
    autocompactBuffer: "enabled",
    usageThreshold: 0,
    sevenDayThreshold: 0,
    environmentThreshold: 0,
    modelFormat: "full",
    modelOverride: "",
    customLine: "",
  },
  harness: {
    enabled: true,
    showScore: true,
    showGuards: true,
    showSensors: true,
    showStats: true,
    scoreThresholds: {
      warning: 70,
      critical: 50,
    },
    readEditRatio: {
      show: true,
      warning: 2.5,
      critical: 1.5,
    },
    violationBreakdown: {
      show: true,
    },
    baseline: {
      enabled: true,
      windowSize: 30,
      minSessions: 5,
      warnZ: 1,
      criticalZ: 2,
    },
    interruptRate: {
      show: true,
      warning: 2,
      critical: 5,
    },
    researchRatio: {
      show: true,
      warning: 5,
      critical: 3,
    },
  },
  colors: {
    context: "green",
    usage: "brightBlue",
    warning: "yellow",
    usageWarning: "brightMagenta",
    critical: "red",
    model: "cyan",
    project: "yellow",
    git: "magenta",
    gitBranch: "cyan",
    label: "dim",
    custom: 208,
  },
};

export function getConfigPath(): string {
  const homeDir = os.homedir();
  return path.join(getHudPluginDir(homeDir), "config.json");
}

function validatePathLevels(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

function validateLineLayout(value: unknown): value is LineLayoutType {
  return value === "compact" || value === "expanded";
}

function validateAutocompactBuffer(
  value: unknown,
): value is AutocompactBufferMode {
  return value === "enabled" || value === "disabled";
}

function validateContextValue(value: unknown): value is ContextValueMode {
  return (
    value === "percent" ||
    value === "tokens" ||
    value === "remaining" ||
    value === "both"
  );
}

function validateLanguage(value: unknown): value is Language {
  return value === "en" || value === "zh";
}

function validateModelFormat(value: unknown): value is ModelFormatMode {
  return value === "full" || value === "compact" || value === "short";
}

function validateColorName(value: unknown): value is HudColorName {
  return (
    value === "dim" ||
    value === "red" ||
    value === "green" ||
    value === "yellow" ||
    value === "magenta" ||
    value === "cyan" ||
    value === "brightBlue" ||
    value === "brightMagenta"
  );
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function validateColorValue(value: unknown): value is HudColorValue {
  if (validateColorName(value)) return true;
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255
  )
    return true;
  if (typeof value === "string" && HEX_COLOR_PATTERN.test(value)) return true;
  return false;
}

function validateElementOrder(value: unknown): HudElement[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...DEFAULT_ELEMENT_ORDER];
  }

  const seen = new Set<HudElement>();
  const elementOrder: HudElement[] = [];

  for (const item of value) {
    if (typeof item !== "string" || !KNOWN_ELEMENTS.has(item as HudElement)) {
      continue;
    }

    const element = item as HudElement;
    if (seen.has(element)) {
      continue;
    }

    seen.add(element);
    elementOrder.push(element);
  }

  return elementOrder.length > 0 ? elementOrder : [...DEFAULT_ELEMENT_ORDER];
}

interface LegacyConfig {
  layout?: "default" | "separators" | Record<string, unknown>;
}

function shouldUpgradeLegacyElementOrder(
  value: unknown,
  hasHarnessConfig: boolean,
): value is Exclude<HudElement, "harness">[] {
  if (hasHarnessConfig || !Array.isArray(value)) {
    return false;
  }

  if (value.length !== LEGACY_ELEMENT_ORDER.length) {
    return false;
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item !== LEGACY_ELEMENT_ORDER[index]) {
      return false;
    }
  }

  return true;
}

function upgradeLegacyElementOrder(
  value: Exclude<HudElement, "harness">[],
): HudElement[] {
  const upgraded: HudElement[] = [...value];
  const environmentIndex = upgraded.indexOf("environment");
  const insertAt =
    environmentIndex >= 0 ? environmentIndex + 1 : upgraded.length;
  upgraded.splice(insertAt, 0, "harness");
  return upgraded;
}

function migrateConfig(
  userConfig: Partial<HudConfig> & LegacyConfig,
): Partial<HudConfig> {
  const migrated = { ...userConfig } as Partial<HudConfig> & LegacyConfig;

  if ("layout" in userConfig && !("lineLayout" in userConfig)) {
    if (typeof userConfig.layout === "string") {
      // Legacy string migration (v0.0.x → v0.1.x)
      if (userConfig.layout === "separators") {
        migrated.lineLayout = "compact";
        migrated.showSeparators = true;
      } else {
        migrated.lineLayout = "compact";
        migrated.showSeparators = false;
      }
    } else if (
      typeof userConfig.layout === "object" &&
      userConfig.layout !== null
    ) {
      // Object layout written by third-party tools — extract nested fields
      const obj = userConfig.layout as Record<string, unknown>;
      if (typeof obj.lineLayout === "string")
        migrated.lineLayout = obj.lineLayout as any;
      if (typeof obj.showSeparators === "boolean")
        migrated.showSeparators = obj.showSeparators;
      if (typeof obj.pathLevels === "number")
        migrated.pathLevels = obj.pathLevels as any;
    }
    delete migrated.layout;
  }

  if (
    shouldUpgradeLegacyElementOrder(
      userConfig.elementOrder,
      "harness" in userConfig,
    )
  ) {
    migrated.elementOrder = upgradeLegacyElementOrder(userConfig.elementOrder);
  }

  return migrated;
}

function validateThreshold(value: unknown, max = 100): number {
  if (typeof value !== "number") return 0;
  return Math.max(0, Math.min(max, value));
}

function validateCountThreshold(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

export function mergeConfig(userConfig: Partial<HudConfig>): HudConfig {
  const migrated = migrateConfig(userConfig);
  const language = validateLanguage(migrated.language)
    ? migrated.language
    : DEFAULT_CONFIG.language;

  const lineLayout = validateLineLayout(migrated.lineLayout)
    ? migrated.lineLayout
    : DEFAULT_CONFIG.lineLayout;

  const showSeparators =
    typeof migrated.showSeparators === "boolean"
      ? migrated.showSeparators
      : DEFAULT_CONFIG.showSeparators;

  const pathLevels = validatePathLevels(migrated.pathLevels)
    ? migrated.pathLevels
    : DEFAULT_CONFIG.pathLevels;

  const elementOrder = validateElementOrder(migrated.elementOrder);

  const gitStatus = {
    enabled:
      typeof migrated.gitStatus?.enabled === "boolean"
        ? migrated.gitStatus.enabled
        : DEFAULT_CONFIG.gitStatus.enabled,
    showDirty:
      typeof migrated.gitStatus?.showDirty === "boolean"
        ? migrated.gitStatus.showDirty
        : DEFAULT_CONFIG.gitStatus.showDirty,
    showAheadBehind:
      typeof migrated.gitStatus?.showAheadBehind === "boolean"
        ? migrated.gitStatus.showAheadBehind
        : DEFAULT_CONFIG.gitStatus.showAheadBehind,
    showFileStats:
      typeof migrated.gitStatus?.showFileStats === "boolean"
        ? migrated.gitStatus.showFileStats
        : DEFAULT_CONFIG.gitStatus.showFileStats,
    pushWarningThreshold: validateCountThreshold(
      migrated.gitStatus?.pushWarningThreshold,
    ),
    pushCriticalThreshold: validateCountThreshold(
      migrated.gitStatus?.pushCriticalThreshold,
    ),
  };

  const display = {
    showModel:
      typeof migrated.display?.showModel === "boolean"
        ? migrated.display.showModel
        : DEFAULT_CONFIG.display.showModel,
    showProject:
      typeof migrated.display?.showProject === "boolean"
        ? migrated.display.showProject
        : DEFAULT_CONFIG.display.showProject,
    showContextBar:
      typeof migrated.display?.showContextBar === "boolean"
        ? migrated.display.showContextBar
        : DEFAULT_CONFIG.display.showContextBar,
    contextValue: validateContextValue(migrated.display?.contextValue)
      ? migrated.display.contextValue
      : DEFAULT_CONFIG.display.contextValue,
    showConfigCounts:
      typeof migrated.display?.showConfigCounts === "boolean"
        ? migrated.display.showConfigCounts
        : DEFAULT_CONFIG.display.showConfigCounts,
    showCost:
      typeof migrated.display?.showCost === "boolean"
        ? migrated.display.showCost
        : DEFAULT_CONFIG.display.showCost,
    showDuration:
      typeof migrated.display?.showDuration === "boolean"
        ? migrated.display.showDuration
        : DEFAULT_CONFIG.display.showDuration,
    showSpeed:
      typeof migrated.display?.showSpeed === "boolean"
        ? migrated.display.showSpeed
        : DEFAULT_CONFIG.display.showSpeed,
    showTokenBreakdown:
      typeof migrated.display?.showTokenBreakdown === "boolean"
        ? migrated.display.showTokenBreakdown
        : DEFAULT_CONFIG.display.showTokenBreakdown,
    showUsage:
      typeof migrated.display?.showUsage === "boolean"
        ? migrated.display.showUsage
        : DEFAULT_CONFIG.display.showUsage,
    usageBarEnabled:
      typeof migrated.display?.usageBarEnabled === "boolean"
        ? migrated.display.usageBarEnabled
        : DEFAULT_CONFIG.display.usageBarEnabled,
    showTools:
      typeof migrated.display?.showTools === "boolean"
        ? migrated.display.showTools
        : DEFAULT_CONFIG.display.showTools,
    showAgents:
      typeof migrated.display?.showAgents === "boolean"
        ? migrated.display.showAgents
        : DEFAULT_CONFIG.display.showAgents,
    showTodos:
      typeof migrated.display?.showTodos === "boolean"
        ? migrated.display.showTodos
        : DEFAULT_CONFIG.display.showTodos,
    showSessionName:
      typeof migrated.display?.showSessionName === "boolean"
        ? migrated.display.showSessionName
        : DEFAULT_CONFIG.display.showSessionName,
    showClaudeCodeVersion:
      typeof migrated.display?.showClaudeCodeVersion === "boolean"
        ? migrated.display.showClaudeCodeVersion
        : DEFAULT_CONFIG.display.showClaudeCodeVersion,
    showMemoryUsage:
      typeof migrated.display?.showMemoryUsage === "boolean"
        ? migrated.display.showMemoryUsage
        : DEFAULT_CONFIG.display.showMemoryUsage,
    showSessionTokens:
      typeof migrated.display?.showSessionTokens === "boolean"
        ? migrated.display.showSessionTokens
        : DEFAULT_CONFIG.display.showSessionTokens,
    showOutputStyle:
      typeof migrated.display?.showOutputStyle === "boolean"
        ? migrated.display.showOutputStyle
        : DEFAULT_CONFIG.display.showOutputStyle,
    autocompactBuffer: validateAutocompactBuffer(
      migrated.display?.autocompactBuffer,
    )
      ? migrated.display.autocompactBuffer
      : DEFAULT_CONFIG.display.autocompactBuffer,
    usageThreshold: validateThreshold(migrated.display?.usageThreshold, 100),
    sevenDayThreshold: validateThreshold(
      migrated.display?.sevenDayThreshold,
      100,
    ),
    environmentThreshold: validateThreshold(
      migrated.display?.environmentThreshold,
      100,
    ),
    modelFormat: validateModelFormat(migrated.display?.modelFormat)
      ? migrated.display.modelFormat
      : DEFAULT_CONFIG.display.modelFormat,
    modelOverride:
      typeof migrated.display?.modelOverride === "string"
        ? migrated.display.modelOverride.slice(0, 80)
        : DEFAULT_CONFIG.display.modelOverride,
    customLine:
      typeof migrated.display?.customLine === "string"
        ? migrated.display.customLine.slice(0, 80)
        : DEFAULT_CONFIG.display.customLine,
  };

  const harness = {
    enabled:
      typeof migrated.harness?.enabled === "boolean"
        ? migrated.harness.enabled
        : DEFAULT_CONFIG.harness.enabled,
    showScore:
      typeof migrated.harness?.showScore === "boolean"
        ? migrated.harness.showScore
        : DEFAULT_CONFIG.harness.showScore,
    showGuards:
      typeof migrated.harness?.showGuards === "boolean"
        ? migrated.harness.showGuards
        : DEFAULT_CONFIG.harness.showGuards,
    showSensors:
      typeof migrated.harness?.showSensors === "boolean"
        ? migrated.harness.showSensors
        : DEFAULT_CONFIG.harness.showSensors,
    showStats:
      typeof migrated.harness?.showStats === "boolean"
        ? migrated.harness.showStats
        : DEFAULT_CONFIG.harness.showStats,
    scoreThresholds: {
      warning:
        validateThreshold(migrated.harness?.scoreThresholds?.warning, 100) ||
        DEFAULT_CONFIG.harness.scoreThresholds.warning,
      critical:
        validateThreshold(migrated.harness?.scoreThresholds?.critical, 100) ||
        DEFAULT_CONFIG.harness.scoreThresholds.critical,
    },
    readEditRatio: {
      show:
        typeof migrated.harness?.readEditRatio?.show === "boolean"
          ? migrated.harness.readEditRatio.show
          : DEFAULT_CONFIG.harness.readEditRatio!.show,
      warning:
        typeof migrated.harness?.readEditRatio?.warning === "number" &&
        Number.isFinite(migrated.harness.readEditRatio.warning)
          ? migrated.harness.readEditRatio.warning
          : DEFAULT_CONFIG.harness.readEditRatio!.warning,
      critical:
        typeof migrated.harness?.readEditRatio?.critical === "number" &&
        Number.isFinite(migrated.harness.readEditRatio.critical)
          ? migrated.harness.readEditRatio.critical
          : DEFAULT_CONFIG.harness.readEditRatio!.critical,
    },
    violationBreakdown: {
      show:
        typeof migrated.harness?.violationBreakdown?.show === "boolean"
          ? migrated.harness.violationBreakdown.show
          : DEFAULT_CONFIG.harness.violationBreakdown!.show,
    },
    baseline: {
      enabled:
        typeof migrated.harness?.baseline?.enabled === "boolean"
          ? migrated.harness.baseline.enabled
          : DEFAULT_CONFIG.harness.baseline!.enabled,
      windowSize:
        typeof migrated.harness?.baseline?.windowSize === "number" &&
        Number.isFinite(migrated.harness.baseline.windowSize) &&
        migrated.harness.baseline.windowSize > 0
          ? Math.floor(migrated.harness.baseline.windowSize)
          : DEFAULT_CONFIG.harness.baseline!.windowSize,
      minSessions:
        typeof migrated.harness?.baseline?.minSessions === "number" &&
        Number.isFinite(migrated.harness.baseline.minSessions) &&
        migrated.harness.baseline.minSessions > 0
          ? Math.floor(migrated.harness.baseline.minSessions)
          : DEFAULT_CONFIG.harness.baseline!.minSessions,
      warnZ:
        typeof migrated.harness?.baseline?.warnZ === "number" &&
        Number.isFinite(migrated.harness.baseline.warnZ)
          ? migrated.harness.baseline.warnZ
          : DEFAULT_CONFIG.harness.baseline!.warnZ,
      criticalZ:
        typeof migrated.harness?.baseline?.criticalZ === "number" &&
        Number.isFinite(migrated.harness.baseline.criticalZ)
          ? migrated.harness.baseline.criticalZ
          : DEFAULT_CONFIG.harness.baseline!.criticalZ,
    },
    interruptRate: {
      show:
        typeof migrated.harness?.interruptRate?.show === "boolean"
          ? migrated.harness.interruptRate.show
          : DEFAULT_CONFIG.harness.interruptRate!.show,
      warning:
        typeof migrated.harness?.interruptRate?.warning === "number" &&
        Number.isFinite(migrated.harness.interruptRate.warning) &&
        migrated.harness.interruptRate.warning >= 0
          ? migrated.harness.interruptRate.warning
          : DEFAULT_CONFIG.harness.interruptRate!.warning,
      critical:
        typeof migrated.harness?.interruptRate?.critical === "number" &&
        Number.isFinite(migrated.harness.interruptRate.critical) &&
        migrated.harness.interruptRate.critical >= 0
          ? migrated.harness.interruptRate.critical
          : DEFAULT_CONFIG.harness.interruptRate!.critical,
    },
    researchRatio: {
      show:
        typeof migrated.harness?.researchRatio?.show === "boolean"
          ? migrated.harness.researchRatio.show
          : DEFAULT_CONFIG.harness.researchRatio!.show,
      warning:
        typeof migrated.harness?.researchRatio?.warning === "number" &&
        Number.isFinite(migrated.harness.researchRatio.warning) &&
        migrated.harness.researchRatio.warning >= 0
          ? migrated.harness.researchRatio.warning
          : DEFAULT_CONFIG.harness.researchRatio!.warning,
      critical:
        typeof migrated.harness?.researchRatio?.critical === "number" &&
        Number.isFinite(migrated.harness.researchRatio.critical) &&
        migrated.harness.researchRatio.critical >= 0
          ? migrated.harness.researchRatio.critical
          : DEFAULT_CONFIG.harness.researchRatio!.critical,
    },
  };

  const colors = {
    context: validateColorValue(migrated.colors?.context)
      ? migrated.colors.context
      : DEFAULT_CONFIG.colors.context,
    usage: validateColorValue(migrated.colors?.usage)
      ? migrated.colors.usage
      : DEFAULT_CONFIG.colors.usage,
    warning: validateColorValue(migrated.colors?.warning)
      ? migrated.colors.warning
      : DEFAULT_CONFIG.colors.warning,
    usageWarning: validateColorValue(migrated.colors?.usageWarning)
      ? migrated.colors.usageWarning
      : DEFAULT_CONFIG.colors.usageWarning,
    critical: validateColorValue(migrated.colors?.critical)
      ? migrated.colors.critical
      : DEFAULT_CONFIG.colors.critical,
    model: validateColorValue(migrated.colors?.model)
      ? migrated.colors.model
      : DEFAULT_CONFIG.colors.model,
    project: validateColorValue(migrated.colors?.project)
      ? migrated.colors.project
      : DEFAULT_CONFIG.colors.project,
    git: validateColorValue(migrated.colors?.git)
      ? migrated.colors.git
      : DEFAULT_CONFIG.colors.git,
    gitBranch: validateColorValue(migrated.colors?.gitBranch)
      ? migrated.colors.gitBranch
      : DEFAULT_CONFIG.colors.gitBranch,
    label: validateColorValue(migrated.colors?.label)
      ? migrated.colors.label
      : DEFAULT_CONFIG.colors.label,
    custom: validateColorValue(migrated.colors?.custom)
      ? migrated.colors.custom
      : DEFAULT_CONFIG.colors.custom,
  };

  return {
    language,
    lineLayout,
    showSeparators,
    pathLevels,
    elementOrder,
    gitStatus,
    harness,
    display,
    colors,
  };
}

export async function loadConfig(): Promise<HudConfig> {
  const configPath = getConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      return mergeConfig({});
    }

    const content = fs.readFileSync(configPath, "utf-8");
    const userConfig = JSON.parse(content) as Partial<HudConfig>;
    return mergeConfig(userConfig);
  } catch {
    return mergeConfig({});
  }
}
