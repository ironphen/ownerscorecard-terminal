#!/usr/bin/env node
// buildShelvesFromTaxonomy.mjs — the one-time (rerunnable) migration from the hand-curated
// 28-shelf taxonomy to the conventional sector/industry structure (docs: the founder's
// standardization directive, 2026-07-17).
//
// MUST RUN BEFORE archetype.mjs flips to the taxonomy: it uses the CURRENT industryOf to
// compute each company's old industry label and slug, pairs it with the NEW industry from
// taxonomy.json, and emits (a) src/data/shelves.json in shelf-per-industry form (noun = the
// industry label, sector carried beside it; only industries that actually occur), and (b)
// redirect lines mapping every old grouping slug and old industry-chapter slug to the new
// industry slug its members majority-moved to.
import { readFileSync, writeFileSync } from "node:fs";
import { industryOf } from "../src/lib/archetype.mjs";
import shelvesOld from "../src/data/shelves.json" with { type: "json" };
import taxonomy from "../src/data/taxonomy.json" with { type: "json" };

const load = (f) => { try { return JSON.parse(readFileSync("src/data/" + f, "utf8")).companies || []; } catch { return []; } };
const us = load("fundamentals.json"), adr = load("fundamentals.adr.json"), jp = load("fundamentals.jp.json");

const indBySlugNew = new Map();
const indByLabelNew = new Map();
const orderedIndustries = [];
for (const s of taxonomy.sectors) for (const i of s.industries) {
  const entry = { ...i, sector: s.name };
  indByLabelNew.set(i.label, entry);
  indBySlugNew.set(i.slug, entry);
  orderedIndustries.push(entry);
}

// The NEW industry for a company: ticker override → JP map → SIC map. Null = unmapped (counted).
function newIndustry(c, pool) {
  const ov = taxonomy.overrides[c.ticker];
  if (ov) return ov.industry;
  if (pool === "jp") return taxonomy.jp[c.ticker]?.industry ?? null;
  const s4 = String(c.sic || "").slice(0, 4);
  return taxonomy.sic[s4]?.industry ?? null;
}

// Old label/slug per company via the CURRENT (pre-flip) code paths.
const oldSlugByLabel = new Map();
for (const sh of shelvesOld.shelves) for (const i of sh.industries) oldSlugByLabel.set(i.label, i.slug);
const oldShelfSlugByLabel = new Map();
// grouping slugs (old) keyed by shelf noun — regenerate the same slugs groupingColumns used
const oldShelfSlug = (noun) => noun.toLowerCase().replace(/^they\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
for (const sh of shelvesOld.shelves) for (const i of sh.industries) oldShelfSlugByLabel.set(i.label, oldShelfSlug(sh.noun));

const occur = new Map(); // new industry label -> count
const moves = new Map(); // oldKey -> Map(newSlug -> count), oldKey = "chapter:slug" | "grouping:slug"
let unmapped = [];
const pools = [["us", us], ["adr", adr], ["jp", jp]];
for (const [pool, list] of pools) {
  for (const c of list) {
    const ni = newIndustry(c, pool);
    if (!ni || !indByLabelNew.has(ni)) { unmapped.push(`${pool}:${c.ticker} (${ni ?? "no mapping"})`); continue; }
    occur.set(ni, (occur.get(ni) || 0) + 1);
    const oldLabel = pool === "jp" ? (c.industry || "Diversified") : industryOf(c).label;
    const newSlug = indByLabelNew.get(ni).slug;
    for (const key of [
      oldSlugByLabel.has(oldLabel) ? "chapter:" + oldSlugByLabel.get(oldLabel) : null,
      oldShelfSlugByLabel.has(oldLabel) ? "grouping:" + oldShelfSlugByLabel.get(oldLabel) : null,
    ]) {
      if (!key) continue;
      const m = moves.get(key) || new Map();
      m.set(newSlug, (m.get(newSlug) || 0) + 1);
      moves.set(key, m);
    }
  }
}

// The sector slug is computed HERE, once, and stored — the same doctrine the industry slugs follow
// ("slugs are stored, not derived at read time, so a later change to the slug rule can never
// silently move a URL"). /groupings/sector/{sectorSlug} reads it verbatim. A collision between two
// sector names fails the build here rather than shadowing a route later.
const sectorSlug = (name) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
{
  const seen = new Map();
  for (const s of taxonomy.sectors) {
    const slug = sectorSlug(s.name);
    if (seen.has(slug)) throw new Error(`sector slug collision: "${seen.get(slug)}" and "${s.name}" both slug to "${slug}"`);
    seen.set(slug, s.name);
  }
}

// shelves.json v2: one shelf per occurring industry, menu order; noun = the industry label.
const shelves = orderedIndustries
  .filter((i) => (occur.get(i.label) || 0) > 0)
  .map((i) => ({ noun: i.label, sector: i.sector, sectorSlug: sectorSlug(i.sector), family: i.family, industries: [{ label: i.label, slug: i.slug }] }));
writeFileSync("src/data/shelves.json", JSON.stringify({ shelves }, null, 1));

// Redirects: each old chapter slug and old grouping slug 301s to its members' majority new
// industry — continuity for every established URL, one line each.
const lines = [];
for (const [key, m] of [...moves.entries()].sort()) {
  const [kind, slug] = key.split(":");
  const winner = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  if (kind === "chapter") lines.push(`/industries/${slug} /industries/${winner} 301`);
  else lines.push(`/groupings/${slug} /groupings/${winner} 301`);
}
writeFileSync("C:/Users/ryanr/AppData/Local/Temp/claude/C--Users-ryanr/6d6f1b58-2746-4214-95da-20156eb83cfd/scratchpad/taxonomy-redirects.txt", [...new Set(lines)].join("\n") + "\n");

console.log(`shelves.json: ${shelves.length} industries across ${new Set(shelves.map((s) => s.sector)).size} sectors; redirects: ${new Set(lines).size}; unmapped: ${unmapped.length}`);
if (unmapped.length) console.log("  unmapped:", unmapped.slice(0, 20).join(", "));
