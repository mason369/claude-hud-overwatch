import type { HudConfig } from "./config.js";
import type { GitStatus } from "./git.js";
export interface StdinData {
    session_id?: string;
    transcript_path?: string;
    cwd?: string;
    model?: {
        id?: string;
        display_name?: string;
    };
    context_window?: {
        context_window_size?: number;
        current_usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
        } | null;
        used_percentage?: number | null;
        remaining_percentage?: number | null;
    };
    cost?: {
        total_cost_usd?: number | null;
        total_duration_ms?: number | null;
        total_api_duration_ms?: number | null;
        total_lines_added?: number | null;
        total_lines_removed?: number | null;
    } | null;
    rate_limits?: {
        five_hour?: {
            used_percentage?: number | null;
            resets_at?: number | null;
        } | null;
        seven_day?: {
            used_percentage?: number | null;
            resets_at?: number | null;
        } | null;
    } | null;
}
export interface ToolEntry {
    id: string;
    name: string;
    target?: string;
    status: "running" | "completed" | "error";
    startTime: Date;
    endTime?: Date;
}
export interface AgentEntry {
    id: string;
    type: string;
    model?: string;
    description?: string;
    status: "running" | "completed";
    startTime: Date;
    endTime?: Date;
}
export interface TodoItem {
    content: string;
    status: "pending" | "in_progress" | "completed";
}
export interface UsageData {
    fiveHour: number | null;
    sevenDay: number | null;
    fiveHourResetAt: Date | null;
    sevenDayResetAt: Date | null;
}
export interface MemoryInfo {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
}
/** Check if usage limit is reached (either window at 100%) */
export declare function isLimitReached(data: UsageData): boolean;
export interface SessionTokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
}
export interface TranscriptData {
    tools: ToolEntry[];
    agents: AgentEntry[];
    todos: TodoItem[];
    sessionStart?: Date;
    sessionName?: string;
    sessionTokens?: SessionTokenUsage;
    /**
     * Cumulative count of every `tool_use` block encountered in the transcript,
     * keyed by tool name. Populated independently of `tools` / `agents` (which
     * are capped by `.slice(-20)` / `.slice(-10)`), so it always reflects the
     * full session total — required for Read:Edit ratio and baseline metrics.
     */
    toolCounts: Record<string, number>;
    /**
     * Number of user-interruption events detected in the transcript. Each is a
     * user-role text block starting with "[Request interrupted by user".
     * Early-warning signal for issue #42796: normal ≈0.9/1k tools, degraded ≈11.4/1k.
     */
    interruptCount: number;
}
export type ComponentStatus = "active" | "installed" | "missing";
export type HealthTrend = "up" | "down" | "stable";
export interface HarnessComponentState {
    id: string;
    name: string;
    type: "guard" | "sensor";
    status: ComponentStatus;
    eventCount: number;
    blockCount: number;
    weight: number;
}
export interface HarnessRecentEvent {
    ts: string;
    event: string;
    source: string;
    category?: string;
    detail?: string;
    severity?: string;
}
export interface HarnessReadEditRatio {
    ratio: number;
    reads: number;
    edits: number;
    writes: number;
}
export interface HarnessBaseline {
    rEMedian: number | null;
    rEMad: number | null;
    rEZScore: number | null;
    sessionCount: number;
}
export interface HarnessInterruptRate {
    rate: number;
    interrupts: number;
    toolCalls: number;
}
export interface HarnessHealth {
    score: number;
    trend: HealthTrend;
    components: HarnessComponentState[];
    totalEvents: number;
    totalViolations: number;
    sessionEvents: number;
    recentEvents: HarnessRecentEvent[];
    /** Read / (Edit + Write) ratio for the current session; undefined when unavailable. */
    readEditRatio?: HarnessReadEditRatio;
    /** Per-category violation counts (e.g. ownership-deflection, premature-stop). */
    violationBreakdown?: Record<string, number>;
    /** Cross-session baseline + z-score for the Read:Edit ratio. */
    baseline?: HarnessBaseline;
    /** User-interruption rate per 1000 tool calls; undefined when no tools yet. */
    interruptRate?: HarnessInterruptRate;
}
export interface RenderContext {
    stdin: StdinData;
    transcript: TranscriptData;
    claudeMdCount: number;
    rulesCount: number;
    mcpCount: number;
    hooksCount: number;
    sessionDuration: string;
    gitStatus: GitStatus | null;
    usageData: UsageData | null;
    memoryUsage: MemoryInfo | null;
    harness?: HarnessHealth;
    config: HudConfig;
    extraLabel: string | null;
    outputStyle?: string;
    claudeCodeVersion?: string;
}
//# sourceMappingURL=types.d.ts.map