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
//
// The census can also be sliced by our own shelf-groupings (computeAlmanac returns one census per
// shelf with a large-enough sample). The groups are in the fixed shelf order — a reading order, never
// a ranking — so a reader can ask "of the businesses that make machines, how many earn 15% on
// capital" without the page ever ranking the groups against each other.
import { buildCompareCard } from "./compareCard.mjs";
import { SHELVES, industryLabelOf, shelfOfIndustry } from "./shelves.mjs";

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

const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Legal-suffix stripping for cross-pool identity: "Toyota Motor Corporation" (the ADR) and "Toyota
// Motor" (the home-market listing) resolve to the same key. Deliberately conservative — only
// corporate-form words are removed, never descriptive ones like "group" or "holdings" — and a match
// is trusted ONLY within the same country, so an unrelated same-normalized name elsewhere is never
// merged. When there is no ISIN in the data, this is the reliable cross-listing key available.
const norm = (s) => String(s || "").toLowerCase()
  .replace(/\b(corporation|corp|incorporated|inc|company|co|limited|ltd|plc)\b/g, "")
  .replace(/[^a-z0-9]/g, "");

// The per-company figures a card contributes to the census. Collected once per card so a company can
// feed both the whole-catalog census and its shelf group without rebuilding its card.
function censusFrom(cards) {
  const roic = [], roe = [], worstRoic = [], opMargin = [], grossMargin = [], oeMargin = [];
  const revGrowth = [], oeGrowth = [], shareChange = [], currentRatio = [], interestCoverage = [];
  let readable = 0;
  let netCash = 0, netCashDen = 0;
  let profitableEveryYear = 0, profitableDen = 0;
  let grewRevenue = 0, revDen = 0;
  let boughtBack = 0, diluted = 0, shareDen = 0;
  const defensivePassCounts = [];
  let defensiveAllPass = 0, defensiveDen = 0;
  // Each Graham defensive test as its own base rate, keyed by a slug of its name, in first-seen order.
  const grahamCrit = new Map();

  for (const card of cards) {
    if (!card) continue;
    readable++;
    const q = card.quality || {}, cm = card.compounding || {}, sv = card.survival || {}, st = card.stewardship || {};

    if (q.roicThroughCycle?.median != null) roic.push(q.roicThroughCycle.median);
    if (q.roeThroughCycle?.median != null) roe.push(q.roeThroughCycle.median);
    // The WORST readable year's return on capital (the low of the through-cycle range) — the figure
    // behind the durability base rate: a franchise clears its bar even in its trough year.
    if (q.roicThroughCycle?.lo != null && Number.isFinite(q.roicThroughCycle.lo)) worstRoic.push(q.roicThroughCycle.lo);
    if (q.operatingMarginThroughCycle?.median != null) opMargin.push(q.operatingMarginThroughCycle.median);
    if (q.grossMarginLatest != null && Number.isFinite(q.grossMarginLatest)) grossMargin.push(q.grossMarginLatest);
    if (q.ownerEarningsMarginThroughCycle?.median != null) oeMargin.push(q.ownerEarningsMarginThroughCycle.median);
    if (cm.revenueGrowthDelivered != null && Number.isFinite(cm.revenueGrowthDelivered)) revGrowth.push(cm.revenueGrowthDelivered);
    if (cm.ownerEarningsGrowthDelivered != null && Number.isFinite(cm.ownerEarningsGrowthDelivered)) oeGrowth.push(cm.ownerEarningsGrowthDelivered);
    if (sv.currentRatio != null && Number.isFinite(sv.currentRatio)) currentRatio.push(sv.currentRatio);
    if (sv.interestCoverage != null && Number.isFinite(sv.interestCoverage)) interestCoverage.push(sv.interestCoverage);

    if (sv.netDebt != null && Number.isFinite(sv.netDebt)) { netCashDen++; if (sv.netCash) netCash++; }

    if (sv.recordYears != null && sv.recordYears >= 5 && sv.profitableYears != null) {
      profitableDen++;
      if (sv.profitableYears === sv.recordYears) profitableEveryYear++;
    }

    if (cm.revenueGrowthDelivered != null && Number.isFinite(cm.revenueGrowthDelivered)) {
      revDen++;
      if (cm.revenueGrowthDelivered > 0) grewRevenue++;
    }

    if (st.shareChange != null && Number.isFinite(st.shareChange)) {
      shareChange.push(st.shareChange);
      shareDen++;
      if (st.shareChange < -0.005) boughtBack++;
      else if (st.shareChange > 0.005) diluted++;
    }

    if (Array.isArray(sv.graham)) {
      const applicable = sv.graham.filter((t) => t.status === "pass" || t.status === "fail");
      if (applicable.length >= 4) {
        const passes = applicable.filter((t) => t.status === "pass").length;
        defensivePassCounts.push(passes);
        defensiveDen++;
        if (passes === applicable.length) defensiveAllPass++;
      }
      // Per-criterion tally: every readable test, whether or not the record had four to be counted
      // in the composite, so each criterion's own base rate rests on its full sample.
      for (const t of sv.graham) {
        if (t.status !== "pass" && t.status !== "fail") continue;
        const key = slugify(t.name);
        if (!key) continue;
        if (!grahamCrit.has(key)) grahamCrit.set(key, { label: t.name, n: 0, pass: 0 });
        const g = grahamCrit.get(key);
        g.n++;
        if (t.status === "pass") g.pass++;
      }
    }
  }

  const rate = (num, den) => (den > 0 ? num / den : null);
  const defHist = {};
  for (let k = 0; k <= 7; k++) defHist[k] = 0;
  for (const k of defensivePassCounts) defHist[k] = (defHist[k] || 0) + 1;

  const grahamCriteria = [...grahamCrit.entries()].map(([key, g]) => ({
    key, label: g.label, n: g.n, pass: g.pass, share: rate(g.pass, g.n),
  }));

  return {
    readable,
    distributions: {
      roicThroughCycle: distribution(roic),
      roeThroughCycle: distribution(roe),
      operatingMarginThroughCycle: distribution(opMargin),
      grossMarginLatest: distribution(grossMargin),
      ownerEarningsMarginThroughCycle: distribution(oeMargin),
      revenueGrowthDelivered: distribution(revGrowth),
      ownerEarningsGrowthDelivered: distribution(oeGrowth),
      shareChangeDelivered: distribution(shareChange),
      currentRatio: distribution(currentRatio),
      interestCoverage: distribution(interestCoverage),
    },
    baseRates: {
      roicAtLeast10: shareAtLeast(roic, 0.10),
      roicAtLeast15: shareAtLeast(roic, 0.15),
      roicAtLeast20: shareAtLeast(roic, 0.20),
      // Buffett's durability read: cleared the bar EVERY year, not just at the median.
      durableRoic10: shareAtLeast(worstRoic, 0.10),
      durableRoic15: shareAtLeast(worstRoic, 0.15),
      // Buffett's primary test of managerial performance: a high return on equity.
      roeAtLeast15: shareAtLeast(roe, 0.15),
      roeAtLeast20: shareAtLeast(roe, 0.20),
      netCash: { n: netCashDen, pass: netCash, share: rate(netCash, netCashDen) },
      currentRatioAtLeast2: shareAtLeast(currentRatio, 2),
      interestCoverAtLeast10: shareAtLeast(interestCoverage, 10),
      profitableEveryYear: { n: profitableDen, pass: profitableEveryYear, share: rate(profitableEveryYear, profitableDen) },
      grewRevenue: { n: revDen, pass: grewRevenue, share: rate(grewRevenue, revDen) },
      reducedShareCount: { n: shareDen, pass: boughtBack, share: rate(boughtBack, shareDen) },
      dilutedShareCount: { n: shareDen, pass: diluted, share: rate(diluted, shareDen) },
      passedAllDefensiveTests: { n: defensiveDen, pass: defensiveAllPass, share: rate(defensiveAllPass, defensiveDen) },
    },
    defensiveHistogram: { n: defensiveDen, counts: defHist },
    grahamCriteria,
  };
}

// us: the US pool. adr: the ADR (SEC 20-F) pool. homePools: [{ country, companies }], one per
// home-market catalog. A company listed BOTH as an ADR and in its home market — Toyota, Sony, and
// the like — is counted once, as the home-market listing, so the census never double-counts it.
// groupMin: the smallest readable sample a shelf group is shown at (a base rate on a handful of
// companies misleads, so a thin shelf is simply not offered as a group).
export function computeAlmanac({ us = [], adr = [], homePools = [], groupMin = 30 }) {
  const homeByCountry = new Map();
  const homeCompanies = [];
  for (const pool of homePools) {
    for (const c of pool.companies || []) {
      const country = c.country || pool.country;
      if (!homeByCountry.has(country)) homeByCountry.set(country, new Set());
      const k = norm(c.name);
      if (k) homeByCountry.get(country).add(k);
      homeCompanies.push(c);
    }
  }
  const adrDeduped = (adr || []).filter((c) => {
    const set = homeByCountry.get(c.country);
    return !(set && set.has(norm(c.name)));
  });
  const droppedDuplicates = (adr || []).length - adrDeduped.length;
  const all = [...(us || []), ...adrDeduped, ...homeCompanies];

  // Build each company's card ONCE, tagged with its shelf, so the whole census and every group read
  // the same figures with no recomputation. A company that cannot be read is simply absent.
  const entries = [];
  for (const c of all) {
    let card;
    try { card = buildCompareCard(c); } catch { card = null; }
    if (!card) continue;
    const shelf = shelfOfIndustry(industryLabelOf(c));
    entries.push({ card, shelfNoun: shelf ? shelf.noun : null });
  }

  const whole = censusFrom(entries.map((e) => e.card));

  // One census per shelf, in shelves.json order (fixed, never a ranking), for shelves whose readable
  // sample clears groupMin. A group carries its own noun and slug so the page can label and route it.
  const groups = [];
  for (const s of SHELVES) {
    const cards = entries.filter((e) => e.shelfNoun === s.noun).map((e) => e.card);
    if (cards.length < groupMin) continue;
    const g = censusFrom(cards);
    if (g.readable < groupMin) continue;
    groups.push({ noun: s.noun, slug: slugify(s.noun.replace(/^They\s+/i, "").replace(/\.$/, "")), ...g });
  }

  return {
    universe: { total: all.length, readable: whole.readable, us: (us || []).length, adr: adrDeduped.length, home: homeCompanies.length, droppedDuplicates },
    distributions: whole.distributions,
    baseRates: whole.baseRates,
    defensiveHistogram: whole.defensiveHistogram,
    grahamCriteria: whole.grahamCriteria,
    groups,
  };
}
