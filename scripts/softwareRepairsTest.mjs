// softwareRepairsTest.mjs — case law for the software desk's repair order (2026-07-22).
//
// Two rules under test, both pool-wide rather than software-specific:
//
// 1. The fiscal-year label for 52/53-week filers. A period ending in the first fortnight of
//    January belongs to the year that just closed. Getting this wrong does not merely mislabel a
//    column: it collides two real years into one bucket and silently erases one. Leidos lost
//    FY2020 and Cadence lost FY2021 that way.
// 2. The SG&A reconstruction. Where a filer splits selling-and-marketing from general-and-
//    administrative and never files the combined element, reading the second alone drops the
//    entire customer-acquisition outlay. Salesforce printed 7% of revenue against a true 42%.
// 3. The cost-of-revenue scope rules, which the same sweep turned up: a near-synonym further down
//    the chain can carry an order of magnitude more for the same year, meaning the two elements are
//    not the same scope. Caterpillar printed a 99.9% gross margin that way.
import { fyOfEnd, sgaSeries, annualByYear, thinCor } from "./fetchFundamentals.mjs";

let failed = 0;
const t = (name, ok, got) => {
  if (!ok) { failed++; console.error(`✗ ${name}${got !== undefined ? ` -> ${JSON.stringify(got)}` : ""}`); }
  else console.log(`ok ${name}`);
};

// --- 1. the January fortnight rule ---
{
  t("Leidos's 2026-01-02 year end is fiscal 2025", fyOfEnd("2026-01-02") === 2025, fyOfEnd("2026-01-02"));
  t("Cadence's 2021-01-02 year end is fiscal 2020", fyOfEnd("2021-01-02") === 2020, fyOfEnd("2021-01-02"));
  t("January 14 is the last day that shifts", fyOfEnd("2026-01-14") === 2025, fyOfEnd("2026-01-14"));
  t("January 15 does not shift", fyOfEnd("2026-01-15") === 2026, fyOfEnd("2026-01-15"));
  // The late-January enders are the reason the rule is a fortnight and not a month: Salesforce,
  // Autodesk, Snowflake and twenty more call the year ending 2026-01-31 their fiscal 2026, and
  // shifting them would break a correctly-labelled record across the whole software shelf.
  t("Salesforce's 2026-01-31 year end stays fiscal 2026", fyOfEnd("2026-01-31") === 2026, fyOfEnd("2026-01-31"));
  t("a December year end is untouched", fyOfEnd("2025-12-31") === 2025, fyOfEnd("2025-12-31"));
  t("a mid-year year end is untouched (Microsoft June)", fyOfEnd("2025-06-30") === 2025, fyOfEnd("2025-06-30"));
  t("a February year end is untouched", fyOfEnd("2026-02-01") === 2026, fyOfEnd("2026-02-01"));
}

// --- 2. the fortnight rule inside the extractor, and the collision it prevents ---
{
  // Two consecutive real fiscal years whose period ends fall in the same calendar year. Under the
  // old calendar-year rule both land on 2021 and the later filing silently wins, erasing FY2020.
  const facts = { facts: { "us-gaap": { Revenues: { units: { USD: [
    { form: "10-K", start: "2020-01-04", end: "2021-01-02", val: 12197, filed: "2021-02-16" },
    { form: "10-K", start: "2021-01-03", end: "2021-12-31", val: 13617, filed: "2022-02-15" },
  ] } } } } };
  const by = annualByYear(facts, ["Revenues"]);
  t("two year ends in one calendar year keep both fiscal years", by[2020]?.val === 12197 && by[2021]?.val === 13617, by);
}

// --- 3. the SG&A reconstruction ---
{
  // The combined element always wins where the filer files it.
  t("the combined element wins", sgaSeries({ 2025: 900 }, { 2025: 600 }, { 2025: 300 })[2025] === 900);

  // Salesforce's shape: no combined element, both legs present. FY2026 selling-and-marketing
  // 14,345 plus general-and-administrative 3,000 against revenue 41,525 is 41.8%, which is the
  // figure the row claims to show; general-and-administrative alone reads 7.2%.
  const crm = sgaSeries({}, { 2026: 14345 }, { 2026: 3000 });
  t("both legs sum where the combined element is absent", crm[2026] === 17345, crm);

  // A filer with no selling line at all keeps its administrative expense, unchanged from the
  // behaviour before the repair, so no REIT or closed-end manager loses a value it already had.
  t("general-and-administrative alone still stands", sgaSeries({}, {}, { 2025: 250 })[2025] === 250);

  // Half a bucket under a whole bucket's name is the same error in smaller print.
  t("a selling leg alone is never shown", sgaSeries({}, { 2025: 600 }, {})[2025] === undefined, sgaSeries({}, { 2025: 600 }, {}));

  // Per-year resolution: the combined element may cover only part of a record's span.
  const mixed = sgaSeries({ 2023: 800 }, { 2024: 500, 2025: 600 }, { 2024: 200, 2025: 300 });
  t("the rule resolves year by year", mixed[2023] === 800 && mixed[2024] === 700 && mixed[2025] === 900, mixed);

  // A year where only one leg was filed must not borrow the other year's leg.
  const gap = sgaSeries({}, { 2024: 500 }, { 2024: 200, 2025: 300 });
  t("a one-legged year falls back to administrative, never to another year", gap[2024] === 700 && gap[2025] === 300, gap);
}

// --- 4. the cost-of-revenue scope conflict ---
{
  const mk = (rows) => ({ facts: { "us-gaap": Object.fromEntries(rows.map(([tag, vals]) => [tag, { units: { USD: vals } }])) } });
  // Caterpillar's shape: a $49M fragment tagged first, the $44,752M total tagged second.
  const cat = mk([
    ["CostOfGoodsAndServicesSold", [{ form: "10-K", start: "2025-01-01", end: "2025-12-31", val: 49e6, filed: "2026-02-01" }]],
    ["CostOfRevenue", [{ form: "10-K", start: "2025-01-01", end: "2025-12-31", val: 44752e6, filed: "2026-02-01" }]],
  ]);
  t("a 900x gap promotes the larger element to the total",
    annualByYear(cat, ["CostOfGoodsAndServicesSold", "CostOfRevenue"], "USD", false, true)[2025]?.val === 44752e6,
    annualByYear(cat, ["CostOfGoodsAndServicesSold", "CostOfRevenue"], "USD", false, true)[2025]);

  // Without the flag the chain still resolves by order, so nothing else in the pipeline moves.
  t("chain order still decides where the rule is not asked for",
    annualByYear(cat, ["CostOfGoodsAndServicesSold", "CostOfRevenue"], "USD")[2025]?.val === 49e6);

  // A narrow gap is a presentation choice (one element carrying depreciation, the other not),
  // not a scope error, and chain order must keep deciding it.
  const narrow = mk([
    ["CostOfGoodsAndServicesSold", [{ form: "10-K", start: "2025-01-01", end: "2025-12-31", val: 1000e6, filed: "2026-02-01" }]],
    ["CostOfRevenue", [{ form: "10-K", start: "2025-01-01", end: "2025-12-31", val: 1100e6, filed: "2026-02-01" }]],
  ]);
  t("a 1.1x gap does not promote",
    annualByYear(narrow, ["CostOfGoodsAndServicesSold", "CostOfRevenue"], "USD", false, true)[2025]?.val === 1000e6);
}

// --- 5. the thin-cost floor ---
{
  t("CenterPoint's $4M against $9,337M is withheld", thinCor(4e6, 9337e6) === null);
  t("Caterpillar's restored total stands", thinCor(44752e6, 67589e6) === 44752e6);
  t("Adobe's genuinely light cost of sales stands", thinCor(2534e6, 23769e6) === 2534e6);
  t("a null stays null", thinCor(null, 1000) === null);
  t("no revenue means no judgment, so the value is left alone", thinCor(5, 0) === 5);
}

if (failed) { console.error(`\n❌ softwareRepairsTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ softwareRepairsTest passed.");
