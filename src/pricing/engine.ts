/**
 * Inventory-aware quoting for USDT/NGN (prices are NGN per USDT).
 *
 *   bid = mid * (1 - halfSpread - skew)   -> we BUY USDT, pay cNGN
 *   ask = mid * (1 + halfSpread - skew)   -> we SELL USDT, receive cNGN
 *
 * skew > 0 when we hold too much USDT: both quotes drop, so our ask gets more
 * attractive (we sell USDT) and our bid gets less attractive (we buy less).
 * That rebalances inventory through normal flow instead of a separate trade.
 *
 * halfSpread = base + volatility add-on (capped).
 * A side is withdrawn (null) when sources disagree too much or when we have
 * nothing to fill it with.
 */

export interface Inventory {
  usdt: number; // USDT units
  cngn: number; // cNGN units (1 cNGN = 1 NGN)
}

export interface PricingParams {
  baseHalfSpreadBps: number;
  maxSkewBps: number;
  volWidenMult: number;
  maxVolWidenBps: number;
  divergenceHaltBps: number;
  targetUsdtShare: number;
  maxSizeShare: number;
}

export interface MarketState {
  mid: number;
  dispersionBps: number;
  volBps: number; // recent mid volatility, bps
}

export interface Side {
  price: number; // NGN per USDT
  maxUsdt: number; // largest size (in USDT) we can fill on this side
}

export interface Quote {
  ts: number;
  mid: number;
  halfSpreadBps: number;
  skewBps: number;
  usdtShare: number;
  bid: Side | null;
  ask: Side | null;
  reason?: string;
}

const BPS = 1e-4;

export function usdtShare(inv: Inventory, mid: number): number {
  const usdtVal = inv.usdt;
  const cngnVal = inv.cngn / mid;
  const total = usdtVal + cngnVal;
  return total > 0 ? usdtVal / total : 0.5;
}

export function buildQuote(m: MarketState, inv: Inventory, p: PricingParams, ts = Date.now()): Quote {
  const share = usdtShare(inv, m.mid);

  if (m.dispersionBps > p.divergenceHaltBps) {
    return {
      ts, mid: m.mid, halfSpreadBps: 0, skewBps: 0, usdtShare: share, bid: null, ask: null,
      reason: `sources disagree by ${m.dispersionBps.toFixed(1)} bps (> ${p.divergenceHaltBps})`,
    };
  }

  const volAdd = Math.min(p.maxVolWidenBps, Math.max(0, m.volBps * p.volWidenMult));
  const halfSpreadBps = p.baseHalfSpreadBps + volAdd;

  // imbalance in [-0.5, 0.5] for a 0.5 target; normalise to [-1, 1].
  const span = Math.max(p.targetUsdtShare, 1 - p.targetUsdtShare);
  const imbalance = Math.max(-1, Math.min(1, (share - p.targetUsdtShare) / span));
  const skewBps = imbalance * p.maxSkewBps;

  const bidPx = m.mid * (1 - (halfSpreadBps + skewBps) * BPS);
  const askPx = m.mid * (1 + (halfSpreadBps - skewBps) * BPS);

  // Size limits: buying USDT spends cNGN; selling USDT spends USDT.
  const bidMax = (inv.cngn * p.maxSizeShare) / bidPx;
  const askMax = inv.usdt * p.maxSizeShare;

  // Never cross: keep bid strictly below ask even under extreme skew.
  const crossed = bidPx >= askPx;

  return {
    ts,
    mid: m.mid,
    halfSpreadBps,
    skewBps,
    usdtShare: share,
    bid: !crossed && bidMax > 0 ? { price: bidPx, maxUsdt: bidMax } : null,
    ask: !crossed && askMax > 0 ? { price: askPx, maxUsdt: askMax } : null,
    reason: crossed ? "quotes would cross" : undefined,
  };
}

/** Rolling volatility of mid changes, in bps (std dev of log returns). */
export class VolTracker {
  private mids: number[] = [];
  private window: number;
  constructor(window = 40) {
    this.window = window;
  }

  push(mid: number): number {
    this.mids.push(mid);
    if (this.mids.length > this.window) this.mids.shift();
    return this.value();
  }

  value(): number {
    if (this.mids.length < 3) return 0;
    const r: number[] = [];
    for (let i = 1; i < this.mids.length; i++) r.push(Math.log(this.mids[i] / this.mids[i - 1]));
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const v = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
    return Math.sqrt(v) * 1e4;
  }
}
