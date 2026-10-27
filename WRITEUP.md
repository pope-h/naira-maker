# naira-maker: write-up for the Textile FX track

**Agent:** inventory-aware cNGN/USDT maker on Textile FX (Celo mainnet), run through Stitch.
**Wallet:** [`0x8754FE2165C4eA746843EfbBc2455830e19e744B`](https://celoscan.io/address/0x8754FE2165C4eA746843EfbBc2455830e19e744B) · **ERC-8004:** [agent #9995](https://www.8004scan.io/agents/celo/9995) · **Maker ID:** `stitch-42220-8754fe21` · **Code:** this repo.

Stitch signs the RFQ responses. This agent supplies its price feed, and decides when to stop quoting. It has run on a VPS (Docker, feed and Stitch as one stack) since Oct 26, with about $100 of float.

## What is new

1. **The feed is where the risk management lives.** Stitch's spreads are static and it applies no inventory lean to RFQ quotes. We move the *mid* instead: the feed price is the Textile mid shifted by an inventory skew (up to 20 bps) so quotes lean toward the token we are short of, and it flags `degraded` to stop Stitch quoting when we should not.
2. **A rate-shock guard that tolerates a structural premium.** Textile's USDT/NGN sits about 300-360 bps above independent sources (CoinGecko, the official rate), so an independent rate cannot be averaged into the price, and a "sources disagree" halt would fire permanently. We track the *basis* between Textile and CoinGecko, keep a slow time-weighted baseline, and halt when the basis jumps away from it by more than 150 bps. A single spike cannot normalise itself; a lasting move is accepted over time (`src/rates/basis.ts`, 5 tests). It false-tripped once at 60 bps because CoinGecko drifted 65 bps in a day, so the threshold and the baseline speed were retuned. That is kept in the history.
3. **Spread chosen from the book, then tested against takers.** Before pricing the sell side we sampled `/v2/rfq/preview`: rival makers sold cNGN at about 96 bps over mid and only about 15 USDT deep, so one maker with depth had pricing room. We then stepped the sell offset and watched fills (table below). Takers paid about 35 bps over mid (30 bps offset) and about 55 bps (50 bps offset) but did not fill at about 84 bps (70 bps offset) over 1.5 hours, so their limit is between 55 and 84 bps.
4. **Accounting that cannot flatter us.** Fills are read from the chain (USDT/cNGN `Transfer` events), not from Textile's trade API, which returned 502s. Every swap the wallet makes is recorded and labelled *maker fill* (sent by a taker) or *own swap* (sent by us), so inventory top-ups show up as a cost.

## Results (Oct 26 21:29 to Oct 27 11:35 UTC, marked at mid 1388.59 NGN/USDT)

| scope | txs | volume USDT | net USDT | net cNGN | P&L USDT (MTM) |
|---|---|---|---|---|---|
| Maker fills | 8 | 131.90 | +131.90 | -182,173 | **+0.70** |
| Own top-up swaps | 5 | 91.60 | -91.60 | +122,738 | **-3.21** |
| All wallet swaps | 13 | 223.50 | +40.30 | -59,435 | **-2.51** |

All-in, the ledger is **-2.51 USDT on about 100 USDT of float**. The maker fills made **+0.70 USDT**. Nearly all of the loss is five manual top-ups on day one, bought on the app at 1,316-1,373 NGN/USDT while the market was near 1,385 (0.9% to 5% worse than mid). We stopped doing that. Not in the ledger: the off-chain cost of restocking by naira deposit, about 0.7% per loop (offramp about 0.4%, deposit fee about 0.3%), roughly -0.10 USDT on the first ₦42,500 loop.

### Maker fills (all verifiable on Celoscan)

| time (UTC) | tx | USDT in | cNGN out | NGN/USDT |
|---|---|---|---|---|
| Oct 26 21:46 | [`0x5af3a39e…973d`](https://celoscan.io/tx/0x5af3a39efe14bb837dede70f009c22da91514ee56ebc0263ee32f010c064973d) | 18.45 | 25,504 | 1382.67 |
| Oct 26 21:51 | [`0x6b4839a1…916d`](https://celoscan.io/tx/0x6b4839a12e26dc19e4b0eeb0e78ab3367330506568841c162352defde028916d) | 17.60 | 24,323 | 1382.18 |
| Oct 26 21:56 | [`0x10c97374…8551`](https://celoscan.io/tx/0x10c973746d18b27566da11273763833373080319c1fcd7c74373ed9d8bcd8551) | 17.59 | 24,304 | 1381.43 |
| Oct 26 22:00 | [`0x22b54888…be06`](https://celoscan.io/tx/0x22b54888b67667d0fe9b1ca208f98e6a662822b1ed507ca489535ffbcc51be06) | 17.96 | 24,800 | 1381.19 |
| Oct 26 22:02 | [`0xdb1dab03…9694`](https://celoscan.io/tx/0xdb1dab03d047b07e88f727e88664538da0f59ebf2cbe8a9c0adfff55b42e9694) | 17.98 | 24,782 | 1378.63 |
| Oct 27 09:14 | [`0xbc0bf1ac…f8b8`](https://celoscan.io/tx/0xbc0bf1ace53198b06c055aa5cea27211f9026ca4b144f4a45cc9be881d4cf8b8) | 11.25 | 15,545 | 1381.94 |
| Oct 27 09:15 | [`0x02c7f016…d783`](https://celoscan.io/tx/0x02c7f01676d4ef18f0df44e0516e0ed3060bfc58dd1a7f109033c7bff75fd783) | 19.83 | 27,387 | 1380.94 |
| Oct 27 11:35 | [`0x51052b67…7c1d`](https://celoscan.io/tx/0x51052b670d84d1729ef82e74c92f72f8647277f54ee22435196a6a4f12b87c1d) | 11.25 | 15,528 | 1380.39 |

### Own top-up swaps (counted as cost)

| time (UTC) | tx | USDT out | cNGN in | NGN/USDT |
|---|---|---|---|---|
| Oct 26 21:29 | [`0x9b6dac32…f675`](https://celoscan.io/tx/0x9b6dac32f51fe89dee63a8f9c0af415332354a6570bbec4f8abc87ceeac7f675) | 18.58 | 25,507 | 1372.81 |
| Oct 26 21:51 | [`0xd5482d7a…f71a`](https://celoscan.io/tx/0xd5482d7ad7a1b8e423aa2e2b550ad0184fbcc27b0940767ef5991807cdeff71a) | 18.07 | 24,807 | 1372.81 |
| Oct 26 21:55 | [`0x3eeaf502…993a`](https://celoscan.io/tx/0x3eeaf502d89e0abc872aee3a1efb0e1058d3b645c407cf5c85efb9cd6cba993a) | 18.07 | 23,837 | 1319.14 |
| Oct 26 21:59 | [`0x83037bbe…0400`](https://celoscan.io/tx/0x83037bbef5572efa61bd60bccb9dd61130ccd88fa715b41ea1d0312541390400) | 18.44 | 24,305 | 1318.06 |
| Oct 26 22:02 | [`0x51b95699…fca4`](https://celoscan.io/tx/0x51b956998cde49e9b799573de2775279081225b0ec3fe370710579616e45fca4) | 18.44 | 24,282 | 1316.82 |

### Sell-offset experiment

| from (UTC) | sell offset | taker premium to mid | outcome |
|---|---|---|---|
| Oct 26 21:45 | 2 bps | about 5 bps | 5 fills in 16 minutes |
| Oct 26 22:09 | 30 bps | about 35 bps | 2 fills, Oct 27 09:14-09:15 |
| Oct 27 09:42 | 70 bps | about 84 bps (incl. skew) | 0 fills in about 1.5 h with cNGN in stock |
| Oct 27 11:19 | 50 bps | about 55 bps | filled 16 minutes later |

## Limits, stated plainly

- **Spreads are static.** Volatility-driven widening exists in the engine but cannot reach Stitch live; only the skew (via the feed) and the halt do.
- **The buy side has not filled once.** Takers sell little cNGN here; flow is almost all takers buying it.
- **Inventory is the hard problem.** cNGN is scarce, and sourcing it by offramp and deposit costs about as much as the sell margin earns. The sell side stops when cNGN runs out. At this size the strategy is roughly break-even, not profitable.
- **Small float, short run.** Sixteen hours and $100. These results show the design works and what the corridor looks like, not what it earns at scale.
- **One independent price source**, and it is noisy.
- **Attribution tags:** Stitch does not tag, and maker fills are taker-submitted, so our tag is not in them. Per Textile, scoring for this track does not use tags.

## Check it yourself

- Fills: the Celoscan links above, or `npm run pnl` (reads `data/fills.jsonl`, rebuilt from chain transfers by `ChainFillScanner` in `src/pnl/tracker.ts`).
- Pricing and guard: `src/pricing/engine.ts`, `src/rates/basis.ts`, `test/` (`npm test`).
- Deploy: `docker-compose.yml`, `stitch.example.toml` (no keys in the repo).
