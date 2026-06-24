import fundamentals from "../data/fundamentals.json";
import adrData from "../data/fundamentals.adr.json";
import jpData from "../data/fundamentals.jp.json";

// The index that powers the site-wide search overlay (press "/" or ⌘K from any page). One compact
// static file, fetched once per visit and cached by the browser, so the company list adds no weight
// to every page's HTML. Each row is a tuple, kept minimal: [ticker, name, poolCode, prominence,
// place]. poolCode 0 = United States, 1 = ADR, 2 = Japan; the href is derived from it on the client
// (Japan → /jp/<ticker>, the rest → /c/<ticker>). prominence is a log-scaled revenue magnitude used
// only to order matches (a household name above a tiny look-alike); place is the country (ADRs) or
// industry (Japan), shown as a tag and searchable. Mirrors the home page's own ranking so the two
// behave identically.
const magOf = (rev) => (rev > 0 ? Math.round(Math.log10(rev) * 10) : 0);

function rowsFrom(companies, poolCode) {
  return (companies || [])
    .map((c) => {
      const ticker = String(c.ticker || "");
      if (!ticker) return null;
      const name = c.name || ticker;
      const rev = (c.lines && c.lines.revenue) || 0;
      const place = poolCode === 2 ? (c.industry || "") : poolCode === 1 ? (c.country || "") : "";
      return [ticker, name, poolCode, magOf(rev), place];
    })
    .filter(Boolean);
}

export async function GET() {
  const rows = [
    ...rowsFrom(fundamentals.companies, 0),
    ...rowsFrom(adrData.companies, 1),
    ...rowsFrom(jpData.companies, 2),
  ];
  return new Response(JSON.stringify({ v: 1, rows }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Immutable for a day at the edge; the file is rebuilt and renamed-by-content on each deploy.
      "cache-control": "public, max-age=86400",
    },
  });
}
