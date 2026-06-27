#!/usr/bin/env node
// fetchSegmentsAdr.mjs — "where the money comes from," for the ADR pool (foreign 20-F filers).
//
// Same primary source as the US segment fetcher: each filing's XBRL instance on EDGAR, which carries the
// reportable-segment / geographic / product revenue the companyfacts API strips. Two differences it
// handles: the ADR record holds no document URL (its sourceUrl is a search link), so the latest 20-F's
// instance is resolved through the submissions API; and IFRS has no fixed segment axis, so the shared
// extractor (fetchSegments.buildRecord) tries the IFRS axis names the ADR-pool probe found
// (SegmentsAxis, ProductsAndServicesAxis, GeographicalAreasAxis) alongside the US-GAAP ones. Every
// breakdown is still reconciled against the consolidated revenue we already hold — wrong data is worse
// than none — so a split that doesn't sum to the total is dropped.
//
// Writes its breakdowns into the SAME src/data/segments.json the US fetcher uses (keyed by ticker),
// preserving the US entries. Reads fundamentals.adr.json.
//
//   POOL=adr npm run fetch:segments:adr
//   ONLY_ADR=ASML,TM npm run fetch:segments:adr   (audit a subset)
//
// Needs outbound access to sec.gov / data.sec.gov. Free, no key. Runs unattended in CI.

import fs from "node:fs";
import { compactJson } from "../src/lib/dataFile.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseContexts, buildRecord, buildLabels } from "./fetchSegments.mjs";

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const dataDir = path.join(process.cwd(), "src", "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_MS = 200;
const ONLY = (process.env.ONLY_ADR || process.env.ONLY_TICKERS || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const DEBUG = (process.env.SEG_DEBUG || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

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

// Resolve the latest annual filing's XBRL instance and its folder (for MetaLinks): submissions → newest
// 20-F/40-F/10-K → the *_htm.xml inline-XBRL instance, or a non-linkbase .xml via the folder index.
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
  const periodEnd = r.reportDate?.[idx] || r.filingDate?.[idx];
  let xml = await getText(folder + primary.replace(/\.htm[l]?$/i, "_htm.xml"));
  if (!xml || !/contextRef|<\w+:context/i.test(xml)) {
    await sleep(THROTTLE_MS);
    const index = await getJSON(folder + "index.json");
    const names = (index?.directory?.item || []).map((it) => it.name);
    const cand = names.find((n) => /_htm\.xml$/i.test(n)) ||
      names.find((n) => /\.xml$/i.test(n) && !/_(cal|def|lab|pre)\.xml$/i.test(n) && !/\.xsd$/i.test(n) && !/^(FilingSummary|MetaLinks|R\d+)/i.test(n));
    if (cand) xml = await getText(folder + cand);
  }
  return xml ? { xml, folder, periodEnd } : null;
}

async function forCompany(c) {
  const cik = c.cik;
  const total = c.lines?.revenue ?? null;
  if (!cik || total == null) return null;
  const inst = await latestInstance(cik);
  if (!inst) return null;
  await sleep(THROTTLE_MS);
  const meta = await (async () => { try { return JSON.parse((await getText(inst.folder + "MetaLinks.json")) || "{}"); } catch { return {}; } })();
  const labels = buildLabels(meta);
  const contexts = parseContexts(inst.xml, c.periodEnd || inst.periodEnd);
  return buildRecord(inst.xml, contexts, labels, {
    fy: c.fy, periodEnd: c.periodEnd || inst.periodEnd,
    sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=20-F`,
    total, oiTotal: c.lines?.operatingIncome ?? null,
  });
}

async function main() {
  const all = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.adr.json"), "utf8")).companies || [];
  const companies = all.filter((c) => !ONLY.length || ONLY.includes(String(c.ticker).toUpperCase()));
  console.log(`ADR segments: ${companies.length} companies`);
  const result = {};
  let hit = 0;
  for (const c of companies) {
    await sleep(THROTTLE_MS);
    let r = null;
    try { r = await forCompany(c); } catch (e) { console.warn(`  ! ${c.ticker}: ${e.message}`); continue; }
    if (!r) { if (DEBUG.includes(String(c.ticker).toUpperCase())) console.log(`${c.ticker}: —`); continue; }
    result[c.ticker] = r;
    hit++;
    const seg = r.bySegment ? `seg ${r.bySegment.items.length}${r.bySegment.hasOperatingIncome ? "+OI" : ""} (×${r.bySegment.reconcile})` : "seg —";
    const geo = r.byGeography ? `geo ${r.byGeography.items.length} (×${r.byGeography.reconcile})` : "geo —";
    const prod = r.byProduct ? `prod ${r.byProduct.items.length} (×${r.byProduct.reconcile})` : "prod —";
    console.log(`${c.ticker}: ${seg} | ${geo} | ${prod}`);
  }

  const outPath = path.join(dataDir, "segments.json");
  // Merge into the shared file, preserving the US (and any other-pool) entries. ADR tickers are keyed
  // the same way; a full ADR run replaces only the ADR tickers, a subset run touches only those it ran.
  let prior = {}, asOfPrior = null;
  try { const p = JSON.parse(fs.readFileSync(outPath, "utf8")); prior = p.companies || {}; asOfPrior = p.asOf; } catch {}
  const adrTickers = new Set(all.map((c) => String(c.ticker).toUpperCase()));
  const preserved = Object.fromEntries(Object.entries(prior).filter(([t]) => ONLY.length ? true : !adrTickers.has(t.toUpperCase())));
  const merged = { ...preserved, ...result };
  const out = { asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR XBRL, reportable-segment and geographic disclosures (10-K + 20-F)", companies: merged };
  fs.writeFileSync(outPath, compactJson(out));
  console.log(`\n✅ ADR segments: ${hit}/${companies.length} with a usable breakdown (${Object.keys(merged).length} total in file)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
