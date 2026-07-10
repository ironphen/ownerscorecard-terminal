import wire from "../data/wire.json";
import fundamentals from "../data/fundamentals.json";
import adrData from "../data/fundamentals.adr.json";

// The wire, reduced to its public filing facts — ticker, form, plain-English label, date, and the
// company page where one exists — so the account page's follows dashboard (whose worker bundle is
// barred from the build-time data JSONs) can show a reader which of the companies they follow
// filed, from one small static file the browser caches. No performance figures, no grave flags,
// no URLs into EDGAR: the full wire at /wire carries those; this file only says who filed what,
// and when.
//
// items: [ticker, form, label, date, href] — href null where the library has no page for the
// ticker (the wire covers the whole catalog; a delisted or uncovered name still filed).
export async function GET() {
  const known = new Set(
    [...(fundamentals.companies || []), ...(adrData.companies || [])].map((c) =>
      String(c.ticker || "").toUpperCase()
    )
  );
  const items = (wire?.items || []).map((it) => {
    const ticker = String(it.ticker || "").toUpperCase();
    return [ticker, it.form || "", it.label || "", it.date || "", known.has(ticker) ? `/c/${ticker}` : null];
  });
  return new Response(JSON.stringify({ v: 1, asOf: wire?.asOf ?? null, items }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // The wire refreshes daily; an hour at the edge keeps the band a day-fresh surface.
      "cache-control": "public, max-age=3600",
    },
  });
}
