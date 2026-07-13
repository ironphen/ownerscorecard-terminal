// The Filing Wire Atom feed, as a pure function so the endpoint (src/pages/wire.xml.js) and the
// offline test (scripts/wireFeedTest.mjs) build it the same way. No imports of the data pools
// here: the caller passes the wire object and the set of tickers that have a /c page, so this
// stays a string transform with no build-time coupling.
import { SITE_URL, SITE_NAME } from "./seo.mjs";

export const xmlEscape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// A filing date carries no clock, so its Atom timestamp anchors at midnight UTC — the same
// convention the wire page renders dates in.
export const stamp = (d) => `${d}T00:00:00Z`;

// The performance line, mirrored from wire.astro: a direction and a percentage per proven line,
// the basis named, nothing derived.
const upDown = (l) => `${l.yoy < 0 ? "down" : "up"} ${Math.abs(l.yoy).toFixed(1)}%`;
export function perfLine(p) {
  if (!p) return null;
  const phrase = p.basis === "fy" ? "for the fiscal year" : p.basis === "ytd" ? "year to date" : "year over year";
  const parts = [];
  if (p.rev) parts.push(`Revenue ${upDown(p.rev)} ${phrase}`);
  if (p.oi) parts.push(p.rev ? `operating income ${upDown(p.oi)}` : `Operating income ${upDown(p.oi)} ${phrase}`);
  return parts.length ? parts.join("; ") : null;
}

function entry(it, knownSet) {
  const ticker = String(it.ticker || "").toUpperCase();
  const hasPage = knownSet.has(ticker);
  const pageUrl = hasPage ? `${SITE_URL}/c/${ticker}` : null;
  // The entry's canonical alternate: the record page where one exists, else EDGAR itself.
  const alt = pageUrl || it.url || `${SITE_URL}/wire`;
  const title = `${it.name || ticker} (${ticker}): ${it.label || it.form}${it.form ? ` (${it.form})` : ""}`;
  const pl = perfLine(it.performance);

  const body = [];
  body.push(`<p>${xmlEscape(it.label || it.form)}${it.grave ? " — a grave filing (an auditor change, a restatement, or a default)" : ""}</p>`);
  if (pl) {
    body.push(`<p>${xmlEscape(pl)}.</p>`);
    if (it.performance?.driver) body.push(`<blockquote>${xmlEscape(it.performance.driver)}</blockquote>`);
    body.push(`<p><small>${it.performance?.driver ? "Figures computed from the filing's XBRL; the words are the company's." : "Figures computed from the filing's XBRL."}</small></p>`);
  }
  if (pageUrl) body.push(`<p><a href="${xmlEscape(pageUrl)}">The ten-year owner's record for ${xmlEscape(ticker)}</a></p>`);
  if (it.url) body.push(`<p><a href="${xmlEscape(it.url)}">Source filing on SEC EDGAR</a></p>`);

  const cats = [ticker, it.form]
    .filter(Boolean)
    .map((t) => `    <category term="${xmlEscape(t)}"/>`)
    .join("\n");

  // The id is stable per filing AND per ticker: one accession number can be filed jointly by
  // several co-registrants (a merger 8-K names both parties), which the wire lists as one row
  // each — distinct entries that must not collide on a shared accession, or a feed reader would
  // hide all but one.
  return [
    "  <entry>",
    `    <id>tag:ownerscorecard.com,2026:wire/${xmlEscape(it.accn || it.date)}/${xmlEscape(ticker)}</id>`,
    `    <title>${xmlEscape(title)}</title>`,
    `    <link rel="alternate" type="text/html" href="${xmlEscape(alt)}"/>`,
    `    <updated>${stamp(it.date)}</updated>`,
    `    <published>${stamp(it.date)}</published>`,
    cats,
    `    <content type="html">${xmlEscape(body.join(""))}</content>`,
    "  </entry>",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildWireFeed(wire, knownSet) {
  const items = wire?.items || [];
  const feedUpdated = wire?.asOf ? stamp(wire.asOf) : stamp(items[0]?.date || "1970-01-01");
  const entries = items.map((it) => entry(it, knownSet)).join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xmlEscape(SITE_NAME)} — The Filing Wire</title>
  <subtitle>Every new SEC filing across the catalog, newest first, with each filer's own figures and the 8-K codes translated into plain English. No ratings, no targets, no estimates.</subtitle>
  <id>${SITE_URL}/wire.xml</id>
  <link rel="self" type="application/atom+xml" href="${SITE_URL}/wire.xml"/>
  <link rel="alternate" type="text/html" href="${SITE_URL}/wire"/>
  <updated>${feedUpdated}</updated>
  <author><name>${xmlEscape(SITE_NAME)}</name><uri>${SITE_URL}/</uri></author>
  <rights>Figures from the companies' own SEC filings. Attribution to Owner Scorecard (ownerscorecard.com) is requested, never required.</rights>
${entries}
</feed>
`;
}
