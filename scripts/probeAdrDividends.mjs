#!/usr/bin/env node
// probeAdrDividends.mjs — a DIAGNOSTIC, not a fetcher. It writes nothing to src/data.
//
// The question it answers, on live data, before we build any extraction:
//   When our ADR pipeline misses a dividend we KNOW is paid (ASML stops at FY2018, SAP at FY2019,
//   yet both pay every year), WHERE did the number go — and can we get it back without leaving the
//   companyfacts API we already use?
//
// It measures three independent signals per company and prints a verdict that makes the next step
// deterministic:
//   1. PIPELINE   — what our published fundamentals.adr.json carries today (the visible gap).
//   2. COMPANYFACTS — every /dividend/i tag the aggregated API exposes, across IFRS + US-GAAP,
//                     annual values by fiscal year. This is the source our fetcher reads. If the
//                     number is here under a tag we don't list → the fix is a one-line tag add.
//   3. FILING XBRL  — ground truth from the latest 20-F/40-F instance itself. Each dividend fact is
//                     classified DEFAULT-context (an aggregate the API should have surfaced) vs
//                     DIMENSIONED-only (split by share class / axis — which the companyfacts API
//                     structurally omits, the dimensioned-only hypothesis).
//
// Verdict taxonomy (per company, for the missing years):
//   • missed-tag        companyfacts HAS an annual dividend under a tag absent from our CONCEPTS list
//                       → cheap fix: add the tag to fetchAdrFundamentals.mjs.
//   • dimensioned-only  companyfacts has nothing, but the filing reports the dividend only in
//                       dimensioned contexts → needs the dimension-aware (full-XBRL) extractor.
//   • filing-default    companyfacts empty, yet the filing has a DEFAULT-context aggregate → API lag
//                       or a duration/edge our reader drops; worth a closer look.
//   • not-found         absent everywhere → an honest null (scrip dividend, per-share-only, none).
//
// Needs outbound access to sec.gov / data.sec.gov (blocked in some sandboxes; runs clean in CI).
//   npm run probe:adr-dividends
//   PROBE_TICKERS=ASML,SAP npm run probe:adr-dividends     # override the curated set
//   PROBE_SKIP_FILING=1 npm run probe:adr-dividends        # companyfacts only (faster, no doc fetch)

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const THROTTLE_MS = 180;
const dataDir = path.join(process.cwd(), "src", "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMESPACES = ["ifrs-full", "us-gaap"];
const ANNUAL_FORMS = ["20-F", "40-F", "10-K"];
const isAnnualForm = (form) => !!form && ANNUAL_FORMS.some((f) => form.startsWith(f));
const days = (a, b) => Math.abs((new Date(b) - new Date(a)) / 86400000);
const fmtM = (v, ccy) => (v == null ? "—" : `${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}M ${ccy}`);

// Curated probe set: each annotated with the gap we already SEE in the pipeline, so the output is
// interpretable at a glance. Controls (full coverage) prove the probe reports "captured" correctly;
// the gap cases (ASML/SAP early-stop, NVO/SONY/TM early-missing) are the ones under investigation.
const CURATED = [
  { t: "ASML", note: "GAP: div stops FY2018, buybacks run to FY2025 — pays every year" },
  { t: "SAP",  note: "GAP: div stops FY2019, buybacks run to FY2025 — pays every year" },
  { t: "NVO",  note: "PARTIAL: missing early years (div from FY2019)" },
  { t: "SONY", note: "PARTIAL: missing early years (div from FY2021)" },
  { t: "TM",   note: "PARTIAL: missing early years (div from FY2020)" },
  { t: "AZN",  note: "CONTROL: fully captured" },
  { t: "BP",   note: "CONTROL: fully captured" },
  { t: "HMC",  note: "CONTROL: fully captured" },
  { t: "TSM",  note: "CONTROL: fully captured" },
  { t: "VOD",  note: "CONTROL: fully captured" },
];

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

// ---- signal 1: what our published pool carries today ----
function pipelineStatus(adr, ticker) {
  const c = (adr.companies || []).find((x) => String(x.ticker).toUpperCase() === ticker);
  if (!c) return { inPool: false };
  const hist = c.history || [];
  const divYrs = hist.filter((h) => h.lines && h.lines.dividendsPaid != null).map((h) => h.fy);
  const bbYrs = hist.filter((h) => h.lines && h.lines.buybacks != null).map((h) => h.fy);
  const allYrs = hist.map((h) => h.fy);
  return { inPool: true, ccy: c.currency, std: c.accountingStandard, divYrs, bbYrs, allYrs };
}

// ---- signal 2: every dividend tag the companyfacts API exposes ----
// Walks BOTH namespaces for any concept whose local name mentions a dividend, and reports annual
// (full-year-duration) values by fiscal year per currency unit. Per-share units are noted separately
// (they are not the cash outflow). This is the exact surface our fetcher reads.
function companyfactsDividends(facts, ccy) {
  const found = []; // { tag, ns, unit, isMoney, byFy:{fy:val} }
  for (const ns of NAMESPACES) {
    const g = facts?.facts?.[ns];
    if (!g) continue;
    for (const tag of Object.keys(g)) {
      if (!/dividend/i.test(tag)) continue;
      if (/pershare|persharedeclared|declaredpershare/i.test(tag)) { /* keep but flag below */ }
      const units = g[tag]?.units || {};
      for (const unit of Object.keys(units)) {
        const isMoney = /^[A-Z]{3}$/.test(unit) || /^iso4217:[A-Z]{3}$/.test(unit);
        const perShare = /\/(shares|share)$/i.test(unit) || /pershare/i.test(tag);
        const byFy = {};
        for (const o of units[unit]) {
          if (!o.start || !o.end) continue; // duration facts only (a dividend outflow is a flow)
          const dur = days(o.start, o.end);
          if (dur < 350 || dur > 380) continue;
          const fy = new Date(o.end).getUTCFullYear();
          if (!(fy in byFy) || (o.filed || "") > (byFy[fy].filed || "")) byFy[fy] = { val: o.val, filed: o.filed || "" };
        }
        const years = Object.keys(byFy);
        if (!years.length) continue;
        found.push({ tag, ns, unit, isMoney: isMoney && !perShare, perShare, byFy: Object.fromEntries(years.map((fy) => [fy, byFy[fy].val])) });
      }
    }
  }
  // Currency, non-per-share tags are the cash dividend. Aggregate the years any such tag covers.
  const moneyTags = found.filter((f) => f.isMoney);
  const annualYears = new Set();
  for (const f of moneyTags) for (const fy of Object.keys(f.byFy)) annualYears.add(Number(fy));
  return { found, moneyTags, annualYears: [...annualYears].sort((a, b) => a - b), ccy };
}

// ---- signal 3: ground truth from the filing's own XBRL ----
// Inline-XBRL fact extraction. Each <ix:nonFraction> carries name (prefix:LocalName), contextRef,
// unitRef, sign and scale; the displayed number times 10^scale, negated if sign="-", is the value.
function parseInlineFacts(html) {
  const facts = [];
  const re = /<ix:nonfraction\b([^>]*)>([\s\S]*?)<\/ix:nonfraction>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const get = (k) => { const r = new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`, "i").exec(attrs); return r ? r[1] : null; };
    const name = get("name");
    if (!name || !/dividend/i.test(name)) continue;
    const ctx = get("contextRef");
    const unit = get("unitRef");
    const scale = parseInt(get("scale") || "0", 10) || 0;
    const sign = get("sign");
    let raw = m[2].replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, "").trim();
    const neg = /^\(.*\)$/.test(raw) || sign === "-";
    raw = raw.replace(/[(),\s]/g, "");
    if (!/^-?\d*\.?\d+$/.test(raw)) continue;
    let val = parseFloat(raw) * Math.pow(10, scale);
    if (neg) val = -Math.abs(val);
    facts.push({ name, ctx, unit, val });
  }
  return facts;
}
// Classic (non-inline) instance facts: <prefix:LocalDividend... contextRef="..">number</...>.
function parseClassicFacts(xml) {
  const facts = [];
  const re = /<([a-z0-9-]+:[A-Za-z0-9_]*[Dd]ividend[A-Za-z0-9_]*)\b([^>]*)>([^<]*)<\/\1>/g;
  let m;
  while ((m = re.exec(xml))) {
    const name = m[1], attrs = m[2];
    const ctx = (/\bcontextRef\s*=\s*"([^"]*)"/i.exec(attrs) || [])[1] || null;
    const unitRef = (/\bunitRef\s*=\s*"([^"]*)"/i.exec(attrs) || [])[1] || null;
    const raw = m[3].replace(/[(),\s]/g, "");
    if (!/^-?\d*\.?\d+$/.test(raw)) continue;
    facts.push({ name, ctx, unit: unitRef, val: parseFloat(raw) });
  }
  return facts;
}
// Context map: id → { dimensioned, members:[{dim,member}] }. Handles xbrli:/no-prefix and
// explicitMember (the common case) plus typedMember (rare, marked dimensioned without a member name).
function parseContexts(xml) {
  const map = new Map();
  const re = /<(?:[a-z0-9]+:)?context\b[^>]*\bid\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?context>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const id = m[1], body = m[2];
    const members = [];
    const em = /<(?:[a-z0-9]+:)?explicitmember\b[^>]*\bdimension\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?explicitmember>/gi;
    let e;
    while ((e = em.exec(body))) members.push({ dim: e[1].split(":").pop(), member: e[2].trim().split(":").pop() });
    const typed = /<(?:[a-z0-9]+:)?typedmember\b/i.test(body);
    map.set(id, { dimensioned: members.length > 0 || typed, members });
  }
  return map;
}
function unitMap(xml) {
  // unitRef id → measure label (e.g. iso4217:EUR, or EUR/shares for per-share). Best-effort.
  const map = new Map();
  const re = /<(?:[a-z0-9]+:)?unit\b[^>]*\bid\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?unit>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const measures = [...m[2].matchAll(/<(?:[a-z0-9]+:)?measure>\s*([^<\s]+)\s*<\/(?:[a-z0-9]+:)?measure>/gi)].map((x) => x[1].split(":").pop());
    const denom = /<(?:[a-z0-9]+:)?divide>/i.test(m[2]);
    map.set(m[1], { label: measures.join("/") || "?", perShare: denom });
  }
  return map;
}

async function filingGroundTruth(cik) {
  const sub = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = sub?.filings?.recent;
  if (!r?.form) return { error: "no submissions" };
  let idx = -1;
  for (let i = 0; i < r.form.length; i++) {
    if (isAnnualForm(r.form[i]) && r.primaryDocument?.[i] && r.accessionNumber?.[i]) { idx = i; break; }
  }
  if (idx < 0) return { error: "no recent annual filing" };
  const accn = r.accessionNumber[idx].replace(/-/g, "");
  const folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn}/`;
  const meta = { form: r.form[idx], date: r.filingDate?.[idx], accn: r.accessionNumber[idx] };
  await sleep(THROTTLE_MS);
  const html = await getText(folder + r.primaryDocument[idx]);
  if (!html) return { ...meta, error: "primary doc fetch failed" };

  let facts = parseInlineFacts(html);
  let source = "inline";
  let ctxXml = html;
  if (!facts.length) {
    // Not inline — find the classic instance .xml in the folder and parse it.
    source = "classic";
    await sleep(THROTTLE_MS);
    const index = await getJSON(folder + "index.json");
    const items = index?.directory?.item || [];
    const inst = items.map((it) => it.name).find((n) =>
      /\.xml$/i.test(n) && !/_(cal|def|lab|pre)\.xml$/i.test(n) && !/^R\d+\.xml$/i.test(n) &&
      !/^(FilingSummary|MetaLinks|.*-index)\.xml$/i.test(n));
    if (!inst) return { ...meta, error: "no instance document found" };
    await sleep(THROTTLE_MS);
    ctxXml = await getText(folder + inst);
    if (!ctxXml) return { ...meta, error: "instance fetch failed" };
    facts = parseClassicFacts(ctxXml);
  }
  const ctxs = parseContexts(ctxXml);
  const units = unitMap(ctxXml);
  // Keep cash-dividend candidates: money unit, sizeable magnitude; classify each by its context.
  const classified = facts.map((f) => {
    const u = units.get(f.unit);
    const perShare = u?.perShare || /pershare/i.test(f.name) || /\/shares?$/i.test(u?.label || "");
    const unitLabel = u?.label || f.unit || "?";
    const c = ctxs.get(f.ctx) || { dimensioned: false, members: [] };
    return { name: f.name.split(":").pop(), val: f.val, unitLabel, perShare, dimensioned: c.dimensioned, members: c.members };
  }).filter((f) => !f.perShare && Math.abs(f.val) >= 1e6);
  // De-dup identical (name, ctx-class, value) rows; sort by magnitude.
  const seen = new Set();
  const rows = classified.filter((f) => { const k = `${f.name}|${f.dimensioned}|${f.members.map((m) => m.member).join(",")}|${Math.round(f.val)}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => Math.abs(b.val) - Math.abs(a.val)).slice(0, 15);
  const hasDefault = rows.some((f) => !f.dimensioned);
  const hasDimensioned = rows.some((f) => f.dimensioned);
  return { ...meta, source, rows, hasDefault, hasDimensioned, total: classified.length };
}

function verdict(pipe, cf, gt) {
  // The years we're missing = pipeline years absent that companyfacts or the filing can fill.
  if (!gt || gt.error) {
    if (cf.annualYears.length && pipe.inPool && pipe.divYrs.length < cf.annualYears.length) return "missed-tag (companyfacts richer than pipeline; filing probe unavailable)";
    return `filing probe unavailable${gt?.error ? ` (${gt.error})` : ""}`;
  }
  const cfYears = cf.annualYears;
  const pipeYears = pipe.inPool ? pipe.divYrs : [];
  const cfBeyondPipe = cfYears.filter((y) => !pipeYears.includes(y));
  if (cfBeyondPipe.length) return `missed-tag — companyfacts has annual dividends the pipeline drops (${cfBeyondPipe.join(",")})`;
  if (!cfYears.length && gt.hasDimensioned && !gt.hasDefault) return "DIMENSIONED-ONLY — filing reports the dividend only in dimensioned contexts (companyfacts structurally omits it)";
  if (!cfYears.length && gt.hasDefault) return "filing-default — companyfacts empty but the filing has a default-context aggregate (API lag / reader edge)";
  if (!cfYears.length && !gt.hasDefault && !gt.hasDimensioned) return "not-found — no cash dividend in companyfacts OR the latest filing (scrip / per-share-only / none)";
  return "captured — companyfacts and pipeline agree";
}

async function main() {
  const targets = (process.env.PROBE_TICKERS
    ? process.env.PROBE_TICKERS.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean).map((t) => ({ t, note: "(override)" }))
    : CURATED);
  const skipFiling = !!process.env.PROBE_SKIP_FILING;
  let adr = { companies: [] };
  try { adr = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.adr.json"), "utf8")); } catch {}

  let cikMap;
  try { cikMap = await tickerCikMap(); } catch (e) { console.error(`❌ ticker→CIK map failed: ${e.message}`); process.exit(1); }

  console.log(`\nADR dividend probe — ${targets.length} companies${skipFiling ? " (companyfacts only)" : ""}\n${"=".repeat(72)}`);
  const summary = [];
  for (const { t, note } of targets) {
    const ticker = t.toUpperCase();
    const cik = cikMap.get(ticker.replace(/-/g, "")) || cikMap.get(ticker);
    console.log(`\n=== ${ticker} — ${note} ===`);
    if (!cik) { console.log("  ! no CIK in SEC map, skipping"); summary.push({ ticker, verdict: "no CIK" }); continue; }

    const pipe = pipelineStatus(adr, ticker);
    if (pipe.inPool) {
      const span = (ys) => (ys.length ? `${Math.min(...ys)}–${Math.max(...ys)} (${ys.length}y)` : "NONE");
      console.log(`  pipeline [${pipe.ccy}/${pipe.std}]: dividends ${span(pipe.divYrs)} | buybacks ${span(pipe.bbYrs)} | history ${span(pipe.allYrs)}`);
    } else console.log("  pipeline: not in pool (withheld or absent)");

    await sleep(THROTTLE_MS);
    let facts;
    try { facts = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`); }
    catch (e) { console.log(`  ! companyfacts ${e.message}`); summary.push({ ticker, verdict: "companyfacts fetch failed" }); continue; }
    const ccy = pipe.ccy || "?";
    const cf = companyfactsDividends(facts, ccy);
    if (!cf.found.length) console.log("  companyfacts: NO dividend-named tag in either namespace");
    else {
      console.log("  companyfacts dividend tags:");
      for (const f of cf.found.sort((a, b) => (b.isMoney - a.isMoney) || a.tag.localeCompare(b.tag))) {
        const yrs = Object.keys(f.byFy).map(Number).sort((a, b) => a - b);
        const kind = f.perShare ? "per-share" : (f.isMoney ? "MONEY" : f.unit);
        const sample = yrs.slice(-3).map((y) => `${y}:${fmtM(f.byFy[y], "")}`.trim()).join(" ");
        console.log(`    ${f.ns}:${f.tag}  [${f.unit}/${kind}]  annual yrs ${yrs.length ? yrs.join(",") : "—"}  ${sample}`);
      }
      console.log(`  → companyfacts annual MONEY dividend coverage: ${cf.annualYears.length ? cf.annualYears.join(",") : "NONE"}`);
    }

    let gt = null;
    if (!skipFiling) {
      await sleep(THROTTLE_MS);
      try { gt = await filingGroundTruth(cik); }
      catch (e) { gt = { error: e.message }; }
      if (gt.error) console.log(`  filing ground-truth: ${gt.error}`);
      else {
        console.log(`  filing ground-truth (${gt.form} ${gt.date}, ${gt.source} XBRL, ${gt.total} cash-dividend facts):`);
        for (const f of gt.rows) {
          const tag = f.dimensioned ? `DIMENSIONED [${f.members.map((m) => `${m.dim}=${m.member}`).join("; ") || "typed"}]` : "default";
          console.log(`    ${f.name.padEnd(46)} ${fmtM(f.val, f.unitLabel.split(":").pop()).padStart(16)}   ${tag}`);
        }
        if (!gt.rows.length) console.log("    (no money-unit dividend facts ≥1M found)");
      }
    }

    const v = verdict(pipe, cf, gt);
    console.log(`  ▸ VERDICT: ${v}`);
    summary.push({ ticker, verdict: v });
  }

  console.log(`\n${"=".repeat(72)}\nSUMMARY`);
  for (const s of summary) console.log(`  ${s.ticker.padEnd(6)} ${s.verdict}`);
  const tally = summary.reduce((m, s) => { const k = s.verdict.split(" ")[0].split("—")[0].trim(); m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log(`\n  tally: ${Object.entries(tally).map(([k, n]) => `${k}=${n}`).join("  ")}`);
  console.log("\nNext step is decided by the tally:");
  console.log("  • mostly missed-tag      → add the tag(s) to fetchAdrFundamentals.mjs CONCEPTS.dividendsPaid (cheap).");
  console.log("  • mostly DIMENSIONED-ONLY → build the dimension-aware full-XBRL dividend extractor.");
  console.log("  • mostly not-found        → leave honest nulls; the dividend isn't a cash outflow we can source.\n");
}

export { companyfactsDividends, parseInlineFacts, parseClassicFacts, parseContexts, verdict };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`\n❌ ${err.message}\n`); process.exit(1); });
}
