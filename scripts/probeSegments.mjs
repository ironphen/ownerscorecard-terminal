#!/usr/bin/env node
// probeSegments.mjs — a DIAGNOSTIC, not a fetcher. Writes nothing to src/data.
//
// Before building ADR/JP segment extraction, measure how much is actually there. The US segment fetcher
// reads us-gaap's fixed axes (StatementBusinessSegmentsAxis, StatementGeographicalAxis, ProductOrService
// Axis) off each 10-K's XBRL instance. ADR filers report in IFRS (or US-GAAP), and IFRS has NO standard
// segment axis — companies define their own — so a fixed-axis reader finds nothing. This probe instead
// enumerates EVERY axis on which revenue is split into single members in the latest 20-F, reconciles each
// against consolidated revenue, and reports which axes look like a segment / geographic / product
// breakdown. The verdict tells us the real axis names to target and the coverage we can expect.
//
//   ONLY_ADR=ASML,TM,SAP npm run probe:segments        # default: a curated diverse sample
//
// Needs outbound access to sec.gov / data.sec.gov (blocked in some sandboxes; runs clean in CI).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseContexts, parseFacts, reconcile, prettify, AGGREGATE } from "./fetchSegments.mjs";

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const dataDir = path.join(process.cwd(), "src", "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = 200;

// Revenue concepts across both taxonomies — IFRS first (most ADRs), then US-GAAP for the foreign issuers
// that elect it. The richest breakdown across these wins per axis.
const REV_TAGS = [
  "Revenue", "RevenueFromContractsWithCustomers",
  "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax",
  "Revenues",
];

// A curated, deliberately diverse sample: IFRS and US-GAAP filers, several home taxonomies and sectors,
// so the probe surfaces the range of axis names in use rather than one filer's convention.
const SAMPLE = ["ASML", "SAP", "TM", "SONY", "AZN", "BP", "SHEL", "TSM", "NVO", "UL", "BHP", "RIO", "SAN", "HMC", "VOD", "NVS", "DEO", "SNY", "TTE", "E"];

async function getJSON(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) return null;
      if (res.status === 429) { await sleep(1000 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) { if (a === 4) throw err; await sleep(500 * a); }
  }
}
async function getText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) return null;
      if (res.status === 429) { await sleep(1000 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) { if (a === 4) throw err; await sleep(500 * a); }
  }
}

async function tickerCikMap() {
  const j = await getJSON("https://www.sec.gov/files/company_tickers.json");
  const m = new Map();
  for (const k in j) { const r = j[k]; if (r?.ticker && r?.cik_str) m.set(String(r.ticker).toUpperCase(), String(r.cik_str).padStart(10, "0")); }
  return m;
}

// Resolve the latest annual filing's XBRL instance: submissions → newest 20-F/40-F/10-K → its folder →
// the *_htm.xml instance (inline-XBRL filings) or a non-linkbase .xml, via the folder index.
async function latestInstance(cik) {
  const sub = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = sub?.filings?.recent;
  if (!r?.form) return null;
  let idx = -1;
  for (let i = 0; i < r.form.length; i++) {
    if (/^(20-F|40-F|10-K)/.test(r.form[i]) && r.primaryDocument?.[i] && r.accessionNumber?.[i]) { idx = i; break; }
  }
  if (idx < 0) return null;
  const accn = r.accessionNumber[idx].replace(/-/g, "");
  const folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn}/`;
  const primary = r.primaryDocument[idx];
  const meta = { form: r.form[idx], date: r.filingDate?.[idx], periodEnd: r.reportDate?.[idx] || r.filingDate?.[idx], folder };
  // Try the derived inline-XBRL instance name first, then the folder index.
  let instUrl = folder + primary.replace(/\.htm[l]?$/i, "_htm.xml");
  let xml = await getText(instUrl);
  if (!xml || !/contextRef|<\w+:context/i.test(xml)) {
    await sleep(THROTTLE_MS);
    const index = await getJSON(folder + "index.json");
    const names = (index?.directory?.item || []).map((it) => it.name);
    const cand = names.find((n) => /_htm\.xml$/i.test(n)) ||
      names.find((n) => /\.xml$/i.test(n) && !/_(cal|def|lab|pre)\.xml$/i.test(n) && !/\.xsd$/i.test(n) && !/^(FilingSummary|MetaLinks|R\d+)/i.test(n));
    if (cand) { instUrl = folder + cand; xml = await getText(instUrl); }
  }
  return xml ? { xml, ...meta, instUrl } : null;
}

// Every axis carrying a single-member current-year revenue split, with each axis's member breakdown.
function axisBreakdowns(xml, contexts) {
  let facts = [];
  for (const tag of REV_TAGS) { const f = parseFacts(xml, tag); if (f.length) facts = facts.concat(f.map((x) => ({ ...x, tag }))); }
  const byAxis = new Map(); // axisLocal -> Map(member -> {memberLocal, value, tag})
  for (const f of facts) {
    const c = contexts.get(f.ctx);
    if (!c || !c.current || c.dims.length !== 1) continue;
    const dim = c.dims[0];
    if (AGGREGATE.test(dim.memberLocal)) continue;
    if (!byAxis.has(dim.axisLocal)) byAxis.set(dim.axisLocal, new Map());
    const m = byAxis.get(dim.axisLocal);
    // Prefer the richer revenue tag if it revisits the same member; first non-null wins otherwise.
    if (!m.has(dim.member)) m.set(dim.member, { memberLocal: dim.memberLocal, value: f.val, tag: f.tag });
  }
  return byAxis;
}

// Classify an axis by its name — a rough read so the report groups segment-like vs geographic-like axes.
function axisKind(axisLocal) {
  if (/segment/i.test(axisLocal)) return "segment";
  if (/geograph|country|region|area/i.test(axisLocal)) return "geographic";
  if (/product|service|brand|business|major|category|line/i.test(axisLocal)) return "product";
  return "other";
}

async function main() {
  const adr = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.adr.json"), "utf8")).companies || [];
  const byTicker = new Map(adr.map((c) => [String(c.ticker).toUpperCase(), c]));
  const want = (process.env.ONLY_ADR || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  const targets = (want.length ? want : SAMPLE).filter((t) => byTicker.has(t));
  if (!targets.length) { console.error("no probe targets in the ADR pool"); process.exit(1); }

  let cikMap;
  try { cikMap = await tickerCikMap(); } catch (e) { console.error(`❌ ticker→CIK map failed: ${e.message}`); process.exit(1); }

  console.log(`\nADR segment probe — ${targets.length} companies\n${"=".repeat(72)}`);
  const tally = { reconciling: 0, none: 0, fetchFail: 0 };
  const axisSeen = new Map(); // axisLocal -> count of companies where it reconciled

  for (const ticker of targets) {
    const c = byTicker.get(ticker);
    const cik = c.cik || cikMap.get(ticker.replace(/-/g, "")) || cikMap.get(ticker);
    const total = c.lines?.revenue ?? null;
    console.log(`\n=== ${ticker} (${c.currency}/${c.accountingStandard}, rev ${total != null ? (total / 1e9).toFixed(1) + "B" : "?"}) ===`);
    if (!cik) { console.log("  ! no CIK"); tally.fetchFail++; continue; }
    if (total == null) { console.log("  ! no consolidated revenue to reconcile against"); tally.fetchFail++; continue; }

    await sleep(THROTTLE_MS);
    let inst;
    try { inst = await latestInstance(cik); } catch (e) { console.log(`  ! instance fetch: ${e.message}`); tally.fetchFail++; continue; }
    if (!inst) { console.log("  ! no XBRL instance resolved"); tally.fetchFail++; continue; }

    const contexts = parseContexts(inst.xml, inst.periodEnd);
    const byAxis = axisBreakdowns(inst.xml, contexts);
    if (!byAxis.size) { console.log(`  (${inst.form} ${inst.date}) no single-member revenue axes in the current year`); tally.none++; continue; }

    let anyRec = false;
    const rows = [];
    for (const [axisLocal, members] of byAxis) {
      if (members.size < 2) continue;
      const r = reconcile(members, total);
      const sum = [...members.values()].reduce((a, b) => a + b.value, 0);
      rows.push({ axisLocal, kind: axisKind(axisLocal), n: members.size, ratio: r, cover: sum / total, members });
    }
    rows.sort((a, b) => (b.ratio ? 1 : 0) - (a.ratio ? 1 : 0) || b.n - a.n);
    for (const row of rows) {
      const status = row.ratio ? `RECONCILES ×${row.ratio.toFixed(2)}` : `(sum ${(row.cover * 100).toFixed(0)}% of total — no)`;
      const sample = [...row.members.values()].sort((a, b) => b.value - a.value).slice(0, 5).map((m) => `${prettify(m.memberLocal)} ${(m.value / 1e9).toFixed(1)}B`).join(", ");
      console.log(`  [${row.kind.padEnd(10)}] ${row.axisLocal.padEnd(42)} ${row.n} members  ${status}`);
      console.log(`               ${sample}`);
      if (row.ratio) { anyRec = true; axisSeen.set(row.axisLocal, (axisSeen.get(row.axisLocal) || 0) + 1); }
    }
    if (anyRec) tally.reconciling++; else tally.none++;
    console.log(`  ▸ ${anyRec ? "HAS a reconciling breakdown" : "no reconciling breakdown"}`);
  }

  console.log(`\n${"=".repeat(72)}\nSUMMARY  (${targets.length} sampled)`);
  console.log(`  reconciling breakdown: ${tally.reconciling}   none: ${tally.none}   fetch failed: ${tally.fetchFail}`);
  console.log(`\n  axes that reconciled, by frequency (the names the ADR extractor should target):`);
  for (const [ax, n] of [...axisSeen.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(2)}×  ${ax}`);
  console.log("\nNext: target the high-frequency axes above in an ADR segment fetcher; reconciliation stays the safety net.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
