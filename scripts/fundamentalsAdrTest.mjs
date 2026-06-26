// Offline test for the ADR pipeline's two hard parts: reading either taxonomy (IFRS or US-GAAP) from
// one concept list, and detecting the home reporting currency instead of assuming USD. No network.
// Run with `npm test`.
import { rowsFor, detectCurrency, detectStandard, annualByYear, latestObservation, CONCEPTS } from "./fetchAdrFundamentals.mjs";

// An IFRS filer reporting in EUR (ASML-shaped), Form 20-F.
const ifrs = { entityName: "ASML Holding N.V.", facts: { "ifrs-full": {
  Revenue: { units: { EUR: [
    { val: 27e9, start: "2024-01-01", end: "2024-12-31", form: "20-F", filed: "2025-02-01" },
    { val: 28e9, start: "2025-01-01", end: "2025-12-31", form: "20-F", filed: "2026-02-01" },
  ] } },
  Assets: { units: { EUR: [{ val: 40e9, end: "2025-12-31", form: "20-F", filed: "2026-02-01" }] } },
  CurrentAssets: { units: { EUR: [{ val: 20e9, end: "2025-12-31", form: "20-F", filed: "2026-02-01" }] } },
  ProfitLoss: { units: { EUR: [{ val: 7e9, start: "2025-01-01", end: "2025-12-31", form: "20-F", filed: "2026-02-01" }] } },
  Equity: { units: { EUR: [{ val: 15e9, end: "2025-12-31", form: "20-F", filed: "2026-02-01" }] } },
}}};

// A foreign issuer that elected US-GAAP, reporting in USD, Form 20-F (only the us-gaap namespace).
const gaap = { entityName: "Some Foreign Co", facts: { "us-gaap": {
  Revenues: { units: { USD: [{ val: 5e9, start: "2025-01-01", end: "2025-12-31", form: "20-F", filed: "2026-03-01" }] } },
  Assets: { units: { USD: [{ val: 9e9, end: "2025-12-31", form: "20-F", filed: "2026-03-01" }] } },
  NetIncomeLoss: { units: { USD: [{ val: 8e8, start: "2025-01-01", end: "2025-12-31", form: "20-F", filed: "2026-03-01" }] } },
}}};

let pass = 0, fail = 0;
const check = (name, cond, got) => { const ok = !!cond; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " -> " + JSON.stringify(got))); ok ? pass++ : fail++; };

// Currency detection
check("detect EUR for the IFRS filer", detectCurrency(ifrs) === "EUR", detectCurrency(ifrs));
check("detect USD for the US-GAAP filer", detectCurrency(gaap) === "USD", detectCurrency(gaap));

// Standard detection
check("IFRS filer flagged IFRS", detectStandard(ifrs) === "IFRS", detectStandard(ifrs));
check("US-GAAP filer flagged US-GAAP", detectStandard(gaap) === "US-GAAP", detectStandard(gaap));

// One concept list reads both taxonomies: revenue resolves via ifrs-full Revenue, and via us-gaap Revenues.
check("revenue found in ifrs-full", !!rowsFor(ifrs, CONCEPTS.revenue, "EUR"), null);
check("revenue found in us-gaap (fallback tag)", !!rowsFor(gaap, CONCEPTS.revenue, "USD"), null);

// Annual extraction off a 20-F duration, in the detected currency.
const ar = annualByYear(ifrs, CONCEPTS.revenue, "EUR");
check("IFRS annual revenue: both fiscal years, restatement-safe", ar["2024"]?.val === 27e9 && ar["2025"]?.val === 28e9, ar);
const gr = annualByYear(gaap, CONCEPTS.revenue, "USD");
check("US-GAAP annual revenue read via fallback", gr["2025"]?.val === 5e9, gr);

// Latest instant balance-sheet value in home currency.
check("IFRS current assets (instant, EUR)", latestObservation(ifrs, CONCEPTS.currentAssets, "EUR", true)?.val === 20e9, null);

// Wrong currency must not match (guards against blindly reading USD off an EUR filer).
check("no USD revenue on the EUR filer", !rowsFor(ifrs, CONCEPTS.revenue, "USD"), null);

// Year-wise tag merge across a US-GAAP→IFRS reporting switch (Toyota/Sony/Honda-shaped): recent years
// tagged ifrs-full:DividendsPaid, older years us-gaap:PaymentsOfDividendsCommonStock. The dividend
// probe showed single-tag selection stranded whichever era the chosen tag didn't cover; annualByYear
// must now bridge it — every fiscal year present, never summed, higher-priority tag winning an overlap.
const split = { entityName: "Transitioned Co", facts: {
  "ifrs-full": { DividendsPaid: { units: { JPY: [
    { val: 970e9, start: "2024-01-01", end: "2024-12-31", form: "20-F", filed: "2025-06-01" },
    { val: 1259e9, start: "2025-01-01", end: "2025-12-31", form: "20-F", filed: "2026-06-01" },
  ] } } },
  "us-gaap": { PaymentsOfDividendsCommonStock: { units: { JPY: [
    { val: 600e9, start: "2022-01-01", end: "2022-12-31", form: "20-F", filed: "2023-06-01" },
    { val: 700e9, start: "2023-01-01", end: "2023-12-31", form: "20-F", filed: "2024-06-01" },
    { val: 800e9, start: "2024-01-01", end: "2024-12-31", form: "20-F", filed: "2025-06-01" }, // overlap year
  ] } } },
}};
const dm = annualByYear(split, CONCEPTS.dividendsPaid, "JPY");
check("merged dividends span both eras (2022–2025)", ["2022", "2023", "2024", "2025"].every((y) => dm[y]?.val != null), dm);
check("US-GAAP fills the pre-IFRS years", dm["2022"]?.val === 600e9 && dm["2023"]?.val === 700e9, dm);
check("higher-priority IFRS tag wins the overlap year (2024)", dm["2024"]?.val === 970e9, dm["2024"]);
check("never summed — overlap is one tag's value, not 970e9+800e9", dm["2024"]?.val !== 1770e9, dm["2024"]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
