import { config } from "../config.js";
import { getReference } from "../rates/index.js";
import { FillLedger } from "./tracker.js";

/** Prints the P&L summary and per-fill table for your README / demo video. */
async function main() {
  const ledger = new FillLedger("./data/fills.jsonl");
  await ledger.load();
  const { mid } = await getReference(config);
  console.log(`Marked at mid ${mid.toFixed(2)} NGN/USDT\n`);
  console.log("| scope | txs | volume USDT | net USDT | net cNGN | P&L USDT (MTM) |");
  console.log("|---|---|---|---|---|---|");
  for (const [label, only] of [["All wallet swaps", undefined], ["Maker fills (taker-sent)", "maker"], ["Own top-up swaps", "self"]] as const) {
    const s = ledger.summary(mid, only);
    console.log(`| ${label} | ${s.fills} | ${s.volumeUsdt.toFixed(2)} | ${s.netUsdt.toFixed(4)} | ${s.netCngn.toFixed(2)} | ${s.pnlUsdt.toFixed(4)} |`);
  }
  console.log();

  const days = new Map<string, { fills: number; vol: number; dUsdt: number; dCngn: number }>();
  for (const f of ledger.fills) {
    const d = new Date(f.ts * 1000).toISOString().slice(0, 10);
    const r = days.get(d) ?? { fills: 0, vol: 0, dUsdt: 0, dCngn: 0 };
    r.fills++; r.vol += Math.abs(f.dUsdt); r.dUsdt += f.dUsdt; r.dCngn += f.dCngn;
    days.set(d, r);
  }
  console.log("| day (UTC) | fills | volume USDT | P&L USDT (MTM) |");
  console.log("|---|---|---|---|");
  for (const [d, r] of [...days].sort()) {
    console.log(`| ${d} | ${r.fills} | ${r.vol.toFixed(2)} | ${(r.dUsdt + r.dCngn / mid).toFixed(4)} |`);
  }
  console.log();

  console.log("| time (UTC) | tx | type | ΔUSDT | ΔcNGN | price |");
  console.log("|---|---|---|---|---|---|");
  for (const f of ledger.fills) {
    const t = new Date(f.ts * 1000).toISOString().replace("T", " ").slice(0, 19);
    console.log(`| ${t} | [${f.txHash.slice(0, 10)}…](https://celoscan.io/tx/${f.txHash}) | ${f.self ? "own swap" : "maker fill"} | ${f.dUsdt.toFixed(2)} | ${f.dCngn.toFixed(0)} | ${f.price} |`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
