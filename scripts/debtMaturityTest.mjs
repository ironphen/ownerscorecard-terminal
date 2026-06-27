#!/usr/bin/env node
// debtMaturityTest.mjs — guards the debt-maturity extractor. The fixtures are modelled on the real
// 10-K footnotes after htmlToText flattens their tables to space-separated text (the shapes were read
// off Apple, Boeing, AT&T, Comcast, Microsoft, and a finance-arm filer). The bar is the product's bar:
// PRECISION OVER RECALL. The extractor must recover the right ladder or nothing — never a wrong one —
// so the reconciliation cases assert null. All amounts here are in $ millions (the module's native unit;
// the fetch converts to whole dollars on storage).

import { extractDebtMaturity } from "./debtMaturity.mjs";

let fails = 0;
const eq = (got, exp, name) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) { console.error(`  ✗ ${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`); fails++; }
  else console.log(`  ✓ ${name} → ${JSON.stringify(got)}`);
};
const sched = (r) => r && r.schedule.map((s) => [s.year, s.amount]);

console.log("Layout A — interleaved year/amount, declared total (Apple shape):");
{
  const t = "Long-Term Debt The Company issues senior unsecured notes. Future principal payments for the Company's term debt as of September 27, 2025 are as follows (in millions): 2026 $ 12,393 2027 10,078 2028 9,300 2029 5,235 2030 4,972 Thereafter 49,303 Total term debt principal $ 91,281 As of September 27, 2025 the fair value of the Notes was 80.4 billion.";
  const r = extractDebtMaturity(t, 2025, 90678);
  eq(r && r.basis, "declared", "Apple basis = declared");
  eq(sched(r), [[2026, 12393], [2027, 10078], [2028, 9300], [2029, 5235], [2030, 4972]], "Apple schedule");
  eq(r && [r.thereafter, r.total, r.dueNextYear, r.within2yr, r.peakYear, r.peakAmount, r.fiveYearOnly],
     [49303, 91281, 12393, 22471, 2026, 12393, false], "Apple totals/metrics");
}

console.log("\nLayout B — year-column header, five-year-only, balance-sheet reconciled (Boeing shape):");
{
  const t = "Debt and Notes Payable Scheduled principal payments for debt for the next five years are as follows: 2026 2027 2028 2029 2030 Debt and other notes $ 8,351 $ 4,403 $ 2,739 $ 2,508 $ 5,274 Scheduled payments for finance lease obligations are as follows: 2026 $ 124 2027 72.";
  const r = extractDebtMaturity(t, 2025, 53000);
  eq(r && r.basis, "balance-sheet", "Boeing basis = balance-sheet");
  eq(r && r.fiveYearOnly, true, "Boeing fiveYearOnly");
  eq(sched(r), [[2026, 8351], [2027, 4403], [2028, 2739], [2029, 2508], [2030, 5274]], "Boeing schedule");
  eq(r && [r.thereafter, r.total, r.dueNextYear, r.peakYear], [null, 23275, 8351, 2026], "Boeing totals/metrics");
}

console.log("\nLayout B — footnote markers between label and amounts must be stripped (AT&T shape):");
{
  const t = "Repayment of Long-Term Debt The aggregate principal amounts of debt and the corresponding weighted-average interest rate scheduled for repayment are as follows: 2026 2027 2028 2029 2030 Thereafter Debt repayments 1,2 $ 8,652 $ 8,953 $ 6,905 $ 6,918 $ 7,020 $ 106,216 Weighted-average interest rate 2 3.1 % 3.8 % 3.2 % 4.6 % 4.3 % 4.3 %.";
  const r = extractDebtMaturity(t, 2025, 137000);
  eq(r && r.dueNextYear, 8652, "AT&T dueNextYear = 8652 (not the '1,2' footnote)");
  eq(sched(r), [[2026, 8652], [2027, 8953], [2028, 6905], [2029, 6918], [2030, 7020]], "AT&T schedule");
  eq(r && [r.thereafter, r.total, r.within2yr, r.peakYear], [106216, 144664, 17605, 2027], "AT&T totals/metrics");
}

console.log("\nLayout B — '(in billions)' normalised to millions, fixed-rate row, fair-value column (Comcast shape):");
{
  const t = "Quantitative and Qualitative Disclosures About Market Risk The fair values of our debt instruments and the related interest rates are as follows (in billions) 2026 2027 2028 2029 2030 Thereafter (a) Total Estimated Fair Value as of December 31, 2025 Debt Fixed-rate debt $ 5.9 $ 5.0 $ 5.7 $ 4.8 $ 4.8 $ 75.4 $ 101.6 $ 87.1 Average interest rate (b) 2.1 % 2.9 % 4.0 % 3.5 % 3.4 % 4.0 % 3.8 %.";
  const r = extractDebtMaturity(t, 2025, 104000);
  eq(r && r.basis, "declared", "Comcast basis = declared");
  eq(sched(r), [[2026, 5900], [2027, 5000], [2028, 5700], [2029, 4800], [2030, 4800]], "Comcast schedule (billions→millions)");
  eq(r && [r.thereafter, r.total, r.dueNextYear, r.peakYear], [75400, 101600, 5900, 2026], "Comcast totals/metrics");
}

console.log("\nLayout A — zero-amount years preserved, declared total (Microsoft shape):");
{
  const t = "The following table outlines maturities of our long-term debt, including the current portion, as of June 30, 2025: (In millions) Year Ending June 30, 2026 $ 3,000 2027 9,250 2028 0 2029 2,054 2030 0 Thereafter 34,902 Total $ 49,206 Income Taxes.";
  const r = extractDebtMaturity(t, 2025, 49000);
  eq(sched(r), [[2026, 3000], [2027, 9250], [2028, 0], [2029, 2054], [2030, 0]], "Microsoft schedule (zeros kept)");
  eq(r && [r.thereafter, r.total, r.dueNextYear, r.within2yr, r.peakYear], [34902, 49206, 3000, 12250, 2027], "Microsoft totals/metrics");
}

console.log("\nReconciliation gate — must return null (precision over recall):");
// A declared total that the schedule doesn't tie out to → a misparse, withheld.
{
  const t = "maturities of long-term debt are as follows (in millions): 2026 $ 1,000 2027 1,000 2028 1,000 2029 1,000 2030 1,000 Thereafter 1,000 Total $ 99,999 .";
  eq(extractDebtMaturity(t, 2025, 6000), null, "declared total doesn't reconcile → null");
}
// A finance-arm filer's tiny unrelated ladder against a huge debt balance → not the wall, withheld.
{
  const t = "aggregate maturities of debt are as follows (in millions): 2026 $ 500 2027 400 2028 300 2029 200 2030 100 .";
  eq(extractDebtMaturity(t, 2025, 159000), null, "tiny ladder vs huge debt (finance-arm) → null");
}
// A lease ladder is not a debt ladder.
{
  const t = "future minimum lease payments under operating leases are as follows (in millions): 2026 $ 889 2027 840 2028 703 2029 494 2030 382 Thereafter 6,337 Total $ 9,646 .";
  eq(extractDebtMaturity(t, 2025, 9646), null, "operating-lease ladder → null");
}
// A five-year-only ladder with no anchor to reconcile against → cannot be verified, withheld.
{
  const t = "Scheduled principal payments for debt for the next five years are as follows: 2026 2027 2028 2029 2030 Debt and other notes $ 8,351 $ 4,403 $ 2,739 $ 2,508 $ 5,274 .";
  eq(extractDebtMaturity(t, 2025, null), null, "five-year-only with no balance-sheet anchor → null");
}
// No fiscal year → can't bound the schedule, withheld.
eq(extractDebtMaturity("2026 $ 1 2027 2 2028 3 2029 4 long-term debt", null, 1000), null, "no fiscal year → null");

if (fails) { console.error(`\n❌ debtMaturityTest: ${fails} failure(s)`); process.exit(1); }
console.log("\n✅ debtMaturityTest passed");
