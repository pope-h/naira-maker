# naira-maker: write-up for the Textile FX track

**Agent:** cNGN/USDT maker on Textile FX (Celo mainnet), run through Stitch.
**Wallet:** [`0x8754FE2165C4eA746843EfbBc2455830e19e744B`](https://celoscan.io/address/0x8754FE2165C4eA746843EfbBc2455830e19e744B) · **ERC-8004:** [agent #9995](https://www.8004scan.io/agents/celo/9995) · **Maker ID:** `stitch-42220-8754fe21` · **Code:** this repo.

Stitch signs the RFQ responses. This agent supplies its price feed and decides when to stop quoting. It has run on a VPS (Docker, feed and Stitch as one stack) since Oct 26 with about $100 of float, 12 days at the time of writing, and was never taken offline except for the redeploys listed below.

## What is new

1. **The feed is where the risk management lives.** Stitch's spreads are static and it applies no inventory lean to RFQ quotes. So the feed carries the logic: it publishes the Textile mid, and it flags `degraded` to stop Stitch quoting when we should not.
2. **A rate-shock guard that tolerates a structural premium.** Textile's USDT/NGN sits about 300-360 bps above independent sources (CoinGecko, the official rate), so an independent rate cannot be averaged into the price, and a "sources disagree" halt would fire permanently. We track the *basis* between Textile and CoinGecko, keep a slow time-weighted baseline, and halt when the basis jumps away from it by more than 150 bps. A single spike cannot normalise itself; a lasting move is accepted over time (`src/rates/basis.ts`, 5 tests). It false-tripped once at 60 bps because CoinGecko drifted 65 bps in a day, so the threshold and the baseline speed were retuned. That is kept in the history.
3. **Spread chosen from the book, then tested against takers.** Before pricing the sell side we sampled `/v2/rfq/preview`: rival makers sold cNGN at about 96 bps over mid and only about 15 USDT deep, so one maker with depth had pricing room. We then stepped the sell offset and watched fills (table below). Takers paid about 35 bps over mid (30 bps offset) and about 55 bps (50 bps offset) but did not fill at about 84 bps (70 bps offset) over 1.5 hours, so their limit is between 55 and 84 bps.
4. **Accounting that cannot flatter us.** Fills are read from the chain (USDT/cNGN `Transfer` events), not from Textile's trade API, which returned 502s. Every swap the wallet makes is recorded and labelled *maker fill* (sent by a taker) or *own swap* (sent by us), so inventory top-ups show up as a cost. Dust probes (see below) are kept in the ledger and reported separately.
5. **A failure we found, measured, and fixed (Nov 5-7).** The first version leaned the price by up to 20 bps toward the token we were short of. On a $100 wallet one fill can empty a whole side, so the lean flipped sign and the price swung about 40 bps within two minutes. A taker used it: it bought all 131,565 cNGN from us, then 27 seconds later sold 131,138 back at a price that had moved. Four more round trips followed within an hour, 510 USDT of volume in total and **-0.47 USDT** to us. We removed the skew (`MAX_SKEW_BPS=0`) and the next fill was clean. The lesson: inventory skew needs inventory deep enough that one fill cannot flip it, or it becomes a free option for arbitrage takers.
6. **Resilience to a thin book.** Textile's order book sometimes has only one side, which leaves no mid. The feed now reuses the last good mid for up to 60 seconds, then fails closed (`src/rates/hold.ts`, 5 tests). Longer gaps still stop quoting, which is the intended behaviour.

## Results (Oct 26 21:29 to Nov 7 22:59 UTC, marked at mid 1377.25 NGN/USDT)

| scope | txs | volume USDT | net USDT | net cNGN | P&L USDT (MTM) |
|---|---|---|---|---|---|
| Maker fills (excluding dust) | 17 | 745.13 | +40.06 | -55,728 | **-0.40** |
| Maker dust probes | 11 | 0.01 | -0.01 | +13 | 0.00 |
| Own top-up swaps | 5 | 91.60 | -91.60 | +122,738 | **-2.48** |
| All wallet swaps | 33 | 836.74 | -51.55 | +67,022 | **-2.89** |

All-in, the ledger is **-2.89 USDT on about 100 USDT of float**. Where it came from, at the same mark:

- **-2.48:** five manual top-ups on day one, bought on the app at 1,316-1,373 NGN/USDT while the market was near 1,385 (0.9% to 5% worse than mid). We stopped doing that.
- **-0.47:** the Nov 5 round-trip burst described above (7 fills).
- **+0.07:** every other maker fill together (Oct 26-27, Nov 7), so the maker side outside the burst is about break-even.
- **Mark-dependent:** P&L is marked to the current mid and moves with it. On Oct 27 at mid 1388.59 the first eight sell fills showed +0.70; at 1377.25 they are worth less, because the cNGN we sold is now worth more USDT.
- **Not in the ledger:** the off-chain cost of restocking by naira deposit, about 0.7% per loop (offramp about 0.4%, deposit fee about 0.3%), roughly -0.10 USDT on the first ₦42,500 loop.

### Maker fills (all verifiable on Celoscan)

| time (UTC) | tx | USDT | cNGN | NGN/USDT |
|---|---|---|---|---|
| Oct 26 21:46 | [`0x5af3a39e…973d`](https://celoscan.io/tx/0x5af3a39efe14bb837dede70f009c22da91514ee56ebc0263ee32f010c064973d) | +18.45 | -25,504 | 1382.67 |
| Oct 26 21:51 | [`0x6b4839a1…916d`](https://celoscan.io/tx/0x6b4839a12e26dc19e4b0eeb0e78ab3367330506568841c162352defde028916d) | +17.60 | -24,323 | 1382.18 |
| Oct 26 21:56 | [`0x10c97374…8551`](https://celoscan.io/tx/0x10c973746d18b27566da11273763833373080319c1fcd7c74373ed9d8bcd8551) | +17.59 | -24,304 | 1381.43 |
| Oct 26 22:00 | [`0x22b54888…be06`](https://celoscan.io/tx/0x22b54888b67667d0fe9b1ca208f98e6a662822b1ed507ca489535ffbcc51be06) | +17.96 | -24,800 | 1381.19 |
| Oct 26 22:02 | [`0xdb1dab03…9694`](https://celoscan.io/tx/0xdb1dab03d047b07e88f727e88664538da0f59ebf2cbe8a9c0adfff55b42e9694) | +17.98 | -24,782 | 1378.63 |
| Oct 27 09:14 | [`0xbc0bf1ac…f8b8`](https://celoscan.io/tx/0xbc0bf1ace53198b06c055aa5cea27211f9026ca4b144f4a45cc9be881d4cf8b8) | +11.25 | -15,545 | 1381.94 |
| Oct 27 09:15 | [`0x02c7f016…d783`](https://celoscan.io/tx/0x02c7f01676d4ef18f0df44e0516e0ed3060bfc58dd1a7f109033c7bff75fd783) | +19.83 | -27,387 | 1380.94 |
| Oct 27 11:35 | [`0x51052b67…7c1d`](https://celoscan.io/tx/0x51052b670d84d1729ef82e74c92f72f8647277f54ee22435196a6a4f12b87c1d) | +11.25 | -15,528 | 1380.39 |
| Oct 27 13:01 | [`0x7864294f…4527`](https://celoscan.io/tx/0x7864294f9d0dab9f71d5d18ab344bc17f938399c25f00470cf0ad694c1474527) | -91.84 | +127,090 | 1383.82 |
| Nov 5 22:12 | [`0x62a9c7d0…1032`](https://celoscan.io/tx/0x62a9c7d0bf377f82752449b2db3d52796845a62dc39f788d786872a039f61032) | +95.49 | -131,565 | 1377.81 |
| Nov 5 22:12 | [`0x9213c408…c30de`](https://celoscan.io/tx/0x9213c40833f431a7f08a7a0472b4dac62b6999bc14f94634ead9b12f42dc30de) | -95.48 | +131,138 | 1373.48 |
| Nov 5 22:46 | [`0xf662c62a…9f3f`](https://celoscan.io/tx/0xf662c62ad81bc9a86938e48f2ed4ac73f3e0d9082c83d5674598c04e381d9f3f) | +70.04 | -96,431 | 1376.71 |
| Nov 5 22:47 | [`0x840b47f0…08bf`](https://celoscan.io/tx/0x840b47f09bbd1e1857773cead7421cdd607d6b8a51b8c972ee417712304708bf) | -70.05 | +96,311 | 1374.96 |
| Nov 5 22:48 | [`0x43349c0f…37ed`](https://celoscan.io/tx/0x43349c0f0ad8b91a315412bf36c82d20459a9e7d472e6e08e6a51400dd0837ed) | +95.17 | -131,019 | 1376.71 |
| Nov 5 22:48 | [`0xe4d46a9a…0d66`](https://celoscan.io/tx/0xe4d46a9ad0b8d5be048770d22911d32a0775f8650d40c858b447fdb3a5b70d66) | -50.06 | +68,792 | 1374.24 |
| Nov 5 22:49 | [`0xf8ac9be0…87bc`](https://celoscan.io/tx/0xf8ac9be033596a6e82dd277429425ff231eeeea1f090024f2df601ceaad287bc) | -33.73 | +46,440 | 1376.91 |
| Nov 7 22:59 | [`0x0eb5b474…a829`](https://celoscan.io/tx/0x0eb5b47479094fbb9d8ca5d61e40a879d83dd6e0cb9f5c82d5801d7f481ea829) | -11.39 | +15,688 | 1377.77 |

USDT is from our wallet's side: positive means we sold cNGN and received USDT. The Nov 5 rows are the round-trip burst; the last row is the first fill after the skew was switched off.

### Dust probes

Eleven transactions moved 1-2 cNGN and about 0 USDT: Oct 30 (2), Nov 4 (8, between 06:34 and 08:32 UTC) and Nov 6 (1). They are not economically meaningful and look like a third party testing the quote. They are in `data/fills.jsonl` and in `npm run pnl`, and we do not count them as trading volume.

### Own top-up swaps (counted as cost)

| time (UTC) | tx | USDT out | cNGN in | NGN/USDT |
|---|---|---|---|---|
| Oct 26 21:29 | [`0x9b6dac32…f675`](https://celoscan.io/tx/0x9b6dac32f51fe89dee63a8f9c0af415332354a6570bbec4f8abc87ceeac7f675) | 18.58 | 25,507 | 1372.81 |
| Oct 26 21:51 | [`0xd5482d7a…f71a`](https://celoscan.io/tx/0xd5482d7ad7a1b8e423aa2e2b550ad0184fbcc27b0940767ef5991807cdeff71a) | 18.07 | 24,807 | 1372.81 |
| Oct 26 21:55 | [`0x3eeaf502…993a`](https://celoscan.io/tx/0x3eeaf502d89e0abc872aee3a1efb0e1058d3b645c407cf5c85efb9cd6cba993a) | 18.07 | 23,837 | 1319.14 |
| Oct 26 21:59 | [`0x83037bbe…0400`](https://celoscan.io/tx/0x83037bbef5572efa61bd60bccb9dd61130ccd88fa715b41ea1d0312541390400) | 18.44 | 24,305 | 1318.06 |
| Oct 26 22:02 | [`0x51b95699…fca4`](https://celoscan.io/tx/0x51b956998cde49e9b799573de2775279081225b0ec3fe370710579616e45fca4) | 18.44 | 24,282 | 1316.82 |

### Spread experiment

| from (UTC) | sell offset | taker premium to mid | outcome |
|---|---|---|---|
| Oct 26 21:45 | 2 bps | about 10-30 bps | 5 fills in 16 minutes |
| Oct 26 22:09 | 30 bps | about 35 bps | 2 fills, Oct 27 09:14-09:15 |
| Oct 27 09:42 | 70 bps | about 84 bps (incl. skew) | 0 fills in about 1.5 h with cNGN in stock |
| Oct 27 11:19 | 50 bps | about 55 bps | filled 16 minutes later; then one buy fill and a quiet week (Textile's 24h volume on the pair was 0 on Nov 5-6) |
| Nov 5 21:55 | 20 bps, skew on | within about 20 bps of mid | 7 fills, 510 USDT in 40 minutes, but the skew was exploited: -0.47 USDT |
| Nov 7 08:25 | 20 bps, skew off | within about 20 bps of mid | 1 clean buy fill (11.39 USDT) in 38 hours |

## Limits, stated plainly

- **Spreads are static.** Volatility-driven widening exists in the engine but cannot reach Stitch live; only the feed price and the halt do.
- **The agent was exploited once by its own skew.** The cost was small (-0.47 USDT) because the float is small. At scale the same flaw would cost more. It is fixed, not hidden.
- **Inventory is the hard problem.** cNGN is scarce, and sourcing it by offramp and deposit costs about as much as the sell margin earns. The sell side stops when cNGN runs out. At this size the strategy is roughly break-even, not profitable.
- **Flow is lumpy and mostly sold into one side.** 11 of the 17 real fills were takers buying cNGN from us. The other 6 were takers selling it to us, in large clips that emptied our USDT.
- **Small float, short run.** About 12 days and $100, with most of the real volume in two bursts (Oct 26-27 and Nov 5). These results show the design works and what the corridor looks like, not what it earns at scale.
- **One independent price source**, and it is noisy.
- **Attribution tags:** Stitch does not tag, and maker fills are taker-submitted, so our tag is not in them. Per Textile, scoring for this track reads the agent wallet and does not use tags.

## Check it yourself

- Fills: the Celoscan links above, or `npm run pnl` (reads `data/fills.jsonl`, rebuilt from chain transfers by `ChainFillScanner` in `src/pnl/tracker.ts`).
- Pricing and guard: `src/pricing/engine.ts`, `src/rates/basis.ts`, `src/rates/hold.ts`, `test/` (`npm test`, 19 tests).
- Deploy: `docker-compose.yml`, `stitch.example.toml` (no keys in the repo).
