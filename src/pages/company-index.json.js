import fundamentals from "../data/fundamentals.json";
import adrData from "../data/fundamentals.adr.json";
import jpData from "../data/fundamentals.jp.json";
import euData from "../data/fundamentals.eu.json";
import { compareKeyOf } from "../lib/compareKey.mjs";

// The index that powers the site-wide search overlay (press "/" or ⌘K from any page) AND the picker
// on the compare and owner pages. One compact static file, fetched once per visit and cached by the
// browser, so the company list adds no weight to every page's HTML. Each row is a tuple, kept
// minimal: [ticker, name, poolCode, prominence, place, compareKey]. poolCode 0 = United States,
// 1 = ADR, 2 = Japan, 3 = Europe (ESEF); the page href is derived from it on the client (Japan →
// /jp/<ticker>, Europe → /eu/<ticker>, the rest → /c/<ticker>). prominence is a log-scaled revenue
// magnitude used only to order matches (a household name above a tiny look-alike); place is the
// country (ADRs and Europe) or industry (Japan), shown as a tag and searchable. compareKey (last
// element) is the ticker for all but the dozen cross-pool homonyms — it is what the compare/owner
// pickers add and fetch a card by, so picking Airbus adds Airbus, not the AAR that shares "AIR".
const magOf = (rev) => (rev > 0 ? Math.round(Math.log10(rev) * 10) : 0);
const POOL_STR = { 0: "US", 1: "ADR", 2: "JP", 3: "EU" };

function rowsFrom(companies, poolCode) {
  return (companies || [])
    .map((c) => {
      const ticker = String(c.ticker || "");
      if (!ticker) return null;
      const name = c.name || ticker;
      const rev = (c.lines && c.lines.revenue) || 0;
      const place =
        poolCode === 2 ? (c.industry || "") :
        poolCode === 1 || poolCode === 3 ? (c.country || "") : "";
      const key = compareKeyOf(c, POOL_STR[poolCode]);
      // Emit the key only when it differs from the ticker (the colliders), so the file stays lean;
      // the client falls back to the ticker when the sixth element is absent.
      return key === ticker.toUpperCase() ? [ticker, name, poolCode, magOf(rev), place]
                                          : [ticker, name, poolCode, magOf(rev), place, key];
    })
    .filter(Boolean);
}

export async function GET() {
  const rows = [
    ...rowsFrom(fundamentals.companies, 0),
    ...rowsFrom(adrData.companies, 1),
    ...rowsFrom(jpData.companies, 2),
    ...rowsFrom(euData.companies, 3),
  ];
  return new Response(JSON.stringify({ v: 1, rows }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Immutable for a day at the edge; the file is rebuilt and renamed-by-content on each deploy.
      "cache-control": "public, max-age=86400",
    },
  });
}
