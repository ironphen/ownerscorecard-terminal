#!/usr/bin/env node
// seoTest.mjs — guards the structured-data helpers (src/lib/seo.mjs) that carry the Dataset,
// trust-graph, and breadcrumb markup. These are citation infrastructure: a broken license URL or
// a missing CIK anchor quietly costs the site its Google Dataset Search entry and its
// primary-source E-E-A-T, with no visible error. The doctrine lines are asserted too: the license
// must NOT be CC-BY (attribution is requested, never required), and no rating-shaped types appear.

import {
  ORG, SITE_URL, edgarCikUrl, corporationNode, companyDataset, breadcrumbList,
} from "../src/lib/seo.mjs";

let fails = 0;
const ok = (cond, name) => { if (cond) console.log(`  ✓ ${name}`); else { console.error(`  ✗ ${name}`); fails++; } };
const eq = (got, exp, name) => ok(JSON.stringify(got) === JSON.stringify(exp), `${name}${JSON.stringify(got) === JSON.stringify(exp) ? "" : ` (got ${JSON.stringify(got)})`}`);

console.log("Organization trust graph:");
ok(ORG.publishingPrinciples === `${SITE_URL}/notes/the-founding-letter`, "publishingPrinciples → the founding letter");
ok(ORG.correctionsPolicy === `${SITE_URL}/corrections`, "correctionsPolicy → the public error log");
ok(ORG.ownershipFundingInfo === `${SITE_URL}/about`, "ownershipFundingInfo → about");
ok(ORG.logo && ORG.logo["@type"] === "ImageObject", "logo is an ImageObject, not a bare string");
ok(!("founder" in ORG) && !("author" in ORG), "no founder/author Person node (masthead is the byline, by doctrine)");

console.log("\nedgarCikUrl:");
ok(edgarCikUrl("0000796343")?.includes("CIK=0000796343"), "builds the EDGAR entity URL from a padded CIK");
eq(edgarCikUrl(""), null, "empty CIK → null");
eq(edgarCikUrl(null), null, "null CIK → null");

console.log("\ncorporationNode:");
const corp = corporationNode({ name: "Adobe Inc.", ticker: "ADBE", cik: "0000796343", url: `${SITE_URL}/c/ADBE` });
eq(corp["@type"], "Corporation", "type is Corporation (never FinancialProduct)");
ok(corp.identifier?.propertyID === "SEC CIK" && corp.identifier.value === "0000796343", "CIK as a PropertyValue identifier, EDGAR's padded form");
ok(typeof corp.sameAs === "string" && corp.sameAs.includes("796343"), "sameAs anchors to EDGAR");
const corpNoCik = corporationNode({ name: "Itochu", ticker: "8001", url: `${SITE_URL}/jp/8001` });
ok(!("identifier" in corpNoCik) && !("sameAs" in corpNoCik), "no CIK (e.g. Japan) → no fabricated identifier or sameAs");

console.log("\ncompanyDataset (the Google Dataset Search entry):");
const ds = companyDataset({
  ticker: "ADBE", name: "Adobe Inc.", cik: "0000796343",
  pageUrl: `${SITE_URL}/c/ADBE`, jsonUrl: `${SITE_URL}/c/ADBE.json`,
  spanFrom: "2016", spanTo: "2025", asOf: "2026-07-13", sourceUrl: "https://sec.gov/x",
});
eq(ds["@type"], "Dataset", "type is Dataset");
ok(ds.isAccessibleForFree === true, "isAccessibleForFree: true");
ok(ds.license === `${SITE_URL}/docs/data#terms`, "license points at the site's own terms");
ok(!/creativecommons|cc-by|by\/4/i.test(ds.license), "license is NOT CC-BY (attribution requested, never required)");
ok(ds.distribution?.["@type"] === "DataDownload" && ds.distribution.encodingFormat === "application/json", "distribution is a JSON DataDownload");
ok(ds.distribution.contentUrl === `${SITE_URL}/c/ADBE.json`, "distribution points at the JSON twin");
eq(ds.temporalCoverage, "2016/2025", "temporalCoverage spans the record");
ok(ds.dateModified === "2026-07-13", "dateModified is the honest asOf");
ok(ds.isPartOf?.["@id"] === `${SITE_URL}/docs/data#catalog`, "isPartOf the DataCatalog node");
ok(ds.about?.identifier?.value === "0000796343", "about carries the CIK anchor");
ok(/EDINET/.test(companyDataset({ ticker: "8001", name: "Itochu", pageUrl: "x", jsonUrl: "y", filingSource: "EDINET filings" }).description), "source is parameterized (EDINET for Japan)");
eq(companyDataset({ ticker: "X", name: "X", pageUrl: "p", jsonUrl: "j", spanFrom: "2020", spanTo: "2020" }).temporalCoverage, "2020", "single-year span is not written as a range");

console.log("\nbreadcrumbList:");
const bc = breadcrumbList([{ name: "Owner Scorecard", url: "/" }, { name: "Railroads", url: "/industries/railroads" }, { name: "Union Pacific (UNP)", url: `${SITE_URL}/c/UNP` }]);
eq(bc["@type"], "BreadcrumbList", "type is BreadcrumbList");
eq(bc.itemListElement.length, 3, "one ListItem per trail entry");
eq(bc.itemListElement[0].position, 1, "positions are 1-indexed");
ok(bc.itemListElement[1].item === `${SITE_URL}/industries/railroads`, "relative URLs are absolutized");
ok(bc.itemListElement[2].item === `${SITE_URL}/c/UNP`, "absolute URLs are left intact");
eq(breadcrumbList([{ name: "only one" }]), null, "a trail of one is not a breadcrumb");

// No rating-shaped types anywhere in what these helpers emit.
const blob = JSON.stringify([ORG, corp, ds, bc]);
ok(!/FinancialProduct|AggregateRating|"Review"|"Rating"/.test(blob), "no rating/review/financial-product types (doctrine)");

if (fails) { console.error(`\n❌ seoTest: ${fails} failure(s)`); process.exit(1); }
console.log("\n✅ seoTest passed");
