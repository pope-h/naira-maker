/**
 * Rate-shock guard.
 *
 * Textile's USDT/NGN mid sits at a structural premium to independent sources
 * (official rate, CoinGecko's USDT/NGN): that is the parallel-market spread, and
 * it is normal. What is dangerous is the premium moving fast: the official rate
 * is repriced, the parallel market gaps, or Textile's own book is pushed around.
 *
 * So the independent source never sets our price. We track the basis between
 * Textile and the independent rate, keep a slow time-weighted baseline of it,
 * and report how far the current basis sits from that baseline. The engine
 * halts quoting when that deviation exceeds its divergence threshold.
 */
export interface BasisReading {
  basisBps: number; // textile vs independent, in bps
  baselineBps: number; // slow average of the basis
  deviationBps: number; // |basis - baseline|
}

export class BasisGuard {
  private baseline: number | null = null;
  private lastTs = 0;

  /** halfLifeMs: how quickly the baseline follows a lasting change in the basis. */
  constructor(private halfLifeMs = 30 * 60_000) {}

  push(textileMid: number, independentMid: number, nowMs: number): BasisReading {
    const basis = (textileMid / independentMid - 1) * 1e4;
    if (this.baseline === null) {
      this.baseline = basis;
    } else {
      // Judge the new reading against the baseline BEFORE it can drag the baseline along.
      const dt = Math.max(0, nowMs - this.lastTs);
      const alpha = 1 - Math.exp((-Math.LN2 * dt) / this.halfLifeMs);
      const deviation = Math.abs(basis - this.baseline);
      // A reading far from the baseline barely moves it, so one spike cannot normalise itself.
      const weight = deviation > 25 ? alpha * 0.1 : alpha;
      const reading = { basisBps: basis, baselineBps: this.baseline, deviationBps: deviation };
      this.baseline += weight * (basis - this.baseline);
      this.lastTs = nowMs;
      return reading;
    }
    this.lastTs = nowMs;
    return { basisBps: basis, baselineBps: basis, deviationBps: 0 };
  }
}
