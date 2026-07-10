// Offline regression test for the groupings tables (src/lib/groupingColumns.mjs and the
// /groupings/[slug] surface). Guards the two reads that page added on top of the shelves:
//
//   1. Through-cycle quality columns (Graham's normalization): the margin and return-on-capital
//      columns are MEDIANS over the record's readable years, never one year's print — a member
//      with under three readable years shows "—", a corrupt gross-margin year never enters its
//      median, and the size columns (revenue, owner earnings, net debt, ...) stay latest-FY.
//      The headers must say so ("median over the record"), because the header is the basis.
//
//   2. The group line: one dated sentence describing the LIST, computed from the very cells the
//      table renders, medians only, naming no member — it describes, never grades.
//
// Plus the standing structural guards: one grouping per shelf, every family column well-formed.
import fundamentals from "../src/data/fundamentals.json" with { type: "json" };
import adrRatios from "../src/data/adrRatios.json" with { type: "json" };
import rates from "../src/data/rates.json" with { type: "json" };
import { SHELVES, industryLabelOf } from "../src/lib/shelves.mjs";
import { GROUPINGS, FAMILIES, groupingBySlug, usdTerms, groupingCells, groupLine } from "../src/lib/groupingColumns.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL " + name); } };

// ---- structure: one grouping per shelf (the import-time guard ran; re-state the shape) ----
ok("one grouping per shelf", GROUPINGS.length === SHELVES.length);
ok("every grouping resolves by slug", GROUPINGS.every((g) => groupingBySlug.get(g.slug) === g));
const allCols = Object.values(FAMILIES).flatMap((f) => f.columns);
ok("every family column is well-formed", allCols.every((c) => c.key && c.label && c.basis && (c.type === "money" || c.type === "pct")));

// ---- 1a: the headers name the basis — quality ratios read as medians, size stays latest-FY ----
const basisOf = (key) => allCols.find((c) => c.key === key)?.basis || "";
for (const key of ["grossMargin", "operatingMargin", "roic", "rote"]) {
  ok(`${key} basis says "median over the record"`, basisOf(key).includes("median over the record"));
}
for (const key of ["revenue", "ownerEarnings", "netDebt", "deposits", "netIncome", "tangibleEquity"]) {
  ok(`${key} basis stays latest-FY`, /latest/i.test(basisOf(key)));
}

// ---- fixtures: a plain US operating company (vehicle parts, SIC 3714 — never financial) ----
const yr = (fy, revenue, costOfRevenue, operatingIncome) => ({
  fy,
  lines: { revenue, costOfRevenue, operatingIncome, netIncome: operatingIncome * 0.75, incomeTaxExpense: operatingIncome * 0.25, stockholdersEquity: revenue * 0.5, totalDebt: 0, cashAndEquivalents: revenue * 0.1, interestExpense: 0 },
});
const opCo = (history) => ({
  ticker: "TST", name: "Test Parts Co", market: "US", sic: "3714", currency: "USD",
  lines: { ...history[history.length - 1].lines },
  history,
});
const terms = usdTerms({ market: "US", currency: "USD" }, adrRatios, rates);
const cellsFor = (co) => {
  const byKey = {};
  FAMILIES.general.columns.forEach((col, i) => { byKey[col.key] = groupingCells(co, "general", terms)[i]; });
  return byKey;
};

// ---- 1b: the operating margin cell is the record's median, not the latest year ----
// Margins by year: 10%, 12%, 20%, 16% — latest is 16%, the through-cycle median is 12%.
const co4 = opCo([yr(2022, 1000, 700, 100), yr(2023, 1000, 700, 120), yr(2024, 1000, 700, 200), yr(2025, 1000, 700, 160)]);
const c4 = cellsFor(co4);
ok(`operating margin is the median over the record (got ${c4.operatingMargin.text})`, c4.operatingMargin.text === "12.0%");
ok("roic reads as a percent on a 4-year record", /%$/.test(c4.roic.text));
ok(`revenue stays latest-FY (got ${c4.revenue.text})`, c4.revenue.text === "$1K" || c4.revenue.text === "$1,000" || c4.revenue.sort === 1000);

// ---- 1c: under three readable years, the median columns withhold ("—"); size still prints ----
const co2 = opCo([yr(2024, 1000, 700, 100), yr(2025, 1000, 700, 160)]);
const c2 = cellsFor(co2);
ok("gross margin withholds below 3 readable years", c2.grossMargin.text === "—" && c2.grossMargin.sort == null);
ok("operating margin withholds below 3 readable years", c2.operatingMargin.text === "—");
ok("roic withholds below 3 readable years", c2.roic.text === "—");
ok("revenue (a size column) still prints on a 2-year record", c2.revenue.sort != null);

// ---- 1d: a corrupt gross-margin year (mis-tagged near-zero cost line) never enters the median ----
// Real years at 29–32%; one impossible 95% year. Median of the readable four is 30%.
const coG = opCo([yr(2021, 1000, 700, 100), yr(2022, 1000, 710, 100), yr(2023, 1000, 690, 100), yr(2024, 1000, 50, 100), yr(2025, 1000, 680, 100)]);
const cg = cellsFor(coG);
ok(`corrupt gross-margin year excluded from the median (got ${cg.grossMargin.text})`, cg.grossMargin.text === "30.0%");

// ---- 1e: the category-error withholding still stands — a bank in an operating family reads n/a ----
const bank = { ...opCo([yr(2023, 1000, 700, 100), yr(2024, 1000, 700, 120), yr(2025, 1000, 700, 160)]), sic: "6022" };
const cb = cellsFor(bank);
ok("a bank's gross margin is n/a, not a number", cb.grossMargin.text === "n/a");
ok("a bank's operating margin is n/a, not a number", cb.operatingMargin.text === "n/a");

// ---- 2: the group line — medians of the table's own cells, a count for net debt, no grades ----
const gCols = [
  { key: "revenue", label: "Revenue", basis: "latest fiscal year, USD", type: "money" },
  { key: "operatingMargin", label: "Operating margin", basis: "median over the record", type: "pct" },
  { key: "netDebt", label: "Net debt", basis: "latest FY, USD", type: "money" },
];
const gRows = [
  [{ text: "$2.0B", sort: 2e9 }, { text: "10.0%", sort: 0.1 }, { text: "$100M", sort: 1e8 }],
  [{ text: "$1.0B", sort: 1e9 }, { text: "20.0%", sort: 0.2 }, { text: "+$50M cash", sort: -5e7 }],
  [{ text: "—", sort: null }, { text: "n/a", sort: null }, { text: "—", sort: null }],
];
const line = groupLine(gCols, gRows);
ok("group line states the medians and the net-cash count",
  line === "As a group: median revenue $1.5B; median operating margin 15.0%; 1 of 2 hold net cash.");
ok("group line grades nothing", !/best|worst|top|cheap|strong|weak/i.test(line || ""));
ok("group line is null when nothing is readable", groupLine(gCols, [gRows[2]]) === null);
ok("an unreadable column is simply skipped",
  groupLine(gCols, [gRows[0].map((c, i) => (i === 0 ? c : { text: "—", sort: null })), gRows[1].map((c, i) => (i === 0 ? c : { text: "—", sort: null }))]) === "As a group: median revenue $1.5B.");

// ---- 2b: the real pool, the page's own assembly — the line exists and names no member ----
{
  const grouping = groupingBySlug.get("make-vehicles-and-their-parts");
  const shelf = SHELVES.find((s) => s.noun === grouping.noun);
  const labels = new Set(shelf.industries.map((ind) => ind.label));
  const members = (fundamentals.companies || []).filter((c) => labels.has(industryLabelOf(c)));
  ok("the vehicles shelf has members in the US pool", members.length >= 10);
  const cellRows = members.map((c) => groupingCells(c, grouping.family, usdTerms(c, adrRatios, rates)));
  const real = groupLine(FAMILIES[grouping.family].columns, cellRows);
  ok("real-pool group line renders", typeof real === "string" && real.startsWith("As a group: "));
  // Naming no member: no ticker appears as a standalone token, and no company name appears at all.
  const tokens = new Set((real || "").split(/[^A-Za-z0-9]+/));
  ok("real-pool group line names no member", real && !members.some((m) => tokens.has(String(m.ticker).toUpperCase()) || (m.name && real.includes(m.name))));
}

console.log(`groupingsTest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
