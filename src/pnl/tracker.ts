import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { formatUnits, getAddress, parseAbiItem, type Address, type PublicClient } from "viem";
import { decimals } from "../inventory/balances.js";

/**
 * Finds our fills straight from the chain, with no dependency on Textile's API.
 *
 * A fill is a transaction in which our wallet both sent one of USDT/cNGN and
 * received the other. Plain deposits, withdrawals and approvals move one token
 * (or none) and are ignored, as are swaps our own wallet sent. Every fill is keyed by its tx hash, which is also
 * what you show judges.
 */

export interface Fill {
  txHash: `0x${string}`;
  ts: number;
  price: number; // NGN per USDT, as printed by Textile
  dUsdt: number; // + received, - sent
  dCngn: number;
  /** true when our own wallet sent the tx (an inventory top-up we took), not a maker fill */
  self?: boolean;
}

export class FillLedger {
  private seen = new Set<string>();
  fills: Fill[] = [];

  constructor(private path: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        const f = JSON.parse(line) as Fill;
        this.fills.push(f);
        this.seen.add(f.txHash);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  has(tx: string): boolean {
    return this.seen.has(tx);
  }

  async add(f: Fill): Promise<void> {
    this.seen.add(f.txHash);
    this.fills.push(f);
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(f) + "\n");
  }

  /** Mark-to-market P&L in USDT versus simply holding the starting inventory. */
  summary(markMid: number, only?: "maker" | "self") {
    let dUsdt = 0;
    let dCngn = 0;
    let volumeUsdt = 0;
    let fills = 0;
    for (const f of this.fills) {
      if (only === "maker" && f.self) continue;
      if (only === "self" && !f.self) continue;
      fills++;
      dUsdt += f.dUsdt;
      dCngn += f.dCngn;
      volumeUsdt += Math.abs(f.dUsdt);
    }
    return { fills, volumeUsdt, netUsdt: dUsdt, netCngn: dCngn, pnlUsdt: dUsdt + dCngn / markMid };
  }
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const CHUNK = 5_000n; // keep getLogs ranges small enough for public RPCs

/** First block whose timestamp is >= ts (Celo blocks are ~1s apart). */
async function firstBlockAtOrAfter(client: PublicClient, ts: number): Promise<bigint> {
  let lo = 0n;
  let hi = await client.getBlockNumber();
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const b = await client.getBlock({ blockNumber: mid });
    if (Number(b.timestamp) < ts) lo = mid + 1n;
    else hi = mid;
  }
  return lo;
}

export class ChainFillScanner {
  private next: bigint | null = null;

  constructor(
    private client: PublicClient,
    private maker: Address,
    private usdt: Address,
    private cngn: Address,
    private ledger: FillLedger,
    private sinceTs: number,
  ) {}

  /** Scans new blocks since the last call and records any fills found. */
  async sync(): Promise<Fill[]> {
    const { client, maker, usdt, cngn } = this;
    if (this.next === null) this.next = await firstBlockAtOrAfter(client, this.sinceTs);
    const head = (await client.getBlockNumber()) - 3n; // stay behind the tip: load-balanced RPC nodes lag
    const [du, dn] = await Promise.all([decimals(client, usdt), decimals(client, cngn)]);

    const flows = new Map<`0x${string}`, { u: bigint; n: bigint; block: bigint }>();
    for (let from = this.next; from <= head; from += CHUNK) {
      const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
      for (const token of [usdt, cngn]) {
        for (const side of ["from", "to"] as const) {
          const logs = await client.getLogs({
            address: token,
            event: TRANSFER,
            args: side === "from" ? { from: maker } : { to: maker },
            fromBlock: from,
            toBlock: to,
          });
          for (const l of logs) {
            const sign = side === "to" ? 1n : -1n;
            // A transfer to ourselves from ourselves nets out, so skip double-counting.
            if (side === "to" && getAddress(l.args.from!) === maker) continue;
            const cur = flows.get(l.transactionHash) ?? { u: 0n, n: 0n, block: l.blockNumber };
            if (token === usdt) cur.u += sign * l.args.value!;
            else cur.n += sign * l.args.value!;
            flows.set(l.transactionHash, cur);
          }
        }
      }
    }
    this.next = head + 1n;

    const added: Fill[] = [];
    for (const [txHash, { u, n, block }] of flows) {
      if (this.ledger.has(txHash)) continue;
      if (u === 0n || n === 0n || (u > 0n) === (n > 0n)) continue; // not a swap
      // A maker fill is submitted by the taker; a swap we sent ourselves is not.
      const tx = await client.getTransaction({ hash: txHash });
      const self = getAddress(tx.from) === maker;
      const dUsdt = Number(formatUnits(u, du));
      const dCngn = Number(formatUnits(n, dn));
      const b = await client.getBlock({ blockNumber: block });
      const f: Fill = { txHash, ts: Number(b.timestamp), price: Math.abs(dCngn / dUsdt), dUsdt, dCngn, self };
      await this.ledger.add(f);
      added.push(f);
    }
    return added;
  }
}
