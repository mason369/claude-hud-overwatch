import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mannWhitneyU,
  cliffDelta,
  cliffEffect,
  median,
  iqr,
} from "../benchmark/stats.js";

test("median handles odd and even length arrays", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("iqr returns [q1, q3] for known data", () => {
  const [q1, q3] = iqr([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(q1, 2.5);
  assert.equal(q3, 6.5);
});

test("mannWhitneyU returns U and p for distinct groups", () => {
  const xs = [10, 12, 14, 16, 18];
  const ys = [1, 2, 3, 4, 5];
  const { U, p } = mannWhitneyU(xs, ys);
  assert.ok(U <= 1, `expected U <= 1, got ${U}`);
  assert.ok(
    p < 0.05,
    `expected p < 0.05 for strongly separated groups, got ${p}`,
  );
});

test("mannWhitneyU handles ties with average ranks", () => {
  const xs = [3, 3, 3];
  const ys = [3, 3, 3];
  const { U, p } = mannWhitneyU(xs, ys);
  assert.ok(p > 0.5, `expected p > 0.5 for identical groups, got ${p}`);
  assert.ok(Number.isFinite(U));
});

test("mannWhitneyU returns p=NaN for empty inputs", () => {
  const { p } = mannWhitneyU([], [1, 2]);
  assert.ok(Number.isNaN(p));
});

test("mannWhitneyU applies tie correction for heavily tied data", () => {
  // Heavily tied: 15 zeros and 5 ones split 9/1 vs 6/4 between groups.
  // Verified via scipy.stats.mannwhitneyu(method='asymptotic', use_continuity=False):
  //   Without tie correction, p = 0.2568
  //   With tie correction,    p = 0.1311
  // The threshold < 0.2 fails under the old uncorrected variance and passes
  // under the corrected variance.
  const xs = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
  const ys = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1];
  const { U, p } = mannWhitneyU(xs, ys);
  assert.equal(U, 35, `expected U=35 for this dataset, got ${U}`);
  assert.ok(p < 0.2, `expected tie-corrected p < 0.2, got ${p}`);
  // Sanity: tie correction shrinks variance so p must still be finite and > 0.
  assert.ok(p > 0 && Number.isFinite(p));
});

test("mannWhitneyU reduces to classic formula with no ties", () => {
  // No ties in combined data — ΣT = 0 so tie-corrected variance equals the
  // classic n1*n2*(N+1)/12 formula. Matches the unchanged green case below.
  const xs = [10, 12, 14, 16, 18];
  const ys = [1, 2, 3, 4, 5];
  const { U, p } = mannWhitneyU(xs, ys);
  assert.equal(U, 0);
  // Matches existing behavior: p ≈ 0.0090 for this classic worked example.
  assert.ok(p < 0.02);
});

test("cliffDelta ranges in [-1, 1]", () => {
  assert.equal(cliffDelta([10, 20, 30], [1, 2, 3]), 1);
  assert.equal(cliffDelta([1, 2, 3], [10, 20, 30]), -1);
  assert.equal(cliffDelta([1, 2, 3], [1, 2, 3]), 0);
});

test("cliffEffect classifies by magnitude", () => {
  assert.equal(cliffEffect(0.1), "\u5C0F");
  assert.equal(cliffEffect(0.2), "\u4E2D");
  assert.equal(cliffEffect(0.4), "\u5927");
  assert.equal(cliffEffect(-0.4), "\u5927");
});
