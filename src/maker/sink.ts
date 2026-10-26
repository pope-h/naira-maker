import { createServer } from "node:http";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Quote } from "../pricing/engine.js";

/**
 * Where our computed levels go.
 *
 * THE OPEN INTEGRATION POINT: Textile makers answer RFQs through Stitch
 * (github.com/textile-protocol/textile-stitch) or the filler API. This repo
 * does the pricing; it does not yet sign or submit quotes. Before wiring:
 *   1. Read "How to become a filler" and "Quoting Swap" on docs.textilecredit.com.
 *   2. Find how Stitch takes its prices (config file, HTTP hook, or library).
 *   3. Implement a QuoteSink for it below. FileSink is a stopgap if Stitch can
 *      read levels from disk; otherwise replace it.
 */
export interface QuoteSink {
  publish(q: Quote): Promise<void>;
}

const fmt = (n: number, d = 2) => n.toLocaleString("en-NG", { maximumFractionDigits: d, minimumFractionDigits: d });

export class ConsoleSink implements QuoteSink {
  async publish(q: Quote): Promise<void> {
    const bid = q.bid ? `${fmt(q.bid.price)} (≤${fmt(q.bid.maxUsdt, 0)} USDT)` : "—";
    const ask = q.ask ? `${fmt(q.ask.price)} (≤${fmt(q.ask.maxUsdt, 0)} USDT)` : "—";
    console.log(
      `[${new Date(q.ts).toISOString()}] mid ${fmt(q.mid)}  bid ${bid}  ask ${ask}  ` +
        `half ${q.halfSpreadBps.toFixed(1)}bps skew ${q.skewBps.toFixed(1)}bps usdt ${(q.usdtShare * 100).toFixed(0)}%` +
        (q.reason ? `  ! ${q.reason}` : ""),
    );
  }
}

export class FileSink implements QuoteSink {
  constructor(private path: string) {}
  async publish(q: Quote): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(q, null, 2));
    await rename(tmp, this.path); // atomic swap so a reader never sees half a file
  }
}

/**
 * Stitch (Textile's filler bot) does not accept pushed quotes. It polls a
 * `[feed] url` in stitch.toml for `{ price, timestamp, degraded? }`, then
 * applies its own static buy/sell_offset_bps. So we serve the skewed mid
 * (inventory skew moves it) and pause quoting via `degraded` when we would
 * have withdrawn both sides. Timestamp must be integer unix seconds.
 * Stitch's feed price is debt per collateral, i.e. USDT per cNGN (~0.00066),
 * not NGN per USDT, so invert defaults to on (textile-stitch docs/ADVANCED.md).
 */
export class FeedSink implements QuoteSink {
  private body = JSON.stringify({ price: 0, timestamp: 1, degraded: true });
  constructor(port: number, private invert = false, host = "127.0.0.1") {
    createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(this.body);
    }).listen(port, host, () => console.log(`feed on http://${host}:${port}`));
  }
  async publish(q: Quote): Promise<void> {
    const dead = !q.bid && !q.ask;
    const skewed = q.mid * (1 - q.skewBps * 1e-4);
    this.body = JSON.stringify({
      price: this.invert ? 1 / skewed : skewed,
      timestamp: Math.floor(q.ts / 1000),
      degraded: dead,
    });
  }
}
