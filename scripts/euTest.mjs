// Offline test for the EU (ESEF) fetcher's parsing (scripts/fetchEuFundamentals.mjs): fiscal-year
// normalisation, annual-vs-interim filtering, the segment-axis rejection, and the operating-income
// derivation. No network. Run with `npm test`.
import { parseFacts, fyOf, annualDays, deriveOpInc, CONCEPT_LINE } from "./fetchEuFundamentals.mjs";

let pass = 0, fail = 0;
const check = (name, cond, got) => { const ok = !!cond; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " -> " + JSON.stringify(got))); ok ? pass++ : fail++; };

// ---- fyOf: the fiscal year a period closes in, with the Jan-1-is-prior-year-end convention ----
check("duration ending Dec 31 → that year", fyOf("2024-01-01T00:00:00/2024-12-31T00:00:00").fy === 2024);
check("duration ending Jan 1 → the prior year (== prior Dec 31)", fyOf("2024-01-01T00:00:00/2025-01-01T00:00:00").fy === 2024);
check("instant at Jan 1 → the prior year-end", fyOf("2025-01-01T00:00:00").fy === 2024);
check("instant at Dec 31 → that year", fyOf("2024-12-31T00:00:00").fy === 2024);
check("June year-end duration → the calendar year it ends in", fyOf("2024-07-01T00:00:00/2025-06-30T00:00:00").fy === 2025);
check("fyOf flags flow vs instant", fyOf("2024-01-01/2025-01-01").isFlow === true && fyOf("2025-01-01").isFlow === false);

// ---- annualDays: only a full-year duration counts ----
check("a full year is ~365 days (366 in a leap year)", [365, 366].includes(Math.round(annualDays("2024-01-01T00:00:00/2025-01-01T00:00:00"))));
check("a quarter is ~92 days", Math.round(annualDays("2024-10-01T00:00:00/2025-01-01T00:00:00")) === 92);
check("an instant has 0 duration", annualDays("2024-12-31T00:00:00") === 0);

// ---- deriveOpInc: reported wins; else pre-tax + interest ≈ EBIT ----
check("reported operating income is returned untouched", deriveOpInc(500, 1000, 300, 100, 50) === 500);
check("derives EBIT from net income + tax + interest when op is null", deriveOpInc(null, 1000, 300, 100, 50) === 450);
check("no derivation without net income + tax", deriveOpInc(null, 1000, 300, null, 50) === null);
check("negative interest (income) is not added into the EBIT proxy", deriveOpInc(null, 1000, 300, 100, -20) === 400);

// ---- parseFacts: consolidated annual facts only ----
const json = { facts: {
  a: { value: "1000000000", dimensions: { concept: "ifrs-full:Revenue", entity: "e", period: "2024-01-01T00:00:00/2025-01-01T00:00:00", unit: "iso4217:EUR" } },
  b: { value: "5000000000", dimensions: { concept: "ifrs-full:Revenue", entity: "e", period: "2024-01-01T00:00:00/2025-01-01T00:00:00", unit: "iso4217:EUR", "ifrs-full:OperatingSegmentsAxis": "seg1" } }, // segment axis → excluded
  c: { value: "200000000", dimensions: { concept: "ifrs-full:Assets", entity: "e", period: "2025-01-01T00:00:00", unit: "iso4217:EUR" } }, // instant, Jan-1 2025 → FY2024
  d: { value: "50000000", dimensions: { concept: "ifrs-full:Revenue", entity: "e", period: "2024-10-01T00:00:00/2025-01-01T00:00:00", unit: "iso4217:EUR" } }, // quarter → excluded
  e: { value: "<p>note text</p>", dimensions: { concept: "ifrs-full:DescriptionOfAccountingPolicy", entity: "e", period: "2024-01-01T00:00:00/2025-01-01T00:00:00" } }, // text, no unit → excluded
} };
const { byFy, currency } = parseFacts(json, CONCEPT_LINE);
check("annual consolidated revenue is taken (not the segment, not the quarter)", byFy[2024]?.revenue === 1000000000, byFy[2024]);
check("a Jan-1 instant lands on the prior fiscal year", byFy[2024]?.totalAssets === 200000000, byFy[2024]);
check("currency detected from the money units", currency === "EUR", currency);
check("no spurious years from the quarter or the text fact", Object.keys(byFy).join(",") === "2024", Object.keys(byFy));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
