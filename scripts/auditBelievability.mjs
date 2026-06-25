#!/usr/bin/env node
// auditBelievability.mjs — the internal-contradiction gate.
//
// auditData.mjs catches MISSING or out-of-band data (a blank cash-flow line, a revenue that
// won't reconcile). This catches the other failure that discredits the tool just as fast: a
// page that contradicts ITSELF or prints an arithmetically impossible figure — a 100% gross
// margin on a machinery maker, a net-cash balance sheet in a year whose debt simply wasn't
// tagged, a "through-cycle" range that doesn't contain the very figure shown beside it, a
// "cash machine" read on a business that has lost money every year. One such number on a
// marquee name (the kind a reader checks first) ends the tool's credibility, so these can
// never ship silently.
//
// Like auditData, every check runs the SAME lib functions the pages render from, so the gate
// can never drift from the display — it flags what a reader would actually see, not a raw tag.
// It prints a grouped report and exits non-zero on a confirmed contradiction (an error), so a
// CI run goes red and a person looks. Warnings print but don't fail unless --strict.
//
//   npm run audit:believe
//   npm run audit:believe -- --strict
//   ONLY=CAT,BRK-B npm run audit:believe

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  topLineRevenue, grossMargin, operatingMargin, ownerEarningsMargin, freeCashFlowAbs,
  liquidAssets, debtReliable, fmtMoney,
} from "../src/lib/fundamentals.mjs";
import { earningsPower } from "../src/lib/normalize.mjs";
import { financialProfile } from "../src/lib/archetype.mjs";

const dataDir = path.join(process.cwd(), "src", "data");
const load = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); } catch { return {}; } };

const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const STRICT = process.argv.includes("--strict");

// Every pool a reader can land on: the US universe plus the ADR and Japan pools, all rendered by
// the same components, so a contradiction in any of them is just as visible.
const pools = [
  ["US", load("fundamentals.json").companies || []],
  ["ADR", load("fundamentals.adr.json").companies || []],
  ["JP", load("fundamentals.jp.json").companies || []],
];
let companies = pools.flatMap(([pool, list]) => list.map((c) => ({ ...c, _pool: pool })));
if (ONLY.length) companies = companies.filter((c) => ONLY.includes(String(c.ticker).toUpperCase()));

// ---- findings ----
const findings = [];
const flag = (level, code, c, msg) => findings.push({ level, code, ticker: String(c.ticker || "?").toUpperCase(), pool: c._pool, msg });
const ERR = (c, code, msg) => flag("error", code, c, msg);
const WARN = (c, code, msg) => flag("warn", code, c, msg);

const histYears = (c) => (c.history || []).filter((h) => h?.lines);

// ---- the checks. Each mirrors a figure the page actually shows. ----
for (const c of companies) {
  const L = c.lines || {};
  const ttmL = c.ttm?.lines || null;
  const $ = (v) => fmtMoney(v, c.currency || "USD");
  const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
  const { kind } = financialProfile(c);

  // ---- B1. Impossible-high gross margin on a goods business ----
  // grossMargin() already withholds an impossibly LOW margin (cost of revenue mis-tagged so high
  // the gross goes negative, GE/Archer-Daniels). It has no ceiling, so a mis-tag that drops cost of
  // revenue to ~zero prints a ~100% gross margin — which is impossible for a business that carries
  // real inventory and therefore real cost of goods (Caterpillar's 2022+ reads 100%). A reader sees
  // it on the vital-signs strip and the record's gross-margin row. Flag the latest year and the TTM.
  // Inventory-intensity is the discriminator: a business holding 15%+ of revenue in stock has a real,
  // large cost of goods, so a near-100% gross margin is a cost-line mis-tag (Caterpillar). A genuinely
  // high-margin software or drug business carries only token inventory and is left alone. Financials
  // don't show a gross-margin row at all, so they're out of scope here.
  if (!kind) {
    const invHeavy = (lines) => lines && lines.inventory != null && lines.revenue > 0 && lines.inventory > lines.revenue * 0.15;
    for (const [tag, lines] of [["latest", L], ["TTM", ttmL]]) {
      if (!lines) continue;
      const gm = grossMargin(lines);
      if (gm != null && gm >= 0.92 && invHeavy(lines)) {
        ERR(c, "gross-margin-impossible-high", `${tag} gross margin ${pct(gm)} is impossible for a goods business carrying ${$(lines.inventory)} of inventory (${pct(lines.inventory / lines.revenue)} of revenue) — cost of revenue is mis-tagged near zero`);
        break; // one flag per company is enough; the row and the strip share the cause
      }
    }
  }

  // ---- B2. Gross-margin series discontinuity (corrupted cost of revenue) ----
  // A year-over-year gross-margin jump of 35+ points with the operating margin essentially flat is
  // arithmetically impossible: a real 35-point move in gross profit has to land somewhere, and a flat
  // operating margin says it didn't. The signature of a cost-of-revenue line that broke mid-record
  // (Caterpillar: 30% → 99% in one year, operating margin 13.5% → 13.3%). The reader sees the jump in
  // the record's gross-margin row.
  if (!kind) {
    const gmSeries = histYears(c).map((h) => ({ fy: h.fy, gm: grossMargin(h.lines), om: operatingMargin(h.lines) }));
    for (let i = 1; i < gmSeries.length; i++) {
      const a = gmSeries[i - 1], b = gmSeries[i];
      if (a.gm == null || b.gm == null) continue;
      const dGm = Math.abs(b.gm - a.gm), dOm = a.om != null && b.om != null ? Math.abs(b.om - a.om) : null;
      if (dGm >= 0.35 && dOm != null && dOm <= 0.06) {
        WARN(c, "gross-margin-discontinuity", `gross margin jumps ${pct(a.gm)} (FY${a.fy}) → ${pct(b.gm)} (FY${b.fy}) while operating margin barely moves (${pct(a.om)} → ${pct(b.om)}) — a ${(dGm * 100).toFixed(0)}-point gross move with no operating effect is impossible; cost of revenue is corrupted`);
        break;
      }
    }
  }

  // ---- B3. Net-debt shown as net cash in a year whose debt simply wasn't tagged ----
  // Mirrors TenYear's net-debt row exactly. A null total-debt year only legitimately reads as net
  // cash when the company is debt-free across the WHOLE record; if it carried debt elsewhere, a null
  // year is a gap, and showing it as net cash invents a clean balance sheet (the 8001/8031/DOW bug).
  // The row already guards this with everHadDebt — so this is the regression alarm that keeps it dead.
  {
    const debtOk = debtReliable(L) && debtReliable(c.ttm?.lines || {});
    const everHadDebt = [...histYears(c).map((h) => h.lines), L, ttmL].some((x) => x && x.totalDebt > 0);
    if (debtOk && everHadDebt) {
      for (const h of histYears(c)) {
        const HL = h.lines;
        // The exact condition under which the row would render a money() value rather than "—":
        const rendered = HL.totalDebt != null || !(everHadDebt || HL.cashAndEquivalents == null);
        if (rendered) {
          const nd = (HL.totalDebt || 0) - (liquidAssets(HL) || 0);
          if (HL.totalDebt == null && nd < 0) {
            ERR(c, "net-debt-spurious-cash", `FY${h.fy} shows a net-cash position (${$(nd)}) but total debt for that year is untagged, and the company carries debt elsewhere — a gap rendered as a clean balance sheet`);
            break;
          }
        }
      }
    }
  }

  // ---- B4. Earnings-power range must contain the figure shown beside it ----
  // NormalizedEarnings shows "Latest, reported" at a margin, the owner-earnings-margin range, and a
  // through-cycle read — all only when a normalized figure is actually displayed (normOE present;
  // a structural break or unstable record withholds it and shows the range as context instead). When
  // it IS shown, the range printed beside the latest figure must contain that latest margin, and an
  // "at its through-cycle average" verdict must match a latest margin that is actually near the median.
  // NormalizedEarnings renders only for non-financials, so scope the check there. The contradiction:
  // the section sets "Latest, reported" (from company.lines, the freshest year) beside a range/span
  // built from the history window — and when the latest year is missing its owner-earnings inputs in
  // the history copy (a capex gap), the window stops short of it, so the latest figure shown is a year
  // the range deliberately excludes (Dominion shows a 2025 figure beside a 2016–2019 range).
  if (!kind) {
    const ep = earningsPower(c);
    if (ep && ep.normOE != null && ep.oemRange && ep.latestOeMargin != null) {
      const [lo, hi] = ep.oemRange;
      if (ep.latestOeMargin < lo - 1e-9 || ep.latestOeMargin > hi + 1e-9) {
        WARN(c, "earnings-power-range", `"Latest, reported" margin ${(ep.latestOeMargin * 100).toFixed(1)}% falls outside the owner-earnings range shown beside it (${(lo * 100).toFixed(1)}% – ${(hi * 100).toFixed(1)}%, ${ep.span}) — the latest year sits outside the window the range is built from`);
      } else if (ep.cyclePos === "at" && ep.normOeMargin > 0) {
        const r = ep.latestOeMargin / ep.normOeMargin;
        if (r > 1.15 || r < 0.85) WARN(c, "earnings-power-cyclepos", `reads "near its through-cycle average, not a peak or trough" but the latest margin ${(ep.latestOeMargin * 100).toFixed(1)}% is ${(r * 100).toFixed(0)}% of the ${(ep.normOeMargin * 100).toFixed(1)}% median`);
      }
    }
  }

  // ---- B5. A celebratory owner-earnings read on a business that loses money every year ----
  // Owner earnings is the page's central "is it a good business?" metric, and a high owner-earnings
  // margin reads as a cash machine. But operating cash inflated by prepayments/payables can print a
  // positive owner-earnings margin for a company whose net income is negative every year and whose
  // free cash flow is deeply negative (CoreWeave) — cash an owner plainly cannot withdraw. If the
  // record is a persistent loss and free cash flow is negative, a positive owner-earnings margin is a
  // figure the page should not be celebrating.
  if (!kind) {
    const niAll = histYears(c).map((h) => h.lines.netIncome);
    const allLoss = niAll.length >= 4 && niAll.every((v) => v != null && v < 0);
    const oem = ownerEarningsMargin(L, c);
    const fcf = freeCashFlowAbs(L);
    if (allLoss && oem != null && oem > 0.05 && fcf != null && fcf < 0) {
      WARN(c, "owner-earnings-on-loss-maker", `owner-earnings margin reads +${pct(oem)} though net income was negative in all ${niAll.length} years on record and free cash flow is ${$(fcf)} — a cash-machine read on a cash burner`);
    }
  }
}

// ---- report ----
const byCode = {};
for (const f of findings) (byCode[f.code] ||= []).push(f);
const errs = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");

console.log(`\nOwner Scorecard, believability audit (${companies.length} companies across ${pools.filter(([, l]) => l.length).length} pools)\n`);
console.log(`FINDINGS  (${errs.length} contradiction${errs.length === 1 ? "" : "s"}, ${warns.length} warning${warns.length === 1 ? "" : "s"})`);
const order = ["error", "warn"];
const codes = Object.keys(byCode).sort((a, b) => order.indexOf(byCode[a][0].level) - order.indexOf(byCode[b][0].level) || a.localeCompare(b));
if (!codes.length) console.log("  none — every page is internally consistent");
for (const code of codes) {
  const list = byCode[code];
  console.log(`\n  ${list[0].level.toUpperCase()}  ${code}  (${list.length})`);
  for (const f of list.slice(0, 14)) console.log(`    ${(f.pool + " " + f.ticker).padEnd(11)} ${f.msg}`);
  if (list.length > 14) console.log(`    ... and ${list.length - 14} more`);
}

// A confirmed contradiction (error) blocks: it is a visibly wrong number on a real page. Warnings
// are softer reads that want a human eye but don't on their own make the page false. --strict fails
// on either, for the pre-ship check.
const fail = errs.length > 0 || (STRICT && warns.length > 0);
console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"}  (${errs.length} contradictions, ${warns.length} warnings${STRICT ? ", strict" : ""})\n`);
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) process.exit(fail ? 1 : 0);
