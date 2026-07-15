#!/usr/bin/env node
// auditContinuity.mjs — the series gate (docs/correctness-campaign.md, N3).
//
// auditIntegrity reads the latest figures; auditBelievability reads each figure against its
// neighbors on the same page. Neither reads a company's record AS A SERIES, so a whole class of
// series breaks ships silently: a phantom or duplicated fiscal year (the xBRL Jan-1 trap's
// symptom), a share count that steps 4× mid-history because one year came from a later filing's
// split-adjusted comparatives while its neighbor came from the original as-filed figure (AAPL's
// committed FY2017→FY2018 series does exactly this), a TTM block frozen at a vintage older than
// the annual record it sits beside (the Franco-Nevada class — the fetcher guards revenue only),
// and a top line that collapses 90% between adjacent years because a tag changed mid-record.
// This reads every pool's history[] and ttm as series and flags the breaks.
//
// Tiering, deliberately: structural impossibilities (duplicate fy, future fy, ttm older than the
// record it sits beside, fy/history desync, a record with no fiscal year at all, share
// scale-mistags ≥250× across ADJACENT years) are ERRORS; discontinuities that have legitimate
// causes (splits, real collapses, divestitures, multi-year gaps) are WARNINGS — they are the
// campaign's suspect list, each to be verified against the filing before it counts, never
// auto-"fixed".
//
// The gate is held to a committed IDENTITY baseline (src/data/continuity-baseline.json): the
// ticker set per pool/code found at the 2026-07-15 kickoff. An error on a ticker IN the set is
// the known pre-campaign tail and passes; an error on any ticker NOT in the set is a NEW break
// and fails, by name. Fixed tickers show up as prunable and are removed in the same change that
// fixed the data — the baseline only ever shrinks. Identity, not counts: a refresh that fixed one
// company and broke another would leave a count unchanged, and a universe rebuild that dropped
// ten old offenders must not open headroom for ten new ones.
//
//   npm run audit:continuity
//   npm run audit:continuity -- --strict        # warnings also fail
//   POOLS=JP npm run audit:continuity           # gate only the pools a workflow writes
//   REPORT=/path/out.json npm run audit:continuity   # dump machine-readable findings (the error map)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { topLineRevenue } from "../src/lib/fundamentals.mjs";
import { financialKind } from "../src/lib/archetype.mjs";

const dataDir = path.join(process.cwd(), "src", "data");
const STRICT = process.argv.includes("--strict");
const nowYear = new Date().getUTCFullYear();
const load = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")).companies || []; } catch { return []; } };

const ALL_POOLS = [
  { key: "US", file: "fundamentals.json" },
  { key: "ADR", file: "fundamentals.adr.json" },
  { key: "JP", file: "fundamentals.jp.json" },
  { key: "EU", file: "fundamentals.eu.json" },
];
// Each data workflow gates on the pools it writes (POOLS=US,ADR / JP / EU), so a break in one
// pool can only redden the workflow responsible for it, never block a healthy refresh elsewhere.
// Unset (local runs, npm test) reads everything.
const POOL_FILTER = (process.env.POOLS || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const POOLS = POOL_FILTER.length ? ALL_POOLS.filter((p) => POOL_FILTER.includes(p.key)) : ALL_POOLS;

// Swing thresholds. Revenue below the floor is skipped — percentage moves on tiny bases are noise,
// and the floor is deliberately currency-agnostic (a warn tier reads fine either way).
const SWING = 0.7;          // |YoY change| beyond this warns
const SWING_FLOOR = 5e7;    // prior-year value must be at least this to judge a swing
const SWING_MAX_GAP = 3;    // compare across a history gap up to this many years (a re-tag often IS the gap)
const SHARE_STEP = 2.5;     // adjacent-year share ratio beyond this (or under 1/this) warns: split, or a basis seam
const SHARE_MISTAG = 250;   // beyond this, between ADJACENT years, it is a scale mistag: error

const findings = [];
const note = (level, code, pool, ticker, msg) => findings.push({ level, code, pool, ticker, msg });

for (const P of POOLS) {
  const companies = load(P.file);
  for (const c of companies) {
    const t = String(c.ticker || "?").toUpperCase();
    const hist = (c.history || []).filter((h) => h && h.fy != null);

    // C0 — a record that carries data but no fiscal year at all is invisible to every dated
    // check on the page and in this file; the most broken record must not be the least flagged.
    if (c.fy == null && (hist.length || c.ttm)) {
      note("error", "fy-missing", P.key, t, `record carries ${hist.length ? `a ${hist.length}-year history` : "a ttm block"} but no top-level fy — undated, so every vintage check is blind to it`);
    }

    // C1 — fiscal-year structure: duplicates and future years are impossible; either means the
    // period selection mis-keyed a filing (the Jan-1 trap files a duration ending Jan 1 under the
    // wrong year). Interior gaps are common enough to count silently (a missing filing year).
    const fys = hist.map((h) => Number(h.fy)).sort((a, b) => a - b);
    const dup = fys.find((y, i) => i && y === fys[i - 1]);
    if (dup != null) note("error", "fy-duplicate", P.key, t, `history carries FY${dup} twice — period selection double-keyed a filing`);
    const future = fys.find((y) => y > nowYear + 1);
    if (future != null) note("error", "fy-future", P.key, t, `history carries FY${future} (beyond ${nowYear + 1}) — a phantom year from a mis-normalized period end`);

    // C2 — the record and the headline must agree on which year is latest.
    if (c.fy != null && fys.length && Number(c.fy) < fys[fys.length - 1]) {
      note("error", "fy-behind-history", P.key, t, `headline fy=FY${c.fy} but history reaches FY${fys[fys.length - 1]} — record/headline desync`);
    }

    // C3 — TTM vintage: a TTM block dated at or before the annual period end it sits beside is a
    // frozen carry-over shown as current (the fetcher's anti-freeze guard covers the ADR revenue
    // line only; this covers every pool and every line, because one shared asOf stamps the whole
    // block). Full-date compare against periodEnd where the record carries one — a TTM frozen
    // eleven months inside the same calendar year must not hide behind a year-granularity check —
    // with a 14-day tolerance for 52/53-week fiscal calendars; year-compare where periodEnd is
    // absent. ttm.isFY is exempt from the periodEnd compare: the fetcher stamps the FY itself as
    // the TTM when no fresher quarter exists, which is honest and equal-dated, not frozen.
    if (c.ttm && typeof c.ttm.asOf === "string") {
      const ty = Number(c.ttm.asOf.slice(0, 4));
      if (typeof c.periodEnd === "string" && c.periodEnd.length >= 10) {
        const tol = new Date(Date.parse(c.periodEnd.slice(0, 10) + "T00:00:00Z") - 14 * 86400000).toISOString().slice(0, 10);
        if (!c.ttm.isFY && c.ttm.asOf.slice(0, 10) < tol) {
          note("error", "ttm-stale", P.key, t, `ttm asOf ${c.ttm.asOf} predates the FY${c.fy} period end ${c.periodEnd.slice(0, 10)} — a frozen TTM shown as current`);
        }
      } else if (Number.isFinite(ty) && c.fy != null && ty < Number(c.fy)) {
        note("error", "ttm-stale", P.key, t, `ttm asOf ${c.ttm.asOf} predates the FY${c.fy} record — a frozen TTM shown as current`);
      }
    }

    // C4 — share-count series. Between ADJACENT fiscal years a huge step is a scale mistag
    // (units vs thousands) and errors; a modest step is a real split OR a basis seam (one year
    // split-adjusted from a later filing's comparatives, its neighbor as-filed — per-share
    // arithmetic across that seam is wrong either way) and warns. Across a GAP even a huge step
    // only warns: BRCC's FY2019→FY2021 853× is a real SPAC recapitalization spanning a missing
    // year, and the error tier must never cry wolf on as-filed truth.
    const shares = hist
      .map((h) => ({ fy: Number(h.fy), v: h.lines?.sharesDiluted ?? null }))
      .filter((s) => s.v != null && s.v > 0)
      .sort((a, b) => a.fy - b.fy);
    for (let i = 1; i < shares.length; i++) {
      const r = shares[i].v / shares[i - 1].v;
      const step = r > 1 ? r : 1 / r;
      const adjacent = shares[i].fy - shares[i - 1].fy === 1;
      if (step >= SHARE_MISTAG && adjacent) {
        note("error", "share-scale-mistag", P.key, t, `share count steps ${step.toFixed(0)}× FY${shares[i - 1].fy}→FY${shares[i].fy} (${shares[i - 1].v.toExponential(2)}→${shares[i].v.toExponential(2)}) — a units-vs-thousands mistag, no real split is this large`);
      } else if (step >= SHARE_STEP) {
        note("warn", "share-step", P.key, t, `share count steps ${step.toFixed(1)}× FY${shares[i - 1].fy}→FY${shares[i].fy}${adjacent ? "" : " (across a history gap)"} — a split, a recapitalization, or a split-adjusted/as-filed basis seam; verify against the filings`);
      }
    }

    // C5 — top-line continuity: a swing past the threshold against the NEAREST prior year on a
    // real base. Nearest-prior, not strictly adjacent: a re-tag and a missing middle year are
    // commonly the same event, so a gap must not exempt the swing (capped at SWING_MAX_GAP years —
    // beyond that a big move is ordinary drift). Financials are exempt (their top line is
    // reconstructed and legitimately jumpy). Real collapses exist — warn tier, verified before
    // counted.
    if (!financialKind(c)) {
      const revs = hist
        .map((h) => ({ fy: Number(h.fy), v: topLineRevenue(h.lines || {}, c) }))
        .filter((r) => r.v != null)
        .sort((a, b) => a.fy - b.fy);
      for (let i = 1; i < revs.length; i++) {
        const gap = revs[i].fy - revs[i - 1].fy;
        if (gap > SWING_MAX_GAP) continue;
        const a = revs[i].v, b = revs[i - 1].v;
        if (b >= SWING_FLOOR && Math.abs(a - b) / b > SWING) {
          note("warn", "revenue-swing", P.key, t, `top line ${a > b ? "jumps" : "collapses"} ${(100 * Math.abs(a - b) / b).toFixed(0)}% FY${revs[i - 1].fy}→FY${revs[i].fy}${gap > 1 ? " (across a history gap)" : ""} (${(b / 1e9).toFixed(2)}B→${(a / 1e9).toFixed(2)}B) — re-tag, acquisition, or divestiture; verify`);
        }
      }
    }
  }
}

// ---- the identity baseline (docs/correctness-campaign.md, N7) ----
// The kickoff found 200+ pre-existing errors: fixing them is pipeline work (fixShareScale for the
// ADR pool, TTM purges) that lands over weeks, and the gate must block NEW breaks in the meantime
// without blocking every refresh on the known tail. Baseline shape:
//   { "errors": { "US/ttm-stale": ["ASB", "BLK", ...], ... } }
// A missing FILE is a legitimate raw gate (any error fails). A file that exists but does not
// parse, or parses without an errors object, fails LOUDLY as its own headline — the ratchet-down
// flow invites hand edits, and a trailing comma must point at itself, not at 200 known findings.
const baselinePath = path.join(dataDir, "continuity-baseline.json");
let baseline = null;
let baselineBroken = null;
if (fs.existsSync(baselinePath)) {
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    if (!baseline || typeof baseline.errors !== "object" || Array.isArray(baseline.errors)) baselineBroken = "parsed but has no errors object";
  } catch (e) {
    baselineBroken = `does not parse (${e.message})`;
  }
}

// ---- report ----
const errs = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");
const byCode = {};
for (const f of findings) byCode[f.code] = (byCode[f.code] || 0) + 1;

const ERR_SHOWN = 25;
for (const f of errs.slice(0, ERR_SHOWN)) console.log(`❌ FAIL  [${f.code}] ${f.pool}/${f.ticker}: ${f.msg}`);
if (errs.length > ERR_SHOWN) console.log(`   … ${errs.length - ERR_SHOWN} more errors (REPORT=out.json for all)`);
const WARN_SHOWN = 15;
for (const f of warns.slice(0, WARN_SHOWN)) console.log(`⚠️  WARN  [${f.code}] ${f.pool}/${f.ticker}: ${f.msg}`);
if (warns.length > WARN_SHOWN) console.log(`   … ${warns.length - WARN_SHOWN} more warnings (REPORT=out.json for all)`);
console.log(`\nauditContinuity: ${errs.length} error(s), ${warns.length} warning(s)${POOL_FILTER.length ? ` (pools: ${POOLS.map((p) => p.key).join(",")})` : ""}. By code: ${Object.entries(byCode).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`);

if (process.env.REPORT) {
  const errTickers = {};
  for (const f of errs) { const k = `${f.pool}/${f.code}`; (errTickers[k] = errTickers[k] || []).push(f.ticker); }
  fs.writeFileSync(process.env.REPORT, JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), errTickers, findings }, null, 1));
  console.log(`report written: ${process.env.REPORT}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  let failed = false;
  if (baselineBroken) {
    console.error(`\n❌ continuity-baseline.json exists but ${baselineBroken} — fix the baseline file itself; the findings above are the long-known tail, not the cause.\n`);
    failed = true;
  } else if (baseline) {
    const fresh = [];
    const known = new Set();
    for (const f of errs) {
      const set = baseline.errors[`${f.pool}/${f.code}`];
      if (Array.isArray(set) && set.includes(f.ticker)) known.add(`${f.pool}/${f.code}/${f.ticker}`);
      else fresh.push(f);
    }
    // Prunable: baselined tickers that no longer error — remove them in the same change that
    // fixed the data, so the baseline only ever shrinks.
    const prunable = [];
    for (const [k, set] of Object.entries(baseline.errors)) {
      if (!POOL_FILTER.length || POOL_FILTER.includes(k.split("/")[0])) {
        for (const tk of set) if (!known.has(`${k}/${tk}`)) prunable.push(`${k}/${tk}`);
      }
    }
    if (fresh.length) {
      console.error(`\n❌ auditContinuity: ${fresh.length} NEW break(s) not in the baseline:`);
      for (const f of fresh) console.error(`   [${f.code}] ${f.pool}/${f.ticker}: ${f.msg}`);
      failed = true;
    }
    if (prunable.length) console.log(`⤵ ${prunable.length} baselined name(s) no longer error — prune from continuity-baseline.json: ${prunable.slice(0, 12).join(", ")}${prunable.length > 12 ? ` … +${prunable.length - 12}` : ""}`);
    if (!failed) console.log("✅ auditContinuity passed (no breaks beyond the baselined tail).");
  } else {
    if (errs.length) failed = true;
    if (!failed) console.log("✅ auditContinuity passed.");
  }
  if (STRICT && warns.length) failed = true;
  if (failed) { console.error("❌ auditContinuity failed."); process.exit(1); }
}
