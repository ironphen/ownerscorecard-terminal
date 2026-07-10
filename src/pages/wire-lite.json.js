import wire from "../data/wire.json";
import fundamentals from "../data/fundamentals.json";
import adrData from "../data/fundamentals.adr.json";

// The wire, reduced to its public filing facts — ticker, form, plain-English label, date, the
// company page where one exists, and (for periodic filings that carry one) the computed
// performance figures — so the account page's follows dashboard and any downstream drafter
// (the filings-tweet routine) can read the day's filings from one small static file instead of
// scraping the wire's HTML. No grave flags, no URLs into EDGAR: the full wire at /wire carries
// those.
//
// items: [ticker, form, label, date, href, revYoyPct, oiYoyPct, quote] — href null where the
// library has no page for the ticker; the last three null except on 10-K/10-Q items whose XBRL
// carried the comparison (revYoyPct/oiYoyPct are percentages, e.g. 6.3 or -31.6, computed from
// the filing's own prior-year figures; quote is the company's verbatim MD&A sentence when one
// passed the anchored/directed/figure-verified gates). Consumers indexing only [0..4] are
// unaffected.
export async function GET() {
  const known = new Set(
    [...(fundamentals.companies || []), ...(adrData.companies || [])].map((c) =>
      String(c.ticker || "").toUpperCase()
    )
  );
  const items = (wire?.items || []).map((it) => {
    const ticker = String(it.ticker || "").toUpperCase();
    const p = it.performance || null;
    return [
      ticker, it.form || "", it.label || "", it.date || "", known.has(ticker) ? `/c/${ticker}` : null,
      p?.rev?.yoy ?? null, p?.oi?.yoy ?? null, p?.driver ?? null,
    ];
  });
  return new Response(JSON.stringify({ v: 1, asOf: wire?.asOf ?? null, items }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // The wire refreshes daily; an hour at the edge keeps the band a day-fresh surface.
      "cache-control": "public, max-age=3600",
    },
  });
}
