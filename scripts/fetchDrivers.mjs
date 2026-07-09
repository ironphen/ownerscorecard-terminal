#!/usr/bin/env node
// fetchDrivers.mjs — "the year, in the company's own words."
//
// For each line the record shows (consolidated revenue, operating income, net income) and each
// reportable segment the company discloses, find the MD&A sentence where the COMPANY explains the
// year's move, verbatim — and ship it only when the sentence proves itself against the record:
//
//   1. ANCHORED  — the sentence begins with the line item or the company's own segment label
//                  (from segments.json), so "Cost of ... revenue" can never masquerade as revenue.
//   2. DIRECTED  — its stated direction (increased/decreased) agrees with the sign of the change
//                  computed from the same filing's XBRL.
//   3. VERIFIED  — a narrated figure adjacent to the anchor matches the computed change
//                  (percentage within a point; dollar delta within 6%), or — for segments, where
//                  qualitative narration is the norm — at minimum the direction check above holds
//                  against the segment's own prior-year figure.
//   4. HONEST    — sentences about expectations/outlook are rejected (results only), the current
//                  fiscal year's comparison only (a named year must include the current fy), and
//                  a company where nothing passes gets NOTHING. Silence over filler.
//
// Never a word of ours: the output is quotation plus arithmetic. Doctrine: present, never pronounce.
//
//   npm run fetch:drivers
//   ONLY_TICKERS=NVDA,AAPL node scripts/fetchDrivers.mjs   (audit a subset)

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compactJson } from "../src/lib/dataFile.mjs";
// The shared machinery — HTML→blocks, the MD&A span, the sentence splitter, and the four gates —
// lives in src/lib/drivers.mjs so the wire's performance line proves its clauses against the
// same rulebook. This script keeps what is 10-K-specific: the fundamentals-history changes,
// the segment anchors, and the catalog walk.
import {
  toBlocks, mdnaText, splitSentences,
  FORWARD, yearOk, verifyFigure, directionAgrees, withCause,
  CONSOLIDATED, pickConsolidated,
} from "../src/lib/drivers.mjs";

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const dataDir = path.join(process.cwd(), "src", "data");
const fundamentals = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
const segments = JSON.parse(fs.readFileSync(path.join(dataDir, "segments.json"), "utf8")).companies || {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = (process.env.ONLY_TICKERS || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

async function fetchText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429) { await sleep(1000 * a); continue; }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) { if (a === 4) throw e; await sleep(500 * a); }
  }
}

// The year-over-year change per line from the fundamentals history — the XBRL proof the
// consolidated gates verify against.
function changeFrom(c, key) {
  const h = c.history || [];
  if (h.length < 2) return null;
  const cur = h[h.length - 1]?.lines?.[key], pri = h[h.length - 2]?.lines?.[key];
  if (cur == null || !pri) return null;
  return { pct: (100 * (cur - pri)) / Math.abs(pri), delta: cur - pri };
}

function consolidatedChanges(c) {
  const changes = {};
  for (const { key } of CONSOLIDATED) {
    const chg = changeFrom(c, key);
    if (chg) changes[key] = chg;
  }
  return changes;
}

// Segment labels worth anchoring on: the company's own, sized like names, minus catch-alls.
function segItems(tk) {
  const v = segments[tk] || {};
  const items = [];
  for (const bucket of ["bySegment", "byGeography", "byProduct"]) {
    for (const it of (v[bucket]?.items || [])) {
      const lb = (it.label || "").trim();
      if (lb.length < 3 || lb.length > 60) continue;
      if (/^(other|total|corporate|non-|all\s+other)/i.test(lb)) continue;
      items.push({ ...it, bucket });
    }
  }
  return items;
}

// Which metric is the sentence about? The token near the anchor decides, and the metric decides
// the verification target — a segment operating-income sentence is never checked against revenue.
const REV_TOKEN = /\b(?:net\s+sales|revenues?|sales)\b/i;
const OI_TOKEN = /\b(?:operating\s+income|operating\s+profit|(?:income|loss)\s+from\s+operations|segment\s+(?:operating\s+)?(?:income|profit|loss))\b/i;

function pickSegments(sents, tk, fy) {
  const out = [];
  const seen = new Set();
  for (const it of segItems(tk)) {
    const esc = it.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^["“']?(?:(?:In|During)\\s+(?:fiscal\\s+(?:year\\s+)?)?\\d{4},?\\s+)?(?:${esc}\\s+)?${esc}(?![A-Za-z])`, "i");
    for (let i = 0; i < sents.length; i++) {
      const s0 = sents[i];
      if (!re.test(s0)) continue;
      // heading-glue: a duplicated leading label ("Services Services net sales…") reads once.
      const s = s0.replace(new RegExp(`^(["“']?)${esc}\\s+(?=${esc}(?![A-Za-z]))`, "i"), "$1");
      const afterAnchor = s.slice(0, 200);
      if (FORWARD.test(afterAnchor)) continue;
      if (!yearOk(s, fy)) continue;
      // metric + verification target
      const near = s.slice(0, it.label.length + 90);
      let metric = null, cur = null, pri = null;
      if (REV_TOKEN.test(near)) { metric = "revenue"; cur = it.revenue; pri = it.revenuePrior; }
      else if (OI_TOKEN.test(near)) { metric = "operatingIncome"; cur = it.operatingIncome; pri = it.operatingIncomePrior; }
      if (!metric || cur == null || !pri) continue; // no prior figures = no proof = no ship
      const pct = (100 * (cur - pri)) / Math.abs(pri);
      if (!directionAgrees(s, s.slice(0, 300), pct > 0)) continue;
      const text = withCause(s, sents[i + 1], fy);
      if (!text) continue;
      const v = verifyFigure(s, 0, pct, cur - pri, 1.5);
      const key = s.slice(0, 80).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ segment: it.label, bucket: it.bucket, metric, pct: +pct.toFixed(1), sentence: text, check: v ? v.kind : "direction" });
      break;
    }
  }
  return out;
}

// fundamentals.sourceUrl is the filing's index page; the MD&A lives in the primary document
// beside it. Resolve via the folder's index.json: the primary doc is the ticker-dated .htm
// (never an exhibit, never the index itself); when naming is odd, the largest .htm wins.
async function resolvePrimaryDoc(sourceUrl) {
  if (!/-index\.html?$/i.test(sourceUrl)) return sourceUrl;
  const folder = sourceUrl.slice(0, sourceUrl.lastIndexOf("/") + 1);
  try {
    const idx = JSON.parse((await fetchText(folder + "index.json")) || "{}");
    const items = (idx.directory?.item || []).filter((i) => /\.html?$/i.test(i.name) && !/-index\.html?$/i.test(i.name) && !/^(ex|r\d|.*exhibit)/i.test(i.name));
    const dated = items.find((i) => /\d{8}\.html?$/i.test(i.name));
    const pick = dated || items.sort((a, b) => (parseInt(b.size, 10) || 0) - (parseInt(a.size, 10) || 0))[0];
    return pick ? folder + pick.name : null;
  } catch { return null; }
}

async function forCompany(c) {
  if (!c.sourceUrl) return null;
  const docUrl = await resolvePrimaryDoc(c.sourceUrl);
  if (!docUrl) return null;
  const html = await fetchText(docUrl);
  if (!html) return null;
  const text = mdnaText(toBlocks(html), "10-K"); // the lib enforces the 4,000-char floor
  if (!text) return null;
  const sents = splitSentences(text);
  const tk = String(c.ticker).toUpperCase();
  const consolidated = pickConsolidated(sents, { fy: c.fy || 2025, changes: consolidatedChanges(c) });
  const segs = pickSegments(sents, tk, c.fy || 2025);
  if (!consolidated.length && !segs.length) return null;
  return { fy: c.fy, sourceUrl: c.sourceUrl, consolidated, segments: segs };
}

async function main() {
  const companies = (fundamentals.companies || []).filter((c) => !ONLY.length || ONLY.includes(String(c.ticker).toUpperCase()));
  const result = {};
  let hit = 0, done = 0;
  for (const c of companies) {
    done++;
    await sleep(200);
    let r = null;
    try { r = await forCompany(c); } catch (e) { console.warn(`  ! ${c.ticker}: ${e.message}`); continue; }
    if (!r) { if (ONLY.length) console.log(`${c.ticker}: —`); continue; }
    result[String(c.ticker).toUpperCase()] = r;
    hit++;
    console.log(`${c.ticker}: ${r.consolidated.length} consolidated, ${r.segments.length} segment (${r.segments.filter((s) => s.check !== "direction").length} figure-checked)`);
    if (done % 250 === 0) console.log(`  …${done}/${companies.length}, ${hit} with drivers`);
  }

  const outPath = path.join(dataDir, "drivers.json");
  let prior = {};
  try { prior = JSON.parse(fs.readFileSync(outPath, "utf8")).companies || {}; } catch {}
  const merged = ONLY.length ? { ...prior, ...result } : result;
  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    source: "Verbatim MD&A sentences from each company's 10-K, anchored to its record lines and reportable segments, and checked against the same filing's XBRL figures",
    companies: merged,
  };
  fs.writeFileSync(outPath, compactJson(out));
  console.log(`\n✅ Drivers: ${hit}/${companies.length} companies with at least one verified sentence`);
}

export { toBlocks, mdnaText, splitSentences, pickConsolidated, pickSegments };
// (the first four re-exported from src/lib/drivers.mjs, where they now live)

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
