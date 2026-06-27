#!/usr/bin/env node
// leasesTest.mjs — guards the lease-ladder reconciliation and the combined display model. The fixtures
// are the real ASC 842 XBRL buckets (Home Depot, Microsoft) in whole dollars. The reconciliation is the
// precision gate: a ladder is kept only if its yearly buckets sum to the undiscounted total, which less
// the imputed interest equals the balance-sheet liability — so a mis-tagged or partial ladder is withheld.

import { reconcileLeaseLadder, leaseObligations } from "../src/lib/leases.mjs";

let fails = 0;
const eq = (got, exp, name) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) { console.error(`  ✗ ${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`); fails++; }
  else console.log(`  ✓ ${name} → ${JSON.stringify(got)}`);
};
const B = 1e9, M = 1e6;

console.log("reconcileLeaseLadder — Home Depot operating (real buckets, $):");
{
  const op = reconcileLeaseLadder({
    y1: 1792 * M, y2: 1806 * M, y3: 1607 * M, y4: 1386 * M, y5: 1062 * M, after: 3985 * M,
    undiscounted: 11638 * M, imputed: 2060 * M, liability: 9578 * M,
  });
  eq(op && op.undiscounted, 11638 * M, "HD op undiscounted ties to bucket sum");
  eq(op && op.liability, 9578 * M, "HD op liability");
  eq(op && op.schedule.length, 5, "HD op five-year ladder");
}

console.log("\nreconcileLeaseLadder — a ladder that doesn't tie out is withheld:");
eq(reconcileLeaseLadder({ y1: 1000 * M, y2: 1000 * M, y3: 1000 * M, y4: 1000 * M, y5: 1000 * M, after: 1000 * M, undiscounted: 99999 * M }), null, "buckets ≠ undiscounted → null");
eq(reconcileLeaseLadder({ y1: null, y2: 100 * M, y3: 100 * M, y4: 100 * M, y5: 100 * M, undiscounted: 400 * M }), null, "no year-one bucket → null");
eq(reconcileLeaseLadder(null), null, "no data → null");
// A filer that tags only the buckets (no declared undiscounted total) is accepted on the buckets alone.
{
  const r = reconcileLeaseLadder({ y1: 300 * M, y2: 250 * M, y3: 200 * M, y4: 150 * M, y5: 100 * M, after: 0, undiscounted: null, imputed: 50 * M, liability: null });
  eq(r && [r.undiscounted, r.liability], [1000 * M, 950 * M], "no declared total → summed; liability = undiscounted − imputed");
}

console.log("\nleaseObligations — combined operating + finance display model (Microsoft shape):");
{
  const company = {
    lines: { totalDebt: 43150 * M },
    leases: {
      asOf: "2025-06-30",
      operating: reconcileLeaseLadder({ y1: 6111 * M, y2: 5237 * M, y3: 3495 * M, y4: 2419 * M, y5: 2017 * M, after: 6202 * M, undiscounted: 25481 * M, imputed: 2620 * M, liability: 22861 * M }),
      finance: reconcileLeaseLadder({ y1: 5008 * M, y2: 5157 * M, y3: 5187 * M, y4: 4521 * M, y5: 4382 * M, after: 36251 * M, undiscounted: 60506 * M, imputed: 14334 * M, liability: 46172 * M }),
    },
  };
  const m = leaseObligations(company);
  eq(m.firstYear, 2026, "MSFT firstYear (Jun close → next year)");
  eq(m.dueNextYear, (6111 + 5008) * M, "MSFT due next 12 months = op + finance year one");
  eq(m.totalPayments, (25481 + 60506) * M, "MSFT total payments = both undiscounted totals");
  eq(m.liability, (22861 + 46172) * M, "MSFT lease liability = both present values");
  eq(m.peakIdx, 0, "MSFT peak is year one");
  eq([m.hasOperating, m.hasFinance], [true, true], "both ladders present");
  // The headline GBM fact: leases ($69.0B) exceed the debt ($43.2B).
  eq(m.liability > company.lines.totalDebt, true, "MSFT lease PV exceeds its debt");
}

console.log("\nleaseObligations — operating-only filer, finance ladder absent:");
{
  const company = {
    lines: { totalDebt: 43940 * M },
    leases: { asOf: "2025-12-31", operating: reconcileLeaseLadder({ y1: 380 * M, y2: 320 * M, y3: 260 * M, y4: 210 * M, y5: 170 * M, after: 680 * M, undiscounted: 2020 * M, imputed: 300 * M, liability: 1720 * M }), finance: null },
  };
  const m = leaseObligations(company);
  eq([m.hasOperating, m.hasFinance], [true, false], "operating only");
  eq(m.firstYear, 2026, "Dec close → next year");
  eq(m.liability, 1720 * M, "liability = operating only");
  eq(m.schedule[0].fin, 0, "finance segment zero when absent");
}

console.log("\nleaseObligations — withheld when there is nothing to show:");
eq(leaseObligations({ leases: null }), null, "no leases → null");
eq(leaseObligations({ leases: { asOf: "2025-12-31", operating: null, finance: null } }), null, "both ladders null → null");

if (fails) { console.error(`\n❌ leasesTest: ${fails} failure(s)`); process.exit(1); }
console.log("\n✅ leasesTest passed");
