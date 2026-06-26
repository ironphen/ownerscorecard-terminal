#!/usr/bin/env node
// probeSegmentsJp.mjs — a DIAGNOSTIC, not a fetcher. Writes nothing.
//
// Measure whether JP (EDINET) segment data is extractable before building anything. The EDINET fundamentals
// fetcher reads a CSV rendering of each filing but deliberately REJECTS dimensional contexts — segment
// facts carry a member suffix on the context id (CurrentYearDuration_<member>Member) that the clean-context
// reader drops. This probe keeps them: it finds every revenue/net-sales fact on a single-member context,
// groups by element, reconciles the members against that element's consolidated total, and reports what it
// finds — crucially, what the member identifiers LOOK like, since the hard part of JP segments is whether
// the members carry a usable (English-ish) name or only an opaque company code.
//
//   EDINET_API_KEY=... npm run probe:segments:jp
//
// Needs an EDINET API v2 key (the JP workflow has it). Blocked in sandboxes without it.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { unzip, decodeCsv } from "./fetchEdinetFundamentals.mjs";

const API = "https://api.edinet-fsa.go.jp/api/v2";
const KEY = process.env.EDINET_API_KEY || "";
const dataDir = path.join(process.cwd(), "src", "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
// Revenue / top-line elements across J-GAAP and IFRS (local names, prefix stripped).
const REV_RE = /^(NetSales|Revenue|Revenues|OperatingRevenue|GrossOperatingRevenue|NetSalesOfCompletedConstructionContracts|OrdinaryIncome)(IFRS)?[A-Za-z0-9]*$/i;
const prettify = (m) => m.replace(/Member$/, "").replace(/ReportableSegments?/i, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();

// A segment-bearing context: the current full year with exactly one explicit member suffix (not the
// non-consolidated twin). Returns the member local name, or null for clean / multi-dimension contexts.
function segmentMember(ctx) {
  const m = /^CurrentYearDuration_([A-Za-z0-9]+Member)$/.exec(ctx);
  if (!m || m[1] === "NonConsolidatedMember") return null;
  return m[1];
}

// Walk a filing's CSVs once: per revenue element, the clean-context total and the per-member values.
function scan(csvText, byElement) {
  const lines = csvText.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split("\t");
    if (row.length <= COL.value) continue;
    const local = cell(row[COL.element]).split(":").pop();
    if (!REV_RE.test(local)) continue;
    const val = num(cell(row[COL.value]));
    if (val == null) continue;
    const ctx = cell(row[COL.context]);
    const e = (byElement[local] ||= { total: null, members: new Map(), item: cell(row[COL.item]) });
    if (ctx === "CurrentYearDuration") { if (e.total == null || cell(row[COL.consol]) === "連結") e.total = val; }
    else { const mem = segmentMember(ctx); if (mem && !e.members.has(mem)) e.members.set(mem, val); }
  }
}

// SEG_RAW diagnostic: dump every DIMENSIONAL context (any with a member suffix, single- or multi-part)
// carrying a revenue fact, raw and uncapped — so we can see exactly how the real per-segment values are
// encoded (a 2-D segment-note context vs the single-member roll-ups the main probe found).
async function rawDump(c, entries) {
  console.log(`\n=== RAW ${c.ticker} ${c.name} ===`);
  const seen = new Map(); // context -> {element, val}
  for (const f of entries) {
    if (!/\.csv$/i.test(f.name)) continue;
    let text; try { text = decodeCsv(f.data); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split("\t");
      if (row.length <= COL.value) continue;
      const local = cell(row[COL.element]).split(":").pop();
      if (!REV_RE.test(local)) continue;
      const ctx = cell(row[COL.context]);
      if (!/Member/.test(ctx) || /^CurrentYearDuration(_NonConsolidatedMember)?$/.test(ctx)) continue;
      const val = num(cell(row[COL.value]));
      if (val == null || !ctx.startsWith("CurrentYear")) continue;
      if (!seen.has(ctx)) seen.set(ctx, { local, val });
    }
  }
  const rows = [...seen.entries()].sort((a, b) => b[1].val - a[1].val).slice(0, 40);
  for (const [ctx, { local, val }] of rows) console.log(`  ${(val / 1e9).toFixed(0).padStart(7)}B  ${local.padEnd(34)} ${ctx}`);
  if (!rows.length) console.log("  (no dimensional revenue contexts at all)");
}

async function main() {
  if (!KEY) { console.error("❌ EDINET_API_KEY is not set."); process.exit(1); }
  const jp = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.jp.json"), "utf8")).companies || [];
  const only = (process.env.ONLY_JP || "").split(",").map((s) => s.trim()).filter(Boolean);
  const RAW = !!process.env.SEG_RAW;
  const targets = jp.filter((c) => c.docId && (!only.length || only.includes(String(c.ticker))));
  console.log(`\nJP segment probe — ${targets.length} companies\n${"=".repeat(72)}`);

  const tally = { reconciling: 0, hasMembersNoRecon: 0, none: 0, fetchFail: 0 };
  const memberShapes = { englishish: 0, opaque: 0 };

  for (const c of targets) {
    console.log(`\n=== ${c.ticker} ${c.name} (rev ${c.lines?.revenue != null ? (c.lines.revenue / 1e9).toFixed(0) + "B" : "?"}) ===`);
    let zip;
    try { zip = await getBuffer(withKey(`${API}/documents/${c.docId}?type=5`)); }
    catch (e) { console.log(`  ! download: ${e.message}`); tally.fetchFail++; continue; }
    let entries;
    try { entries = unzip(zip); } catch (e) { console.log(`  ! unzip: ${e.message}`); tally.fetchFail++; continue; }
    if (RAW) { await rawDump(c, entries); continue; }
    const byElement = {};
    for (const f of entries) if (/\.csv$/i.test(f.name)) { try { scan(decodeCsv(f.data), byElement); } catch {} }

    // Report the revenue element with the most members; reconcile against its own clean-context total.
    const cands = Object.entries(byElement).filter(([, e]) => e.members.size >= 2).sort((a, b) => b[1].members.size - a[1].members.size);
    if (!cands.length) { console.log("  no segment-member revenue facts"); tally.none++; continue; }
    let recon = false, anyMembers = false;
    for (const [el, e] of cands.slice(0, 3)) {
      anyMembers = true;
      const members = [...e.members.entries()].sort((a, b) => b[1] - a[1]);
      const sum = members.reduce((a, b) => a + b[1], 0);
      const ratio = e.total ? sum / e.total : null;
      const ok = ratio != null && ratio >= 0.8 && ratio <= 1.2;
      const sample = members.slice(0, 5).map(([m, v]) => `${prettify(m)} ${(v / 1e9).toFixed(0)}B`).join(", ");
      console.log(`  ${el} — ${members.size} members, total ${e.total != null ? (e.total / 1e9).toFixed(0) + "B" : "?"}  ${ok ? `RECONCILES ×${ratio.toFixed(2)}` : ratio != null ? `(sum ${(ratio * 100).toFixed(0)}% — no)` : "(no total)"}`);
      console.log(`     ${sample}`);
      // Member-name shape: do they prettify to something readable, or are they opaque codes?
      for (const [m] of members) { if (/^[A-Za-z][A-Za-z0-9]*Member$/.test(m) && !/^E\d|^Jpcrp|^[A-Z]\d/.test(m)) memberShapes.englishish++; else memberShapes.opaque++; }
      if (ok) recon = true;
    }
    if (recon) tally.reconciling++; else if (anyMembers) tally.hasMembersNoRecon++; else tally.none++;
    console.log(`  ▸ ${recon ? "HAS a reconciling breakdown" : anyMembers ? "has members but none reconcile" : "nothing"}`);
  }

  console.log(`\n${"=".repeat(72)}\nSUMMARY  (${targets.length} sampled)`);
  console.log(`  reconciling: ${tally.reconciling}   members-but-no-reconcile: ${tally.hasMembersNoRecon}   none: ${tally.none}   fetch failed: ${tally.fetchFail}`);
  console.log(`  member-name shape across all candidates: english-ish ${memberShapes.englishish}, opaque ${memberShapes.opaque}`);
  console.log("\nVerdict guide: reconciling + mostly english-ish members → JP segments are buildable like ADR;");
  console.log("  opaque members → would need the label linkbase (harder); few reconciling → JP segments are genuinely thin.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
