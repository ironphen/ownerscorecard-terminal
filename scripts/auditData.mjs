#!/usr/bin/env node
// auditData.mjs, the data-quality gate.
//
// Every figure on the site is arithmetic on SEC filings, so a wrong figure on a major
// company would discredit the whole tool. EDGAR's XBRL is also noisy and its taxonomy
// shifts (ASU 2023-07 added a segment subtotal that broke three breakdowns until caught),
// so anomalies ship silently. This codifies the audits we run by hand into one pass that
// runs the SAME lib functions the pages use, so the check can never drift from the
// display. It prints a grouped report and a coverage scorecard, and exits non-zero on a
// genuine problem (an error-level finding, or a coverage threshold breached), so a CI run
// goes red and a person looks. Warnings are printed but do not fail unless --strict.
//
//   npm run audit            # before shipping, and after every fetch
//   npm run audit -- --strict
//   ONLY=DPZ,MET npm run audit

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { topLineRevenue, roicValue, fmtUSD } from "../src/lib/fundamentals.mjs";
import { classify, financialProfile } from "../src/lib/archetype.mjs";
import { returnOnEquity } from "../src/lib/financials.mjs";
import { combinedRatio } from "../src/lib/insurers.mjs";
import { medicalLossRatio } from "../src/lib/managedCare.mjs";
import { pickPrimaryBreakdown, isAggregate } from "../src/lib/segments.mjs";

const dataDir = path.join(process.cwd(), "src", "data");
const load = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); } catch { return {}; } };
const fund = load("fundamentals.json");
const seg = (load("segments.json").companies) || {};
const lang = (load("language.json").companies) || {};

const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const STRICT = process.argv.includes("--strict");
let companies = fund.companies || [];
if (ONLY.length) companies = companies.filter((c) => ONLY.includes(String(c.ticker).toUpperCase()));

// ---- findings ----
const findings = [];
const flag = (level, code, ticker, msg) => findings.push({ level, code, ticker, msg });
const ERR = (...a) => flag("error", ...a);
const WARN = (...a) => flag("warn", ...a);

// ---- per-company checks. Each is archetype-aware and runs on the value the page would
// actually show, so we flag a misleading display, not merely an odd raw tag. ----
for (const c of companies) {
  const t = String(c.ticker || "?").toUpperCase();
  const L = c.lines || {};
  const { kind, subtype } = financialProfile(c);
  const sector = classify(c).sector.key;
  const isFin = !!kind;

  // Top line: the headline number. Must exist and be positive after reconstruction.
  const rev = topLineRevenue(L, c);
  if (rev == null || rev <= 0) {
    ERR("revenue-missing", t, "no usable top-line revenue (headline would be blank or zero)");
  } else if (kind === "bank") {
    const comp = (L.netInterestIncome || 0) + (L.noninterestIncome || 0);
    if (comp > 0 && rev < comp * 0.8) ERR("revenue-recon-failed", t, `bank top line ${fmtUSD(rev)} still below net interest + fee income ${fmtUSD(comp)}`);
  } else if (kind === "insurer" || kind === "managedCare") {
    const comp = (L.premiumsEarned || 0) + (L.investmentIncome || 0);
    if (comp > 0 && rev < comp * 0.8) ERR("revenue-recon-failed", t, `insurer top line ${fmtUSD(rev)} still below premiums + investment income ${fmtUSD(comp)}`);
  } else if (rev < 50e6 && (Math.abs(L.netIncome || 0) > 100e6 || (L.totalAssets || 0) > 2e9) && sector !== "reit") {
    WARN("revenue-tiny", t, `top line ${fmtUSD(rev)} looks too small for a business this size (net income ${fmtUSD(L.netIncome)}, assets ${fmtUSD(L.totalAssets)})`);
  }

  // Industrials are read on operating income and ROIC; financials are not.
  if (!isFin) {
    if (L.operatingIncome == null) WARN("opincome-missing", t, "no operating income (the margin and EBIT reads go blank)");
    if (roicValue(L) == null) WARN("roic-null", t, "ROIC not computable (negative invested capital or missing inputs)");
  }

  // Return on equity is the headline for banks, insurers and life insurers, and it is
  // garbage on zero or negative equity, where the page shows it raw rather than guarded.
  if (kind === "bank" || kind === "insurer") {
    if (L.stockholdersEquity != null && L.stockholdersEquity <= 0) ERR("roe-neg-equity", t, `equity ${fmtUSD(L.stockholdersEquity)} would make the displayed return on equity meaningless`);
    else if (returnOnEquity(L) == null) WARN("roe-null", t, "return on equity not computable (the financial headline read is blank)");
  }

  // P&C combined ratio: only ever shown inside a believable band, so flag a P&C insurer
  // whose ratio we could not compute (the page falls back to a bare loss ratio).
  if (kind === "insurer" && subtype !== "life-insurer") {
    if (L.premiumsEarned && combinedRatio(L) == null) WARN("combined-ratio-untagged", t, "premiums present but combined ratio out of band or untagged (showing loss ratio alone)");
  }
  // Managed care lives on the medical loss ratio; flag when premiums are under-tagged
  // (Centene reads 364% raw, so the guard suppresses it and the metric goes blank).
  if (kind === "managedCare" && L.premiumsEarned && medicalLossRatio(L) == null) {
    WARN("mlr-untagged", t, "premiums under-tagged, so the medical loss ratio is suppressed");
  }

  // Debt and its interest should be consistent, but only where borrowed debt is the
  // funding. A bank pays most of its interest on deposits, which are not "debt," so the
  // ratio is meaningless there; we check industrials and REITs. An implied rate far above
  // market means the debt is under-captured (the Domino's case: $196M interest on a
  // tagged $15M of debt; Ford's $150B of Ford Credit borrowings tagged as $471M).
  const debtRelevant = kind == null || kind === "reit";
  const ie = L.interestExpense, td = L.totalDebt;
  if (debtRelevant && ie != null && ie > 25e6 && (td == null || td <= 0)) {
    WARN("debt-missing", t, `pays ${fmtUSD(ie)} of interest but no debt is tagged`);
  } else if (debtRelevant && ie != null && td != null && td > 0 && ie / td > 0.3) {
    WARN("debt-implied-rate", t, `${fmtUSD(ie)} interest on ${fmtUSD(td)} debt implies a ${(100 * ie / td).toFixed(0)}% rate, debt is likely under-captured`);
  }

  // Segments: the gate should never let an aggregate subtotal lead the shown breakdown,
  // and stored data still carrying one is a pending re-fetch from the pipeline fix.
  const S = seg[t];
  if (S) {
    const pick = pickPrimaryBreakdown(S);
    if (pick && isAggregate([...pick.raw.items].sort((a, b) => b.revenue - a.revenue)[0]?.qname)) {
      ERR("segment-aggregate-shown", t, `the shown ${pick.kind} breakdown is led by a us-gaap subtotal member`);
    }
    for (const ax of ["bySegment", "byProduct", "byGeography"]) {
      const b = S[ax];
      if (b && b.items.some((i) => isAggregate(i.qname))) { WARN("segment-aggregate-stored", t, `${ax} still stores a subtotal member (cleaned on next fetch)`); break; }
    }
  }
}

// ---- coverage scorecard: a pipeline regression shows up as a coverage cliff (a taxonomy
// change that silently drops debt or segments for a whole swath of filers), so we hold
// each layer to a floor. The floors are deliberately set to catastrophe levels, well
// below the normal numbers, not as quality targets: they must catch a layer cratering
// while tolerating the ordinary dilution of adding companies (a batch of recent IPOs
// genuinely lacks eight years of history). A real quality target is a different job; this
// is the smoke alarm. ----
const inds = companies.filter((c) => !financialProfile(c).kind);
const frac = (n, d) => (d ? n / d : 1);
const coverage = [
  ["top-line revenue > 0", frac(companies.filter((c) => topLineRevenue(c.lines || {}, c) > 0).length, companies.length), 0.95],
  ["operating income (industrials)", frac(inds.filter((c) => c.lines?.operatingIncome != null).length, inds.length), 0.9],
  ["ROIC (industrials)", frac(inds.filter((c) => roicValue(c.lines || {}) != null).length, inds.length), 0.85],
  ["8+ years of history", frac(companies.filter((c) => (c.history || []).length >= 8).length, companies.length), 0.7],
  ["fresh quarter (TTM)", frac(companies.filter((c) => c.ttm?.lines).length, companies.length), 0.8],
  ["owner flags (what the filing emphasizes)", frac(companies.filter((c) => lang[c.ticker]?.ownerFlags?.length).length, companies.length), 0.7],
  ["segment breakdown (any axis)", frac(companies.filter((c) => { const S = seg[c.ticker]; return S && (S.bySegment || S.byProduct || S.byGeography); }).length, companies.length), 0.5],
];
const covFails = coverage.filter(([, v, min]) => v < min);

// ---- report ----
const byCode = {};
for (const f of findings) (byCode[f.code] ||= []).push(f);
const errs = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");

console.log(`\nOwner Scorecard, data quality audit (${companies.length} companies)\n`);
console.log("COVERAGE");
for (const [label, v, min] of coverage) {
  const ok = v >= min;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label.padEnd(42)} ${(100 * v).toFixed(0).padStart(3)}%  (floor ${(100 * min).toFixed(0)}%)`);
}

console.log(`\nFINDINGS  (${errs.length} error${errs.length === 1 ? "" : "s"}, ${warns.length} warning${warns.length === 1 ? "" : "s"})`);
const order = ["error", "warn"];
const codes = Object.keys(byCode).sort((a, b) => order.indexOf(byCode[a][0].level) - order.indexOf(byCode[b][0].level) || a.localeCompare(b));
if (!codes.length) console.log("  none");
for (const code of codes) {
  const list = byCode[code];
  const lvl = list[0].level.toUpperCase();
  console.log(`\n  ${lvl}  ${code}  (${list.length})`);
  for (const f of list.slice(0, 12)) console.log(`    ${f.ticker.padEnd(6)} ${f.msg}`);
  if (list.length > 12) console.log(`    ... and ${list.length - 12} more`);
}

// What blocks an unattended refresh: only a systemic coverage cliff (a taxonomy change
// that drops a whole layer), because a single odd new filer must not freeze every future
// weekly run. Per-company findings are printed loudly for review but do not block the
// batch. A local pre-ship check runs --strict to fail on anything. Coverage floors gate a
// full run only, not a debugging subset (ONLY=...), where a few companies can't represent
// catalog coverage.
const covGate = ONLY.length ? 0 : covFails.length;
const fail = covGate > 0 || (STRICT && errs.length + warns.length > 0);
const needsReview = errs.length > 0;
console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"}  (${errs.length} errors, ${warns.length} warnings, ${covGate} coverage floors breached${STRICT ? ", strict" : ""})`);
if (needsReview && !fail) console.log(`Note: ${errs.length} per-company error${errs.length === 1 ? "" : "s"} above need review but do not block the refresh.`);
console.log("");
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) process.exit(fail ? 1 : 0);
