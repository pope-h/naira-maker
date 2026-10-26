/**
 * Textile FX public rates feed (no auth, GET only).
 * Docs: https://docs.textilecredit.com/api/rates
 *
 * Conventions (from the docs):
 *  - USDT_NGN last_price/bid/ask are NGN per USDT.
 *  - bid/ask are what a ~100 USDT trade clears at right now, net of fees.
 *  - "0" means nobody is quoting that side.
 *  - historical_trades.trade_id = "<txHash>-<logIndex>".
 */

export interface Ticker {
  ticker_id: string;
  base_currency: string;
  target_currency: string;
  last_price: string;
  base_volume: string;
  target_volume: string;
  bid: string;
  ask: string;
  high: string;
  low: string;
}

export interface Trade {
  trade_id: string;
  price: string;
  base_volume: string;
  target_volume: string;
  trade_timestamp: number;
  type: "buy" | "sell";
}

export async function getTicker(api: string, tickerId: string): Promise<Ticker> {
  const res = await fetch(`${api}/tickers?ticker_id=${encodeURIComponent(tickerId)}`);
  if (!res.ok) throw new Error(`Textile /tickers ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as Ticker[];
  const t = body.find((x) => x.ticker_id === tickerId);
  if (!t) throw new Error(`Textile /tickers: ${tickerId} not in response`);
  return t;
}

/** Mid of the live book, or null if either side is empty. */
export function tickerMid(t: Ticker): number | null {
  const bid = Number(t.bid);
  const ask = Number(t.ask);
  if (!(bid > 0) || !(ask > 0)) return null;
  return (bid + ask) / 2;
}

export async function getTrades(
  api: string,
  tickerId: string,
  opts: { startTime?: number; endTime?: number; limit?: number } = {},
): Promise<Trade[]> {
  const q = new URLSearchParams({ ticker_id: tickerId });
  if (opts.startTime !== undefined) q.set("start_time", String(opts.startTime));
  if (opts.endTime !== undefined) q.set("end_time", String(opts.endTime));
  q.set("limit", String(opts.limit ?? 1000));
  const res = await fetch(`${api}/historical_trades?${q}`);
  if (!res.ok) throw new Error(`Textile /historical_trades ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { buy: Trade[]; sell: Trade[] };
  return [...body.buy, ...body.sell].sort((a, b) => a.trade_timestamp - b.trade_timestamp);
}

/** "0xabc...-7" -> "0xabc..." */
export function txHashOf(tradeId: string): `0x${string}` {
  return tradeId.split("-")[0] as `0x${string}`;
}
