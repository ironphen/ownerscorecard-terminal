// /llms.txt — the machine-readable site guide (llmstxt.org convention: an H1, a summary
// blockquote, then H2 sections of links with one-line descriptions). Generated from the content
// collection and the curated shelf/grouping files at build time so nothing here can go stale;
// never from the company pools, so the file stays a few KB. Static like every other public page.
// The expanded index (every grouping and industry chapter URL) lives at /llms-full.txt; the
// endpoint documentation, written for programmers and agents alike, at /docs/data.
import { getCollection } from "astro:content";
import { SITE_URL, DEFAULT_DESCRIPTION } from "../lib/seo.mjs";
import { dataAsOf, dataAsOfLatest } from "../lib/freshness.mjs";
import { GROUPINGS } from "../lib/groupingColumns.mjs";
import { SHELVES } from "../lib/shelves.mjs";

export async function GET() {
  const articles = (await getCollection("articles", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf()
  );

  const chapterCount = SHELVES.reduce((n, s) => n + (s.industries || []).length, 0);
  const vintage = dataAsOf
    ? ` Data vintage: the pipeline's own as-of stamps, never the build clock; currently ${dataAsOf}${
        dataAsOfLatest && dataAsOfLatest !== dataAsOf ? ` to ${dataAsOfLatest}` : ""
      }.`
    : "";

  const lines = [
    "# Owner Scorecard",
    "",
    `> ${DEFAULT_DESCRIPTION} The doctrine is to present, never pronounce: the record is laid out plain and the judgment is left to the reader.`,
    "",
    `Company scorecards live at ${SITE_URL}/c/{TICKER} for US filers and ADRs (for example ${SITE_URL}/c/ADBE); the Japan catalog lives at ${SITE_URL}/jp/{CODE} by securities code (for example ${SITE_URL}/jp/4502). Each page carries roughly a decade of revenue, margins, returns on capital, owner earnings, buybacks, share count, and debt, every figure traced to the company's own filings. Each has a JSON twin: the full record at /c/{TICKER}.json (US and ADR pools) and the slim comparison card at /compare/{TICKER}.json (all pools, Japan included).${vintage}`,
    "",
    `Citing this site: every scorecard and Note ends with a Cite block, and the JSON record carries the same line under suggestedCitation. The format is: Owner Scorecard, "Company Name (TICKER), the owner's record," ${SITE_URL}/c/TICKER, data as of YYYY-MM-DD. For a short credit, "Owner Scorecard (ownerscorecard.com), data from SEC filings" is requested, never required. The publication carries no ratings, price targets, or estimates, so no page or endpoint contains a judgment to quote; figures and their sources only.`,
    "",
    "## Notes",
    ...(articles.length
      ? articles.map((a) => `- [${a.data.title}](${SITE_URL}/notes/${a.id}): ${a.data.description}`)
      : [`- [The Notes index](${SITE_URL}/notes): the publication's research Notes; each returns here as its final draft is published`]),
    "",
    "## Core",
    `- [Catalog](${SITE_URL}/catalog): search and browse every scorecard`,
    `- [The Filing Wire](${SITE_URL}/wire): the latest SEC filings as they arrive, with each filer's own figures`,
    `- [Compare](${SITE_URL}/compare): two to four businesses side by side, on the record and on what a price would have to assume`,
    `- [Principles](${SITE_URL}/concepts): how to read a filing, and every measure used, defined`,
    `- [About](${SITE_URL}/about): what this publication is and is not`,
    `- [Corrections](${SITE_URL}/corrections): the public log of published errors and their fixes`,
    `- [Terms of Use](${SITE_URL}/terms): the terms and disclaimer — informational only, not investment advice, data provided without warranty`,
    "",
    "## Browse",
    `- [Groupings](${SITE_URL}/groupings): ${GROUPINGS.length} comparative tables, one per kind of business — the catalog arranged by what the businesses do, each grouping listing its industry chapters — at /groupings/{slug} (for example ${SITE_URL}/groupings/lend-money); plain factual columns, never a ranking`,

    `- [Industry chapters](${SITE_URL}/industries/enterprise-software): ${chapterCount} chapters at /industries/{slug}, each industry's companies across all pools; the full list is in /llms-full.txt`,
    `- [The Manual](${SITE_URL}/manual): every company in fixed alphabetical order, three volumes at /manual/us/{A-Z}, /manual/adr/{A-Z}, and /manual/japan`,
    `- [The Defensive Workbook](${SITE_URL}/tests/defensive): Graham's defensive-investor tests as his own worksheet, one row per company, every figure shown`,
    `- [Net-nets](${SITE_URL}/tests/net-nets): Graham's net-current-asset-value ledger, arithmetic shown`,
    `- [Flags](${SITE_URL}/flags): five registers of disqualifying facts at /flags/{register}, each a single kind of fact with the figure that fired`,
    `- [Withheld](${SITE_URL}/withheld): the records this publication could not read reliably, each with its specific reason`,
    "",
    "## Data",
    `- [Endpoint documentation](${SITE_URL}/docs/data): every public JSON endpoint with its URL, exact shape, a real example, freshness semantics, and the terms (free, no key, attribution requested)`,
    `- [Company index](${SITE_URL}/company-index.json): every covered ticker and name across all pools, one JSON file`,
    `- [The raw record](${SITE_URL}/c/ADBE.json): per-company JSON at /c/{TICKER}.json with roughly a decade of filed line items, provenance, and a suggested citation; no ratings or derived judgments`,
    `- [Record card](${SITE_URL}/compare/ADBE.json): the slimmer per-company card at /compare/{TICKER}.json, with reverse-DCF inputs`,
    `- [Wire lite](${SITE_URL}/wire-lite.json): the day's filings as compact tuples, refreshed daily`,
    `- [Follow context](${SITE_URL}/follow-context.json): one row per company — name, industry chapter, latest annual filing`,
    `- [Full index](${SITE_URL}/llms-full.txt): every grouping table and industry chapter URL, one line each`,
    "",
    "## Feeds",
    `- [The Filing Wire (Atom)](${SITE_URL}/wire.xml): the day's SEC filings, newest first, one entry per filing keyed by its accession number, each linking the filer's record page — the site's daily-changing stream, machine-subscribable`,
    `- [Research Notes (RSS)](${SITE_URL}/rss.xml): the publication's Notes as they are published`,
    `- [Sitemap](${SITE_URL}/sitemap-index.xml)`,
  ];

  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
