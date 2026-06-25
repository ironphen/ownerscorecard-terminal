// The peer engine. A number means nothing alone — 18% ROIC is wonderful for a grocer and mediocre for
// software — so the job here is to assemble a set of TRUE economic peers and place the company's figures
// in their distribution. Two rules keep it honest:
//
//   1. Peer by the economic ENGINE first, not the SIC bucket. SIC is coarse — it seats a software firm
//      beside a contract manufacturer — so we start from companies that share the same model (a bank with
//      banks, an asset-light platform with platforms) and use SIC only to refine within that pool.
//   2. Rank candidates by STRUCTURAL likeness only — sub-industry, scale, capital intensity — never by
//      the performance metrics the comparison then reads. Selecting on the very numbers you compare would
//      rig the distribution; structure is chosen blind to performance, so the comparison stays meaningful.
//
// We present a distribution and a position, never a rank or a verdict — where the company falls among its
// peers is context the reader judges, not a score we assign.

import { classify, financialKind } from "./archetype.mjs";
import { topLineRevenue } from "./fundamentals.mjs";
import reitSubsectors from "../data/reit-subsectors.json" with { type: "json" };

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

// Find the closest peers by economic likeness. Returns the chosen peers and the basis used, so the heading
// can stay honest (an industry group named by its industry, or an economic-model match that says so).
export function selectPeers(company, all, n = 7) {
  const myEngine = engineOf(company);
  const mySic = String(company.sic || "");
  const myRev = topLineRevenue(company.lines || {}, company) || 0;
  const myInt = intensityOf(company);

  // The candidate pool: same economic engine, the company excluded — and one entry per ENTITY, so a
  // multi-share-class company (Alphabet's GOOG/GOOGL, Berkshire's A/B) counts once and doesn't crowd out
  // real peers with four copies of itself. Dedupe by CIK; the company's own sibling classes are excluded
  // too, since they are the same business, not a peer.
  const seen = new Set(company.cik != null ? [company.cik] : []);
  const pool = [];
  for (const c of all || []) {
    if (!c || c.ticker === company.ticker || engineOf(c) !== myEngine) continue;
    if (c.cik != null) { if (seen.has(c.cik)) continue; seen.add(c.cik); }
    pool.push(c);
  }
  if (!pool.length) return { peers: [], basis: "model" };

  // Sub-industry closeness: a shared 4-digit SIC is a tight match, 3-digit close, 2-digit loose, none far.
  const sicDist = (c) => {
    const s = String(c.sic || "");
    if (!mySic || !s) return 1.2;
    if (s.slice(0, 4) === mySic.slice(0, 4)) return 0;
    if (s.slice(0, 3) === mySic.slice(0, 3)) return 0.4;
    if (s.slice(0, 2) === mySic.slice(0, 2)) return 0.8;
    return 1.2;
  };
  // Scale closeness: distance in log-revenue, so a $5B and a $50B company read an order of magnitude apart
  // regardless of absolute size. A peer with no usable revenue is held at arm's length, not excluded.
  const sizeDist = (c) => {
    const r = topLineRevenue(c.lines || {}, c) || 0;
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
      const sameSub = pool.filter((c) => reitSubsectors[c.ticker] === mySub);
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

  // Prefer the same broad industry over mere size. If the engine pool holds enough peers sharing the
  // 2-digit SIC — the same industry, not just the same model — draw only from those, so a computer maker
  // isn't padded with drug distributors and an industrial isn't padded with airlines to fill a fixed count.
  // Only when that industry bench is thin (under three) do we widen to the whole economic-model pool, and
  // the heading then says "nearest by model" honestly. (A near-unique mega-cap, or a small sub-industry,
  // takes the wider net; a deep industry like banking keeps a clean, same-industry bench.)
  const sic2 = mySic.slice(0, 2);
  const sameIndustry = sic2 ? pool.filter((c) => String(c.sic || "").slice(0, 2) === sic2) : [];
  const drewFromIndustry = sameIndustry.length >= 3;
  const peers = (drewFromIndustry ? sameIndustry : pool)
    .map((c) => ({ c, s: score(c) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, n)
    .map((x) => x.c);

  // The heading is honest about the basis: an industry group where we drew from the same industry, the
  // nearest by economic model where the industry bench was too thin and we widened the net.
  return { peers, basis: drewFromIndustry ? "industry" : "model" };
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
