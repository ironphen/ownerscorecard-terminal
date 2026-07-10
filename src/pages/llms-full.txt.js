// /llms-full.txt — the expanded machine-readable index: every grouping table and every industry
// chapter URL with a one-line description, so an agent can reach any browse surface without
// crawling. Built only from the curated shelf and grouping files (a few hundred lines, stable
// across data refreshes); NEVER from the company pools, and never inlining company data — the
// records live at their own endpoints, documented at /docs/data. Static text, like /llms.txt.
import { SITE_URL } from "../lib/seo.mjs";
import { GROUPINGS, FAMILIES } from "../lib/groupingColumns.mjs";
import { SHELVES } from "../lib/shelves.mjs";

export function GET() {
  const chapterCount = SHELVES.reduce((n, s) => n + (s.industries || []).length, 0);

  const groupingLines = GROUPINGS.map((g) => {
    const cols = (FAMILIES[g.family]?.columns || []).map((c) => c.label).join(", ");
    return `- [${g.noun}](${SITE_URL}/groupings/${g.slug}): one table, compared on ${cols}`;
  });

  const chapterLines = SHELVES.flatMap((s) =>
    (s.industries || []).map(
      (ind) => `- [${ind.label}](${SITE_URL}/industries/${ind.slug}): a chapter of the shelf "${s.noun}"`
    )
  );

  const lines = [
    "# Owner Scorecard: the full browse index",
    "",
    `> The expanded index behind [/llms.txt](${SITE_URL}/llms.txt): all ${GROUPINGS.length} grouping tables and all ${chapterCount} industry chapters, one line each. Company records themselves are served as JSON; see the endpoint documentation at ${SITE_URL}/docs/data.`,
    "",
    "## Groupings",
    "",
    "Each grouping is one comparative table for one kind of business: plain factual columns, figures from the companies' own filings, never a ranking or a score.",
    "",
    ...groupingLines,
    "",
    "## Industry chapters",
    "",
    "Each chapter lists one industry's companies across the US, ADR, and Japan pools, alphabetical, with links to every scorecard.",
    "",
    ...chapterLines,
  ];

  return new Response(lines.join("\n") + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
