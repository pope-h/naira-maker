import "dotenv/config";
import { getAddress, isAddress, type Address } from "viem";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw.split("#")[0].trim());
  if (!Number.isFinite(v)) throw new Error(`${name} must be a number, got "${raw}"`);
  return v;
}

function str(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).split("#")[0].trim();
}

function addr(name: string): Address | undefined {
  const v = str(name);
  if (!v) return undefined;
  if (!isAddress(v)) throw new Error(`${name} is not a valid address: ${v}`);
  return getAddress(v);
}

export const config = {
  rpcUrl: str("CELO_RPC_URL", "https://forno.celo.org"),
  makerAddress: addr("MAKER_ADDRESS"),
  usdt: addr("USDT_ADDRESS"),
  cngn: addr("CNGN_ADDRESS"),

  textileApi: "https://api.textilecredit.com",
  tickerId: "USDT_NGN",

  pricing: {
    baseHalfSpreadBps: num("BASE_HALF_SPREAD_BPS", 2.5),
    maxSkewBps: num("MAX_SKEW_BPS", 8),
    volWidenMult: num("VOL_WIDEN_MULT", 0.5),
    maxVolWidenBps: num("MAX_VOL_WIDEN_BPS", 15),
    divergenceHaltBps: num("DIVERGENCE_HALT_BPS", 60),
    targetUsdtShare: num("TARGET_USDT_SHARE", 0.5),
    maxSizeShare: num("MAX_SIZE_SHARE", 0.9),
  },

  loop: {
    intervalMs: num("QUOTE_INTERVAL_MS", 3000),
    sink: str("QUOTE_SINK", "console") as "console" | "file" | "feed",
    feedPort: num("FEED_PORT", 8787),
    feedHost: str("FEED_HOST", "127.0.0.1"), // 0.0.0.0 only inside the Docker network
    feedInvert: str("FEED_INVERT", "1") !== "0", // Stitch wants USDT per cNGN
    quoteFile: str("QUOTE_FILE", "./data/levels.json"),
  },

  // Only count fills at/after this unix time, so manual top-up swaps never enter the ledger.
  fillsSince: num("FILLS_SINCE", 0),

  externalRef: {
    // Independent USDT/NGN source, used only as a rate-shock guard (see src/rates/basis.ts).
    url: str("REF_URL") || "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=ngn",
    field: str("REF_FIELD") || "tether.ngn",
    name: str("REF_NAME") || "coingecko",
  },
} as const;

export type Config = typeof config;
