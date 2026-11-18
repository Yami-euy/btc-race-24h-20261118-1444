// STABLE-DIP trader for cbBTC, long only.
//
// Own design, built from first principles for a choppy day (the dev window
// falls 2.8% top to bottom, so holding loses and every win has to come from
// a dip that actually turns). The shape it hunts, in order:
//
//   1. A dip against the rolling high. The close must sit at least DIP1
//      below the highest close of the last HI_BARS bars. Measuring against
//      a rolling high (not a fixed lookback) means the trigger follows the
//      market instead of firing on stale levels.
//   2. The dip must STOP falling before any money goes in. Entry waits for
//      the close to reclaim RECLAIM bps off the running dip low. A 5-bar
//      uptick fires on dead-cat bounces mid-fall; a reclaim off the low
//      waits for the turn. This is the single biggest change from a plain
//      drop+bounce trigger.
//   3. Two tranches. The first takes TRANCHE1_PCT of the cash on the first
//      stabilised dip. If the market legs down again to a much deeper dip
//      (DIP2), the rest of the cash goes in at the better price. Most days
//      the second tranche never fires; it is there for the deep second leg,
//      not for averaging down a slow bleed.
//   4. Tiered take-profit. An entry that caught a deep dip (at least
//      DEEP_DIP below the rolling high) is allowed to ride to TP_DEEP: the
//      big morning V pays for the day. A shallow entry banks TP_SHALLOW
//      fast instead of giving a small recovery back.
//   5. A regime filter. No new entries while the trailing 360-bar return
//      is under REGIME_BPS: the afternoon of the dev window grinds down
//      with shallow dips that recover ~30 bps and then keep falling, and
//      buying those is how a good morning gets handed back.
//   6. A stop on the blended cost (STOP_BPS) and a max-hold exit
//      (MAX_HOLD_BARS): a position that never reaches its target gets cut
//      instead of riding the downtrend to the close.
//
// At most one position, at most 1 order per bar, fills at the next open.
// A full-size round trip costs ~26 bps in fees, slippage and impact, so a
// 60 bps target still nets ~34 bps and a 220 bps target ~194 bps.
//
// Deterministic: float64 arithmetic on closes only, no wall clock, no
// randomness, no network, no files. Same bars give the same orders. Tranche
// bookkeeping comes from the fills the harness reports, never from assumed
// fills, so a rejected order can never leave a phantom tranche behind.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const HI_BARS = 240; // rolling high looks back 4 hours of closes
const DIP1_BPS = 100; // first tranche: close 1.0% under the rolling high
const DIP2_BPS = 190; // second tranche: a much deeper second leg
const DEEP_DIP_BPS = 180; // an entry this deep rides to the big target
const TRANCHE1_PCT = 90; // first tranche takes 90% of the cash
const RECLAIM_BPS = 15; // entry waits for 0.15% back off the dip low
const TP_DEEP_BPS = 180; // deep entry: ride to +1.8% over its cost
const TP_SHALLOW_BPS = 60; // shallow entry: bank +0.6% fast
const STOP_BPS = 120; // cut the whole position at -1.2% on blended cost
const REGIME_BPS = -25; // skip entries while the 6h return is under -0.25%
const REGIME_BARS = 360; // the regime lookback: 6 hours of closes
const MAX_HOLD_BARS = 420; // exit a stale position after 7 hours held
const MAX_SLIPPAGE_BPS = 100; // 1% past the close the order was decided on
const WARMUP_BARS = 241; // bars of history before the first entry is allowed (241 = the first bar with a 240-bar rolling high)

/** Every CBBTC close seen so far, oldest first. */
const closes: number[] = [];

/** The lowest close of the dip in progress, or Infinity when no dip is on. */
let dipLow = Infinity;

/** A filled, still-held buy: its size, its cost, its own target. */
interface Tranche {
  id: number;
  kind: 't1' | 't2';
  qty: bigint;
  cost: bigint;
  tpBps: number;
  entryBar: number;
  sellId: string | null;
}
const tranches: Tranche[] = [];
let nextTrancheId = 1;
let nextOrderId = 1;

/** client_id -> { tpBps, entryBar, kind } for buys waiting on their fill. */
const pendingBuys = new Map<string, { tpBps: number; entryBar: number; kind: 't1' | 't2' }>();
/** client_id of an outstanding sell-all, if one is in flight. */
let pendingSellAll: string | null = null;

function freshId(prefix: string): string {
  return `${prefix}${nextOrderId++}`;
}

/** The close n bars back, or null before that many bars exist. */
function closeBack(n: number): number | null {
  if (closes.length <= n) return null;
  return closes[closes.length - 1 - n]!;
}

/** Whole basis points of (now / then - 1), truncated toward zero. */
function moveBps(now: number, then: number): number {
  return Math.trunc(((now - then) / then) * 10000);
}

/** Highest close of the previous HI_BARS bars, or null before they exist. */
function rollingHigh(): number | null {
  if (closes.length - 1 < HI_BARS) return null;
  let hi = -Infinity;
  for (let i = closes.length - 1 - HI_BARS; i < closes.length - 1; i++) {
    if (closes[i]! > hi) hi = closes[i]!;
  }
  return hi;
}

await runBars({
  onBatch(state: BarsState, batch) {
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) closes.push(Number(bar.c));
    }

    // ---- fold in the fills of the orders decided on the previous bar ----
    for (const fill of batch.fills ?? []) {
      if (fill.status === 'filled' && pendingBuys.has(fill.client_id)) {
        const p = pendingBuys.get(fill.client_id)!;
        pendingBuys.delete(fill.client_id);
        tranches.push({
          id: nextTrancheId++,
          kind: p.kind,
          qty: BigInt(fill.qty),
          cost: BigInt(fill.notional_quote_units),
          tpBps: p.tpBps,
          entryBar: p.entryBar,
          sellId: null,
        });
      } else if (fill.status === 'filled' && pendingSellAll === fill.client_id) {
        pendingSellAll = null;
        tranches.length = 0;
      } else if (fill.status === 'filled') {
        const t = tranches.find((x) => x.sellId === fill.client_id);
        if (t !== undefined) tranches.splice(tranches.indexOf(t), 1);
      } else if (fill.status === 'rejected' && pendingSellAll === fill.client_id) {
        pendingSellAll = null; // tranches stay: the position is still held
      }
      if (fill.status === 'rejected') pendingBuys.delete(fill.client_id);
    }

    if (state.warmingUp) return [];
    const close = closes.length > 0 ? closes[closes.length - 1]! : null;
    if (close === null) return [];

    const held = state.positions.get(SYMBOL);
    if (held === undefined && tranches.length > 0) tranches.length = 0; // defensive sync
    // Self-heal: if a position is held but no tranche records it (a fill was
    // ever missed), rebuild one tranche from the position itself so exits
    // keep working instead of riding to the end-of-window flatten.
    if (held !== undefined && tranches.length === 0) {
      tranches.push({
        id: nextTrancheId++,
        kind: 't1',
        qty: held.qty,
        cost: held.cost,
        tpBps: TP_SHALLOW_BPS,
        entryBar: closes.length,
        sellId: null,
      });
    }

    // ---- market state: dip against the rolling high, and its running low ----
    const hi = rollingHigh();
    let dip: number | null = null;
    if (hi !== null) {
      dip = moveBps(close, hi);
      if (dip <= -DIP1_BPS) {
        if (close < dipLow) dipLow = close;
      } else {
        dipLow = Infinity; // the dip is over: the next one starts fresh
      }
    }
    const stabilised =
      dip !== null && dip <= -DIP1_BPS && dipLow !== Infinity && close >= dipLow * (1 + RECLAIM_BPS / 10000);

    // Regime: the trailing 6h return. Before 360 bars there is no filter,
    // so the early-morning dip is never blocked by it.
    let regimeOk = true;
    const sixHoursAgo = closeBack(REGIME_BARS);
    if (sixHoursAgo !== null) regimeOk = moveBps(close, sixHoursAgo) >= REGIME_BPS;

    // ---- exits: stop, then max-hold, then one target per tranche ----
    // While a partial sell is in flight, hold off the sell-all: its qty was
    // sized before that sell, and issuing both would oversell the position.
    const anySellPending = tranches.some((t) => t.sellId !== null);
    if (held !== undefined && tranches.length > 0 && pendingSellAll === null && !anySellPending) {
      const totalValue = state.value(SYMBOL, held.qty);
      const stopped = totalValue * BPS <= held.cost * (BPS - BigInt(STOP_BPS));
      const oldest = Math.min(...tranches.map((t) => t.entryBar));
      const stale = closes.length - oldest >= MAX_HOLD_BARS;
      if (stopped || stale) {
        const sell: SellInput = {
          side: 'sell',
          symbol: SYMBOL,
          qty: held.qty,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
          client_id: freshId('s'),
        };
        pendingSellAll = sell.client_id;
        return [sell];
      }
      for (const t of tranches) {
        if (t.sellId !== null) continue;
        const value = state.value(SYMBOL, t.qty);
        if (value * BPS >= t.cost * (BPS + BigInt(t.tpBps))) {
          const sell: SellInput = {
            side: 'sell',
            symbol: SYMBOL,
            qty: t.qty,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
            client_id: freshId('s'),
          };
          t.sellId = sell.client_id;
          return [sell];
        }
      }
      // No exit fired: fall through to the entries below, so a second
      // tranche can still be bought while the first is held.
    }

    // ---- entries ----
    if (closes.length < WARMUP_BARS) return [];
    if (dip === null || !stabilised || !regimeOk) return [];
    if (pendingBuys.size > 0 || pendingSellAll !== null) return [];
    if (tranches.some((t) => t.sellId !== null)) return []; // a sale in flight

    // First tranche: flat, a stabilised dip of at least DIP1.
    if (tranches.length === 0) {
      const cash = state.cash;
      if (cash <= 0n) return [];
      const spend = (cash * BigInt(TRANCHE1_PCT)) / 100n;
      if (spend <= 0n) return [];
      const buy: BuyInput = {
        side: 'buy',
        symbol: SYMBOL,
        notional_quote_units: spend,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
        client_id: freshId('b'),
      };
      pendingBuys.set(buy.client_id, {
        tpBps: dip <= -DEEP_DIP_BPS ? TP_DEEP_BPS : TP_SHALLOW_BPS,
        entryBar: closes.length,
        kind: 't1',
      });
      return [buy];
    }

    // Second tranche: only while the first is held alone, on a deeper dip
    // that has itself stabilised (a reclaim off the dip low, same as the
    // first entry) — never buy a leg that is still falling.
    if (tranches.length === 1 && tranches[0]!.kind === 't1' && dip <= -DIP2_BPS && stabilised) {
      const cash = state.cash;
      if (cash <= 0n) return [];
      const buy: BuyInput = {
        side: 'buy',
        symbol: SYMBOL,
        notional_quote_units: cash,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
        client_id: freshId('b'),
      };
      pendingBuys.set(buy.client_id, { tpBps: TP_DEEP_BPS, entryBar: closes.length, kind: 't2' });
      return [buy];
    }
    return [];
  },
});
