# naira-maker

An inventory-aware quoting agent for the **cNGN/USDT** corridor on [Textile FX](https://app.textilecredit.com), Celo mainnet.
Built for **Agents on Open Rails** · Track 2a (Open Corridors × Textile).

Most makers on Textile quote a fixed spread. This agent prices from a multi-source reference rate and adjusts every few seconds for:

- **Inventory skew:** holding too much USDT moves both quotes down so normal flow rebalances the book, no separate rebalancing trade.
- **Volatility:** the spread widens when the naira mid moves fast, and tightens again when it calms.
- **Rate-shock guard:** Textile's USDT/NGN sits at a structural premium (~360 bps today) to independent sources such as CoinGecko, so an independent rate can't set the price or be averaged in. We track the basis between the two instead, keep a slow time-weighted baseline, and stop quoting when the basis jumps away from it (official vs parallel rate shock, or Textile's own book being pushed). One spike doesn't normalise itself. See `src/rates/basis.ts` and `test/basis.test.ts`.
- **Size limits:** never offers more than it can actually fill, since Textile quotes are all-or-nothing.

## Status

| Part | State |
|---|---|
| Reference rate from Textile's public feed | done |
| Pricing engine (skew, vol, divergence, sizing) + tests | done |
| On-chain inventory read (viem, Celo) | done |
| Fill detection + mark-to-market P&L from tx receipts | done |
| Price feed for Stitch (`QUOTE_SINK=feed`, USDT per cNGN, `degraded` on halt) | done — see `stitch.example.toml` |
| Stitch install, `stitch connect`, `stitch approve`, go live | TODO (operator steps) |
| Independent rate-shock guard (CoinGecko USDT/NGN, configurable via `REF_URL`) | done |

## Run

```bash
npm install
cp .env.example .env     # fill MAKER_ADDRESS, CNGN_ADDRESS, CELO_RPC_URL
npm test                 # pricing engine tests
npm run quote:once       # one pricing tick
npm start                # loop; prints quotes, syncs fills every 30s
npm run pnl              # P&L summary + fills table with CeloScan links
```

Without a wallet configured it runs in dry-run mode with a balanced 300 USDT inventory.

## Going live with Stitch

Textile makers don't push quotes: the Stitch bot polls our feed, applies a static spread and signs RFQ responses.

1. Set `QUOTE_SINK=feed`, `npm start` (serves `http://127.0.0.1:8787`).
2. Install Stitch, copy `stitch.example.toml` to `stitch.toml`, use a dedicated hot wallet.
3. `stitch approve`, then `stitch connect` (confirm the email link; get onboarding from contact@textilecredit.com).
4. `stitch register --config stitch.toml --dry-run`, then without `--dry-run` to mint the ERC-8004 identity (~0.09 CELO).
5. `stitch --dry-run`, then start live with small caps.

Limits: Stitch's spread offsets are static, so inventory skew flows through the feed price while volatility/divergence halts pause quoting via `degraded`. Spread widening is not live.

## Deploy (Docker, `/opt/naira-maker`)

`docker-compose.yml` runs the feed and Stitch together (Stitch shares the feed's network because it only accepts a plain-http feed on localhost). Put `.env`, and `stitch/{stitch.toml,stitch.key,rfq-api.key}` on the server, then `docker compose up -d --build`. After changing the feed, always `docker compose up -d --force-recreate` both services: Stitch shares the feed's network and goes blind if only the feed is recreated.
With an `--exact` Permit2 approval Stitch refuses to start once fills use up the allowance: re-run `stitch approve --exact` (see the compose file for the image and mounts).

## How P&L is measured

The public trade feed doesn't name the maker, so for every new trade on `USDT_NGN` the tracker reads the transaction receipt and keeps the ones with USDT/cNGN `Transfer` events to or from `MAKER_ADDRESS`. P&L is the net token change marked to the current mid:

```
pnl_usdt = Σ ΔUSDT + (Σ ΔcNGN) / mid_now
```

Fills are written to `data/fills.jsonl`, keyed by tx hash.

**Update:** fills are now read straight from the chain (`ChainFillScanner` in `src/pnl/tracker.ts`), not from Textile's trades API. A fill is a tx where our wallet sent one of USDT/cNGN and received the other, sent by someone else. Swaps our own wallet sends (inventory top-ups) are excluded. `FILLS_SINCE` sets where scanning starts.

## Hackathon checklist (deadline Mon Nov 9, 09:00 GMT)

- [ ] Register at loops.house/agents-on-open-rails with this public repo
- [x] Register an ERC-8004 Agent ID (agent #9995, https://www.8004scan.io/agents/celo/9995) for the maker (`stitch register`, Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`)
- [ ] Attribution (ERC-8021, `@celo/attribution-tags`): the taker submits the settlement tx, and Textile builder codes are taker-side, so ask DevRel how a maker is credited
- [ ] Ask whether *quoted* volume counts, or only filled
- [x] Feed for Stitch built; [ ] run Stitch live with small inventory
- [ ] Add at least one independent reference rate
- [ ] Record P&L + volume daily; final `npm run pnl` table in the submission
- [ ] 2–3 min demo video: pricing reacting to skew / volatility, live fills on CeloScan

## Risk

This quotes real money. Fund the maker wallet like a float, not a treasury. Start with a few hundred dollars per side and widen `BASE_HALF_SPREAD_BPS` until fills look healthy.
