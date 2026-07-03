// /llms.txt — the machine-readable site guide (llmstxt.org convention). Generated from the
// content collection at build time so the Notes list can never go stale. Static like every
// other public page; costs nothing to serve.
import { getCollection } from "astro:content";
import { SITE_URL, DEFAULT_DESCRIPTION } from "../lib/seo.mjs";

export async function GET() {
  const articles = (await getCollection("articles", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf()
  );

  const lines = [
    "# Owner Scorecard",
    "",
    `> ${DEFAULT_DESCRIPTION} The doctrine is to present, never pronounce: the record is laid out plain and the judgment is left to the reader.`,
    "",
    `Company scorecards live at ${SITE_URL}/c/{TICKER} (for example ${SITE_URL}/c/ADBE). Each carries roughly a decade of revenue, margins, returns on capital, owner earnings, buybacks, share count, and debt, with a peer table, every figure traced to the company's own SEC filings. A Japan catalog lives at ${SITE_URL}/jp/{TICKER}.`,
    "",
    "## Notes",
    ...articles.map(
      (a) => `- [${a.data.title}](${SITE_URL}/notes/${a.id}): ${a.data.description}`
    ),
    "",
    "## Core",
    `- [Catalog](${SITE_URL}/): search and browse every scorecard`,
    `- [The Filing Wire](${SITE_URL}/wire): the latest SEC filings as they arrive`,
    `- [Compare](${SITE_URL}/compare): two businesses side by side`,
    `- [Principles](${SITE_URL}/concepts): the measures used, defined`,
    `- [About](${SITE_URL}/about): what this publication is and is not`,
    "",
    "## Data",
    `- [Company index](${SITE_URL}/company-index.json): every covered ticker and name, one JSON file`,
    `- [Record card](${SITE_URL}/compare/ADBE.json): per-company JSON at /compare/{TICKER}.json; every figure from the company's own SEC filings`,
    "",
    "## Feeds",
    `- [RSS](${SITE_URL}/rss.xml)`,
    `- [Sitemap](${SITE_URL}/sitemap-index.xml)`,
  ];

  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
