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
import { GROUPINGS, FAMILIES, SECTORS, SECTOR_COLUMNS, sectorSlugOf, groupingBySlug, usdTerms, groupingCells, groupLine } from "../src/lib/groupingColumns.mjs";
import { computeSectorColumns } from "./sectorColumnsRule.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL " + name); } };

// ---- structure: one grouping per shelf (the import-time guard ran; re-state the shape) ----
ok("one grouping per shelf", GROUPINGS.length === SHELVES.length);
ok("every grouping resolves by slug", GROUPINGS.every((g) => groupingBySlug.get(g.slug) === g));
const allCols = Object.values(FAMILIES).flatMap((f) => f.columns);
// "num" joined money and pct when the semiconductor family added inventory days, which is a count
// of days and neither a sum nor a share. The group-line summary still speaks only for money
// columns, so a count is carried and rendered without being described in that sentence.
ok("every family column is well-formed", allCols.every((c) => c.key && c.label && c.basis && ["money", "pct", "num"].includes(c.type)));

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
// Margins by year: 10%, 12%, 20%, 16% — latest is 16%; sorted the middles are 12 and 16, so the
// median is 14%. This expectation moved on 2026-07-25: throughCycle() used to take the LOWER of
// two middle values while peers.mjs averaged them, so one concept printed two different numbers
// depending on which table a reader was looking at. The standard definition won.
const co4 = opCo([yr(2022, 1000, 700, 100), yr(2023, 1000, 700, 120), yr(2024, 1000, 700, 200), yr(2025, 1000, 700, 160)]);
const c4 = cellsFor(co4);
ok(`operating margin is the median over the record (got ${c4.operatingMargin.text})`, c4.operatingMargin.text === "14.0%");
ok("roic reads as a percent on a 4-year record", /%$/.test(c4.roic.text));
ok(`revenue stays latest-FY (got ${c4.revenue.text})`, c4.revenue.text === "$1K" || c4.revenue.text === "$1,000" || c4.revenue.sort === 1000);

// ---- 1c: under three readable years the figure PRINTS, carrying the count of years it rests on ----
// Reversed 2026-07-27 on the owner's ruling. These columns used to show an em-dash under three
// readable years, on the reasoning that one year dressed as a level is a lie. That is right about the
// LABEL and wrong about the FIGURE: a two-year-old filer has a real record, just a short one, and
// blanking it tells the reader nothing where saying "two years" tells them everything. The mark is
// what keeps the header ("median over the record") true, and it is not cosmetic — the same header was
// already false on 55 return-on-tangible-equity cells that printed off one or two years with nothing
// saying so, because that column had no floor while these three did.
const co2 = opCo([yr(2024, 1000, 700, 100), yr(2025, 1000, 700, 160)]);
const c2 = cellsFor(co2);
ok(`gross margin prints on a 2-year record, marked (got ${c2.grossMargin.text})`, c2.grossMargin.text === "30.0% · 2y" && c2.grossMargin.years === 2);
ok(`operating margin prints on a 2-year record, marked (got ${c2.operatingMargin.text})`, c2.operatingMargin.text === "13.0% · 2y");
ok("roic prints on a 2-year record and carries its year count", /· 2y$/.test(c2.roic.text) && c2.roic.years === 2);
ok("a short-record cell still sorts on its figure alone", c2.grossMargin.sort === 0.3);
ok("revenue (a size column) still prints on a 2-year record", c2.revenue.sort != null);
// Three or more readable years is a normalized figure and carries no mark at all.
ok("a full record carries no year mark", !/·/.test(c4.operatingMargin.text) && c4.operatingMargin.years === 4);

// ---- 1d: a corrupt gross-margin year (mis-tagged near-zero cost line) never enters the median ----
// Real years at 29-32%; one impossible 95% year, which never enters. Sorted, the readable four
// are 29, 30, 31, 32 and the median is their two middles averaged: 30.5%.
const coG = opCo([yr(2021, 1000, 700, 100), yr(2022, 1000, 710, 100), yr(2023, 1000, 690, 100), yr(2024, 1000, 50, 100), yr(2025, 1000, 680, 100)]);
const cg = cellsFor(coG);
ok(`corrupt gross-margin year excluded from the median (got ${cg.grossMargin.text})`, cg.grossMargin.text === "30.5%");

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
  const grouping = groupingBySlug.get("automobiles") || groupingBySlug.get("auto-components");
  const shelf = SHELVES.find((s) => s.noun === grouping.noun);
  const labels = new Set(shelf.industries.map((ind) => ind.label));
  const members = (fundamentals.companies || []).filter((c) => labels.has(industryLabelOf(c)));
  ok("the automobiles grouping has members in the US pool", members.length >= 5);
  const cellRows = members.map((c) => groupingCells(c, grouping.family, usdTerms(c, adrRatios, rates)));
  const real = groupLine(FAMILIES[grouping.family].columns, cellRows);
  ok("real-pool group line renders", typeof real === "string" && real.startsWith("As a group: "));
  // Naming no member: no ticker appears as a standalone token, and no company name appears at all.
  const tokens = new Set((real || "").split(/[^A-Za-z0-9]+/));
  ok("real-pool group line names no member", real && !members.some((m) => tokens.has(String(m.ticker).toUpperCase()) || (m.name && real.includes(m.name))));
}

// ---- 3: the sector tables — the frozen column sets, and the drift check behind them ----
// The sector sets are chosen by what a sector's rows can ANSWER (scripts/sectorColumnsRule.mjs),
// then frozen into the source, because a data-driven column set could otherwise rewrite a
// published page between two builds and break a reader's bookmarked ?sort= URL with nobody in the
// loop. This recomputes the rule over the live pools and fails when the answer has moved. That is
// a decision to make, not a test to silence: read the measurement (`node scripts/sectorColumnsRule.mjs`),
// then either accept the change into SECTOR_COLUMNS with its reason, or record why it is refused.
ok("eleven sectors, each with a frozen column set", SECTORS.length === 11 && SECTORS.every((s) => Array.isArray(SECTOR_COLUMNS[s.name])));
ok("every sector carries a stored slug", SECTORS.every((s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug)) && new Set(SECTORS.map((s) => s.slug)).size === SECTORS.length);
ok("no industry slug shadows the /groupings/sector route", GROUPINGS.every((g) => g.slug !== "sector"));
ok("sectorSlugOf resolves a known sector", sectorSlugOf("Financials") === "financials");
// Revenue first on every sector table, so the default largest-first order always has a column to
// read; and never more than seven, the same wall the families are held to.
ok("every sector set opens on revenue and caps at 7", Object.values(SECTOR_COLUMNS).every((cols) => cols[0].key === "revenue" && cols.length <= 7));
{
  const recomputed = computeSectorColumns();
  let drifted = 0;
  for (const s of SECTORS) {
    const want = SECTOR_COLUMNS[s.name].map((c) => c.key).join(" ");
    const got = (recomputed.get(s.name)?.keys || []).join(" ");
    if (want !== got) {
      drifted++;
      console.log(`  DRIFT ${s.name}\n    frozen:      ${want}\n    recomputed:  ${got}`);
    }
  }
  ok(`frozen sector columns still match the rule (${drifted} drifted)`, drifted === 0);

  // The drift check above compares the CHOSEN KEYS, which is silent for the five sectors that are
  // single-family: those take their family's columns unchanged and the selection floors are never
  // applied to them, so a column could rot to mostly dashes without anything failing. Real Estate's
  // dividend-against-operating-cash sits at 75% today and Utilities' owner earnings not far above
  // the floor, so this is a live risk rather than a theoretical one. Assert the ANSWER RATE on every
  // rendered column of every sector, single-family included: a column of holes is worse than a
  // narrower table, whichever branch of the rule put it there.
  let thin = 0;
  for (const s of SECTORS) {
    for (const m of recomputed.get(s.name)?.measured || []) {
      if (!SECTOR_COLUMNS[s.name].some((c) => c.key === m.key)) continue;
      if (m.answerRate < 2 / 3) {
        thin++;
        console.log(`  THIN ${s.name} · ${m.key} answers ${(m.answerRate * 100).toFixed(1)}% of rows`);
      }
    }
  }
  ok(`every rendered sector column answers two thirds of its rows (${thin} thin)`, thin === 0);
}

console.log(`groupingsTest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
