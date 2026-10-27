import { test } from "node:test";
import assert from "node:assert/strict";
import { BasisGuard } from "../src/rates/basis.js";

const MIN = 60_000;

test("a steady premium is normal: no deviation", () => {
  const g = new BasisGuard();
  let r = g.push(1385, 1360, 0);
  for (let i = 1; i < 30; i++) r = g.push(1385 + (i % 3), 1360, i * MIN);
  assert.ok(r.deviationBps < 20, `deviation ${r.deviationBps}`); // 0-2 NGN of jitter is up to ~14 bps of noise
  assert.ok(r.basisBps > 150 && r.basisBps < 200); // ~1.8% premium
});

test("a sudden jump in the basis is flagged", () => {
  const g = new BasisGuard();
  for (let i = 0; i < 20; i++) g.push(1385, 1360, i * MIN);
  const r = g.push(1410, 1360, 20 * MIN); // premium widens by ~180 bps
  assert.ok(r.deviationBps > 150, `deviation ${r.deviationBps}`);
});

test("a spike does not normalise itself within a few readings", () => {
  const g = new BasisGuard();
  for (let i = 0; i < 20; i++) g.push(1385, 1360, i * MIN);
  let r = g.push(1410, 1360, 20 * MIN);
  for (let i = 21; i < 25; i++) r = g.push(1410, 1360, i * MIN);
  assert.ok(r.deviationBps > 100, `deviation ${r.deviationBps}`);
});

test("a 65 bps drift over hours (CoinGecko noise) stays under the halt threshold", () => {
  const g = new BasisGuard();
  let r = g.push(1385, 1345, 0);
  for (let h = 1; h <= 12; h++) {
    // basis drifts from ~297 bps to ~232 bps over 12 hours, sampled every 10 minutes
    for (let k = 0; k < 6; k++) r = g.push(1385, 1345 + (h * 6 + k) * 0.125, (h * 60 + k * 10) * MIN);
  }
  assert.ok(r.deviationBps < 60, `deviation ${r.deviationBps}`);
});

test("a lasting regime shift is eventually accepted", () => {
  const g = new BasisGuard(10 * MIN);
  for (let i = 0; i < 10; i++) g.push(1385, 1360, i * MIN);
  let r = g.push(1410, 1360, 10 * MIN);
  for (let i = 11; i < 400; i++) r = g.push(1410, 1360, i * MIN);
  assert.ok(r.deviationBps < 20, `deviation ${r.deviationBps}`);
});
