// oilGasLines.mjs — the oil & gas desk (docs/oil-gas-desk-survey.md, ratified 2026-07-26).
//
// THE FRAME: a producer sells its own inventory and must buy it back. Every barrel produced is a
// barrel gone, so the only question that matters over a cycle is whether the company replaces what
// it sells for less than it sells it for. Depletion is not an abstraction here, it is the cost of
// goods sold, which is why EBITDA is the most dangerous number in this industry.
//
// THE RULE THAT SHAPES EVERYTHING BELOW: publish where filed, withhold where not, NEVER impute.
// Unlike funds from operations, which no REIT tags at all, reserves ARE tagged in a stable standard
// vocabulary — but only by some filers. 21 of 51 producers surveyed carry the complete set. So the
// empty cells will sit on the same shelf beside full ones, and the temptation to fill one from a
// peer average will be permanent. It is refused here and must stay refused: a reserve figure is the
// one number in this industry a reader would act on.
//
// Reserves live in the srt: namespace, not us-gaap:, and carry a DECLARED UNIT that differs by
// filer (boe, bbl, Mcfe, MMcfe, Bcfe). The unit is load-bearing: EQT files the same production
// quantity in both MMcfe and Bcfe, a thousandfold apart, so any ratio mixing them is silently
// wrong by three orders of magnitude. Every ratio below therefore requires its inputs to carry the
// identical declared unit string, and refuses rather than converts.

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// Facts for one srt/us-gaap element, per fiscal year, keeping the DECLARED UNIT with the value.
// A reserve quantity without its unit is not a number, it is a rumour.
function byYearWithUnit(facts, ns, tag, { instant = false } = {}) {
  const units = facts?.facts?.[ns]?.[tag]?.units;
  if (!units) return null;
  const out = {};
  for (const [unit, arr] of Object.entries(units)) {
    for (const u of arr) {
      if (!u.form || !u.form.startsWith("10-K") || !u.end) continue;
      if (instant ? u.start : !u.start) continue;
      if (!instant) { const d = days(u.start, u.end); if (d < 350 || d > 380) continue; }
      const fy = new Date(u.end).getUTCFullYear();
      const cur = out[fy];
      if (!cur || (u.filed || "") > cur.filed) out[fy] = { val: u.val, unit, end: u.end, filed: u.filed || "" };
    }
  }
  return Object.keys(out).length ? out : null;
}

const firstOf = (facts, ns, tags, opts) => {
  for (const t of tags) { const s = byYearWithUnit(facts, ns, t, opts); if (s) return s; }
  return null;
};

const RESERVE_TOTAL = ["ProvedDevelopedAndUndevelopedReserveNetEnergy", "ProvedDevelopedAndUndevelopedReservesNet"];
const RESERVE_PD = ["ProvedDevelopedReservesBOE1", "ProvedDevelopedReservesVolume", "ProvedDevelopedReservesBOE"];
const RESERVE_PUD = ["ProvedUndevelopedReserveBOE1", "ProvedUndevelopedReserveVolume", "ProvedUndevelopedReserveBOE"];
const PRODUCTION = ["ProvedDevelopedAndUndevelopedReserveProductionEnergy", "ProvedDevelopedAndUndevelopedReservesProduction"];
const EXTENSIONS = ["ProvedDevelopedAndUndevelopedReserveExtensionAndDiscoveryEnergy", "ProvedDevelopedAndUndevelopedReservesExtensionsDiscoveriesAndAdditions"];
const REVISIONS = ["ProvedDevelopedAndUndevelopedReserveRevisionOfPreviousEstimateEnergy", "ProvedDevelopedAndUndevelopedReservesRevisionsOfPreviousEstimatesIncreaseDecrease"];

// Which of the two legal accounting methods the filer uses. This is not a footnote: successful
// efforts and full cost produce materially different earnings and asset bases for IDENTICAL wells,
// so a table comparing them on return on capital is comparing nothing. Both carry their own tag
// families, so the method is readable from structured data rather than from policy prose — and a
// filer showing markers of both, or of neither, returns undetermined rather than a guess.
export function accountingMethod(facts) {
  const g = facts?.facts?.["us-gaap"] || {};
  const has = (t) => !!g[t];
  const se = ["OilAndGasPropertySuccessfulEffortMethodGross", "OilAndGasPropertySuccessfulEffortMethodNet", "ProvedOilAndGasPropertySuccessfulEffortMethod", "CapitalizedExploratoryWellCostAdditionsPendingDeterminationOfProvedReserves"].some(has);
  const fc = ["OilAndGasPropertyFullCostMethodGross", "OilAndGasPropertyFullCostMethodNet", "OilAndGasPropertyFullCostMethodDepletion", "CapitalizedCostsOfUnprovedPropertiesExcludedFromAmortizationCumulative"].some(has);
  if (se && !fc) return "successfulEfforts";
  if (fc && !se) return "fullCost";
  return "undetermined";
}

export function hasOilGasData(facts) {
  return !!(byYearWithUnit(facts, "srt", RESERVE_TOTAL[0], { instant: true }) ||
    byYearWithUnit(facts, "srt", RESERVE_TOTAL[1], { instant: true }) ||
    accountingMethod(facts) !== "undetermined");
}

export function oilGasLines(facts, fyEnds = null) {
  const warns = [];
  const W = (s) => warns.push(s);
  const flows = {}, instants = {}, flags = {};

  const method = accountingMethod(facts);
  if (method !== "undetermined") flags.accountingMethod = method;

  const total = firstOf(facts, "srt", RESERVE_TOTAL, { instant: true });
  const pd = firstOf(facts, "srt", RESERVE_PD, { instant: true });
  const pud = firstOf(facts, "srt", RESERVE_PUD, { instant: true });
  const prod = firstOf(facts, "srt", PRODUCTION);
  const ext = firstOf(facts, "srt", EXTENSIONS);
  const rev = firstOf(facts, "srt", REVISIONS);
  if (!total) { if (warns.length) flags.warns = warns; return { flows, instants, flags }; }

  const years = Object.keys(total).map(Number).sort((a, b) => a - b);
  const latest = years[years.length - 1];

  // G5 FRESHNESS. A reserve fact's own period end must match the year it is shown against. EOG's
  // reserve facts stop at 2021 while it keeps filing 10-Ks; without this the terminal would serve a
  // four-year-old reserve base against current production and nothing would look wrong.
  const anchorEnd = fyEnds?.[latest];
  if (anchorEnd && Math.abs(days(anchorEnd, total[latest].end)) > 20) {
    W(`reserves: the filer's latest tagged reserve fact is ${total[latest].end}, not the fiscal year on this record — withheld rather than shown stale`);
    if (warns.length) flags.warns = warns;
    return { flows, instants, flags };
  }

  const keep = {};
  for (const fy of years) {
    const T = total[fy];
    if (!T || !(T.val > 0)) continue;

    // G4 SAME UNIT. Every input to a ratio must carry the identical declared unit string. EQT files
    // one production quantity in both MMcfe and Bcfe; mixing them is a thousandfold error that
    // looks entirely plausible on the page.
    const sameUnit = (s) => (s?.[fy] && s[fy].unit === T.unit ? s[fy].val : null);
    const d = sameUnit(pd), u = sameUnit(pud), p = sameUnit(prod);

    // G1 COMPONENT IDENTITY. Developed plus undeveloped must equal the total. Catches unit and
    // period mismatches, and passed 20 of the 21 complete filers on its own.
    if (d != null && u != null && Math.abs(d + u - T.val) > Math.abs(T.val) * 0.0001) {
      W(`reserves ${fy}: developed plus undeveloped does not equal the total — withheld`);
      continue;
    }

    // G6 NARRATIVE FACTS. A magnitude sanity band against production: a reserve base is years of
    // production, never a fraction of one and never a thousand years of it. Catches sentence
    // fragments tagged as schedule lines (Matador's only reserve fact is a gas plant's daily inlet
    // capacity) and scale errors that survive every other test.
    if (p != null && p > 0) {
      const life = T.val / p;
      if (!(life >= 1 && life <= 100)) {
        W(`reserves ${fy}: ${life.toFixed(1)} years of production is outside the plausible band — the fact is not a reserve schedule line, withheld`);
        continue;
      }
    }

    keep[fy] = { total: T.val, unit: T.unit, pd: d, pud: u, prod: p, ext: sameUnit(ext), rev: sameUnit(rev) };
  }

  if (!Object.keys(keep).length) { if (warns.length) flags.warns = warns; return { flows, instants, flags }; }

  const set = (bag, line, pick) => {
    const o = {};
    for (const [fy, k] of Object.entries(keep)) { const v = pick(k); if (v != null) o[fy] = v; }
    if (Object.keys(o).length) bag[line] = o;
  };
  set(instants, "provedReserves", (k) => k.total);
  set(instants, "provedDevelopedReserves", (k) => k.pd);
  set(instants, "provedUndevelopedReserves", (k) => k.pud);
  set(flows, "reservesProduced", (k) => k.prod);
  // Reserve life, in years: how long the company could produce at this rate before it had nothing
  // left to sell. The most useful single number a producer has.
  set(instants, "reserveLifeYears", (k) => (k.prod > 0 ? k.total / k.prod : null));
  // The share of proved reserves that is undeveloped — a promise requiring future capital rather
  // than a fact. Booked on an intent to drill within five years.
  set(instants, "pudShare", (k) => (k.pud != null && k.total > 0 ? k.pud / k.total : null));
  // Replacement by the drill bit: what the company found and revised, against what it produced.
  // Revisions are ALWAYS included, including negative ones — excluding them would report only the
  // good news, which is the entire trick this line exists to prevent.
  set(flows, "reserveReplacement", (k) => (k.prod > 0 && k.ext != null && k.rev != null ? (k.ext + k.rev) / k.prod : null));

  // The declared unit travels with the figures, because a reserve quantity without its unit is not
  // comparable to anything.
  flags.reserveUnit = keep[Math.max(...Object.keys(keep).map(Number))].unit;
  if (warns.length) flags.warns = [...new Set(warns)];
  return { flows, instants, flags };
}

export const OILGAS_LINE_NAMES = [
  "provedReserves", "provedDevelopedReserves", "provedUndevelopedReserves", "reservesProduced",
  "reserveLifeYears", "pudShare", "reserveReplacement",
];
