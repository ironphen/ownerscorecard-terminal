// Offline regression test for the shelves (docs/discovery-design.md feature 4) and the industry
// slug map the /industries/[slug] chapters (feature 3) will reuse. The curation in
// src/data/shelves.json is hand-written; the data refreshes on its own schedule — this test is the
// tripwire between them. It guards, over the REAL three pools:
//
//   1. Completeness: every industry label that actually occurs (classify's industryOf label for
//      the US and ADR pools, the hand-assigned industry field for Japan) sits on exactly one
//      shelf, so a data refresh can never silently orphan an industry off the catalog.
//   2. No double-shelving: one label on two shelves would double-count its companies.
//   3. No empty shelves, and every shelf noun is a plain sentence.
//   4. Slugs: present on every industry, unique site-wide, kebab-case — these become the chapter
//      URLs, so a collision or a format drift here is a broken permalink there.
//
// Stale curation the OTHER way (a shelved label no company carries any more) is a warning, not a
// failure: a dead entry renders nothing and breaks nothing, and the next curation pass sweeps it.
import fundamentals from "../src/data/fundamentals.json" with { type: "json" };
import adr from "../src/data/fundamentals.adr.json" with { type: "json" };
import jp from "../src/data/fundamentals.jp.json" with { type: "json" };
import { SHELVES, industryLabelOf, shelfOfIndustry, industrySlug } from "../src/lib/shelves.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL " + name); } };

// ---- the real distribution, the same read businesses.astro renders ----
const occurring = new Map(); // label -> company count
for (const c of [...fundamentals.companies, ...adr.companies, ...jp.companies]) {
  const label = industryLabelOf(c);
  occurring.set(label, (occurring.get(label) || 0) + 1);
}
ok("pools non-trivial (>= 3000 companies)", [...occurring.values()].reduce((a, b) => a + b, 0) >= 3000);
ok("industry variety sane (>= 100 labels)", occurring.size >= 100);

// ---- 1 + 2: every occurring industry on exactly one shelf ----
const shelfCountByLabel = new Map();
for (const s of SHELVES) for (const ind of s.industries) {
  shelfCountByLabel.set(ind.label, (shelfCountByLabel.get(ind.label) || 0) + 1);
}
const unshelved = [...occurring.keys()].filter((l) => !shelfCountByLabel.has(l));
ok(`every occurring industry is shelved (${unshelved.length} orphaned)`, unshelved.length === 0);
for (const l of unshelved) console.log(`  orphaned: "${l}" (${occurring.get(l)} companies)`);
const doubled = [...shelfCountByLabel.entries()].filter(([, n]) => n > 1).map(([l]) => l);
ok(`no industry sits on two shelves (${doubled.length} doubled)`, doubled.length === 0);
for (const l of doubled) console.log(`  doubled: "${l}"`);

// The two lookups agree with the raw file walk.
ok("shelfOfIndustry resolves every occurring label", [...occurring.keys()].every((l) => unshelved.includes(l) || shelfOfIndustry(l) !== null));

// ---- 3: shelf shape ----
ok("a sane number of shelves (20-35)", SHELVES.length >= 20 && SHELVES.length <= 35);
ok("every shelf has at least one industry", SHELVES.every((s) => s.industries.length >= 1));
ok("every shelf noun is a plain sentence (ends in a period)", SHELVES.every((s) => typeof s.noun === "string" && /^They .+\.$/.test(s.noun)));
ok("shelves are alphabetical by sentence (the stated fixed order)", SHELVES.every((s, i) => i === 0 || SHELVES[i - 1].noun.localeCompare(s.noun) < 0));
ok("industries alphabetical within each shelf", SHELVES.every((s) => s.industries.every((ind, i) => i === 0 || s.industries[i - 1].label.localeCompare(ind.label) < 0)));

// ---- 4: slugs ----
const allInds = SHELVES.flatMap((s) => s.industries);
ok("every industry carries a slug", allInds.every((ind) => typeof ind.slug === "string" && ind.slug.length > 0));
ok("slugs are kebab-case", allInds.every((ind) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(ind.slug)));
ok("slugs unique site-wide", new Set(allInds.map((ind) => ind.slug)).size === allInds.length);
ok("labels unique site-wide", new Set(allInds.map((ind) => ind.label)).size === allInds.length);
ok("industrySlug resolves a known label", industrySlug("Banks") === "banks");

// ---- stale curation: warn only ----
const stale = allInds.filter((ind) => !occurring.has(ind.label));
if (stale.length) console.log(`note: ${stale.length} shelved industr${stale.length === 1 ? "y" : "ies"} with no companies after this refresh (renders nothing, breaks nothing): ${stale.map((i) => `"${i.label}"`).join(", ")}`);

console.log(`\nshelvesTest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
