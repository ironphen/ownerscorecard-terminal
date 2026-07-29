// The sector column rule (UX audit spec, 2026-07-25, section 2B) — the one place it is written.
//
// A sector table is a DIFFERENT INSTRUMENT from an industry table, not a bigger one. At sector
// scale the reader is asking how big, how profitable, how much capital, how much debt, across many
// kinds of business at once; the specialist columns (what is contracted for next year in software,
// inventory days in semiconductors, deposits in banks) belong to the industry table one step down.
// So the sector set is chosen by WHAT THE SECTOR'S ROWS CAN ANSWER, not by what its families
// happen to list. An intersection of family column sets would measure editorial crowding instead,
// and it produces a one-column Health Care table.
//
// The rule:
//   1. Single-family sector: that family's columns, unchanged. No rule, no argument.
//   2. Otherwise, candidates are the union of the member families' columns, and a candidate is
//      kept only if BOTH
//        (a) COVERAGE: the families that list it cover at least 40% of the sector's rows (the
//            anti-tail test — one small industry never drags its specialist instrument onto a
//            whole sector's table), and
//        (b) ANSWER RATE: it returns a sortable figure for at least two thirds of the sector's
//            rows (the anti-dash test — a column of holes is worse than a narrower table).
//   3. Cap at 7 (the FAMILIES standard: dense enough to compare, never a wall), ranked by coverage
//      then answer rate, but RENDERED in the canonical COL declaration order so every sector table
//      reads the same way left to right.
//   4. Hand amendments are permitted, one line each, with the reason recorded. The rule generates
//      a defensible default; it does not get the last word. (AMENDMENTS, below.)
//
// This module is imported by scripts/groupingsTest.mjs as a DRIFT CHECK: it recomputes the sets off
// the live pools and fails when they no longer match the frozen SECTOR_COLUMNS literal in
// src/lib/groupingColumns.mjs. That is deliberate. A data-driven column set could otherwise
// silently rewrite a published page between two builds, and a reader's bookmarked ?sort= URL would
// quietly stop resolving. A data change must force a human decision, not perform one.
//
// Run it directly to see the full measurement:  node scripts/sectorColumnsRule.mjs
import fundamentals from "../src/data/fundamentals.json" with { type: "json" };
import adrData from "../src/data/fundamentals.adr.json" with { type: "json" };
import jpData from "../src/data/fundamentals.jp.json" with { type: "json" };
import adrRatios from "../src/data/adrRatios.json" with { type: "json" };
import rates from "../src/data/rates.json" with { type: "json" };
import { industryLabelOf, shelfOfIndustry } from "../src/lib/shelves.mjs";
import { COL, FAMILIES, usdTerms, groupingCells } from "../src/lib/groupingColumns.mjs";

export const COVERAGE_FLOOR = 0.4;
export const ANSWER_FLOOR = 2 / 3;
export const COLUMN_CAP = 7;

// The canonical render order: the COL declaration order in groupingColumns.mjs.
const COL_ORDER = Object.keys(COL);

// Hand amendments (rule step 4). Each is one line and carries its reason in the file, per the
// spec's requirement that the reason be recorded rather than the outcome only.
export const AMENDMENTS = {
  // Information Technology gains NET DEBT. It answers 97% of IT rows and is a category error for
  // none of them; it fails only the coverage test, and it fails it for a purely editorial reason —
  // the software and semiconductor families spent their column budget on their own specialist
  // lines. Debt net of the cash against it is close to the most Graham column on the board, and
  // refusing to print it sector-wide because two families were crowded is the rule outranking the
  // judgment it was meant to serve.
  "Information Technology": { add: ["netDebt"] },
  // Utilities narrows to the universal reads (Wave C, 2026-07-28). The single-family branch would
  // carry the utility family's four specialist columns onto the sector table, where they answer
  // 34-53% of rows — the merchant generators and YieldCos that share these shelves fail the
  // rate-regulated gate and print dashes, which is honest on a forty-row industry table and a wall
  // of holes at sector scale (the anti-dash floor exists for exactly this). The regulated ledger
  // and the reinvestment columns live one step down on the four industry tables; the sector keeps
  // what every kind of power-and-water business can answer — the earned return, the dividend, and
  // net debt, hand-restored on the Information Technology precedent because a sector this
  // leveraged without a debt column is the rule outranking the judgment it serves (answers 91%).
  "Utilities": { add: ["netDebt"], drop: ["plantGrowth", "afudcShare", "regAssets", "regLiabilities"] },
  // FLAGGED, NOT APPLIED: Financials gaining TOTAL ASSETS. It answers 97% of Financials rows and
  // is the size measure a lender is genuinely read on, and revenue for a bank is a reconstruction.
  // Against it: total assets appears in no Financials family today, only in the property family, so
  // adding it would be a new curation claim about how these businesses are read rather than a
  // rearrangement of existing ones. That is the owner's call and it has not been made.
};

// Every row the groupings surface knows about: the three pools, presence on a shelf the only
// criterion, exactly as /groupings/[slug] counts it. (The EU pool is outside this surface entirely;
// the sector pages state the three-pool scope rather than silently dropping 45 records.)
export function sectorRows() {
  const pools = [fundamentals.companies || [], adrData.companies || [], jpData.companies || []];
  const bySector = new Map();
  for (const pool of pools) {
    for (const c of pool) {
      const shelf = shelfOfIndustry(industryLabelOf(c));
      if (!shelf) continue;
      if (!bySector.has(shelf.sector)) bySector.set(shelf.sector, []);
      bySector.get(shelf.sector).push({ company: c, family: shelf.family, terms: usdTerms(c, adrRatios, rates) });
    }
  }
  return bySector;
}

// One sector's measurement: every candidate's coverage and answer rate, and the kept set.
export function measureSector(rows) {
  const families = [...new Set(rows.map((r) => r.family))];
  const total = rows.length;

  // Rule 1: single family, that family's columns unchanged.
  if (families.length === 1) {
    return {
      families,
      total,
      single: families[0],
      keys: FAMILIES[families[0]].columns.map((c) => c.key),
      measured: measureKeys(rows, FAMILIES[families[0]].columns.map((c) => c.key), families),
    };
  }

  const candidates = [];
  for (const f of families) for (const col of FAMILIES[f].columns) if (!candidates.includes(col.key)) candidates.push(col.key);
  const measured = measureKeys(rows, candidates, families);

  const kept = measured
    .filter((m) => m.coverage >= COVERAGE_FLOOR && m.answerRate >= ANSWER_FLOOR)
    .sort((a, b) => b.coverage - a.coverage || b.answerRate - a.answerRate)
    .slice(0, COLUMN_CAP)
    .map((m) => m.key);

  return { families, total, single: null, keys: kept, measured };
}

function measureKeys(rows, keys, families) {
  const cols = keys.map((k) => COL[k]);
  const answered = new Map(keys.map((k) => [k, 0]));
  for (const r of rows) {
    // The KEY LIST comes from the table; the WITHHOLDING SEMANTICS come from the row's own family.
    // That distinction is the whole reason a REIT's net debt survives on a mixed sector table.
    const cells = groupingCells(r.company, r.family, r.terms, cols);
    // A NORMALIZED answer only. Since 2026-07-27 a ratio cell built on one or two years still prints,
    // marked with its year count — the right call for a reader looking at one company, and the wrong
    // input to THIS question, which is whether a column earns its place across a whole sector. Counting
    // short records as answers moved gross margin from 61% to 67% of Health Care rows and pushed it
    // over the two-thirds bar, so a column the rule had deliberately dropped would have returned on the
    // strength of one-year figures from biotechs whose cost lines are the reason it was dropped. A
    // column carried by short records is exactly the column that reads as a wall of qualifiers at
    // sector scale, so the bar is measured on figures the record actually supports.
    cells.forEach((cell, i) => {
      if (!cell || cell.sort == null) return;
      if (cell.years != null && cell.years < 3) return;
      answered.set(keys[i], answered.get(keys[i]) + 1);
    });
  }
  const rowsInFamily = new Map(families.map((f) => [f, rows.filter((r) => r.family === f).length]));
  return keys.map((k) => {
    const listing = families.filter((f) => FAMILIES[f].columns.some((c) => c.key === k));
    const covered = listing.reduce((a, f) => a + rowsInFamily.get(f), 0);
    return {
      key: k,
      coverage: rows.length ? covered / rows.length : 0,
      answerRate: rows.length ? answered.get(k) / rows.length : 0,
      answered: answered.get(k),
      listing,
    };
  });
}

// The rule plus its amendments, in canonical order — the exact shape the frozen literal must match.
export function computeSectorColumns() {
  const out = new Map();
  for (const [sector, rows] of sectorRows()) {
    const m = measureSector(rows);
    let keys = [...m.keys];
    const amend = AMENDMENTS[sector];
    if (amend?.add) for (const k of amend.add) if (!keys.includes(k)) keys.push(k);
    if (amend?.drop) keys = keys.filter((k) => !amend.drop.includes(k));
    keys.sort((a, b) => COL_ORDER.indexOf(a) - COL_ORDER.indexOf(b));
    out.set(sector, { keys, total: m.total, families: m.families, single: m.single, measured: m.measured });
  }
  return out;
}

// Direct run: the full measurement, for the hand-check the spec requires before freezing.
if (/sectorColumnsRule\.mjs$/.test(String(process.argv[1] || "").replace(/\\/g, "/"))) {
  const pct = (v) => `${(v * 100).toFixed(0)}%`;
  let grand = 0;
  for (const [sector, r] of computeSectorColumns()) {
    grand += r.total;
    console.log(`\n${sector} (${r.total} rows; families: ${r.families.join(", ")}${r.single ? " — SINGLE, family columns unchanged" : ""})`);
    console.log(`  KEPT: ${r.keys.join(" | ")}`);
    const byKey = new Map(r.measured.map((m) => [m.key, m]));
    for (const m of [...r.measured].sort((a, b) => b.coverage - a.coverage || b.answerRate - a.answerRate)) {
      const mark = r.keys.includes(m.key) ? "+" : " ";
      console.log(`   ${mark} ${m.key.padEnd(20)} coverage ${pct(m.coverage).padStart(4)}  answered ${pct(m.answerRate).padStart(4)} (${m.answered}/${r.total})`);
    }
    const worst = r.keys.map((k) => byKey.get(k)).filter(Boolean).sort((a, b) => a.answerRate - b.answerRate)[0];
    if (worst) console.log(`   lowest kept answer rate: ${worst.key} ${pct(worst.answerRate)}`);
  }
  console.log(`\ntotal rows across sectors: ${grand}`);
}
