#!/usr/bin/env node
// auditIntegrity.mjs — the "silent failure" gate.
//
// auditCoverage catches a whole POOL cratering; auditData catches a figure that is wrong WHERE PRESENT.
// Neither catches the failure modes that shipped silently across 2026-07: a couple of mega-caps
// vanishing (XOM resolved to an empty reorg shell, Morgan Stanley stranded on a discontinued tag), a
// whole CATEGORY going hollow (foreign banks carried over with no top line for weeks, below the
// catastrophe floor), an IMPOSSIBLE figure (Marui's operating income exceeding its revenue 1.6×, a
// revenue understated 8×), and a value silently SWINGING between refreshes (a bank's gross-vs-net top
// line, a filer's currency flipping). None are a pool crater and none are a per-company contradiction
// the other gates model, so they slipped. This encodes them as invariants so the next one turns the
// run red before it ships. Runs the SAME lib functions the pages use, so a check can't drift from the
// display.
//
//   npm run audit:integrity
//   npm run audit:integrity -- --strict   # warnings also fail
//   PRIOR_DIR=/path/to/old/src/data npm run audit:integrity   # enable the cross-refresh delta check
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { topLineRevenue } from "../src/lib/fundamentals.mjs";
import { financialKind } from "../src/lib/archetype.mjs";

const dataDir = path.join(process.cwd(), "src", "data");
const STRICT = process.argv.includes("--strict");
const nowYear = new Date().getUTCFullYear();
const OPINC_SPIKE = 40; // count of opInc>rev in a pool above which it's a systematic break, not the known tail
const load = (dir, f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).companies || []; } catch { return []; } };

const POOLS = [
  { key: "US", file: "fundamentals.json" },
  { key: "ADR", file: "fundamentals.adr.json" },
  { key: "JP", file: "fundamentals.jp.json" },
  { key: "EU", file: "fundamentals.eu.json" },
];

// Bellwethers that must always be present with a plausible, recent top line. Deliberately a spread
// across sectors and pools — and INCLUDING the names that broke this session (XOM, MS, GS, MUFG, SMFG,
// MFG) so the exact regressions can never recur unseen. A name here going missing or hollow FAILS.
const ANCHORS = {
  US: ["AAPL", "MSFT", "GOOGL", "AMZN", "XOM", "CVX", "JPM", "BAC", "GS", "MS", "JNJ", "MRK", "PG", "KO", "WMT", "COST", "HD", "CAT", "BA", "MMC", "FI", "V", "MA"],
  ADR: ["TSM", "ASML", "NVO", "SAP", "AZN", "SHEL", "TM", "SONY", "HSBC", "MUFG", "SMFG", "MFG", "TTE", "UL"],
  JP: ["7203", "6758", "6861", "8035", "7974", "9432", "6098", "6501"], // non-financials only (banks are held back)
  EU: ["MC", "OR", "RMS", "DGE", "CPR"],
};

const findings = [];
const note = (level, code, msg) => findings.push({ level, code, msg });
const latestFy = (c) => { const ys = (c.history || []).map((h) => h?.fy).filter((v) => v != null); const f = c.fy ?? (ys.length ? Math.max(...ys) : null); return f; };
const lines = (c) => c.ttm?.lines || c.lines || {};

for (const P of POOLS) {
  const companies = load(dataDir, P.file);
  const byTicker = new Map(companies.map((c) => [String(c.ticker).toUpperCase(), c]));
  const n = companies.length;
  if (!n) { note("error", "empty-pool", `${P.key}: pool is empty (${P.file} unreadable or has no companies)`); continue; }

  // 1) ANCHORS — each must exist, resolve a positive top line, and be within ~2 years.
  for (const t of ANCHORS[P.key] || []) {
    const c = byTicker.get(t);
    if (!c) { note("error", "anchor-missing", `${P.key}/${t}: bellwether absent from the pool — a silent drop (wrong CIK, stranded tag, or routed away)`); continue; }
    const tl = topLineRevenue(lines(c), c);
    if (!(tl != null && tl > 0)) { note("error", "anchor-hollow", `${P.key}/${t}: bellwether present but no top line reads — extraction hole`); continue; }
    const fy = latestFy(c);
    if (fy != null && nowYear - fy >= 3) note("error", "anchor-stale", `${P.key}/${t}: bellwether stranded at FY${fy} (${nowYear - fy}y old) — a stale carry-over`);
  }

  // 2) CATEGORY COMPLETENESS — financials (SIC 6000-6499) must nearly all resolve a top line. A hole
  //    here is exactly the foreign-bank class: present, SIC-classified, but no revenue read.
  const fins = companies.filter((c) => { const s = Number(c.sic) || 0; return s >= 6000 && s <= 6499; });
  if (fins.length >= 20) {
    const withTop = fins.filter((c) => { const tl = topLineRevenue(lines(c), c); return tl != null && tl > 0; }).length;
    const rate = withTop / fins.length;
    if (rate < 0.9) note("error", "category-hollow", `${P.key}: only ${(100 * rate).toFixed(0)}% of ${fins.length} financials resolve a top line (floor 90%) — a financial-extraction cohort broke`);
  }

  // 3) IMPOSSIBLE RELATIONSHIPS — per operating company (financials read on the balance sheet, exempt).
  //    Operating income above revenue is arithmetically impossible for an operating business and is the
  //    tell of an understated revenue (Marui) or an overstated operating line.
  let opGtRev = 0, examples = [];
  for (const c of companies) {
    if (financialKind(c)) continue; // banks/insurers/fee: revenue is reconstructed, opInc n/a
    const L = lines(c);
    const rev = topLineRevenue(L, c), oi = L.operatingIncome;
    if (rev != null && rev > 0 && oi != null && oi > rev * 1.05) {
      opGtRev++; if (examples.length < 6) examples.push(`${c.ticker} (oi ${(oi / 1e9).toFixed(1)} > rev ${(rev / 1e9).toFixed(1)})`);
    }
  }
  // A persistent long tail of these exists (leasing/royalty/mortgage/rental filers whose net-revenue
  // presentation isn't matched), so a handful WARNS (surfaces for fixing) and only a SPIKE fails — a
  // taxonomy shift that understated revenue across a cohort would push the count far past this.
  if (opGtRev) note(opGtRev > OPINC_SPIKE ? "error" : "warn", "opinc-over-rev", `${P.key}: ${opGtRev} operating compan${opGtRev === 1 ? "y has" : "ies have"} operating income above revenue (impossible; understated top line): ${examples.join(", ")}`);
}

// 4) MOJIBAKE IN THE DATA — the committed JSON must not carry double-encoded text ("â€™" for an
//    apostrophe, "Ã©" for é). The rendered pages have the same tripwire in verifyStatic, but that
//    runs at DEPLOY time, after the commit: a data-borne artifact would land green, then fail every
//    deploy after it with the signal buried in the Cloudflare dashboard. Here it turns the data
//    workflow itself red, before the commit, with the file named. Raw-text scan, all data files —
//    base64 and legitimate accented/Japanese text cannot contain these sequences.
const MOJIBAKE = ["�", "â€", "â‚¬", "Ã©", "Ã¨", "Ã¤", "Ã¶", "Ã¼", "Ã±", "Ã¸", "Ã¥", "Â£", "Â¥", "Â«", "Â»"];
for (const f of fs.readdirSync(dataDir).filter((n) => n.endsWith(".json"))) {
  let raw = "";
  try { raw = fs.readFileSync(path.join(dataDir, f), "utf8"); } catch { continue; }
  for (const m of MOJIBAKE) {
    const i = raw.indexOf(m);
    if (i >= 0) { note("error", "mojibake-in-data", `${f}: contains ${JSON.stringify(m)} at offset ${i} (${JSON.stringify(raw.slice(Math.max(0, i - 40), i + 20))}) — double-encoded text committed; fix the producer, not the file`); break; }
  }
}

// 5) CROSS-REFRESH DELTA — if a prior data dir is provided, flag a company whose top line swung by more
//    than 60% or whose reporting currency flipped between refreshes. Catches re-tags (gross↔net), a
//    stale carry-over resurfacing, or a currency mis-detection. Off by default (needs a prior snapshot).
const PRIOR = process.env.PRIOR_DIR;
if (PRIOR && fs.existsSync(PRIOR)) {
  for (const P of POOLS) {
    const now = new Map(load(dataDir, P.file).map((c) => [String(c.ticker).toUpperCase(), c]));
    const was = new Map(load(PRIOR, P.file).map((c) => [String(c.ticker).toUpperCase(), c]));
    let swings = 0, examples = [];
    for (const [t, c] of now) {
      const p = was.get(t); if (!p) continue;
      if (c.currency && p.currency && c.currency !== p.currency) { swings++; if (examples.length < 6) examples.push(`${t} ${p.currency}→${c.currency}`); continue; }
      const a = topLineRevenue(lines(c), c), b = topLineRevenue(lines(p), p);
      if (a != null && b != null && b > 0 && Math.abs(a - b) / b > 0.6) { swings++; if (examples.length < 6) examples.push(`${t} ${(b / 1e9).toFixed(1)}→${(a / 1e9).toFixed(1)}`); }
    }
    if (swings) note("warn", "refresh-swing", `${P.key}: ${swings} compan${swings === 1 ? "y" : "ies"} swung top line >60% or changed currency vs the prior refresh (re-tag / carry-over / currency): ${examples.join(", ")}`);
  }
} else {
  note("info", "delta-skipped", "cross-refresh delta skipped (set PRIOR_DIR to a prior src/data to enable)");
}

// ---- report ----
const errs = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");
const order = { error: 0, warn: 1, info: 2 };
for (const f of findings.sort((a, b) => order[a.level] - order[b.level])) {
  const tag = f.level === "error" ? "❌ FAIL" : f.level === "warn" ? "⚠️  WARN" : "·  info";
  console.log(`${tag}  [${f.code}] ${f.msg}`);
}
console.log(`\nauditIntegrity: ${errs.length} error(s), ${warns.length} warning(s).`);
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  if (errs.length || (STRICT && warns.length)) { console.error("\n❌ auditIntegrity failed.\n"); process.exit(1); }
  console.log("✅ auditIntegrity passed.");
}
