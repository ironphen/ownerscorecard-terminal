// The Almanac — a census of the whole catalog, computed at build time from the same per-company
// figures the compare cards use. Its entire purpose is to be a CITABLE base-rate reference: "what
// fraction of companies earned 15% on capital over a decade," "how many carry net cash," "how many
// clear Graham's defensive tests." No free primary-source publishes these, which is exactly why an
// answer engine or a journalist reaches for them — a pull artifact that gets cited without a byline.
//
// Doctrine, held strictly: DISTRIBUTIONS AND COUNTS ONLY. Never a ranked list of named companies —
// that would be a pronouncement (arrangement is a verdict). The Almanac states what the population
// looks like; it never says which companies are the good ones. Figures are through-the-cycle
// medians where the compare card reads them that way, so one peak or trough year never sets a level.
import { buildCompareCard } from "./compareCard.mjs";

// Percentiles by linear interpolation on the sorted sample. Returns null for an empty sample.
function pct(sortedVals, p) {
  if (!sortedVals.length) return null;
  if (sortedVals.length === 1) return sortedVals[0];
  const idx = p * (sortedVals.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedVals[lo];
  return sortedVals[lo] + (sortedVals[hi] - sortedVals[lo]) * (idx - lo);
}

// A continuous metric's distribution: the count and the p10/p25/median/p75/p90 spread.
export function distribution(values) {
  const vals = values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!vals.length) return { n: 0 };
  return {
    n: vals.length,
    p10: pct(vals, 0.1), p25: pct(vals, 0.25), median: pct(vals, 0.5),
    p75: pct(vals, 0.75), p90: pct(vals, 0.9),
  };
}

// The share of a sample that clears a threshold, as { n, pass, share } — a base rate.
export function shareAtLeast(values, threshold) {
  const vals = values.filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return { n: 0, pass: 0, share: null };
  const pass = vals.filter((v) => v >= threshold).length;
  return { n: vals.length, pass, share: pass / vals.length };
}

// Legal-suffix stripping for cross-pool identity: "Toyota Motor Corporation" (the ADR) and "Toyota
// Motor" (the home-market listing) resolve to the same key. Deliberately conservative — only
// corporate-form words are removed, never descriptive ones like "group" or "holdings" — and a match
// is trusted ONLY within the same country, so an unrelated same-normalized name elsewhere is never
// merged. When there is no ISIN in the data, this is the reliable cross-listing key available.
const norm = (s) => String(s || "").toLowerCase()
  .replace(/\b(corporation|corp|incorporated|inc|company|co|limited|ltd|plc)\b/g, "")
  .replace(/[^a-z0-9]/g, "");

// us: the US pool. adr: the ADR (SEC 20-F) pool. homePools: [{ country, companies }], one per
// home-market catalog (Japan today; Europe/UK later, each keyed by its own country). A company
// listed BOTH as an ADR and in its home market — Toyota, Sony, and the like — is counted once, as
// the home-market listing, so the census never double-counts it. An ADR with no home-market pool
// (a Chinese or Canadian filer with only a 20-F) is kept, since it is the only version there is.
export function computeAlmanac({ us = [], adr = [], homePools = [] }) {
  const homeByCountry = new Map();
  const homeCompanies = [];
  for (const pool of homePools) {
    if (!homeByCountry.has(pool.country)) homeByCountry.set(pool.country, new Set());
    const set = homeByCountry.get(pool.country);
    for (const c of pool.companies || []) { const k = norm(c.name); if (k) set.add(k); homeCompanies.push(c); }
  }
  const adrDeduped = (adr || []).filter((c) => {
    const set = homeByCountry.get(c.country);
    return !(set && set.has(norm(c.name)));
  });
  const droppedDuplicates = (adr || []).length - adrDeduped.length;
  const all = [...(us || []), ...adrDeduped, ...homeCompanies];

  // Collect the per-company figures once. A company that cannot be read is simply absent from the
  // metric it fails, never a zero — the same withholding the pages make.
  const roic = [], opMargin = [], grossMargin = [], oeMargin = [];
  const revGrowth = [], oeGrowth = [], shareChange = [];
  let readable = 0;
  let netCash = 0, netCashDen = 0;
  let profitableEveryYear = 0, profitableDen = 0;
  let grewRevenue = 0, revDen = 0;
  let boughtBack = 0, diluted = 0, shareDen = 0;
  // Graham's defensive tests: the count of applicable tests each company passes.
  const defensivePassCounts = [];
  let defensiveAllPass = 0, defensiveDen = 0;

  for (const c of all) {
    let card;
    try { card = buildCompareCard(c); } catch { continue; }
    if (!card) continue;
    readable++;
    const q = card.quality || {}, cm = card.compounding || {}, sv = card.survival || {}, st = card.stewardship || {};

    if (q.roicThroughCycle?.median != null) roic.push(q.roicThroughCycle.median);
    if (q.operatingMarginThroughCycle?.median != null) opMargin.push(q.operatingMarginThroughCycle.median);
    if (q.grossMarginLatest != null && Number.isFinite(q.grossMarginLatest)) grossMargin.push(q.grossMarginLatest);
    if (q.ownerEarningsMarginThroughCycle?.median != null) oeMargin.push(q.ownerEarningsMarginThroughCycle.median);
    if (cm.revenueGrowthDelivered != null && Number.isFinite(cm.revenueGrowthDelivered)) revGrowth.push(cm.revenueGrowthDelivered);
    if (cm.ownerEarningsGrowthDelivered != null && Number.isFinite(cm.ownerEarningsGrowthDelivered)) oeGrowth.push(cm.ownerEarningsGrowthDelivered);

    // Net cash vs net debt — only where the balance sheet was read (netDebt present).
    if (sv.netDebt != null && Number.isFinite(sv.netDebt)) { netCashDen++; if (sv.netCash) netCash++; }

    // Profitable in every year of a record of at least five readable years.
    if (sv.recordYears != null && sv.recordYears >= 5 && sv.profitableYears != null) {
      profitableDen++;
      if (sv.profitableYears === sv.recordYears) profitableEveryYear++;
    }

    // Grew revenue over the record (delivered CAGR positive).
    if (cm.revenueGrowthDelivered != null && Number.isFinite(cm.revenueGrowthDelivered)) {
      revDen++;
      if (cm.revenueGrowthDelivered > 0) grewRevenue++;
    }

    // Share count: reduced (bought back) vs increased (diluted), from the delivered share change.
    if (st.shareChange != null && Number.isFinite(st.shareChange)) {
      shareChange.push(st.shareChange);
      shareDen++;
      if (st.shareChange < -0.005) boughtBack++;      // more than a rounding retirement
      else if (st.shareChange > 0.005) diluted++;
    }

    // Graham's seven defensive tests: count applicable passes; a company with at least four
    // applicable tests read enters the distribution (so a thin record does not read as "0 of 7").
    if (Array.isArray(sv.graham)) {
      const applicable = sv.graham.filter((t) => t.status === "pass" || t.status === "fail");
      if (applicable.length >= 4) {
        const passes = applicable.filter((t) => t.status === "pass").length;
        defensivePassCounts.push(passes);
        defensiveDen++;
        if (passes === applicable.length) defensiveAllPass++;
      }
    }
  }

  const rate = (num, den) => (den > 0 ? num / den : null);

  // The defensive pass-count histogram: how many companies pass k of their applicable tests.
  const defHist = {};
  for (let k = 0; k <= 7; k++) defHist[k] = 0;
  for (const k of defensivePassCounts) defHist[k] = (defHist[k] || 0) + 1;

  return {
    universe: { total: all.length, readable, us: (us || []).length, adr: adrDeduped.length, home: homeCompanies.length, droppedDuplicates },
    // Continuous distributions (decimals; 0.15 = 15%).
    distributions: {
      roicThroughCycle: distribution(roic),
      operatingMarginThroughCycle: distribution(opMargin),
      grossMarginLatest: distribution(grossMargin),
      ownerEarningsMarginThroughCycle: distribution(oeMargin),
      revenueGrowthDelivered: distribution(revGrowth),
      ownerEarningsGrowthDelivered: distribution(oeGrowth),
      shareChangeDelivered: distribution(shareChange),
    },
    // Base rates — the citable "what fraction of companies…" facts.
    baseRates: {
      roicAtLeast10: shareAtLeast(roic, 0.10),
      roicAtLeast15: shareAtLeast(roic, 0.15),
      roicAtLeast20: shareAtLeast(roic, 0.20),
      netCash: { n: netCashDen, pass: netCash, share: rate(netCash, netCashDen) },
      profitableEveryYear: { n: profitableDen, pass: profitableEveryYear, share: rate(profitableEveryYear, profitableDen) },
      grewRevenue: { n: revDen, pass: grewRevenue, share: rate(grewRevenue, revDen) },
      reducedShareCount: { n: shareDen, pass: boughtBack, share: rate(boughtBack, shareDen) },
      dilutedShareCount: { n: shareDen, pass: diluted, share: rate(diluted, shareDen) },
      passedAllDefensiveTests: { n: defensiveDen, pass: defensiveAllPass, share: rate(defensiveAllPass, defensiveDen) },
    },
    defensiveHistogram: { n: defensiveDen, counts: defHist },
  };
}
