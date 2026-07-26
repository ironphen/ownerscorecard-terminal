// A company page should be a BUSINESS. A preferred series, a baby bond, a warrant and a contingent
// value right are all claims ON a business rather than the business itself, and they arrive in the
// universe as separate tickers sharing one CIK with the common stock. There are 200 of them against
// 2,881 rows, so seven percent of every shelf count, cohort statistic and comparative table has been
// the same company counted twice, or a warrant sitting in a row of operating companies.
//
// They are not deleted. Each keeps its page and its route, because a reader who types AGNCP should
// land somewhere truthful rather than nowhere. What they stop doing is COUNTING: a comparative table
// exists to line businesses up against each other, and the same issuer twice is not a comparison.
//
// The test is the CIK, never the ticker shape. A suffix rule would be a guess dressed as a rule —
// exactly the class of blanket heuristic that cost us Arrowhead's tax history and Jones Lang
// LaSalle's archetype earlier the same week. Sharing a CIK with another listing is a filed fact.
// Among listings that share one, the shortest ticker is the common stock in every case checked; ties
// break alphabetically so the choice is stable across builds rather than dependent on file order.

// Build once per pool: ticker -> true when this listing is not the issuer's primary one.
export function secondaryListings(companies) {
  const byCik = new Map();
  for (const c of companies || []) {
    const cik = String(c?.cik || "");
    const ticker = String(c?.ticker || "").toUpperCase();
    if (!cik || !ticker) continue;
    if (!byCik.has(cik)) byCik.set(cik, []);
    byCik.get(cik).push(ticker);
  }
  const secondary = new Set();
  for (const tickers of byCik.values()) {
    if (tickers.length < 2) continue;
    const primary = [...tickers].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
    for (const t of tickers) if (t !== primary) secondary.add(t);
  }
  return secondary;
}

// The primary ticker for an issuer, for a page that wants to point at the business rather than the
// claim on it.
export function primaryTickerFor(companies, ticker) {
  const t = String(ticker || "").toUpperCase();
  const me = (companies || []).find((c) => String(c?.ticker || "").toUpperCase() === t);
  if (!me?.cik) return t;
  const siblings = (companies || [])
    .filter((c) => String(c?.cik || "") === String(me.cik))
    .map((c) => String(c.ticker || "").toUpperCase())
    .filter(Boolean);
  if (siblings.length < 2) return t;
  return siblings.sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
}
