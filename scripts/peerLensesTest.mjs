// The peer bench's columns (src/lib/peerLenses.mjs), and the guard that keeps them from drifting away
// from the /groupings tables again.
//
// The owner reported the gap this file exists to close: the desks' specialist columns lived on the
// industry tables and never reached the bench on a company's own page. Fixing the six shipped desks
// fixes six desks; the SEVENTH would recreate the gap on the day it merged, because nothing in the
// codebase ever asked whether a new column belonged on both surfaces. The completeness check below is
// that question, asked at build time.
import { COL, FAMILIES } from "../src/lib/groupingColumns.mjs";
import { PEER_COL, PEER_LENSES, REFUSED_ON_BENCH, REFUSED_BY_LENS, lensKeyFor, peerColumnsFor } from "../src/lib/peerLenses.mjs";
import { secondaryListings, primaryTickerFor } from "../src/lib/listings.mjs";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); cond ? pass++ : fail++; };

// ---------------------------------------------------------------------------------------------
// Shape: every declared column is well-formed and every lens is drawn from the declaration.
// ---------------------------------------------------------------------------------------------
const allCols = Object.values(PEER_COL);
ok("every peer column is well-formed", allCols.every((c) => c.key && c.label && c.basis && typeof c.read === "function"));
ok("every peer column key matches its declaration key", Object.entries(PEER_COL).every(([k, c]) => c.key === k));
ok("every lens is built from the declaration, not from copies",
  Object.values(PEER_LENSES).every((cols) => cols.every((c) => PEER_COL[c.key] === c)));
ok("no lens repeats a column", Object.values(PEER_LENSES).every((cols) => new Set(cols.map((c) => c.key)).size === cols.length));
// The bench renders Company + Revenue + these. Seven comparison columns is the widest lens
// (semiconductors), which the owner accepted with horizontal scroll rather than dropping figures a
// reader can see today.
ok("no lens exceeds seven comparison columns", Object.values(PEER_LENSES).every((cols) => cols.length <= 7));

// ---------------------------------------------------------------------------------------------
// MONEY IS REFUSED ON THE BENCH, on every lens. The bench's device is a distribution read against the
// group median at the foot; the families' money lines would turn 0 group medians into 12,097, and 70%
// of the net-debt ones would be mixed-sign. A median of a set holding both net cash and net debt is
// not a fact about anything. This asserts the refusal rather than trusting it.
// ---------------------------------------------------------------------------------------------
// Tested on the COLUMN, not on its glossary link: a ratio may honestly borrow a money column's entry
// (debt-to-assets links to net-debt, yield-on-float to insurance-float) because that entry is where
// the word is defined. What must never appear is a money column itself.
const MONEY_KEYS = new Set(Object.values(COL).filter((c) => c.type === "money").map((c) => c.key));
ok("no lens renders a money column", Object.values(PEER_LENSES).every((cols) => cols.every((c) => !MONEY_KEYS.has(c.key))));
ok("no lens renders a second size line beside revenue",
  Object.values(PEER_LENSES).every((cols) => !cols.some((c) => ["deposits", "insFloat", "tangibleEquity", "premiums"].includes(c.key))));
// Owner earnings is the one concept that appears in both forms and is the exception that proves the
// rule: the grouping tables show the DOLLARS and the bench shows the MARGIN. Same concept, one
// glossary entry, two forms — the money form on the surface that compares levels, the ratio form on
// the surface that compares distributions.
ok("owner earnings appears on the bench as a margin, not as dollars", PEER_COL.oeMargin.label.includes("margin"));

// ---------------------------------------------------------------------------------------------
// THE COMPLETENESS GUARD. Every RATIO column on a /groupings family table must be either present on
// the matching peer lens or named in REFUSED_ON_BENCH with the measurement that refused it. A new
// desk column merges only after somebody answers that question one way or the other.
//
// The two surfaces use different key names for a handful of concepts that predate this file
// (operatingMargin/opMargin, rote/rotce, cashPayout/payout), so the pairing is stated once here
// rather than inferred. An unpaired ratio column fails loudly: that is a new column nobody has
// decided about, which is exactly what this guard is for.
// ---------------------------------------------------------------------------------------------
const BENCH_KEY = {
  grossMargin: "grossMargin", operatingMargin: "opMargin", roic: "roic", rote: "rotce",
  mlr: "mlr", cashPayout: "payout", nibShare: "nibShare",
  bookedYear: "bookedYear", salesMarketing: "salesMarketing", stockComp: "stockComp",
  rdIntensity: "rdIntensity", capexIntensity: "capexIntensity", inventoryDays: "inventoryDays",
  reserveLife: "reserveLife", reserveReplacement: "reserveReplacement", pudShare: "pudShare",
};
// Which peer lens a /groupings family's members are read on. Producer maps to the plain operating
// lens because its three reserve columns were measured too sparse for a seven-row bench.
const FAMILY_TO_LENS = {
  software: "software", semiconductor: "semiconductor", producer: "operating",
  general: "operating", heavy: "operating", lender: "bank", insurer: "insurer",
  managedCare: "managedCare", property: "reit", fee: "fee",
};
ok("every grouping family maps to a peer lens", Object.keys(FAMILIES).every((f) => PEER_LENSES[FAMILY_TO_LENS[f]]));

{
  const unpaired = [], undecided = [];
  for (const [famKey, fam] of Object.entries(FAMILIES)) {
    const lens = PEER_LENSES[FAMILY_TO_LENS[famKey]] || [];
    const onLens = new Set(lens.map((c) => c.key));
    for (const col of fam.columns) {
      if (col.type === "money") continue; // exempt by construction, asserted above
      const benchKey = BENCH_KEY[col.key];
      if (!benchKey) { unpaired.push(`${famKey}.${col.key}`); continue; }
      if (onLens.has(benchKey)) continue;
      if (REFUSED_ON_BENCH[col.key]) continue;
      if (REFUSED_BY_LENS[`${FAMILY_TO_LENS[famKey]}.${col.key}`]) continue;
      undecided.push(`${famKey}.${col.key} (would render on the ${FAMILY_TO_LENS[famKey]} lens)`);
    }
  }
  ok(`every grouping ratio column is paired to a bench key (${unpaired.join(", ") || "none unpaired"})`, unpaired.length === 0);
  ok(`every grouping ratio column is on its lens or refused with a reason (${undecided.join("; ") || "none undecided"})`, undecided.length === 0);
}

ok("every refusal carries a measurement, not just a verdict",
  [...Object.values(REFUSED_ON_BENCH), ...Object.values(REFUSED_BY_LENS)].every((why) => /\d/.test(why) && why.length > 30));
ok("nothing is both refused and rendered", Object.keys(REFUSED_ON_BENCH).every((k) =>
  Object.values(PEER_LENSES).every((cols) => !cols.some((c) => c.key === BENCH_KEY[k]))));
ok("a per-lens refusal names a lens that exists", Object.keys(REFUSED_BY_LENS).every((k) => PEER_LENSES[k.split(".")[0]]));
ok("a per-lens refusal does not render on that lens", Object.keys(REFUSED_BY_LENS).every((k) => {
  const [lens, col] = k.split(".");
  return !PEER_LENSES[lens].some((c) => c.key === BENCH_KEY[col]);
}));
// The split is only honest if the column really does render where the denominator exists: return on
// tangible equity is refused on fee and managed care and REQUIRED on the two families whose capital
// is tangible. A refusal everywhere would be a deletion wearing a reason.
ok("return on tangible equity still renders where the denominator exists",
  PEER_LENSES.bank.some((c) => c.key === "rotce") && PEER_LENSES.insurer.some((c) => c.key === "rotce"));

// ---------------------------------------------------------------------------------------------
// The desks' columns actually reach the companies they were written for.
// ---------------------------------------------------------------------------------------------
{
  const us = JSON.parse(readFileSync(new URL("../src/data/fundamentals.json", import.meta.url), "utf8"));
  const byT = (t) => (us.companies || []).find((c) => String(c.ticker).toUpperCase() === t);
  const keysFor = (t) => { const c = byT(t); return c ? peerColumnsFor(c).map((x) => x.key) : []; };

  ok("a software company's bench carries the software desk's columns",
    ["salesMarketing", "stockComp"].every((k) => keysFor("MSFT").includes(k)));
  ok("a semiconductor bench carries research, capital and the inventory cycle",
    ["rdIntensity", "capexIntensity", "inventoryDays"].every((k) => keysFor("NVDA").includes(k)));
  ok("a bank's bench carries the franchise read (the noninterest-bearing share)", keysFor("JPM").includes("nibShare"));
  ok("a REIT's bench is unchanged and carries no money column", keysFor("O").join(",") === "cashMargin,cashOnAssets,payout,debtToAssets");
  ok("an ordinary operating company keeps the plain owner-economics lens",
    keysFor("CAT").join(",") === "grossMargin,opMargin,roic,oeMargin");
  // A financial kind decides which STATEMENT a company is read on, so it wins over the taxonomy's
  // column family wherever it applies; the family route is only ever reached when there is no kind.
  ok("a financial kind outranks the column family", lensKeyFor(byT("JPM")) === "bank");

  // A CLAIM ON A BUSINESS GETS NO BENCH (owner ruling, 2026-07-27). Peers.astro renders a pointer to
  // the issuer's common stock instead of a comparative table, so the assertion here is on the
  // identification: the secondary listings must be found across BOTH pools that reach a /c/ page,
  // since four of the Brookfield Property series are ADR filings.
  const adr = JSON.parse(readFileSync(new URL("../src/data/fundamentals.adr.json", import.meta.url), "utf8"));
  const pool = [...(us.companies || []), ...(adr.companies || [])];
  const secondary = secondaryListings(pool);
  ok(`the listing pool finds the claims on a business (${secondary.size})`, secondary.size > 200);
  ok("AGNC's preferred series are claims, and AGNC itself is not",
    ["AGNCP", "AGNCN", "AGNCO"].every((t) => secondary.has(t)) && !secondary.has("AGNC"));
  ok("a claim points at the business behind it", primaryTickerFor(pool, "AGNCP") === "AGNC");
  ok("a business points at itself", primaryTickerFor(pool, "AGNC") === "AGNC");
  // The known limitation, asserted so it cannot regress silently into a ticker-shape guess: with no
  // common stock in the pool, Brookfield Property's series are indistinguishable from a primary
  // listing by any filed fact we hold.
  ok("the no-common-stock case is a known miss, not a silent guess", !secondary.has("BPYPM"));

  // The four measured refusals stay off every bench.
  ok("contracted revenue stays on the software TABLE and off the bench", !keysFor("MSFT").includes("bookedYear"));
  ok("the reserve columns stay on the producer TABLE and off the bench",
    !["reserveLife", "reserveReplacement", "pudShare"].some((k) => keysFor("FANG").includes(k)));
}

// ---------------------------------------------------------------------------------------------
// The readings themselves: a ratio read over the record carries its year count, a latest-year
// intensity carries none, and the two bases are never confused for each other.
// ---------------------------------------------------------------------------------------------
{
  const co = { ticker: "T", sic: "7372", lines: { revenue: 1000, operatingIncome: 200, sellingMarketing: 90, stockComp: 40 },
    history: [1, 2, 3, 4].map((i) => ({ lines: { revenue: 1000, operatingIncome: 100 * i } })) };
  const om = PEER_COL.opMargin.read(co);
  ok(`operating margin is the record median (got ${om && om.value})`, om && Math.abs(om.value - 0.25) < 1e-9 && om.years === 4);
  const sm = PEER_COL.salesMarketing.read(co);
  ok("sales & marketing is the latest year and carries no year count", sm && Math.abs(sm.value - 0.09) < 1e-9 && sm.years === null);
  ok("a latest-year column withholds where the line is absent", PEER_COL.rdIntensity.read(co) === null);
  const short = { ticker: "S", sic: "7372", lines: { revenue: 100, operatingIncome: 20 }, history: [{ lines: { revenue: 100, operatingIncome: 10 } }, { lines: { revenue: 100, operatingIncome: 20 } }] };
  const so = PEER_COL.opMargin.read(short);
  ok("a two-year record still reads, and says it is two years", so && Math.abs(so.value - 0.15) < 1e-9 && so.years === 2);
  // Inventory days is a count, not a share — the one column on the bench that is neither.
  ok("inventory days is declared a count, not a percent", PEER_COL.inventoryDays.type === "num");
}

console.log(`\npeerLensesTest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
