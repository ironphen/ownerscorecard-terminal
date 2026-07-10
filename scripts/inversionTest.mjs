// Offline regression for the inversion checks — the disconfirming questions. No network: synthetic
// records assert the blind spots the audit found stay closed. (1) A margin that starts NEGATIVE can
// fail: the old "recent < early × 0.9" flips sign on a negative base, so a deepening money-loser
// always read clean. (2) Leverage flags on the DRIFT of debt against owner earnings, not a
// flat-earnings gate: a debt pile growing from a rounding error to past a year's earnings (the
// Crocs shape) flags even when earnings grew, while a trivial borrower cannot. (3) The dilution
// note names "stock issued to staff" only when cumulative stock comp could plausibly have paid for
// the added shares; otherwise it states the issuance and leaves the cause to the filing (AZZ's rise
// was a preferred conversion, not staff pay). Run with `npm test`.
import { inversionChecks } from "../src/lib/inversion.mjs";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); cond ? pass++ : fail++; };

// A synthetic record: one company from an array of per-year line objects (fy assigned in order).
const co = (years, extra = {}) => ({
  ticker: "TEST", currency: "USD", market: "US",
  history: years.map((lines, i) => ({ fy: 2016 + i, lines })),
  lines: years[years.length - 1],
  fy: 2016 + years.length - 1,
  ...extra,
});
const find = (r, key) => r?.checks.find((c) => c.key === key);

// ---- 1a. A deepening money-loser flags the margin check (the old test could never fire here). ----
// Owner-earnings margin runs about −7% early and about −37% across the last three years.
const loser = (cfo) => ({ revenue: 100e6, cashFromOps: cfo, capex: 2e6, receivables: 10e6, inventory: 10e6, totalDebt: 10e6 });
const deepening = co([-5e6, -5e6, -6e6, -20e6, -30e6, -35e6, -40e6].map(loser));
const dm = find(inversionChecks(deepening), "margin");
check("margin: a deepening money-loser is flagged", dm && dm.flagged === true);
check("margin: the deepening note states the widening, factually", dm && /loss has widened/.test(dm.note));

// ---- 1b. A steady money-loser does NOT flag — losses level, nothing widening. ----
const steady = co([-10e6, -10e6, -10e6, -10e6, -10e6, -10e6, -10e6].map(loser));
const sm = find(inversionChecks(steady), "margin");
check("margin: a steady money-loser is not flagged", sm && sm.flagged === false);
check("margin: the steady-loser note says the losses have not widened", sm && /negative throughout/.test(sm.note) && /not widened/.test(sm.note));

// ---- 2a. The Crocs shape: debt from a rounding error to past a year's owner earnings, while ----
// ---- owner earnings grew 12x — the old OE-growth gate cleared it; the ratio drift must flag. ----
const yr = (cfo, debt) => ({ revenue: 1000e6, cashFromOps: cfo, capex: 2e6, netIncome: cfo * 0.8, receivables: 50e6, inventory: 50e6, totalDebt: debt });
const croxShape = co([yr(70e6, 2e6), yr(70e6, 2e6), yr(70e6, 2e6), yr(400e6, 500e6), yr(800e6, 1500e6), yr(820e6, 1500e6), yr(840e6, 1500e6)]);
const lv = find(inversionChecks(croxShape), "leverage");
check("leverage: debt outrunning owner earnings flags even when earnings grew (Crocs shape)", lv && lv.flagged === true);
check("leverage: the flagged note reads the debt against years of owner earnings", lv && /owner earnings in debt then/.test(lv.note));

// ---- 2b. A trivial borrower cannot flag: debt doubled but the whole of it stays well under ----
// ---- a year's owner earnings — the materiality floor holds. ----
const trivial = co([yr(100e6, 10e6), yr(100e6, 10e6), yr(100e6, 12e6), yr(100e6, 15e6), yr(100e6, 18e6), yr(100e6, 20e6)]);
const tv = find(inversionChecks(trivial), "leverage");
check("leverage: doubled-but-trivial debt (flat earnings) does not flag", tv && tv.flagged === false);
check("leverage: the trivial-debt note still names the drift honestly", tv && /sits higher than it did/.test(tv.note) && /remains under a year's owner earnings/.test(tv.note));

// ---- 2c. The classic case stays caught: debt up materially, earnings flat, ratio past a year's OE. ----
const classic = co([yr(100e6, 150e6), yr(100e6, 150e6), yr(100e6, 200e6), yr(100e6, 300e6), yr(100e6, 400e6), yr(100e6, 450e6)]);
const cl = find(inversionChecks(classic), "leverage");
check("leverage: debt up 3x on flat earnings still flags", cl && cl.flagged === true);

// ---- 3. Dilution: the cause is named only when the record supports it. ----
// Both companies: shares 100M → 110M (+10%) with $50M of buybacks at ~$50 a share, so covering the
// 10M added shares would take ~$500M of stock comp. GENERIC pays $5M a year — the note must not
// blame staff. STAFF pays $300M a year — cumulative comp plausibly covers the shares, staff is named.
const dilYr = (shares, sbc, bb = 0, repShares = null) => ({
  revenue: 500e6, cashFromOps: 100e6, capex: 10e6, netIncome: 50e6, stockBasedComp: sbc,
  receivables: 20e6, inventory: 20e6, sharesDiluted: shares, buybacks: bb, repurchasedShares: repShares, dividendsPaid: 0,
});
const generic = co([dilYr(100e6, 5e6), dilYr(102e6, 5e6), dilYr(105e6, 5e6, 50e6, 1e6), dilYr(107e6, 5e6), dilYr(110e6, 5e6)]);
const gd = find(inversionChecks(generic), "dilution");
check("dilution: a net rise with buybacks flags", gd && gd.flagged === true);
check("dilution: staff is NOT blamed when stock comp cannot cover the added shares", gd && !/stock issued to staff outran them/.test(gd.note));
check("dilution: the note sends the reader to the filing for the cause", gd && /the filing says which/.test(gd.note));

const staff = co([dilYr(100e6, 300e6), dilYr(102e6, 300e6), dilYr(105e6, 300e6, 50e6, 1e6), dilYr(107e6, 300e6), dilYr(110e6, 300e6)]);
const sd = find(inversionChecks(staff), "dilution");
check("dilution: staff IS named when cumulative stock comp plausibly covers the added shares", sd && sd.flagged === true && /stock issued to staff outran them/.test(sd.note));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
