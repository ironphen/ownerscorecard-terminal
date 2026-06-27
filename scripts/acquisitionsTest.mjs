#!/usr/bin/env node
// acquisitionsTest.mjs — guards the acquisition/goodwill lens. Fixtures are the real shapes: a serial
// acquirer carrying goodwill above its equity, a company that has already written acquisitions down, and
// an organically-built business that should be withheld (its story is told elsewhere). All amounts in $.

import { acquisitionRecord } from "../src/lib/acquisitions.mjs";

let fails = 0;
const eq = (got, exp, name) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) { console.error(`  ✗ ${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`); fails++; }
  else console.log(`  ✓ ${name} → ${JSON.stringify(got)}`);
};
const B = 1e9;
const co = (lines, history) => ({ lines, history: history.map((l) => ({ fy: l.fy, lines: l })) });

console.log("Serial acquirer — goodwill exceeds equity, no write-downs (Salesforce shape):");
{
  const c = co(
    { goodwill: 57.9 * B, intangibleAssets: 6.8 * B, totalAssets: 111 * B, stockholdersEquity: 59 * B },
    [{ fy: 2022, acquisitionSpend: 27 * B, capex: 0.8 * B }, { fy: 2023, acquisitionSpend: 0, capex: 0.8 * B }],
  );
  const a = acquisitionRecord(c);
  eq(a && a.exceedsEquity, false, "goodwill below equity (98%) → not 'exceeds'");
  eq(a && Math.round(a.gwVsEquity * 100), 98, "goodwill is 98% of book equity");
  eq(a && [a.cumImp, a.impByYear.length], [0, 0], "no write-downs");
  eq(a != null, true, "shown (goodwill+intangibles 58% of assets, material)");
}

console.log("\nGoodwill larger than all book equity (AbbVie shape — equity near zero):");
{
  const c = co(
    { goodwill: 35.6 * B, intangibleAssets: 52.6 * B, totalAssets: 135 * B, stockholdersEquity: 3.3 * B },
    [{ fy: 2020, acquisitionSpend: 38 * B, capex: 0.8 * B }],
  );
  const a = acquisitionRecord(c);
  eq(a && a.exceedsEquity, true, "goodwill exceeds book equity");
}

console.log("\nWritten-down record (Kraft Heinz shape — a $20B concession):");
{
  const c = co(
    { goodwill: 22.2 * B, intangibleAssets: 37.5 * B, totalAssets: 82 * B, stockholdersEquity: 42 * B },
    [
      { fy: 2018, acquisitionSpend: 0.6 * B, capex: 0.8 * B, goodwillImpairment: 7.0 * B },
      { fy: 2019, acquisitionSpend: 0.2 * B, capex: 0.7 * B, goodwillImpairment: 13.2 * B },
      { fy: 2020, acquisitionSpend: 0.2 * B, capex: 0.6 * B },
    ],
  );
  const a = acquisitionRecord(c);
  eq(a && a.cumImp, 20.2 * B, "cumulative write-down summed across the record");
  eq(a && a.impByYear.map((x) => x.fy), [2018, 2019], "the years a write-down was taken");
}

console.log("\nOrganic builder — little goodwill, no write-downs → withheld (Costco shape):");
{
  const c = co(
    { goodwill: 1.0 * B, intangibleAssets: null, totalAssets: 70 * B, stockholdersEquity: 25 * B },
    [{ fy: 2023, acquisitionSpend: 0.1 * B, capex: 4 * B }, { fy: 2024, acquisitionSpend: 0, capex: 4.7 * B }],
  );
  eq(acquisitionRecord(c), null, "built-not-bought → withheld");
}

console.log("\nWithheld when the core balance-sheet inputs are missing:");
eq(acquisitionRecord({ lines: { totalAssets: 100 * B }, history: [] }), null, "no goodwill tagged → null");
eq(acquisitionRecord({ lines: { goodwill: 5 * B }, history: [] }), null, "no total assets → null");

if (fails) { console.error(`\n❌ acquisitionsTest: ${fails} failure(s)`); process.exit(1); }
console.log("\n✅ acquisitionsTest passed");
