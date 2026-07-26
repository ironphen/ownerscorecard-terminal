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
import TAXONOMY from "../src/data/taxonomy.json" with { type: "json" };

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL " + name); } };

// ---- the real distribution, the same read businesses.astro renders ----
const occurring = new Map(); // label -> company count
for (const c of [...fundamentals.companies, ...adr.companies, ...jp.companies]) {
  const label = industryLabelOf(c);
  occurring.set(label, (occurring.get(label) || 0) + 1);
}
ok("pools non-trivial (>= 3000 companies)", [...occurring.values()].reduce((a, b) => a + b, 0) >= 3000);
// The 2026-07-17 standardization consolidated the SIC-description sprawl into ~93
// conventional industries under 11 sectors (src/data/taxonomy.json) — variety is now bounded
// by the menu, and drift in either direction is the signal.
ok("industry variety sane (60-120 labels)", occurring.size >= 60 && occurring.size <= 120);

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
ok("a sane number of shelves (60-120 — one per occurring industry)", SHELVES.length >= 60 && SHELVES.length <= 120);
ok("every shelf has at least one industry", SHELVES.every((s) => s.industries.length >= 1));
// Since the standardization, a shelf IS one conventional industry (noun = the industry
// label, sector carried beside it) and the fixed order is the taxonomy's sector-then-industry
// order — a reading order stated in one place (taxonomy.json), never a ranking.
ok("every shelf is one industry carrying its sector and family", SHELVES.every((s) => typeof s.noun === "string" && s.noun.length > 0 && typeof s.sector === "string" && typeof s.family === "string" && s.industries.length === 1 && s.industries[0].label === s.noun));
ok("shelf order follows the taxonomy's fixed order", (() => {
  const order = new Map();
  let n = 0;
  for (const sec of TAXONOMY.sectors) for (const i of sec.industries) order.set(i.label, n++);
  return SHELVES.every((s, i) => i === 0 || (order.get(SHELVES[i - 1].noun) ?? -1) < (order.get(s.noun) ?? -1));
})());

// ---- 4: slugs ----
const allInds = SHELVES.flatMap((s) => s.industries);
ok("every industry carries a slug", allInds.every((ind) => typeof ind.slug === "string" && ind.slug.length > 0));
ok("slugs are kebab-case", allInds.every((ind) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(ind.slug)));
ok("slugs unique site-wide", new Set(allInds.map((ind) => ind.slug)).size === allInds.length);
ok("labels unique site-wide", new Set(allInds.map((ind) => ind.label)).size === allInds.length);
ok("industrySlug resolves a known label", industrySlug("Banks") === "banks");

// The sector slug is stored beside the sector name, on the same doctrine: /groupings/sector/{slug}
// reads it verbatim, so a drift here would move eleven URLs silently.
ok("every shelf carries a sector slug", SHELVES.every((s) => typeof s.sectorSlug === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.sectorSlug)));
ok("one slug per sector, one sector per slug", (() => {
  const byName = new Map(), bySlug = new Map();
  for (const s of SHELVES) {
    if ((byName.get(s.sector) ?? s.sectorSlug) !== s.sectorSlug) return false;
    if ((bySlug.get(s.sectorSlug) ?? s.sector) !== s.sector) return false;
    byName.set(s.sector, s.sectorSlug);
    bySlug.set(s.sectorSlug, s.sector);
  }
  return byName.size === 11;
})());
// /groupings/sector/{sector-slug} sits in the same directory as /groupings/{industry-slug}; an
// industry slugged "sector" would shadow the whole route rather than fail.
ok("no industry slug is \"sector\"", allInds.every((ind) => ind.slug !== "sector"));

// ---- stale curation: warn only ----
const stale = allInds.filter((ind) => !occurring.has(ind.label));
if (stale.length) console.log(`note: ${stale.length} shelved industr${stale.length === 1 ? "y" : "ies"} with no companies after this refresh (renders nothing, breaks nothing): ${stale.map((i) => `"${i.label}"`).join(", ")}`);

console.log(`\nshelvesTest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
