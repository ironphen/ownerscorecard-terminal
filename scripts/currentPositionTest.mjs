// Offline regression for the Current Position derivation. The quick ratio's whole point is
// subtracting inventory, so an UNTAGGED inventory line on a goods business (a department store's
// quarterly balance often carries no inventory tag — Dillard's reproduces it) is missing data, not
// zero: subtracted as zero the "stricter" quick ratio silently equals the current ratio. It is
// withheld there; a services filer keeps it, since its inventory genuinely rounds to zero; a
// goods business with the tag computes it normally. Run with `npm test`.
import { currentPosition } from "../src/lib/currentPosition.mjs";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); cond ? pass++ : fail++; };

const co = (sic, balance, lines = {}) => ({
  ticker: "TEST", sic, lines,
  quarterly: { asOf: "2026-03-31", form: "10-Q", balance: { currentAssets: 200e6, currentLiabilities: 100e6, cash: 40e6, totalLiabilities: 150e6, ...balance }, series: [] },
});

// A retailer (SIC 5311) whose quarterly balance carries no inventory tag: quick ratio withheld.
const dept = currentPosition(co("5311", {}));
check("quick ratio withheld on a goods business with untagged inventory", dept.quickRatio === null && dept.invUntagged === true);
check("current and cash ratios still compute there", Math.abs(dept.currentRatio - 2) < 1e-9 && Math.abs(dept.cashRatio - 0.4) < 1e-9);

// The same retailer with the inventory tag: quick ratio computes, stricter than current.
const tagged = currentPosition(co("5331", { inventory: 80e6 }));
check("quick ratio computes on a goods business with tagged inventory", Math.abs(tagged.quickRatio - 1.2) < 1e-9 && tagged.invUntagged === false);
check("tagged quick ratio sits below the current ratio", tagged.quickRatio < tagged.currentRatio);

// A services filer (SIC 7372) with no inventory line: genuinely ~zero, quick ratio kept.
const services = currentPosition(co("7372", {}));
check("quick ratio kept for a services filer without an inventory line", Math.abs(services.quickRatio - 2) < 1e-9 && services.invUntagged === false);

// No SIC (the JP pool): a cost-of-goods line dominating revenue is the fallback goods signal.
const jpGoods = currentPosition(co(undefined, {}, { revenue: 100e6, costOfRevenue: 70e6 }));
check("no-SIC filer with dominant cost of goods is treated as a goods business (withheld)", jpGoods.quickRatio === null);
const jpServices = currentPosition(co(undefined, {}, { revenue: 100e6, costOfRevenue: 30e6 }));
check("no-SIC filer with a light cost line keeps its quick ratio", jpServices.quickRatio != null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
