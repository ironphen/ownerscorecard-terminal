#!/usr/bin/env node
// fetchSegmentsJp.mjs — "where the money comes from," for the Japanese pool (EDINET filers).
//
// EDINET's CSV rendering carries each reportable segment's revenue, dimensioned on the segment axis. The
// fundamentals fetcher drops dimensional contexts, so JP segments were absent — but the data is clean and
// the labels are English. The one trick: a company's own segments are tagged with extension members that
// carry an EDINET prefix, e.g. context CurrentYearDuration_jpcrp030000-asr_E01737-000EnergyReportableSegment
// Member. We strip that prefix and the ReportableSegment(s)Member suffix to get the segment's name
// ("Energy"), keep the company segments plus the residual "Other", and drop the roll-up and reconciling
// members. Every breakdown is reconciled against the segment-revenue total before it's kept — wrong data
// is worse than none.
//
// Writes its breakdowns into the SAME src/data/segments.json the US and ADR fetchers use (keyed by
// ticker), preserving their entries. Reads fundamentals.jp.json. Needs an EDINET API v2 key.
//
//   EDINET_API_KEY=... npm run fetch:segments:jp
//   ONLY_JP=6501,9983 EDINET_API_KEY=... npm run fetch:segments:jp   (audit a subset)

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { unzip, decodeCsv } from "./fetchEdinetFundamentals.mjs";

const API = "https://api.edinet-fsa.go.jp/api/v2";
const KEY = process.env.EDINET_API_KEY || "";
const dataDir = path.join(process.cwd(), "src", "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = Number(process.env.EDINET_THROTTLE_MS || 300);
const ONLY = (process.env.ONLY_JP || process.env.ONLY_TICKERS || "").split(",").map((s) => s.trim()).filter(Boolean);
const DEBUG = (process.env.SEG_DEBUG || "").split(",").map((s) => s.trim()).filter(Boolean);
const withKey = (u) => u + (u.includes("?") ? "&" : "?") + "Subscription-Key=" + encodeURIComponent(KEY);

async function getBuffer(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.status === 429) { await sleep(1000 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) { if (a === 4) throw err; await sleep(500 * a); }
  }
}

const COL = { element: 0, item: 1, context: 2, consol: 4, value: 8 };
const cell = (s) => { if (s == null) return ""; let t = s.trim(); if (t.length >= 2 && t.charCodeAt(0) === 34 && t.charCodeAt(t.length - 1) === 34) t = t.slice(1, -1).replace(/""/g, '"'); return t; };
const num = (s) => { const t = String(s ?? "").replace(/,/g, "").trim(); if (!t || t === "－" || t === "-" || t === "—") return null; const v = Number(t); return Number.isFinite(v) ? v : null; };

// Segment revenue elements, external-customer variants first (the clean per-segment top line, free of
// inter-segment double counting), then the generic ones. Segment operating profit, best-effort.
const SEG_REV = ["RevenueFromExternalCustomersIFRS", "RevenuesFromExternalCustomers", "NetSalesIFRS", "RevenueIFRS", "NetSales", "OperatingRevenueIFRS", "Revenue"];
const SEG_OI = ["SegmentProfitLossIFRS", "OperatingProfitLossIFRS", "ProfitLossFromOperatingActivitiesIFRS", "OperatingIncomeIFRS", "OperatingIncome", "SegmentIncomeLoss"];

// A segment-bearing context: the current full year with exactly one explicit member (one "Member" token).
function singleMember(ctx) {
  const m = /^CurrentYearDuration_(.+Member)$/.exec(ctx);
  if (!m) return null;
  const member = m[1];
  if ((member.match(/Member/g) || []).length !== 1) return null; // 2-D (segment × something) → skip
  if (member === "NonConsolidatedMember") return null;
  return member;
}
// The segment's own name: drop the EDINET company-extension prefix and the ReportableSegment(s)Member
// suffix, then split camelCase. Roll-up / reconciling members strip to nothing useful and are dropped.
function segLabel(member) {
  let s = member.replace(/^jp[a-z0-9]+-[a-z]+_E\d+-\d+/i, ""); // company-extension prefix (jpcrp030000-asr_E01737-000)
  s = s.replace(/ReportableSegments?Member$/i, "").replace(/Segments?Member$/i, "").replace(/Member$/i, "");
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();
}
const isExcludedMember = (member, label) =>
  !label || /ReconcilingItems|OperatingSegmentsNotIncluded|^ReportableSegmentsMember$/i.test(member);

// Per revenue element: the clean-context total and the per-segment values (and operating income, if the
// segment-profit element is tagged on the same member contexts).
function collect(csvText, rev, oi) {
  const lines = csvText.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split("\t");
    if (row.length <= COL.value) continue;
    const local = cell(row[COL.element]).split(":").pop();
    const val = num(cell(row[COL.value]));
    if (val == null) continue;
    const ctx = cell(row[COL.context]);
    if (SEG_REV.includes(local)) {
      const e = (rev[local] ||= { total: null, members: new Map() });
      if (ctx === "CurrentYearDuration") { if (e.total == null || cell(row[COL.consol]) === "連結") e.total = val; }
      else { const mem = singleMember(ctx); if (mem && !e.members.has(mem)) e.members.set(mem, val); }
    } else if (SEG_OI.includes(local)) {
      const mem = singleMember(ctx);
      if (mem && !oi.has(mem)) oi.set(mem, val);
    }
  }
}

function buildRecord(c, rev, oi) {
  // The element whose company-segment members reconcile to its total, richest winning.
  let best = null;
  for (const [el, e] of Object.entries(rev)) {
    const items = [...e.members.entries()]
      .map(([member, value]) => ({ member, label: segLabel(member), value }))
      .filter((it) => !isExcludedMember(it.member, it.label));
    if (items.length < 2 || !e.total) continue;
    const sum = items.reduce((a, b) => a + b.value, 0);
    const ratio = sum / e.total;
    if (ratio >= 0.8 && ratio <= 1.2 && (!best || items.length > best.items.length)) best = { el, items, total: e.total, ratio };
  }
  if (!best) return null;
  // Attach segment operating income where the member matches and the split is sane.
  const oiVals = best.items.map((it) => (oi.has(it.member) ? oi.get(it.member) : null));
  const oiCount = oiVals.filter((v) => v != null).length;
  const oiSum = oiVals.reduce((a, v) => a + (v != null ? Math.abs(v) : 0), 0);
  const hasOI = oiCount >= Math.ceil(best.items.length / 2) && oiSum > 0;
  const items = best.items
    .map((it, i) => ({ label: it.label, revenue: it.value, operatingIncome: hasOI ? oiVals[i] : null }))
    .sort((a, b) => b.revenue - a.revenue);
  return {
    fy: c.fy, periodEnd: c.periodEnd, sourceUrl: c.sourceUrl, revenueTotal: best.total, operatingIncomeTotal: c.lines?.operatingIncome ?? null,
    bySegment: { reconcile: +best.ratio.toFixed(3), hasOperatingIncome: hasOI, items },
  };
}

async function forCompany(c) {
  if (!c.docId) return null;
  const zip = await getBuffer(withKey(`${API}/documents/${c.docId}?type=5`));
  const entries = unzip(zip);
  const rev = {}, oi = new Map();
  for (const f of entries) if (/\.csv$/i.test(f.name)) { try { collect(decodeCsv(f.data), rev, oi); } catch {} }
  return buildRecord(c, rev, oi);
}

async function main() {
  if (!KEY) { console.error("\n❌ EDINET_API_KEY is not set (free key from the EDINET site).\n"); process.exit(1); }
  const all = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.jp.json"), "utf8")).companies || [];
  const companies = all.filter((c) => c.docId && (!ONLY.length || ONLY.includes(String(c.ticker))));
  console.log(`JP segments: ${companies.length} companies`);
  const result = {};
  let hit = 0;
  for (const c of companies) {
    await sleep(THROTTLE_MS);
    let r = null;
    try { r = await forCompany(c); } catch (e) { console.warn(`  ! ${c.ticker}: ${e.message}`); continue; }
    if (!r) { if (DEBUG.includes(String(c.ticker))) console.log(`${c.ticker}: —`); continue; }
    result[c.ticker] = r;
    hit++;
    console.log(`${c.ticker} ${c.name}: seg ${r.bySegment.items.length}${r.bySegment.hasOperatingIncome ? "+OI" : ""} (×${r.bySegment.reconcile}) — ${r.bySegment.items.slice(0, 4).map((i) => i.label).join(", ")}`);
  }

  const outPath = path.join(dataDir, "segments.json");
  let prior = {};
  try { prior = JSON.parse(fs.readFileSync(outPath, "utf8")).companies || {}; } catch {}
  const jpTickers = new Set(all.map((c) => String(c.ticker)));
  const preserved = Object.fromEntries(Object.entries(prior).filter(([t]) => ONLY.length ? true : !jpTickers.has(t)));
  const merged = { ...preserved, ...result };
  const out = { asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR XBRL (10-K + 20-F) and EDINET (Japanese securities reports), reportable-segment / geographic disclosures", companies: merged };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n✅ JP segments: ${hit}/${companies.length} with a usable breakdown (${Object.keys(merged).length} total in file)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
