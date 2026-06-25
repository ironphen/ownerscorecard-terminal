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

  const pool = (all || []).filter((c) => c && c.ticker !== company.ticker && engineOf(c) === myEngine);
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

  const peers = pool
    .map((c) => ({ c, s: score(c) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, n)
    .map((x) => x.c);

  // Honest heading: if a majority of the chosen peers share the 3-digit industry, it is an industry group;
  // otherwise it is the nearest by economic model, and the heading should say so rather than imply an
  // industry the peers don't really share.
  const sameSic = mySic ? peers.filter((c) => String(c.sic || "").slice(0, 3) === mySic.slice(0, 3)).length : 0;
  const basis = peers.length && sameSic >= Math.ceil(peers.length / 2) ? "industry" : "model";
  return { peers, basis };
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
