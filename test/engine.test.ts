import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuote, usdtShare, VolTracker, type PricingParams } from "../src/pricing/engine.js";

const p: PricingParams = {
  baseHalfSpreadBps: 2.5,
  maxSkewBps: 8,
  volWidenMult: 0.5,
  maxVolWidenBps: 15,
  divergenceHaltBps: 60,
  targetUsdtShare: 0.5,
  maxSizeShare: 0.9,
};
const mid = 1381.5;
const balanced = { usdt: 150, cngn: 150 * mid };

test("balanced inventory quotes symmetrically around mid", () => {
  const q = buildQuote({ mid, dispersionBps: 0, volBps: 0 }, balanced, p);
  assert.ok(q.bid && q.ask);
  assert.ok(Math.abs(q.skewBps) < 1e-9);
  assert.ok(Math.abs(mid - q.bid.price - (q.ask.price - mid)) < 1e-9);
  const totalBps = ((q.ask.price - q.bid.price) / mid) * 1e4;
  assert.ok(Math.abs(totalBps - 5) < 1e-6, `total spread ${totalBps}`);
});

test("too much USDT lowers both quotes (sell USDT, buy less)", () => {
  const heavy = { usdt: 270, cngn: 30 * mid };
  const q = buildQuote({ mid, dispersionBps: 0, volBps: 0 }, heavy, p);
  const b = buildQuote({ mid, dispersionBps: 0, volBps: 0 }, balanced, p);
  assert.ok(q.skewBps > 0);
  assert.ok(q.ask!.price < b.ask!.price);
  assert.ok(q.bid!.price < b.bid!.price);
});

test("too much cNGN raises both quotes", () => {
  const heavy = { usdt: 30, cngn: 270 * mid };
  const q = buildQuote({ mid, dispersionBps: 0, volBps: 0 }, heavy, p);
  assert.ok(q.skewBps < 0);
  assert.ok(q.bid!.price > mid * (1 - 2.5e-4));
});

test("volatility widens the spread, capped", () => {
  const calm = buildQuote({ mid, dispersionBps: 0, volBps: 0 }, balanced, p);
  const wild = buildQuote({ mid, dispersionBps: 0, volBps: 1000 }, balanced, p);
  assert.equal(calm.halfSpreadBps, 2.5);
  assert.equal(wild.halfSpreadBps, 2.5 + 15);
});

test("source divergence withdraws both sides", () => {
  const q = buildQuote({ mid, dispersionBps: 100, volBps: 0 }, balanced, p);
  assert.equal(q.bid, null);
  assert.equal(q.ask, null);
  assert.match(q.reason ?? "", /disagree/);
});

test("empty side is withdrawn, other side stays", () => {
  const q = buildQuote({ mid, dispersionBps: 0, volBps: 0 }, { usdt: 0, cngn: 200_000 }, p);
  assert.equal(q.ask, null);
  assert.ok(q.bid && q.bid.maxUsdt > 0);
});

test("size never exceeds inventory share", () => {
  const q = buildQuote({ mid, dispersionBps: 0, volBps: 0 }, balanced, p);
  assert.ok(q.ask!.maxUsdt <= balanced.usdt * 0.9 + 1e-9);
  assert.ok(q.bid!.maxUsdt * q.bid!.price <= balanced.cngn * 0.9 + 1e-6);
});

test("usdtShare handles empty wallet", () => {
  assert.equal(usdtShare({ usdt: 0, cngn: 0 }, mid), 0.5);
});

test("vol tracker is zero for a flat series and positive for a noisy one", () => {
  const flat = new VolTracker();
  for (let i = 0; i < 10; i++) flat.push(1000);
  assert.equal(flat.value(), 0);
  const noisy = new VolTracker();
  [1000, 1001, 999, 1002, 998].forEach((m) => noisy.push(m));
  assert.ok(noisy.value() > 0);
});
