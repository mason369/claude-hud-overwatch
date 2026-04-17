export function median(xs) {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function iqr(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return [NaN, NaN];
  const mid = Math.floor(n / 2);
  const lower = sorted.slice(0, mid);
  const upper = n % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);
  return [median(lower), median(upper)];
}

// Returns { ranks, tieGroups } where tieGroups is the list of group sizes for
// any tied run of length >= 2. Callers that ignore ties can use ranks alone.
function rankWithTies(values) {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(values.length);
  const tieGroups = [];
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[indexed[k].i] = avg;
    if (j - i + 1 >= 2) tieGroups.push(j - i + 1);
    i = j + 1;
  }
  return { ranks, tieGroups };
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

export function mannWhitneyU(xs, ys) {
  const n1 = xs.length;
  const n2 = ys.length;
  if (n1 === 0 || n2 === 0) return { U: NaN, p: NaN };

  const combined = [...xs, ...ys];
  const { ranks, tieGroups } = rankWithTies(combined);
  const r1 = ranks.slice(0, n1).reduce((s, r) => s + r, 0);
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const U = Math.min(u1, u2);

  const N = n1 + n2;
  const meanU = (n1 * n2) / 2;
  // Tie-corrected Wilcoxon–Mann–Whitney variance:
  //   var(U) = (n1*n2 / 12) * ((N + 1) - ΣT / (N * (N - 1)))
  //   where ΣT = Σ (tᵢ³ - tᵢ) over each tie group of size tᵢ.
  // When there are no ties, ΣT = 0 and this reduces to the classic
  // n1*n2*(N+1)/12 formula. When N <= 1 the test is degenerate.
  if (N <= 1) return { U, p: 1 };
  const sumT = tieGroups.reduce((s, t) => s + (t * t * t - t), 0);
  const varU = ((n1 * n2) / 12) * (N + 1 - sumT / (N * (N - 1)));
  if (!(varU > 0)) return { U, p: 1 };
  const stdU = Math.sqrt(varU);
  const z = (U - meanU) / stdU;
  const p = 2 * Math.min(normalCdf(z), 1 - normalCdf(z));
  return { U, p };
}

export function cliffDelta(xs, ys) {
  const n1 = xs.length;
  const n2 = ys.length;
  if (n1 === 0 || n2 === 0) return 0;
  let gt = 0;
  let lt = 0;
  for (const x of xs) {
    for (const y of ys) {
      if (x > y) gt += 1;
      else if (x < y) lt += 1;
    }
  }
  return (gt - lt) / (n1 * n2);
}

export function cliffEffect(delta) {
  const d = Math.abs(delta);
  if (d < 0.15) return "\u5C0F";
  if (d < 0.33) return "\u4E2D";
  return "\u5927";
}
