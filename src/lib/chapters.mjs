// The industry chapters' order and computed headers — docs/discovery-design.md feature 3.
// One chapter per industry label that occurs in any pool (US, ADR, Japan share one label space,
// per lib/shelves.mjs), every member in strict alphabetical order by ticker. Pure arithmetic over
// the pools the pages already import; presence in the pool is the only criterion — the chapters
// are reading surfaces, not tests, so withheld and flagged records sit in their alphabetical
// place like everything else.
//
// Memoized globally for the build, like manualOrder: each of the ~219 chapter
// pages and each of the ~3,530 company pages (for the industry prev/next pair) ask for the same
// canonical order, so the pass over the pools runs a single time.
import { industryLabelOf, industrySlug, shelfOfIndustry } from "./shelves.mjs";
import { classify } from "./archetype.mjs";
import { cashPosition, grossMargin } from "./fundamentals.mjs";

const safe = (fn, c) => {
  try {
    return fn(c);
  } catch {
    return null;
  }
};
// The lower median, the same convention the company-page reads use, so a chapter figure can
// never disagree with the arithmetic it mirrors.
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)] : null);

let _cache = null;

export function industryOrder(usCompanies, adrCompanies, jpCompanies) {
  if (_cache) return _cache;
  const pools = [
    ["us", usCompanies || []],
    ["adr", adrCompanies || []],
    ["jp", jpCompanies || []],
  ];

  const byLabel = new Map(); // label -> chapter
  for (const [poolKey, pool] of pools) {
    for (const c of pool) {
      const ticker = String(c.ticker || "").toUpperCase();
      if (!ticker) continue;
      const label = industryLabelOf(c);
      const slug = industrySlug(label);
      // A label the curation has not caught up with has no stable URL; shelvesTest fails the suite
      // loudly in that state, so this guard only matters mid-edit.
      if (!slug) continue;
      if (!byLabel.has(label))
        byLabel.set(label, { label, slug, shelfNoun: shelfOfIndustry(label)?.noun || null, members: [] });
      byLabel.get(label).members.push({ ticker, company: c, poolKey, jp: poolKey === "jp" });
    }
  }

  // Chapters alphabetical by label — a fixed reading order, never a ranking — and members strictly
  // A to Z by ticker within each. Each member's prev/next neighbor in its own chapter feeds the
  // company pages' industry-order links; a neighbor may live in another pool (a JP name between
  // two US names), so the neighbor carries its route.
  const chapters = [...byLabel.values()].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const neighbors = {}; // `${poolKey}:${ticker}` -> { prev, next, label, slug, i, count }
  const bySlug = new Map();
  for (const ch of chapters) {
    ch.members.sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
    bySlug.set(ch.slug, ch);
    ch.members.forEach((m, i) => {
      neighbors[`${m.poolKey}:${m.ticker}`] = {
        prev: i > 0 ? { ticker: ch.members[i - 1].ticker, jp: ch.members[i - 1].jp } : null,
        next: i < ch.members.length - 1 ? { ticker: ch.members[i + 1].ticker, jp: ch.members[i + 1].jp } : null,
        label: ch.label,
        slug: ch.slug,
        i,
        count: ch.members.length,
      };
    });
  }

  _cache = { chapters, bySlug, neighbors };
  return _cache;
}

// The company page a chapter member (or a neighbor from the map above) lives on.
export function chapterMemberHref(m) {
  return (m.jp ? "/jp/" : "/c/") + m.ticker;
}

// The three per-member reads the chapter header aggregates. Same guards as the corresponding
// computations in lib/fundamentals.mjs, so a chapter figure can never
// disagree with the company page: gross profitability is gross profit ÷ total
// assets (grossMargin's own withholds, plus the plausibility band), capital intensity is capital
// expenditure ÷ revenue, each the member's median across its readable years, at least three such
// years required. All three are operating-company reads, withheld from banks, insurers and REITs
// exactly as the company page and the Entry Block withhold them.
function memberReads(company) {
  const cls = company?.market === "JP" ? null : safe(classify, company);
  const isFin = !!cls && ["financial", "reit"].includes(cls.sector?.key);
  let gpa = null;
  let capint = null;
  let netCash = null; // null = not read; true/false where the debt line is reliably captured
  if (!isFin) {
    const gpas = [];
    const cis = [];
    for (const h of company.history || []) {
      const L = h?.lines;
      if (!L) continue;
      const gm = grossMargin(L);
      if (gm != null && gm > 0.05 && gm < 0.95 && L.revenue > 0 && L.totalAssets > 0)
        gpas.push((gm * L.revenue) / L.totalAssets);
      if (L.capex != null && L.revenue > 0) cis.push(Math.abs(L.capex) / L.revenue);
    }
    if (gpas.length >= 3) gpa = median(gpas);
    if (cis.length >= 3) capint = median(cis);
    const cp = safe(cashPosition, company);
    if (cp && cp.tone !== "none") netCash = /^Net cash/.test(cp.label);
  }
  return { isFin, gpa, capint, netCash };
}

// The chapter header's facts: a description of the list, never a grade. Ratios only (gross profit
// ÷ assets, capex ÷ revenue, cash vs debt), so members filed in different currencies aggregate
// without conversion. Each figure carries the count of members it was read on; a member missing
// the inputs is simply absent from the median, never counted against the others.
export function chapterFacts(chapter) {
  const gpas = [];
  const cis = [];
  let netCashYes = 0;
  let netCashRead = 0;
  let finCount = 0;
  for (const m of chapter.members) {
    const r = memberReads(m.company);
    if (r.isFin) finCount++;
    if (r.gpa != null) gpas.push(r.gpa);
    if (r.capint != null) cis.push(r.capint);
    if (r.netCash != null) {
      netCashRead++;
      if (r.netCash) netCashYes++;
    }
  }
  return {
    count: chapter.members.length,
    finCount,
    gpa: { n: gpas.length, median: median(gpas) },
    capint: { n: cis.length, median: median(cis) },
    netCash: { n: netCashRead, yes: netCashYes },
  };
}
