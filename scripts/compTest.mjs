#!/usr/bin/env node
// compTest.mjs — guards the proxy extractors (insider ownership, pay ratio). The live fetch runs only
// in CI (the sandbox can't reach SEC), so these fixtures — modelled on the real DEF 14A formats after
// htmlToText flattens the beneficial-ownership table to space-separated text — are how the parser's
// precision is checked. The bar is precision over recall: it must extract the right number or nothing,
// never a wrong one, so the false-match cases assert null.

import { extractInsiderOwnership, extractInsiderGroup, extractPayRatio } from "./fetchFilings.mjs";
import { resolveInsiderOwnership } from "../src/lib/fundamentals.mjs";

let fails = 0;
const eq = (got, exp, name) => {
  const ok = got === exp;
  if (!ok) { console.error(`  ✗ ${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`); fails++; }
  else console.log(`  ✓ ${name} → ${JSON.stringify(got)}`);
};

const HEAD = "Security Ownership of Certain Beneficial Owners and Management. The following table sets forth ";

console.log("extractInsiderOwnership — real-shape fixtures:");
// 1. Standard row: shares then percent.
eq(extractInsiderOwnership(HEAD + "All directors and executive officers as a group (12 persons) 3,456,789 2.3% "), 2.3, "standard shares+percent");
// 2. Officers-first ordering, whole-number percent.
eq(extractInsiderOwnership(HEAD + "All executive officers and directors as a group (8 persons) 45,678,901 28.4%"), 28.4, "officers-first, high %");
// 3. Director-nominees variant, sub-1 decimal.
eq(extractInsiderOwnership(HEAD + "All current directors, director nominees and named executive officers as a group (15 persons) 5,432,109 1.1%"), 1.1, "nominees variant");
// 4. Asterisk placeholder → "<1%".
eq(extractInsiderOwnership(HEAD + "All directors and executive officers as a group (10 persons) 234,567 * Note: * Less than 1%."), "<1%", "asterisk placeholder");
// 5. "Less than 1%" spelled out.
eq(extractInsiderOwnership(HEAD + "Directors and executive officers as a group (9 persons) 123,456 less than 1%"), "<1%", "less-than-1 spelled out");
// 6. A space inside the percent ("2.3 %").
eq(extractInsiderOwnership(HEAD + "All directors and executive officers as a group (11 persons) 9,876,543 2.3 %"), 2.3, "space before percent sign");
// 7. Controlled company, dual-class — first percent column captured.
eq(extractInsiderOwnership(HEAD + "All directors and executive officers as a group (7 persons) 88,000,000 51.2% 9.8%"), 51.2, "controlled, first % column");
// 8. Multi-column table (shares, options exercisable, total, percent) — the percent is several
//    numeric columns past the share count, the shape big-cap proxies use.
eq(extractInsiderOwnership(HEAD + "All directors and executive officers as a group (14 persons) 2,345,678 456,789 2,802,467 1.9%"), 1.9, "multi-column shares/options/total/percent");
// 9. Long group label (nominees + named + other executives) before "as a group".
eq(extractInsiderOwnership(HEAD + "All current directors, director nominees and named executive officers as a group (21 persons) 12,345,678 3.4%"), 3.4, "long nominee+officer label");
// 10. The header appears FIRST in a table of contents, with the real table 13,000 chars later —
//     a single window from the first hit would miss it. This is the large-cap recall fix.
eq(
  extractInsiderOwnership(
    "Table of Contents. Security Ownership of Certain Beneficial Owners and Management 47. " +
      "x".repeat(13000) + " " + HEAD +
      "All directors and executive officers as a group (12 persons) 234,567 * Note: * Less than 1%."
  ),
  "<1%",
  "TOC reference precedes the real table by >12k chars"
);

console.log("\nextractInsiderOwnership — must return null (precision over recall):");
// 11. Prose use of "as a group" with a stray percent, no share count → no match.
eq(extractInsiderOwnership("The directors, acting as a group, approved a 5% salary increase for the year."), null, "prose 'as a group ... 5%'");
// 12. "the board ... as a group" — not directors/officers wording.
eq(extractInsiderOwnership("The board, as a group, met four times. Compensation rose 7% over the prior year."), null, "board prose");
// 13. Ownership section present but no group line.
eq(extractInsiderOwnership(HEAD + "BlackRock, Inc. 12,345,678 8.1% Vanguard Group 11,000,000 7.2%"), null, "5%-holders only, no group row");
// 14. Header present (e.g. a bare TOC entry) but no table anywhere → null, never a stray prose %.
eq(extractInsiderOwnership("Security Ownership of Certain Beneficial Owners and Management 47. " + "Our board met as a group several times; pay rose 6% over the year. ".repeat(20)), null, "header but no table");
// 15. Exactly 100% is impossible as an economic stake for a proxy-filing public company (it's a
//     super-voting-class / voting-power column, or a parse artifact) → null, not an overstated stake.
eq(extractInsiderOwnership(HEAD + "All directors and executive officers as a group (5 persons) 3,263,659 100%"), null, "100% (voting-class/error artifact) → null");
// 16. Above 80% is now KEPT as the raw percent — the share-count cross-check that decides whether it's
//     genuine economic ownership or a voting-class column lives downstream (resolveInsiderOwnership).
eq(extractInsiderOwnership(HEAD + "All directors and executive officers as a group (6 persons) 56,000,000 93.1%"), 93.1, "above-80% kept as raw percent (resolved downstream)");
// 17. A genuine high-but-plausible owner-operator stake reads through.
eq(extractInsiderOwnership(HEAD + "All directors and executive officers as a group (4 persons) 41,000,000 74.6%"), 74.6, "74.6% owner-operator kept");

console.log("\nextractInsiderGroup — captures the group share count beside the percent:");
const g1 = extractInsiderGroup(HEAD + "All directors and executive officers as a group (12 persons) 3,456,789 2.3% ");
eq(g1 && g1.pct, 2.3, "group pct"); eq(g1 && g1.shares, 3456789, "group shares");
const g2 = extractInsiderGroup(HEAD + "All directors and executive officers as a group (6 persons) 56,000,000 93.1%");
eq(g2 && g2.shares, 56000000, "high-stake group shares captured (for the cross-check)");
const g3 = extractInsiderGroup(HEAD + "All directors and executive officers as a group (10 persons) 234,567 * Note: * Less than 1%.");
eq(g3 && g3.pct, "<1%", "asterisk pct"); eq(g3 && g3.shares, 234567, "asterisk-row shares still captured");

console.log("\nresolveInsiderOwnership — the share-count cross-check on a high percent:");
// Below 80%: shown as-is, no cross-check needed.
eq(resolveInsiderOwnership({ insiderOwnership: 40, insiderShares: 1 }, 100), 40, "≤80% shown as-is");
// 93% corroborated by shares (56M of 60M ≈ 93% of the float) — a genuine thin-float owner-operator, kept.
eq(resolveInsiderOwnership({ insiderOwnership: 93.1, insiderShares: 56_000_000 }, 60_000_000), 93.1, "93% corroborated by shares → kept (Ubiquiti-shape)");
// 97% NOT corroborated (1.6M of 110M ≈ 1.5% economically) — a super-voting-class column, suppressed.
eq(resolveInsiderOwnership({ insiderOwnership: 97.4, insiderShares: 1_600_000 }, 110_000_000), null, "97% with low economic share → suppressed (Regeneron-shape)");
// 90% with no share count to corroborate (old data) → suppressed.
eq(resolveInsiderOwnership({ insiderOwnership: 90, insiderShares: null }, 100_000_000), null, "high % with no shares → suppressed");
// A garbage share count (more shares than outstanding) can't corroborate → suppressed.
eq(resolveInsiderOwnership({ insiderOwnership: 95, insiderShares: 999_000_000 }, 100_000_000), null, "shares > outstanding → suppressed");
// The "<1%" placeholder is always low and always kept.
eq(resolveInsiderOwnership({ insiderOwnership: "<1%" }, 100_000_000), "<1%", "\"<1%\" kept");

console.log("\nextractPayRatio — unchanged regression:");
eq(extractPayRatio("the ratio of the annual total compensation of our CEO to the median was 248 to 1 for fiscal 2024."), 248, "pay ratio sentence");
eq(extractPayRatio("The board approved a 3 to 1 stock split."), null, "3-to-1 split is not a pay ratio");

if (fails) { console.error(`\n❌ compTest: ${fails} failure(s)`); process.exit(1); }
console.log("\n✅ compTest passed");
