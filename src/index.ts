import { config } from "./config.js";
import { getReference } from "./rates/index.js";
import { buildQuote, VolTracker, type Inventory } from "./pricing/engine.js";
import { makeClient, readInventory } from "./inventory/balances.js";
import { ConsoleSink, FeedSink, FileSink, type QuoteSink } from "./maker/sink.js";
import { ChainFillScanner, FillLedger, type Fill } from "./pnl/tracker.js";

const once = process.argv.includes("--once");

// Dry-run inventory used until MAKER_ADDRESS and CNGN_ADDRESS are set.
const DRY_INVENTORY_USDT = 300;

async function main() {
  const live = Boolean(config.makerAddress && config.usdt && config.cngn);
  const client = makeClient(config.rpcUrl);
  const sink: QuoteSink =
    config.loop.sink === "feed" ? new FeedSink(config.loop.feedPort, config.loop.feedInvert, config.loop.feedHost)
    : config.loop.sink === "file" ? new FileSink(config.loop.quoteFile)
    : new ConsoleSink();
  const vol = new VolTracker();
  const ledger = new FillLedger("./data/fills.jsonl");
  await ledger.load();
  const startedAt = Math.floor(Date.now() / 1000);
  const scanner = live
    ? new ChainFillScanner(client, config.makerAddress!, config.usdt!, config.cngn!, ledger, config.fillsSince || startedAt - 3600)
    : null;
  let lastSync = 0;

  if (!live) {
    console.log(
      `DRY RUN: set MAKER_ADDRESS, USDT_ADDRESS and CNGN_ADDRESS in .env to read real inventory.\n` +
        `Using a balanced ${DRY_INVENTORY_USDT} USDT-equivalent inventory for now.\n`,
    );
  }

  const tick = async () => {
    const ref = await getReference(config);
    for (const f of ref.failures) console.warn(`  rate source failed: ${f}`);
    const volBps = vol.push(ref.mid);

    const inv: Inventory = live
      ? await readInventory(client, config.makerAddress!, config.usdt!, config.cngn!)
      : { usdt: DRY_INVENTORY_USDT / 2, cngn: (DRY_INVENTORY_USDT / 2) * ref.mid };

    const q = buildQuote({ mid: ref.mid, dispersionBps: ref.dispersionBps, volBps }, inv, config.pricing);
    await sink.publish(q);

    // Fill sync every ~30s, not every tick: it reads receipts per trade.
    if (scanner && Date.now() - lastSync > 30_000) {
      lastSync = Date.now();
      let added: Fill[] = [];
      try {
        added = await scanner!.sync();
      } catch (e) {
        console.warn(`  fill sync failed, will retry: ${(e as Error).message}`);
      }
      for (const f of added) {
        console.log(`  FILL ${f.txHash}  ΔUSDT ${f.dUsdt.toFixed(2)}  ΔcNGN ${f.dCngn.toFixed(0)} @ ${f.price}`);
      }
      if (added.length) {
        const s = ledger.summary(ref.mid);
        console.log(`  P&L ${s.pnlUsdt.toFixed(4)} USDT over ${s.fills} fills, ${s.volumeUsdt.toFixed(2)} USDT volume`);
      }
    }
  };

  if (once) return tick();

  let stopping = false;
  process.on("SIGINT", () => { stopping = true; console.log("\nstopping…"); });
  while (!stopping) {
    try {
      await tick();
    } catch (e) {
      // Fail closed: if pricing breaks, publish nothing rather than a stale level.
      console.error(`tick failed: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, config.loop.intervalMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
