// Offline test for the EU (ESEF) fetcher's parsing (scripts/fetchEuFundamentals.mjs): fiscal-year
// normalisation, annual-vs-interim filtering, the segment-axis rejection, and the operating-income
// derivation. No network. Run with `npm test`.
import { readFileSync } from "node:fs";
import { parseFacts, fyOf, annualDays, deriveOpInc, CONCEPT_LINE, unstableDerivedShareYears } from "./fetchEuFundamentals.mjs";

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

// ---- unstableDerivedShareYears: withhold a DERIVED share count that swings against its own series ----
// Telefónica's real pattern: a stable ~5–6.5bn derived across years, then a −€49M loss year whose
// hybrid-adjusted EPS derives 817M — a 7× outlier that must be withheld, not priced on.
const tef = [
  { fy: 2021, shares: 6072000000, derived: true },
  { fy: 2022, shares: 6487000000, derived: true },
  { fy: 2023, shares: 4460000000, derived: true },
  { fy: 2024, shares: 817000000, derived: true },
];
const tefBad = unstableDerivedShareYears(tef);
check("the 817M hybrid-broken derivation is flagged for withholding", tefBad.has(2024), [...tefBad]);
check("the stable ~5–6bn derived years are kept", !tefBad.has(2021) && !tefBad.has(2022) && !tefBad.has(2023), [...tefBad]);

// A filer whose EPS is struck on net income derives a stable count — nothing is withheld.
const stable = [
  { fy: 2022, shares: 505000000, derived: true },
  { fy: 2023, shares: 500000000, derived: true },
  { fy: 2024, shares: 495000000, derived: true },
];
check("a stable derived series withholds nothing", unstableDerivedShareYears(stable).size === 0);

// A directly-tagged count is never second-guessed, even if it is an outlier (a real split/consolidation).
const tagged = [
  { fy: 2022, shares: 6000000000, derived: false },
  { fy: 2023, shares: 6000000000, derived: false },
  { fy: 2024, shares: 800000000, derived: false }, // directly tagged: trusted as filed
];
check("a directly-tagged outlier is trusted, not withheld", unstableDerivedShareYears(tagged).size === 0);

// Too little data to judge stability → withhold nothing (never invent a reason to blank a lone year).
check("a single year cannot be judged unstable", unstableDerivedShareYears([{ fy: 2024, shares: 817000000, derived: true }]).size === 0);

// ---- real-pool canaries for the two extraction fixes (offline: reads the committed pool) ----
const euPool = (() => { try { return JSON.parse(readFileSync("src/data/fundamentals.eu.json", "utf8")).companies || []; } catch { return []; } })();
const findEu = (t) => euPool.find((c) => c.ticker === t);
const tefRec = findEu("TEF");
if (tefRec) check("TEF prices on no share count (817M hybrid-broken derivation withheld, real ~5.67bn)", tefRec.lines?.sharesDiluted == null, tefRec.lines?.sharesDiluted);
const mcRec = findEu("MC");
// LVMH tags operating profit only under the …AfterShareOfProfitLoss… concept (€18,907M); before the
// concept was listed the derivation returned a wrong €17,707M that matched no line in the filing.
if (mcRec) check("LVMH operating income is the filed €18,907M, not the mis-derived €17,707M", Math.abs((mcRec.lines?.operatingIncome ?? 0) - 18907000000) < 5e6, mcRec.lines?.operatingIncome);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
