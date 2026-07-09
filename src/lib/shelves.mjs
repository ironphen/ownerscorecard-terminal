// The shelves: the hand-curated mapping from industry to a plain-noun shelf (docs/discovery-design.md
// feature 4), plus the industry slug map the /industries/[slug] chapters (feature 3) will reuse.
//
// The industry's identity throughout is the LABEL — classify(company).industry.label for the US and
// ADR pools, and the hand-assigned company.industry field for the Japan pool (EDINET filings carry
// no SIC, so the 34 JP names were mapped by hand when they were ingested; five of their labels —
// Pharma, Automakers, Medical devices, Tobacco, Household & personal care — coincide with US labels
// on purpose and merge into the same industry). The numeric 3-digit SIC prefix in industry.key is
// NOT one-to-one with labels (prefix 737 alone yields Enterprise software, Internet platforms and
// Software & internet), so the label is the stable key, and the slug stored beside it in
// shelves.json is the permanent URL fragment for the industry's chapter. Slugs are stored, not
// derived at read time, so a later change to the slug rule can never silently move a URL.
//
// scripts/shelvesTest.mjs guards the file both ways on every `npm test`: an industry that appears
// in any pool without a shelf, a label on two shelves, an empty shelf, or a duplicate slug fails
// the suite — so a data refresh cannot silently orphan an industry.
import shelvesData from "../data/shelves.json" with { type: "json" };
import { industryOf } from "./archetype.mjs";

// Alphabetical by shelf sentence in the file, and rendered in file order: a fixed reading order,
// never a ranking. Industries within a shelf are alphabetical by label for the same reason.
export const SHELVES = shelvesData.shelves;

// The one industry label a company carries, for shelving, chapters and counts.
export function industryLabelOf(company) {
  if (company?.market === "JP") return company.industry || "Diversified";
  return industryOf(company).label;
}

const byLabel = new Map();
for (const shelf of SHELVES) for (const ind of shelf.industries) byLabel.set(ind.label, { shelf, slug: ind.slug });

// The shelf an industry sits on, or null where the curation has not caught up with the data
// (shelvesTest fails loudly in that case; callers may still meet it mid-edit).
export function shelfOfIndustry(label) {
  return byLabel.get(label)?.shelf || null;
}

// The stable chapter slug for an industry label, or null. Feature 3's /industries/[slug] routes
// build from exactly this map.
export function industrySlug(label) {
  return byLabel.get(label)?.slug || null;
}
