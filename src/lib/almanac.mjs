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

export function computeAlmanac(usCompanies, adrCompanies, jpCompanies) {
  const all = [...(usCompanies || []), ...(adrCompanies || []), ...(jpCompanies || [])];

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
    universe: { total: all.length, readable, us: (usCompanies || []).length, adr: (adrCompanies || []).length, jp: (jpCompanies || []).length },
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
