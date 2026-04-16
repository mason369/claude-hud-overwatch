import * as path from "node:path";

export interface SessionContext {
  sessionId?: string;
  transcriptPath?: string;
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

export function normalizeTranscriptPath(transcriptPath?: string): string | null {
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

export function matchesSession(
  eventSession: string | undefined,
  eventTranscript: string | undefined,
  ctx: SessionContext
): boolean {
  const currentSessionId = normalizeSessionId(ctx.sessionId);
  const currentTranscriptPath = normalizeTranscriptPath(ctx.transcriptPath);
  const lineSessionId = normalizeSessionId(eventSession);
  const lineTranscriptPath = normalizeTranscriptPath(eventTranscript);

  if (currentSessionId && lineSessionId && currentSessionId === lineSessionId) {
    return true;
  }

  if (currentTranscriptPath && lineTranscriptPath && currentTranscriptPath === lineTranscriptPath) {
    return true;
  }

  return false;
}
