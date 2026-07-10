import fundamentals from "../data/fundamentals.json";
import adrData from "../data/fundamentals.adr.json";
import jpData from "../data/fundamentals.jp.json";
import { industryLabelOf, industrySlug } from "../lib/shelves.mjs";

// The context behind the account page's follows dashboard: one compact row per company across all
// three pools, so the page (server-rendered per user, its worker bundle barred from the big data
// JSONs by scripts/verifyStatic.mjs) can put a name, an industry chapter and the latest annual
// filing beside each bare followed ticker — entirely on the client, from one static file the
// browser caches like company-index.json. Facts with dates only: the same figures the company
// page and the chapters already publish, so a dashboard line can never disagree with the page it
// links to. (No archetype memberships: the coined labels were retired 2026-07 — a
// flatteringly-named category the publication awards is a verdict by arrangement.)
//
// Shape, tuples to stay lean (~3,530 rows):
//   industries: [label, slug] per chapter that occurs — chip labels and routes
//   rows:       [ticker, name, pool, industryIdx, fy, form, periodEnd]
//               pool 0 = United States, 1 = ADR, 2 = Japan (the company page is /jp/<ticker> for
//               pool 2, /c/<ticker> otherwise — same convention as company-index.json);
//               industryIdx -1 where no chapter slug exists; fy/periodEnd null where not filed.
export async function GET() {
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

      rows.push([
        ticker,
        c.name || ticker,
        pool,
        ind,
        c.fy ?? null,
        c.form || null,
        c.periodEnd ?? null,
      ]);
    }
  }

  return new Response(JSON.stringify({ v: 2, industries, rows }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Immutable for a day at the edge; the file is rebuilt on each deploy.
      "cache-control": "public, max-age=86400",
    },
  });
}
