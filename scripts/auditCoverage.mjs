#!/usr/bin/env node
// auditCoverage.mjs — the cross-pool ingestion guardrail.
//
// The other gates (auditData, auditJp, auditBelievability, auditLanguage) check that a figure, where
// present, is sane. This one checks the thing they don't: that the data the GBM analysis actually needs
// is PRESENT, FRESH, and hasn't quietly cratered for a whole pool. A scheduled fetch can fail softly —
// a taxonomy shift drops depreciation across a cohort, an API outage stops an entire pool refreshing,
// a carry-over masks a company that has gone stale for good — and none of that is a per-company
// contradiction, so none of the other gates catch it. It would just ship, quietly thinner each week.
//
// So this encodes what an owner needs to reason the GBM way, as enforced invariants across all three
// fundamentals pools (US, ADR, Japan):
//   - a top line (the headline),
//   - owner-earnings inputs — operating cash flow AND capex (Buffett's figure can't be formed without both),
//   - depreciation (without it, maintenance capex falls back to TOTAL capex and owner earnings are
//     overstated — a silent, systematic error if a cohort loses the tag),
//   - a multi-year record deep enough to read through a cycle (Graham's "average the years"),
//   - a share count (every per-share read and the reverse-DCF need it),
//   - and freshness — that a company isn't stranded on an old fiscal year while its pool moved on.
//
// Floors are set as CATASTROPHE lines — well below today's coverage, with headroom — so a real cliff
// turns the run red and blocks the commit, while normal week-to-week drift does not. The known-thin
// realities (the ADR pool carries less capital-allocation and depreciation history; Japan's EDINET
// five-year summary caps its record at ~5 years) are surfaced as WARNINGS, not failures: visible, never
// blocking, because they are properties of the source, not regressions to fix.
//
//   npm run audit:coverage
//   npm run audit:coverage -- --strict   # warnings also fail (for a hard pre-release check)

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dataDir = path.join(process.cwd(), "src", "data");
const load = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); } catch { return {}; } };
const STRICT = process.argv.includes("--strict");
const nowYear = new Date().getUTCFullYear();

// The language layer is keyed by ticker (US + ADR; Japanese filings are not machine-read by design).
const language = load("language.json").companies || {};
const segments = load("segments.json").companies || {};

// Owner-earnings inputs for a year's `lines`: operating cash flow AND capex both present.
const hasOE = (L) => L && L.cashFromOps != null && L.capex != null;
const latestFy = (c) => {
  const ys = (c.history || []).map((h) => h?.fy).filter((v) => v != null);
  return c.fy != null ? Number(c.fy) : ys.length ? Math.max(...ys.map(Number)) : null;
};
// Years in the record (history + the headline year) that carry owner-earnings inputs.
const oeYears = (c) => {
  const rows = [...(c.history || []).map((h) => h?.lines), c.lines].filter(Boolean);
  return rows.filter(hasOE).length;
};
const frac = (n, d) => (d ? n / d : 1);

const findings = [];
const note = (level, pool, code, msg) => findings.push({ level, pool, code, msg });

// Each pool: the file, the through-cycle depth its source can support (Japan's EDINET caps at ~5
// years; SEC reaches ~10), and whether the language layer covers it.
const POOLS = [
  { key: "US", file: "fundamentals.json", cycle: 7, hasLanguage: true, hasSegments: true },
  { key: "ADR", file: "fundamentals.adr.json", cycle: 7, hasLanguage: true, hasSegments: false, thinCapitalAlloc: true },
  { key: "JP", file: "fundamentals.jp.json", cycle: 5, hasLanguage: false, hasSegments: false, thinCapitalAlloc: true },
];

const report = [];
for (const P of POOLS) {
  const companies = load(P.file).companies || [];
  const n = companies.length;
  if (!n) { note("error", P.key, "pool-empty", `${P.file} has no companies — the pool failed to load or fetch`); continue; }

  const lead = Math.max(...companies.map(latestFy).filter((v) => v != null), 0);
  const withRev = companies.filter((c) => (c.lines?.revenue || 0) > 0).length;
  const withOE = companies.filter((c) => hasOE(c.lines)).length;
  const withDep = companies.filter((c) => c.lines?.depreciation != null).length;
  const withShares = companies.filter((c) => (c.lines?.sharesDiluted || 0) > 0).length;
  const withCycle = companies.filter((c) => oeYears(c) >= P.cycle).length;
  const langCount = P.hasLanguage ? companies.filter((c) => language[c.ticker]).length : 0;
  const segCount = P.hasSegments ? companies.filter((c) => segments[c.ticker]).length : 0;

  // Stale: a company three or more years behind the calendar — it has missed two-plus annual filing
  // cycles, the signature of a fetch that has quietly stopped refreshing it while carry-over keeps it
  // on the page. (Foreign 20-F filers legitimately lag a year, so the threshold is generous: only a
  // genuinely stranded name trips it, not a normal filing delay.)
  const stale = companies.filter((c) => { const fy = latestFy(c); return fy != null && nowYear - fy >= 3; });

  // Hard floors (a cliff fails the run); soft floors (a known-thin reality, warns only).
  const checks = [
    { label: "top line (revenue > 0)", v: frac(withRev, n), floor: 0.95, hard: true },
    { label: "owner-earnings inputs (CFO + capex)", v: frac(withOE, n), floor: 0.85, hard: true },
    { label: "share count", v: frac(withShares, n), floor: 0.9, hard: true },
    { label: "depreciation (owner-earnings integrity)", v: frac(withDep, n), floor: P.thinCapitalAlloc ? 0.5 : 0.9, hard: !P.thinCapitalAlloc },
    { label: `through-cycle record (${P.cycle}+ yr of owner earnings)`, v: frac(withCycle, n), floor: P.thinCapitalAlloc ? 0.45 : 0.6, hard: !P.thinCapitalAlloc },
  ];
  if (P.hasLanguage) checks.push({ label: "filing language", v: frac(langCount, n), floor: P.key === "ADR" ? 0.7 : 0.88, hard: true });
  if (P.hasSegments) checks.push({ label: "segment breakdown", v: frac(segCount, n), floor: 0.5, hard: false });

  for (const ch of checks) {
    if (ch.v < ch.floor) note(ch.hard ? "error" : "warn", P.key, "coverage-cliff",
      `${ch.label}: ${(100 * ch.v).toFixed(0)}% (floor ${(100 * ch.floor).toFixed(0)}%) — a cohort lost this layer`);
  }

  // Freshness, two ways. Whole-pool: if even the freshest company is years behind the calendar, the
  // fetch has stopped entirely — a hard failure. Subset: a broad band of stranded names (a quarter of
  // the pool missing two-plus cycles) is a systematic refresh failure; a handful are just abandoned
  // listings worth pruning, surfaced as a warning.
  if (lead && lead < nowYear - 2) note("error", P.key, "pool-stale", `the freshest fiscal year in the pool is FY${lead}, ${nowYear - lead} years behind ${nowYear} — the fetch has stopped`);
  else if (lead && lead < nowYear - 1) note("warn", P.key, "pool-stale", `the freshest fiscal year is FY${lead}, over a year behind ${nowYear} — check the fetch`);
  if (frac(stale.length, n) > 0.25) note("error", P.key, "coverage-cliff", `${stale.length} of ${n} companies are 3+ years behind the calendar — a broad refresh failure`);
  else if (stale.length) note("warn", P.key, "stranded", `${stale.length} compan${stale.length === 1 ? "y" : "ies"} 3+ years stale (likely delisted/abandoned, worth pruning): ${stale.slice(0, 8).map((c) => `${c.ticker} (FY${latestFy(c)})`).join(", ")}${stale.length > 8 ? ", …" : ""}`);

  report.push({ pool: P.key, n, lead, checks, stale: stale.length });
}

// ---- report ----
console.log(`\nOwner Scorecard, ingestion coverage guardrail`);
for (const r of report) {
  console.log(`\n${r.pool}  (${r.n} companies, leading FY${r.lead})`);
  for (const ch of r.checks) {
    const ok = ch.v >= ch.floor;
    const tag = ok ? "ok  " : ch.hard ? "FAIL" : "warn";
    console.log(`  ${tag} ${ch.label.padEnd(46)} ${(100 * ch.v).toFixed(0).padStart(3)}%  (floor ${(100 * ch.floor).toFixed(0)}%)`);
  }
  if (r.stale) console.log(`  ··   ${String(r.stale)} stranded 2+ yr behind the leading edge`);
}

const errs = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");
console.log(`\nFINDINGS  (${errs.length} error${errs.length === 1 ? "" : "s"}, ${warns.length} warning${warns.length === 1 ? "" : "s"})`);
for (const f of [...errs, ...warns]) console.log(`  ${f.level === "error" ? "FAIL" : "warn"}  ${f.pool.padEnd(3)} ${f.code.padEnd(14)} ${f.msg}`);
if (!findings.length) console.log("  none");

const fail = errs.length > 0 || (STRICT && warns.length > 0);
console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"}  (${errs.length} cliffs, ${warns.length} warnings${STRICT ? ", strict" : ""})`);
if (warns.length && !fail) console.log("Note: warnings are known-thin source realities (ADR capital-allocation depth, Japan's ~5-year EDINET record), surfaced not blocked.");
console.log("");
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) process.exit(fail ? 1 : 0);
