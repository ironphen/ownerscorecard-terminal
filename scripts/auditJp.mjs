#!/usr/bin/env node
// auditJp.mjs, the data-quality gate for the Japanese pool.
//
// The mirror of auditData.mjs for fundamentals.jp.json. It runs the SAME lib functions the
// JP pages use, so the check can never drift from the display, and holds each data layer to
// a floor so a pipeline regression (a taxonomy shift that silently drops a layer for a swath
// of filers) turns a CI run red instead of shipping quietly. Operating income is checked
// only where it is a meaningful read, the trading houses earn through equity-method
// affiliates, so a missing operating line there is expected, not a fault.
//
//   npm run audit:jp
//   npm run audit:jp -- --strict

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fmtMoney, liquidAssets, oiReliable } from "../src/lib/fundamentals.mjs";

const yen = (v) => fmtMoney(v, "JPY");
const dataDir = path.join(process.cwd(), "src", "data");
const load = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); } catch { return {}; } };
const companies = (load("fundamentals.jp.json").companies) || [];
const STRICT = process.argv.includes("--strict");

const findings = [];
const ERR = (code, t, msg) => findings.push({ level: "error", code, t, msg });
const WARN = (code, t, msg) => findings.push({ level: "warn", code, t, msg });

for (const c of companies) {
  const t = String(c.ticker || "?");
  const L = c.lines || {};

  // Top line and the core profitability and balance-sheet figures: each drives a headline,
  // so a missing one shows as a blank where a number belongs.
  if (L.revenue == null || L.revenue <= 0) ERR("revenue-missing", t, "no usable revenue (the headline would be blank)");
  if (L.netIncome == null) WARN("netincome-missing", t, "no net income (the net-margin and ROE reads go blank)");
  if (L.stockholdersEquity == null || L.stockholdersEquity <= 0) WARN("equity-missing", t, `equity ${yen(L.stockholdersEquity)} would make book value and ROE meaningless`);
  if (L.sharesDiluted == null || L.sharesDiluted <= 0) WARN("shares-missing", t, "no share count (per-share rows and the reverse-DCF go blank)");

  // Operating income only where it is a meaningful read (not the trading houses).
  if (oiReliable(c) && L.operatingIncome == null) WARN("opincome-missing", t, "no operating income (the operating-margin read goes blank)");

  // A revenue that sits below net income is the signature of the parent-only / consolidated
  // mix-up the IFRS mapping is meant to prevent, so guard against a regression there.
  if (L.revenue != null && L.netIncome != null && L.netIncome > 0 && L.revenue < L.netIncome) {
    ERR("revenue-below-profit", t, `revenue ${yen(L.revenue)} is below net income ${yen(L.netIncome)} (likely a parent-only figure)`);
  }

  // History depth: the durability strips need a few years; a single year means the
  // five-year-summary reach failed for this filer.
  const hy = (c.history || []).filter((h) => h?.lines?.revenue != null).length;
  if (hy < 3) WARN("history-thin", t, `only ${hy} year(s) of history (durability reads are weak)`);
}

// Coverage floors, set to catastrophe levels (a layer cratering), not quality targets.
const frac = (n, d) => (d ? n / d : 1);
const n = companies.length;
const oiNames = companies.filter((c) => oiReliable(c));
const coverage = [
  ["revenue > 0", frac(companies.filter((c) => (c.lines?.revenue || 0) > 0).length, n), 0.95],
  ["net income", frac(companies.filter((c) => c.lines?.netIncome != null).length, n), 0.9],
  ["equity > 0", frac(companies.filter((c) => (c.lines?.stockholdersEquity || 0) > 0).length, n), 0.9],
  ["share count", frac(companies.filter((c) => (c.lines?.sharesDiluted || 0) > 0).length, n), 0.85],
  ["operating income (where meaningful)", frac(oiNames.filter((c) => c.lines?.operatingIncome != null).length, oiNames.length), 0.85],
  ["5+ years of history", frac(companies.filter((c) => (c.history || []).filter((h) => h?.lines?.revenue != null).length >= 5).length, n), 0.7],
];
const covFails = coverage.filter(([, v, min]) => v < min);

const byCode = {};
for (const f of findings) (byCode[f.code] ||= []).push(f);
const errs = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");

console.log(`\nOwner Scorecard, Japan data quality audit (${n} companies)\n`);
console.log("COVERAGE");
for (const [label, v, min] of coverage) {
  console.log(`  ${v >= min ? "OK  " : "FAIL"} ${label.padEnd(40)} ${(100 * v).toFixed(0).padStart(3)}%  (floor ${(100 * min).toFixed(0)}%)`);
}
console.log(`\nFINDINGS  (${errs.length} error${errs.length === 1 ? "" : "s"}, ${warns.length} warning${warns.length === 1 ? "" : "s"})`);
const codes = Object.keys(byCode).sort((a, b) => (byCode[b][0].level === "error" ? 1 : 0) - (byCode[a][0].level === "error" ? 1 : 0) || a.localeCompare(b));
if (!codes.length) console.log("  none");
for (const code of codes) {
  const list = byCode[code];
  console.log(`\n  ${list[0].level.toUpperCase()}  ${code}  (${list.length})`);
  for (const f of list.slice(0, 12)) console.log(`    ${f.t.padEnd(6)} ${f.msg}`);
  if (list.length > 12) console.log(`    ... and ${list.length - 12} more`);
}

const fail = !companies.length || covFails.length > 0 || (STRICT && errs.length + warns.length > 0);
console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"}  (${errs.length} errors, ${warns.length} warnings, ${covFails.length} coverage floors breached${STRICT ? ", strict" : ""})`);
if (errs.length && !fail) console.log(`Note: ${errs.length} per-company error(s) above need review but do not block the refresh.`);
console.log("");
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) process.exit(fail ? 1 : 0);
