import type { Config } from "../config.js";
import { getTicker, tickerMid } from "./textile.js";

export interface RateReading {
  source: string;
  mid: number; // NGN per USDT
}

export interface Reference {
  mid: number; // median across sources
  dispersionBps: number; // (max - min) / mid, in bps
  readings: RateReading[];
  failures: string[];
}

function pick(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), obj);
}

async function external(cfg: Config): Promise<RateReading | null> {
  const { url, field, name } = cfg.externalRef;
  if (!url || !field) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name} ${res.status}`);
  const v = Number(pick(await res.json(), field));
  if (!(v > 0)) throw new Error(`${name}: field ${field} is not a positive number`);
  return { source: name, mid: v };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Builds a reference mid from every configured source.
 *
 * Caveat: Textile's own mid already contains other makers' quotes, so using it
 * alone means following the crowd. Add at least one independent source
 * (Quidax, Binance P2P, Monierate...) via REF_URL / REF_FIELD, or add more
 * sources here, before trusting the strategy with real size.
 */
export async function getReference(cfg: Config): Promise<Reference> {
  const readings: RateReading[] = [];
  const failures: string[] = [];

  const jobs: Array<Promise<RateReading | null>> = [
    getTicker(cfg.textileApi, cfg.tickerId).then((t) => {
      const mid = tickerMid(t);
      return mid ? { source: "textile", mid } : null;
    }),
    external(cfg),
  ];

  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === "fulfilled" && r.value) readings.push(r.value);
    else if (r.status === "rejected") failures.push(String(r.reason));
  }

  if (readings.length === 0) throw new Error(`No reference rate available: ${failures.join("; ")}`);
  const mids = readings.map((r) => r.mid);
  const mid = median(mids);
  const dispersionBps = ((Math.max(...mids) - Math.min(...mids)) / mid) * 1e4;
  return { mid, dispersionBps, readings, failures };
}
