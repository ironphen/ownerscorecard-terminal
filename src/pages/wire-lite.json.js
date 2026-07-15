import wire from "../data/wire.json";
import fundamentals from "../data/fundamentals.json";
import adrData from "../data/fundamentals.adr.json";

// The wire, reduced to its filing facts — ticker, form, plain-English label, date, the company page
// where one exists, the computed performance figures (for periodic filings that carry one), and the
// grave-event flag — so the account page's follows dashboard reads the day's filings, and what they
// disclosed, from one small static file instead of scraping the wire's HTML. No URLs into EDGAR here:
// the full wire at /wire carries the source links.
//
// items: [ticker, form, label, date, href, revYoyPct, oiYoyPct, quote, grave, basis] — href null
// where the library has no page for the ticker; revYoyPct/oiYoyPct/quote/basis are null except on
// 10-K/10-Q items whose XBRL carried the comparison (the percentages are computed from the filing's
// own prior-year figures, e.g. 6.3 or -31.6; quote is the company's verbatim MD&A sentence when one
// passed the anchored/directed/figure-verified gates; basis is "fy"/"ytd"/"yoy"). grave is 1 for an
// SEC-defined material 8-K event (auditor change, non-reliance/restatement, default, delisting), else
// 0 — a filing classification from the filer's own item codes, not an OwnerScorecard verdict, shown on
// the reader's own watch band the same way /wire shows it. Consumers indexing only [0..4] are unaffected.
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
      p?.rev?.yoy ?? null, p?.oi?.yoy ?? null, p?.driver ?? null, it.grave ? 1 : 0, p?.basis ?? null,
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
