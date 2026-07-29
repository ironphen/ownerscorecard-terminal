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
// LaSalle's archetype earlier the same week.
//
// WHICH sibling is the business is now a FILED FACT where the record carries it (2026-07-28): the
// pipeline stores `primaryTicker`, the first entry of the issuer's own registered-securities list in
// its SEC submissions record, which lists the common stock first (DTE before its four baby bonds,
// SO before its notes, DUK before DUKB — verified across the multi-listing utility CIKs). The old
// shape heuristic — shortest ticker, ties alphabetical — remains only as the fallback for rows not
// yet re-extracted, and it is what once made DTE's shelf row its 2080 baby bond DTB (equal length,
// B before E).

// The primary among one CIK's sibling rows: the filed fact when any sibling carries it and it names
// a ticker actually in the group; the shape heuristic otherwise.
function primaryOf(rows) {
  const tickers = rows.map((r) => r.ticker);
  const filed = rows.map((r) => r.primaryTicker).find((p) => p && tickers.includes(p));
  if (filed) return filed;
  return [...tickers].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
}

// Build once per pool: ticker -> true when this listing is not the issuer's primary one.
export function secondaryListings(companies) {
  const byCik = new Map();
  for (const c of companies || []) {
    const cik = String(c?.cik || "");
    const ticker = String(c?.ticker || "").toUpperCase();
    if (!cik || !ticker) continue;
    if (!byCik.has(cik)) byCik.set(cik, []);
    byCik.get(cik).push({ ticker, primaryTicker: c?.primaryTicker ? String(c.primaryTicker).toUpperCase() : null });
  }
  const secondary = new Set();
  for (const rows of byCik.values()) {
    if (rows.length < 2) continue;
    const primary = primaryOf(rows);
    for (const r of rows) if (r.ticker !== primary) secondary.add(r.ticker);
  }
  return secondary;
}

// KNOWN LIMITATION, recorded rather than guessed around. Where an issuer's COMMON stock is not in
// the pool at all, its preferred series look like the primary listing and are treated as one:
// Brookfield Property's four series (BPYPM/N/O/P, one CIK, one name, no common — the partnership was
// taken private) and CHS's CHSCO are the live cases. The filed registered-securities list cannot
// separate them either, because no common is registered — the first-listed security IS a preferred.
// That is a fact about the issuer, not a gap in the rule.
//
// Memoized per pool array, because the peer bench asks this on every one of 3,623 company pages and
// the answer only changes when the pool does.
const _secondaryCache = new WeakMap();
export function secondaryListingsCached(companies) {
  if (!companies) return new Set();
  let s = _secondaryCache.get(companies);
  if (!s) { s = secondaryListings(companies); _secondaryCache.set(companies, s); }
  return s;
}

// The primary ticker for an issuer, for a page that wants to point at the business rather than the
// claim on it.
export function primaryTickerFor(companies, ticker) {
  const t = String(ticker || "").toUpperCase();
  const me = (companies || []).find((c) => String(c?.ticker || "").toUpperCase() === t);
  if (!me?.cik) return t;
  const siblings = (companies || [])
    .filter((c) => String(c?.cik || "") === String(me.cik))
    .map((c) => ({ ticker: String(c.ticker || "").toUpperCase(), primaryTicker: c?.primaryTicker ? String(c.primaryTicker).toUpperCase() : null }))
    .filter((r) => r.ticker);
  if (siblings.length < 2) return t;
  return primaryOf(siblings);
}
