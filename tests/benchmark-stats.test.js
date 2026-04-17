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
