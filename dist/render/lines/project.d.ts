import type { RenderContext } from '../../types.js';
export declare function renderProjectLine(ctx: RenderContext): string | null;
/**
 * 渲染会话信息行（时长 + 速度 + 费用），从 project 行拆出避免超宽。
 * 仅在 expanded 模式下使用。
 */
export declare function renderSessionInfoLine(ctx: RenderContext): string | null;
export declare function renderGitFilesLine(ctx: RenderContext, terminalWidth?: number | null): string | null;
//# sourceMappingURL=project.d.ts.map