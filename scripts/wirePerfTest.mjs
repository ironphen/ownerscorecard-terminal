#!/usr/bin/env node
// wirePerfTest.mjs — guards the wire's performance line, offline. The shared driver machinery
// (src/lib/drivers.mjs) must find a 10-Q's MD&A between its Item 2 and Item 3/4 anchors, quote
// only a clause that verifies against the caller-supplied XBRL changes, and reject narration
// about a DIFFERENT period — the six-month sentence a 10-Q also carries must never ship against
// quarter changes. The bar is the product's bar: a wrong quote is worse than no quote.

import { toBlocks, mdnaText, splitSentences, pickConsolidated } from "../src/lib/drivers.mjs";

let fails = 0;
const eq = (got, exp, name) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) { console.error(`  ✗ ${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`); fails++; }
  else console.log(`  ✓ ${name}`);
};

// ---- fixtures ----
// A quarter's figures, hand-built the way performanceFor builds them from companyfacts:
// revenue $370.8M → $416.4M (+$45.6M, +12.3%), operating income $91.1M → $99.3M (+$8.2M, +9.0%).
const CHANGES = {
  revenue: { pct: 12.3, delta: 45.6e6 },
  operatingIncome: { pct: 9.0, delta: 8.2e6 },
};
const FY = 2026;

const FILLER = [
  "The following discussion should be read together with our unaudited condensed consolidated financial statements and the related notes included elsewhere in this report, and with the audited financial statements in our most recent annual report.",
  "Our results of operations reflect the seasonality of demand in our end markets, the timing of shipments to distribution partners, and the mix of products sold through our direct and indirect channels during the period, each of which can move gross margin by a point or more in a given quarter.",
  "Gross margin was consistent with the comparable prior-year period, as favorable product mix and improved absorption of fixed manufacturing overhead offset higher freight and input costs across our manufacturing footprint during the period presented in this report.",
  "Cash provided by operating activities funded our working capital needs, capital expenditures for capacity and tooling, and the repurchase program authorized by the board, and we held no borrowings under the credit facility at period end.",
];

const SIX_MONTH_SENTENCE =
  "Net sales for the six months ended May 31, 2026 increased $60.2 million, or 8.1%, compared to the six months ended May 31, 2025, primarily due to higher unit volumes across both segments.";
const QUARTER_REV_SENTENCE =
  "Net sales increased $45.6 million, or 12.3%, to $416.4 million for the three months ended May 31, 2026, compared to $370.8 million for the three months ended May 31, 2025, primarily driven by higher unit volumes in our commercial segment.";
const QUARTER_OI_SENTENCE =
  "Operating income increased $8.2 million, or 9.0%, to $99.3 million for the three months ended May 31, 2026, primarily reflecting operating leverage on the higher net sales in the quarter.";

// A 10-Q shell: cover, a TOC whose Item 2 row must lose to the real section (longest span
// wins), Part I financial statements, the MD&A, then the Item 3 / Item 4 boundary.
const doc10Q = (mdnaSentences) => `
<html><body>
<div>FORM 10-Q — For the quarterly period ended May 31, 2026</div>
<table>
<tr><td>Item 1. Financial Statements</td><td>3</td></tr>
<tr><td>Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations</td><td>24</td></tr>
<tr><td>Item 3. Quantitative and Qualitative Disclosures About Market Risk</td><td>38</td></tr>
</table>
<div>Item 1. Financial Statements</div>
<p>The condensed consolidated financial statements are unaudited and reflect all adjustments necessary for a fair statement of the results for the interim periods presented.</p>
<div>Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations</div>
<p>${FILLER[0]}</p>
<p>${mdnaSentences.join(" ")}</p>
<p>${FILLER[1]}</p>
<p>${FILLER[2]}</p>
<p>${FILLER[3]}</p>
<p>${FILLER.join(" ")}</p>
<p>${FILLER.join(" ")}</p>
<div>Item 3. Quantitative and Qualitative Disclosures About Market Risk</div>
<p>There have been no material changes in our market risk during the period covered by this report.</p>
<div>Item 4. Controls and Procedures</div>
</body></html>`;

console.log("mdnaText — the 10-Q anchors:");
{
  const blocks = toBlocks(doc10Q([QUARTER_REV_SENTENCE, QUARTER_OI_SENTENCE]));
  const text = mdnaText(blocks, "10-Q");
  eq(!!text, true, "finds the Item 2 → Item 3 span");
  eq(text.includes("primarily driven by higher unit volumes"), true, "the span carries the MD&A body");
  eq(text.includes("no material changes in our market risk"), false, "the span stops at Item 3");
  eq(mdnaText(blocks, "10-K"), null, "the 10-K anchors do not fire on a 10-Q");
  // A section below the 2,500-char floor is a misparse, not the MD&A.
  const short = toBlocks(`<div>Item 2. Management's Discussion and Analysis</div><p>Too short to be the section.</p><div>Item 3. Quantitative and Qualitative Disclosures About Market Risk</div>`);
  eq(mdnaText(short, "10-Q"), null, "a sub-floor 10-Q span reads null");
}

console.log("\nmdnaText — the 10-K anchors still hold:");
{
  const pad = FILLER.join(" ").repeat(4); // clear the 4,000-char 10-K floor
  const blocks = toBlocks(`<div>Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations</div><p>${QUARTER_REV_SENTENCE}</p><p>${pad}</p><div>Item 7A. Quantitative and Qualitative Disclosures About Market Risk</div>`);
  eq(!!mdnaText(blocks, "10-K"), true, "finds the Item 7 → Item 7A span");
  eq(mdnaText(blocks, "10-Q"), null, "the 10-Q anchors do not fire on a 10-K");
}

console.log("\npickConsolidated — a verified clause ships; revenue anchors first:");
{
  const sents = splitSentences(mdnaText(toBlocks(doc10Q([QUARTER_REV_SENTENCE, QUARTER_OI_SENTENCE])), "10-Q"));
  const picks = pickConsolidated(sents, { fy: FY, changes: CHANGES });
  eq(picks.length, 2, "both lines verify");
  eq(picks[0].line, "revenue", "revenue first (the wire's preferred anchor)");
  eq(picks[0].check, "pct", "revenue clause figure-verified by percentage");
  eq(picks[0].sentence, QUARTER_REV_SENTENCE, "the clause is verbatim");
  eq(picks[1].line, "operatingIncome", "operating income second");
}

console.log("\npickConsolidated — the six-month sentence is rejected against quarter changes:");
{
  // Alone, it must not ship: 8.1% is not 12.3% (±1.0), $60.2M is not $45.6M (±6%).
  const alone = splitSentences(mdnaText(toBlocks(doc10Q([SIX_MONTH_SENTENCE])), "10-Q"));
  eq(pickConsolidated(alone, { fy: FY, changes: CHANGES }), [], "six-month narration alone → nothing ships");
  // Ahead of the quarter sentence, it must lose to it, not shadow it.
  const both = splitSentences(mdnaText(toBlocks(doc10Q([SIX_MONTH_SENTENCE, QUARTER_REV_SENTENCE])), "10-Q"));
  const picks = pickConsolidated(both, { fy: FY, changes: CHANGES });
  eq(picks.length, 1, "exactly one revenue clause");
  eq(picks[0].sentence, QUARTER_REV_SENTENCE, "the quarter sentence wins, not the six-month one");
}

console.log("\npickConsolidated — the other gates hold for the wire's caller-supplied changes:");
{
  // Direction: a sentence narrating a decrease against a computed increase never ships.
  const down = "Net sales decreased $45.6 million, or 12.3%, for the three months ended May 31, 2026, primarily due to lower unit volumes in our commercial segment.";
  const sents = splitSentences(mdnaText(toBlocks(doc10Q([down])), "10-Q"));
  eq(pickConsolidated(sents, { fy: FY, changes: CHANGES }), [], "direction disagreement → nothing ships");
  // No changes supplied (companyfacts not up yet) → no line is ever quoted.
  const good = splitSentences(mdnaText(toBlocks(doc10Q([QUARTER_REV_SENTENCE])), "10-Q"));
  eq(pickConsolidated(good, { fy: FY, changes: {} }), [], "no XBRL changes → no quote");
}

console.log("\npickConsolidated — a segment-scoped subject never anchors a consolidated claim:");
{
  // AZZ, live leak caught in review: the segment's 11.5% sat within tolerance of the
  // consolidated 10.8% by coincidence. Scope words before the change verb kill the sentence;
  // a segment named after the verb is a cause and still ships.
  const seg = "Operating income for the AZZ Metal Coatings segment increased $5.8 million, or 11.5%, for the three months ended May 31, 2026, compared to the prior year quarter. The increase was due to increased sales, partially offset by an increase in cost of sales.";
  const segSents = splitSentences(mdnaText(toBlocks(doc10Q([seg])), "10-Q"));
  eq(pickConsolidated(segSents, { fy: FY, changes: { operatingIncome: { pct: 10.8, delta: 7484000 } } }), [], "segment-subject OI clause -> nothing ships");
  const cause = "Net sales increased $45.6 million, or 12.3%, for the three months ended May 31, 2026, driven primarily by growth in the commercial segment.";
  const causeSents = splitSentences(mdnaText(toBlocks(doc10Q([cause])), "10-Q"));
  eq(pickConsolidated(causeSents, { fy: FY, changes: CHANGES }).length, 1, "segment named after the verb is a cause and ships");
}

if (fails) { console.error(`\n❌ wirePerfTest: ${fails} failure(s)`); process.exit(1); }
console.log("\n✅ wirePerfTest passed");
