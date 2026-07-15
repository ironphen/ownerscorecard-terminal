// The one place the wire's performance line is phrased, so every surface that shows a filing's figures
// reads identically: /wire, the per-day wire page, the wire email feed, the account follows-band, and
// the company page's most-recent-filing block. Present, never pronounce — up/down and a percentage per
// proven line, the company's own figures against its own prior-year, no rating/target/verdict.

// Core: from the two year-over-year percentages and the comparison basis. revYoy/oiYoy are percentages
// (e.g. 6.3 or -31.6) or null; basis is "fy" (a fiscal year), "ytd" (year to date), or "yoy" (a quarter
// against the year-earlier quarter). Returns a sentence, or null when neither line was proven.
export function perfPhrase({ revYoy = null, oiYoy = null, basis } = {}) {
  const upDown = (y) => `${y < 0 ? "down" : "up"} ${Math.abs(y).toFixed(1)}%`;
  const phrase = basis === "fy" ? "for the fiscal year" : basis === "ytd" ? "year to date" : "year over year";
  const parts = [];
  if (revYoy != null) parts.push(`Revenue ${upDown(revYoy)} ${phrase}`);
  if (oiYoy != null) parts.push(revYoy != null ? `operating income ${upDown(oiYoy)}` : `Operating income ${upDown(oiYoy)} ${phrase}`);
  return parts.length ? parts.join("; ") : null;
}

// From a wire item's full `performance` object (rev/oi carry .yoy plus the dollar figures; basis names
// the comparison). Used where the full wire.json is on hand.
export const perfLine = (p) => (p ? perfPhrase({ revYoy: p.rev?.yoy ?? null, oiYoy: p.oi?.yoy ?? null, basis: p.basis }) : null);

// The attribution line under a performance read — the company's numbers, and its words when a verbatim
// MD&A sentence passed the gates. Kept identical everywhere so nothing reads as an OwnerScorecard verdict.
export const perfNote = (hasDriver) =>
  hasDriver ? "figures computed from the filing's XBRL; the words are the company's" : "figures computed from the filing's XBRL";
