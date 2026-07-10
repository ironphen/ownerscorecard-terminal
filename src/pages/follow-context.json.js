import fundamentals from "../data/fundamentals.json";
import adrData from "../data/fundamentals.adr.json";
import jpData from "../data/fundamentals.jp.json";
import language from "../data/language.json";
import { industryLabelOf, industrySlug } from "../lib/shelves.mjs";
import { computeLenses, LENSES } from "../lib/lenses.mjs";

// The context behind the account page's follows dashboard: one compact row per company across all
// three pools, so the page (server-rendered per user, its worker bundle barred from the big data
// JSONs by scripts/verifyStatic.mjs) can put a name, an industry chapter, the latest annual filing
// and the archetype memberships beside each bare followed ticker — entirely on the client, from one
// static file the browser caches like company-index.json. Facts with dates only: the same figures
// the company page, the chapters and the lens pages already publish, so a dashboard line can never
// disagree with the page it links to.
//
// Shape, tuples to stay lean (~3,530 rows):
//   lenses:     [key, title, positive] per archetype, in lens order — chip titles and routes
//   industries: [label, slug] per chapter that occurs — chip labels and routes
//   rows:       [ticker, name, pool, industryIdx, fy, form, periodEnd, [lensIdx...]]
//               pool 0 = United States, 1 = ADR, 2 = Japan (the company page is /jp/<ticker> for
//               pool 2, /c/<ticker> otherwise — same convention as company-index.json);
//               industryIdx -1 where no chapter slug exists; fy/periodEnd null where not filed.
export async function GET() {
  // The same memoized universe pass every page runs, so a chip here can never disagree with the
  // lens page it links to. JP names never enter this pass (same line the chapters draw).
  const byTicker = computeLenses(
    [...(fundamentals.companies || []), ...(adrData.companies || [])],
    language.companies
  ).byTicker;

  const lenses = LENSES.map((l) => [l.key, l.title, l.positive ? 1 : 0]);
  const lensIdx = Object.fromEntries(LENSES.map((l, i) => [l.key, i]));

  const industries = [];
  const industryIdx = new Map(); // label -> index into industries

  const seen = new Set();
  const rows = [];
  const pools = [
    [fundamentals.companies, 0],
    [adrData.companies, 1],
    [jpData.companies, 2],
  ];
  for (const [companies, pool] of pools) {
    for (const c of companies || []) {
      const ticker = String(c.ticker || "").toUpperCase();
      if (!ticker || seen.has(ticker)) continue;
      seen.add(ticker);

      const label = industryLabelOf(c);
      const slug = industrySlug(label);
      let ind = -1;
      if (slug) {
        if (!industryIdx.has(label)) {
          industryIdx.set(label, industries.length);
          industries.push([label, slug]);
        }
        ind = industryIdx.get(label);
      }

      const memberships = (byTicker[ticker] || []).map((k) => lensIdx[k]).filter((i) => i != null);
      rows.push([
        ticker,
        c.name || ticker,
        pool,
        ind,
        c.fy ?? null,
        c.form || null,
        c.periodEnd ?? null,
        memberships,
      ]);
    }
  }

  return new Response(JSON.stringify({ v: 1, lenses, industries, rows }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Immutable for a day at the edge; the file is rebuilt on each deploy.
      "cache-control": "public, max-age=86400",
    },
  });
}
