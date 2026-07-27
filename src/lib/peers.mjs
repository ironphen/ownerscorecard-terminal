// The peer engine. A number means nothing alone — 18% ROIC is wonderful for a grocer and mediocre for
// software — so the job here is to assemble a set of TRUE economic peers and place the company's figures
// in their distribution. Three rules keep it honest:
//
//   1. Peer by the site's own taxonomy first. The company page's heading names the industry label the
//      taxonomy assigns ("Peers, Hotels & Resorts"), and the /groupings tables seat every company by
//      that same label — so the bench under the heading must be drawn from it, or the heading lies.
//      (Before 2026-07-21 the bench was drawn by raw SIC-digit distance inside an economic-model pool,
//      and only 49% of benches were fully same-label: Airbnb sat beside Shopify under a Hotels heading.)
//      The widening ladder when a label is thin is explicit and the heading names each rung: the
//      industry label, then its shelf, then its sector, then the economic model — never silently.
//   2. Within a pool, a financial subject keeps its financial kind: a bank benches with banks, a life
//      insurer with life insurers, even inside a mixed label — the comparison columns are kind-specific,
//      and a figure printed on the wrong kind's lens is a wrong figure.
//   3. Rank candidates by STRUCTURAL likeness only — sub-industry, scale, capital intensity — never by
//      the performance metrics the comparison then reads. Selecting on the very numbers you compare would
//      rig the distribution; structure is chosen blind to performance, so the comparison stays meaningful.
//
// THE BENCH CROSSES BORDERS (owner ruling, 2026-07-27: "it's okay for peers groups to cross borders,
// these companies compete in real life"). Until then selectPeers was only ever handed the US pool, so
// 742 foreign filers benched against companies drawn from a universe their own competitors were not
// in — Taiwan Semiconductor's peer table could not contain ASML or Samsung, and the heading above it
// named an industry whose /groupings table holds all of them. Nissan had no bench at all. The pools
// are a filing-jurisdiction fact about where a company registers its shares, and a reader comparing
// chipmakers does not care which regulator they file with.
//
// Two things had to be true before this could ship, and they were shipped first, in this order:
// currency conversion on the printed figures, then the same conversion inside the SCALE TEST below.
// Without the second, a widened universe ranks candidates on unconverted revenue, and a yen filer
// looks a hundred times larger than it is — which would have seated Nissan beside Toyota and Walmart
// by accident and called it structural likeness.
//
// We present a distribution and a position, never a rank or a verdict — where the company falls among its
// peers is context the reader judges, not a score we assign.

import { classify, financialKind } from "./archetype.mjs";
import { topLineRevenue } from "./fundamentals.mjs";
import { industryLabelOf, shelfOfIndustry, sectorOfIndustry } from "./shelves.mjs";
import { floatOf } from "./insurers.mjs";
import { usdTerms } from "./groupingColumns.mjs";
import adrRatios from "../data/adrRatios.json" with { type: "json" };
import rates from "../data/rates.json" with { type: "json" };
import reitSubsectors from "../data/reit-subsectors.json" with { type: "json" };

// A COMPANY'S SIZE, IN ONE CURRENCY. The scale test below asks how far apart two companies are in
// log-revenue, and until the bench crossed borders it could read the filed figure directly because
// every candidate filed in dollars. It cannot now: Nissan files ¥12.0T and Nvidia $215.9B, and on the
// raw numbers Nissan reads as fifty-five times the larger when it is roughly a third. Same doctrine as
// every other surface — convert where the terms are known, and where they are not, return null so the
// company is held at arm's length by the scale test rather than ranked on a guess.
const revenueUsd = (c) => {
  const r = topLineRevenue(c?.lines || {}, c);
  if (r == null || !Number.isFinite(r)) return null;
  const t = usdTerms(c, adrRatios, rates);
  return t.asFiled ? null : r * t.factor;
};

// REITs almost all carry the same SIC (~6798), so the 2-digit-SIC industry tier below can't tell a
// net-lease trust from an apartment landlord or a cell-tower operator — it would seat Realty Income
// beside Simon and American Tower. A curated property-type map (the NAREIT taxonomy) restores real
// comparability: a REIT peers within its own subsector. The labels name the bench in the heading.
export const REIT_SUBSECTOR_LABELS = {
  "net-lease": "Net-lease REITs",
  "retail": "Retail REITs",
  "office": "Office REITs",
  "industrial": "Industrial REITs",
  "residential": "Residential REITs",
  "healthcare": "Healthcare REITs",
  "hotel": "Hotel & lodging REITs",
  "self-storage": "Self-storage REITs",
  "data-center": "Data-center REITs",
  "tower": "Tower & infrastructure REITs",
  "specialty": "Specialty REITs",
  "diversified": "Diversified REITs",
};

// The economic engine: a financial kind (bank, insurer, REIT, managed-care, fee) where one applies, else
// the operating-model sector (asset-light, consumer, capital-intensive, retail). This, not the SIC, is the
// pool a company's peers are drawn from.
const engineOf = (c) => financialKind(c) || classify(c).sector.key;

// Capital intensity separates a platform from a plant-heavy operator inside the same sector (a software
// firm and a data-center REIT can share a model label but not an economics). Structural, not performance.
const intensityOf = (c) => {
  const L = c.lines || {};
  const r = topLineRevenue(L, c);
  return r && r > 0 && L.capex != null ? Math.abs(L.capex) / r : null;
};

// Find the closest peers, taxonomy-first. Returns the chosen peers and the basis used, so the heading
// can stay honest: "industry" (the label pool), "shelf" (the label was thin; siblings on the same shelf,
// named), "sector" (the shelf was thin too), or "model" (the last resort, the economic-model pool).
export function selectPeers(company, all, n = 7) {
  const myEngine = engineOf(company);
  const mySic = String(company.sic || "");
  const myRev = revenueUsd(company) || 0;
  const myInt = intensityOf(company);
  const myLabel = industryLabelOf(company);
  const myShelf = myLabel ? shelfOfIndustry(myLabel) : null;
  const mySector = myLabel ? sectorOfIndustry(myLabel) : null;
  const myKind = financialKind(company) || null;

  // The candidate universe: everyone but the company, one entry per ENTITY — a multi-share-class company
  // (Alphabet's GOOG/GOOGL, Berkshire's A/B) counts once and doesn't crowd out real peers with copies of
  // itself. Dedupe by CIK; the company's own sibling classes are excluded too — same business, not a peer.
  const seen = new Set(company.cik != null ? [company.cik] : []);
  const universe = [];
  for (const c of all || []) {
    if (!c || c.ticker === company.ticker) continue;
    if (c.cik != null) { if (seen.has(c.cik)) continue; seen.add(c.cik); }
    universe.push(c);
  }
  if (!universe.length) return { peers: [], basis: "model" };

  // Rule 2: inside any pool, a subject benches only its own kind — the comparison columns are
  // kind-specific, and ROE printed for a REIT on a bank's lens is a wrong figure, not a loose one.
  //
  // The guard used to be conditional: it applied where it left three rows and was SKIPPED where it
  // would have thinned the bench, on the reasoning that a short bench is worse than a mixed one. That
  // is exactly backwards under the house doctrine, and the cost was measurable — 404 peer rows were
  // being read on a lens that does not describe them, and /c/IRS shipped CBRE, JLL and Cushman &
  // Wakefield under a bank header, printing a 140% return on tangible equity for a company whose
  // tangible equity is NEGATIVE $1.145B. That is the Jones Lang LaSalle defect (2026-07-26) arriving
  // through the other door: fixed on the subject's own page, still live on everyone else's bench.
  //
  // Made unconditional 2026-07-27, applied INSIDE the widening ladder rather than over the finished
  // bench — which is the whole reason it costs nothing. A rung that the guard thins below three simply
  // fails its own >= 3 test and the ladder widens one more step, so the bench is re-drawn rather than
  // emptied. Measured over all 3,623 benches: 0 lost, 0 left without a peer section, 4 fall under three
  // rows and lose only their median line, 136 change membership, 31 change basis rung, and off-lens
  // rows go to 0. The survey that proposed this refused it twice on a claim that it "empties 120
  // benches" — which was the count of benches CARRYING an off-kind peer, not the count a guard would
  // empty. Two quantities conflated; the same lesson as always, and the reason the number is measured
  // here in writing.
  //
  // The test is symmetric: an operating company (kind null) benches only other operating companies,
  // so a bank can no longer wander into a table read on gross margin either.
  const lensGuard = (pool) => pool.filter((c) => (financialKind(c) || null) === myKind);
  const pool = universe;

  // Sub-industry closeness: a shared 4-digit SIC is a tight match, 3-digit close, 2-digit loose, none far.
  const sicDist = (c) => {
    const s = String(c.sic || "");
    if (!mySic || !s) return 1.2;
    if (s.slice(0, 4) === mySic.slice(0, 4)) return 0;
    if (s.slice(0, 3) === mySic.slice(0, 3)) return 0.4;
    if (s.slice(0, 2) === mySic.slice(0, 2)) return 0.8;
    return 1.2;
  };
  // Scale closeness: distance in log-revenue IN ONE CURRENCY, so a $5B and a $50B company read an order
  // of magnitude apart regardless of absolute size. A peer with no usable revenue — or with no known
  // conversion terms, which is the same thing for this purpose — is held at arm's length, not excluded.
  const sizeDist = (c) => {
    const r = revenueUsd(c) || 0;
    return myRev > 0 && r > 0 ? Math.abs(Math.log(r / myRev)) : 3;
  };
  // Capital-intensity closeness: how far apart their plant-to-sales ratios sit. Neutral when either lacks
  // the line (financials have no capex), so size and sub-industry carry the weight there.
  const intDist = (c) => {
    const i = intensityOf(c);
    return myInt != null && i != null ? Math.abs(i - myInt) * 2 : 0.4;
  };
  const score = (c) => sicDist(c) * 1.0 + sizeDist(c) * 0.6 + intDist(c) * 0.5;

  // A REIT peers within its own NAREIT subsector, not merely within SIC 6798: a net-lease trust
  // sits beside other net-lease trusts, a tower operator beside towers — so the FFO, payout and
  // leverage a reader compares are read against a like property model, not a grab-bag of "real
  // estate". The curated map also keeps the misrouted non-REITs (a patent licensor, an audio-tech
  // firm that happen to carry a 67xx SIC) out of the real-REIT benches entirely. Within the
  // subsector we still rank by structural likeness (scale, intensity), and a thin subsector simply
  // shows its few true peers rather than padding with a different property type. Only when the
  // subject itself is unmapped or a flagged non-REIT do we fall back to the broad model pool.
  if (myEngine === "reit") {
    const mySub = reitSubsectors[company.ticker];
    if (mySub && mySub !== "not-a-reit") {
      // Guarded like every other rung: a company can carry a REIT SIC and a curated subsector and
      // still not be read on the REIT lens (Howard Hughes and Transcontinental Realty were both,
      // until 2026-07-27 — they benched fourteen genuine trusts on an industrial lens under a
      // "Residential REITs" heading). An emptied subsector falls through to the ladder below.
      const sameSub = lensGuard(pool.filter((c) => reitSubsectors[c.ticker] === mySub));
      if (sameSub.length) {
        const peers = sameSub
          .map((c) => ({ c, s: score(c) }))
          .sort((a, b) => a.s - b.s)
          .slice(0, n)
          .map((x) => x.c);
        return { peers, basis: "industry", subsector: mySub };
      }
    }
  }

  // Rule 1: the widening ladder, each rung the taxonomy's own. The bench under a heading that names an
  // industry label is drawn from that label; a thin label widens to its shelf's sibling industries, then
  // to its sector, and only then to the economic-model pool — and the basis names the rung, so the
  // heading never claims a tighter group than the bench actually holds. Three is the floor everywhere:
  // fewer is not a distribution worth reading (peerStat holds the same line).
  const rank = (cands) => cands
    .map((c) => ({ c, s: score(c) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, n)
    .map((x) => x.c);

  if (myLabel) {
    const sameLabel = lensGuard(pool.filter((c) => industryLabelOf(c) === myLabel));
    if (sameLabel.length >= 3) return { peers: rank(sameLabel), basis: "industry" };

    if (myShelf && myShelf.industries.length > 1) {
      const shelfLabels = new Set(myShelf.industries.map((i) => i.label));
      const sameShelf = lensGuard(pool.filter((c) => shelfLabels.has(industryLabelOf(c))));
      if (sameShelf.length >= 3) return { peers: rank(sameShelf), basis: "shelf", shelfNoun: myShelf.noun };
    }

    if (mySector) {
      const sameSector = lensGuard(pool.filter((c) => sectorOfIndustry(industryLabelOf(c)) === mySector));
      if (sameSector.length >= 3) return { peers: rank(sameSector), basis: "sector", sector: mySector };
    }
  }

  // The last resort keeps the old economic-model pool, honestly labelled: same engine (a bank with banks,
  // an asset-light platform with platforms), nearest by structure. Guarded like the rest, and where even
  // that is empty the bench is drawn from every company of the subject's own kind rather than from the
  // raw universe — a thin bench of the right kind beats a full one read on the wrong lens.
  const sameModel = lensGuard(pool.filter((c) => engineOf(c) === myEngine));
  if (sameModel.length) return { peers: rank(sameModel), basis: "model" };
  const sameKind = lensGuard(pool);
  return { peers: rank(sameKind.length ? sameKind : pool), basis: "model" };
}

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// The through-cycle reading of a metric for one company: the median across its record (latest year as a
// fallback for a short record), so a peak or trough can't speak for the whole. Shared, so the peer table
// and the scorecard read a company the same way. fn takes (lines, company) — the company for the few
// metrics (owner earnings) whose maintenance-capex test needs the record.
export function throughCycleMetric(c, fn) {
  const hist = (c?.history || []).map((h) => fn(h?.lines || {}, c)).filter((v) => v != null && isFinite(v));
  if (hist.length >= 3) return med(hist);
  const latest = fn(c?.lines || {}, c);
  return latest != null && isFinite(latest) ? latest : null;
}

// The peer-group median of a metric, each peer read through its own cycle — context for a company's own
// figure. Null when too few peers carry the metric to form a distribution (the caller then shows no peer
// line rather than a median of one or two).
export function peerMedian(peers, fn) {
  const vals = (peers || []).map((c) => throughCycleMetric(c, fn)).filter((v) => v != null && isFinite(v));
  return vals.length >= 3 ? med(vals) : null;
}

// "Yield on float": investment income against the float that funds it. Since 2026-07-21 the
// denominator is the insurance desk's full float arithmetic (lib/insurers.mjs floatOf) wherever
// the Wave A components extract — which is what finally lets a LIFE insurer's yield publish:
// against the old P&C loss-reserve sliver, MetLife printed an impossible 110% and was withheld;
// against its real ~$443B float the same income reads ~5%, a number an owner can use. The
// loss-reserves fallback (with the same plausibility cap) remains for filers whose components
// don't extract; the cap stays as the wrong-denominator tripwire either way.
export const FLOAT_YIELD_CAP = 0.15;
export function floatYield(L) {
  const f = floatOf(L);
  const denom = f?.value ?? (L?.lossReserves || null);
  const v = L && L.investmentIncome != null && denom ? L.investmentIncome / denom : null;
  return v != null && v > 0 && v <= FLOAT_YIELD_CAP ? v : null;
}

// Where a value falls in the peer set: the group median, the company's percentile, and the min/max band.
// Context, never a crown — the reader reads the position, we assign no winner. Needs at least three
// non-null values (the company plus two peers) to be a distribution worth reading; null otherwise.
export function peerStat(values, subjectValue) {
  const xs = (values || []).filter((v) => v != null && isFinite(v)).sort((a, b) => a - b);
  if (xs.length < 3 || subjectValue == null || !isFinite(subjectValue)) return null;
  const m = xs.length, mid = Math.floor(m / 2);
  const median = m % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  const below = xs.filter((v) => v < subjectValue).length;
  return { median, percentile: below / m, count: m, min: xs[0], max: xs[m - 1] };
}
