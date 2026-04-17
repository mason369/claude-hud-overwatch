import { mannWhitneyU, cliffDelta, cliffEffect, median, iqr } from "./stats.js";

const METRICS = [
  { key: "re_ratio", label: "R/E", digits: 2 },
  { key: "rm_ratio", label: "R/M", digits: 2 },
  { key: "write_pct", label: "Write%", digits: 3, isPercent: true },
  { key: "violations_per_session", label: "\u8FDD\u89C4\u6570", digits: 1 },
  { key: "interrupts_per_1k", label: "\u4E2D\u65AD\u7387(/1k)", digits: 2 },
  { key: "tool_diversity", label: "\u5DE5\u5177\u591A\u6837\u6027", digits: 1 },
  { key: "session_length", label: "\u4F1A\u8BDD\u957F\u5EA6", digits: 0 },
];

function formatValue(v, digits, isPercent) {
  if (!Number.isFinite(v)) return "NaN";
  return isPercent
    ? `${(v * 100).toFixed(digits === 3 ? 1 : digits)}%`
    : v.toFixed(digits);
}

function formatSummary(values, digits, isPercent) {
  if (values.length === 0) return "-";
  const m = median(values);
  const [q1, q3] = iqr(values);
  const formatOne = (x) => formatValue(x, digits, isPercent);
  return `${formatOne(m)} [${formatOne(q1)}-${formatOne(q3)}]`;
}

export function buildReport({ enabled, disabled, date }) {
  const lines = [];
  lines.push(`# Benchmark Report ${date}`);
  lines.push("");
  lines.push(
    `**Sample**: enabled n=${enabled.length}, disabled n=${disabled.length}`,
  );
  lines.push("");
  lines.push(
    "| \u6307\u6807 | enabled median [IQR] | disabled median [IQR] | U | p | Cliff's \u03B4 | \u6548\u5E94 |",
  );
  lines.push("|---|---|---|---|---|---|---|");

  const smallSample = enabled.length < 10 || disabled.length < 10;

  for (const { key, label, digits, isPercent } of METRICS) {
    const xs = enabled.map((s) => s[key]).filter(Number.isFinite);
    const ys = disabled.map((s) => s[key]).filter(Number.isFinite);
    const { U, p } = mannWhitneyU(xs, ys);
    const delta = cliffDelta(xs, ys);
    const effect = cliffEffect(delta);
    const sampleMark = smallSample ? " \u26A0\ufe0f" : "";
    lines.push(
      `| ${label}${sampleMark} | ${formatSummary(xs, digits, isPercent)} | ${formatSummary(ys, digits, isPercent)} | ${Number.isFinite(U) ? U.toFixed(1) : "-"} | ${Number.isFinite(p) ? p.toFixed(4) : "-"} | ${delta.toFixed(3)} | ${effect} |`,
    );
  }

  lines.push("");
  if (smallSample) {
    lines.push(
      "**Note**: \u4EFB\u4E00\u7EC4 n<10 \u65F6\u6807\u6CE8 \u26A0\ufe0f \u6837\u672C\u4E0D\u8DB3 (p-value may be unreliable, but Cliff's \u03B4 remains interpretable).",
    );
  }
  lines.push("");
  lines.push(
    "**Effect sizes**: |\u03B4| < 0.15 \u5C0F / < 0.33 \u4E2D / \u2265 0.33 \u5927",
  );
  lines.push("");
  return lines.join("\n");
}
