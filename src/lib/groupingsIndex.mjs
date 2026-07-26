// The browse inventory: what is on every shelf, counted once for the whole build.
//
// The groupings surface now has three view types (the door, eleven sector tables, ninety-odd
// industry tables) and all three render the same control bar, which needs the same counts. Doing
// the classify pass inside the component would repeat it on every page; this module computes it at
// import time, and the module instance is shared across the build, so it happens once.
//
// Scope, stated rather than assumed: the US, ADR and Japanese pools. That is the criterion
// /groupings/[slug] has always used. The EU pool is read by the catalog and the almanac but has
// never been part of the groupings, so a sector count here will not match the same sector's count
// on /catalog. The pages say so rather than letting the difference look like an error.
import fundamentals from "../data/fundamentals.json" with { type: "json" };
import adr from "../data/fundamentals.adr.json" with { type: "json" };
import jp from "../data/fundamentals.jp.json" with { type: "json" };
import { industryLabelOf } from "./shelves.mjs";
import { SECTORS, SECTOR_COLUMNS } from "./groupingColumns.mjs";

const countByLabel = new Map();
for (const c of [...(fundamentals.companies || []), ...(adr.companies || []), ...(jp.companies || [])]) {
  const label = industryLabelOf(c);
  countByLabel.set(label, (countByLabel.get(label) || 0) + 1);
}

// Sectors in the taxonomy's fixed file order, each with its industries in the same order. An
// industry that no company carries after a refresh is dropped: a zero row would advertise a table
// that renders nothing.
export const SECTOR_INDEX = SECTORS.map((s) => {
  const industries = s.industries
    .map((ind) => ({ ...ind, count: countByLabel.get(ind.noun) || 0 }))
    .filter((ind) => ind.count > 0);
  return {
    name: s.name,
    slug: s.slug,
    href: `/groupings/sector/${s.slug}`,
    industries,
    count: industries.reduce((a, ind) => a + ind.count, 0),
    columns: SECTOR_COLUMNS[s.name],
  };
}).filter((s) => s.count > 0);

export const sectorIndexByName = new Map(SECTOR_INDEX.map((s) => [s.name, s]));
export const sectorIndexBySlug = new Map(SECTOR_INDEX.map((s) => [s.slug, s]));

// Every industry across every sector, one flat list — the door's alphabetical index reads it, and
// so does the control bar when it needs a sibling's sector.
export const ALL_INDUSTRIES = SECTOR_INDEX.flatMap((s) => s.industries.map((ind) => ({ ...ind, sector: s.name, sectorSlug: s.slug })));
export const industryEntryBySlug = new Map(ALL_INDUSTRIES.map((ind) => [ind.slug, ind]));

export const TOTAL_COMPANIES = SECTOR_INDEX.reduce((a, s) => a + s.count, 0);
export function industryCountOf(label) {
  return countByLabel.get(label) || 0;
}
