// The raw record as a machine endpoint: /c/<TICKER>.json, generated at build time like the
// compare cards. This is the "primary source" surface for agents and answer engines: the filed
// line items, the provenance, and a suggested citation — and NOTHING derived. No archetype
// labels, no quality blocks, no screens: a judgment quoted bare by a machine reads as a rating,
// and this publication does not rate. Records only.
import fundamentals from "../../data/fundamentals.json";
import adrData from "../../data/fundamentals.adr.json";
import { SITE_URL, SITE_NAME } from "../../lib/seo.mjs";

export function getStaticPaths() {
  const all = [...(fundamentals.companies || []), ...(adrData.companies || [])];
  const seen = new Set();
  const paths = [];
  for (const c of all) {
    const ticker = String(c.ticker || "").toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    const pool = (fundamentals.companies || []).includes(c) ? fundamentals : adrData;
    paths.push({ params: { ticker }, props: { company: c, asOf: pool.asOf || null, source: pool.source || null } });
  }
  return paths;
}

export function GET({ props }) {
  const { company, asOf, source } = props;
  const ticker = String(company.ticker || "").toUpperCase();
  const pageUrl = `${SITE_URL}/c/${ticker}`;
  const body = {
    ticker,
    name: company.name || ticker,
    cik: company.cik || null,
    latestFiling: { fy: company.fy ?? null, form: company.form || null, periodEnd: company.periodEnd || null },
    sourceUrl: company.sourceUrl || null,
    // The record: each entry is one fiscal year of line items as the company filed them.
    // Values are as-reported units (USD for US filers). Absent means not disclosed that year.
    record: company.history || [],
    latest: company.lines || {},
    provenance: {
      source: source || "SEC EDGAR XBRL (companyfacts)",
      asOf: asOf || null,
      note: "Every figure traces to the company's own filings. This endpoint carries no ratings, estimates, or derived judgments by design.",
    },
    page: pageUrl,
    publisher: SITE_NAME,
    suggestedCitation: `${SITE_NAME}, "${company.name || ticker} (${ticker}), the owner's record," ${pageUrl}${asOf ? `, data as of ${asOf}` : ""}.`,
  };
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
