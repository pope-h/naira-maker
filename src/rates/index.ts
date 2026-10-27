import type { Config } from "../config.js";
import { getTicker, tickerMid } from "./textile.js";
import { BasisGuard } from "./basis.js";

export interface RateReading {
  source: string;
  mid: number; // NGN per USDT
}

export interface Reference {
  mid: number; // Textile mid: the independent source guards it but never sets the price
  dispersionBps: number; // deviation of the Textile/independent basis from its baseline, in bps
  basisBps?: number;
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

const guard = new BasisGuard();
const INDEPENDENT_TTL_MS = 60_000; // free APIs rate-limit, and the basis moves slowly
let cached: { at: number; reading: RateReading } | null = null;

async function independent(cfg: Config): Promise<RateReading | null> {
  if (cached && Date.now() - cached.at < INDEPENDENT_TTL_MS) return cached.reading;
  const r = await external(cfg);
  if (r) cached = { at: Date.now(), reading: r };
  return r;
}

/**
 * Textile's mid is the price we quote from. It already contains other makers'
 * quotes and sits at a premium to the official and international rates, so an
 * independent source is used only as a shock detector (see BasisGuard), never
 * averaged into the price. If the independent source is unavailable we keep
 * quoting from Textile alone and report the failure.
 */
export async function getReference(cfg: Config): Promise<Reference> {
  const readings: RateReading[] = [];
  const failures: string[] = [];

  const [t, ind] = await Promise.allSettled([
    getTicker(cfg.textileApi, cfg.tickerId).then((x) => tickerMid(x)),
    independent(cfg),
  ]);
  if (t.status !== "fulfilled" || !t.value) {
    throw new Error(`No Textile reference rate: ${t.status === "rejected" ? String(t.reason) : "no two-sided quote"}`);
  }
  const mid = t.value;
  readings.push({ source: "textile", mid });

  let dispersionBps = 0;
  let basisBps: number | undefined;
  if (ind.status === "rejected") failures.push(String(ind.reason));
  else if (ind.value) {
    readings.push(ind.value);
    const b = guard.push(mid, ind.value.mid, Date.now());
    dispersionBps = b.deviationBps;
    basisBps = b.basisBps;
  }
  return { mid, dispersionBps, basisBps, readings, failures };
}
