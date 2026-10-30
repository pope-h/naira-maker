import { test } from "node:test";
import assert from "node:assert/strict";
import { HoldLast } from "../src/rates/hold.js";

test("fresh mid passes through", () => {
  const h = new HoldLast(60_000);
  assert.deepEqual(h.use(1380, 0), { mid: 1380, held: false });
});

test("holds the last mid during a gap", () => {
  const h = new HoldLast(60_000);
  h.use(1380, 0);
  assert.deepEqual(h.use(null, 30_000), { mid: 1380, held: true });
  assert.deepEqual(h.use(null, 60_000), { mid: 1380, held: true });
});

test("fails closed after the hold window", () => {
  const h = new HoldLast(60_000);
  h.use(1380, 0);
  assert.equal(h.use(null, 60_001), null);
});

test("nothing to hold before the first reading", () => {
  assert.equal(new HoldLast().use(null, 0), null);
});

test("a fresh mid restarts the window", () => {
  const h = new HoldLast(60_000);
  h.use(1380, 0);
  h.use(1381, 50_000);
  assert.deepEqual(h.use(null, 100_000), { mid: 1381, held: true });
});
