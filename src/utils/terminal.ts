export const UNKNOWN_TERMINAL_WIDTH = 120;

/** Detect terminal columns from stdout, stderr, or COLUMNS env var. */
function detectColumns(): number {
  const stdoutCols = process.stdout?.columns;
  if (typeof stdoutCols === 'number' && Number.isFinite(stdoutCols) && stdoutCols > 0) {
    return Math.floor(stdoutCols);
  }

  const stderrCols = process.stderr?.columns;
  if (typeof stderrCols === 'number' && Number.isFinite(stderrCols) && stderrCols > 0) {
    return Math.floor(stderrCols);
  }

  const envCols = Number.parseInt(process.env.COLUMNS ?? '', 10);
  if (Number.isFinite(envCols) && envCols > 0) {
    return envCols;
  }

  return 0;
}

// Returns a progress bar width scaled to the current terminal width.
// Wide (>=100): 10, Medium (60-99): 6, Narrow (<60): 4.
export function getAdaptiveBarWidth(): number {
  const cols = detectColumns();
  if (cols > 0) {
    if (cols >= 100) return 10;
    if (cols >= 60) return 6;
    return 4;
  }
  return 10;
}
