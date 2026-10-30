/**
 * Textile's book is briefly one-sided now and then, which leaves no mid. Reuse the
 * last good mid for a short while so quoting doesn't blink; past maxAgeMs it
 * returns null and the caller fails closed.
 */
export class HoldLast {
  private last: { mid: number; at: number } | null = null;

  constructor(private maxAgeMs = 60_000) {}

  /** Pass the fresh mid (or null when there is none); get the mid to use, or null. */
  use(fresh: number | null, nowMs: number): { mid: number; held: boolean } | null {
    if (fresh) {
      this.last = { mid: fresh, at: nowMs };
      return { mid: fresh, held: false };
    }
    if (this.last && nowMs - this.last.at <= this.maxAgeMs) return { mid: this.last.mid, held: true };
    return null;
  }
}
