#!/usr/bin/env node
// fetchAdrRatios.mjs — how many ordinary shares one US-listed ADS represents, parsed from each
// foreign filer's own 20-F/40-F cover, with the verbatim clause kept as the receipt. The ratio is
// what lets the valuation tool accept the US ADR price a reader actually holds and reconcile it
// with home-currency, ordinary-share financials. Three outcomes per company, never a guess:
//   ads    — a ratio parsed from the filing (quote retained)
//   direct — the filing registers ordinary/common shares on the US exchange with no depositary
//            program mentioned in its registered titles: one listed share IS one ordinary share
//   null   — a depositary program exists but the ratio didn't parse; the tool stays in warn mode
//
//   npm run fetch:adr:ratios
//   ONLY_ADR=HLN,TSM node scripts/fetchAdrRatios.mjs

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const dataDir = path.join(process.cwd(), "src", "data");
const adr = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.adr.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = (process.env.ONLY_ADR || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

async function fetchText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(90_000) });
      if (res.status === 429) { await sleep(1000 * a); continue; }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) { if (a === 4) throw e; await sleep(500 * a); }
  }
}

// Number vocabulary, hardened against the three real corruption classes the 2026-07-17 sweep found
// in shipped ratios (13 filers corrected by hand, each now frozen in scripts/adrRatiosTest.mjs):
//   1. comma-grouped counts — "each representing 2,000 shares" parsed as 2 (LTM/NAAS/TC/XHG/SVREW,
//      ratios to 43,200), because the number pattern had no comma alternative and the cap was 100;
//   2. M-for-N programs — "every 13 ADSs representing 10 Class A" is 10/13 ≈ 0.77, not 10 (SY,
//      GOTU, RERE, DDL, JG), because no pattern captured the leading count;
//   3. multiword fractions — "one half of one" (SNY), "half a Class B" (WKEY), "one and one
//      quarter (1.25)" (ADAG), where matching the bare "one" printed 1.
// Multiword forms are listed before their prefixes so the longest match wins.
const WORDS = {
  "one and one half": 1.5, "one and one-half": 1.5, "one and a half": 1.5,
  "one and one quarter": 1.25, "one and one-quarter": 1.25, "one and a quarter": 1.25,
  "one half": 0.5, "one-half": 0.5, half: 0.5,
  "one quarter": 0.25, "one-quarter": 0.25,
  "one tenth": 0.1, "one-tenth": 0.1,
  "three quarters": 0.75, "three-quarters": 0.75,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20,
};
const WORD_ALT = Object.keys(WORDS).sort((a, b) => b.length - a.length).map((w) => w.replace(/[- ]/g, "[- ]")).join("|");
const NUM = `(${WORD_ALT}|\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|\\d+\\s*/\\s*\\d+)`;
const numVal = (raw) => {
  const w = raw.toLowerCase().replace(/[-\s]+/g, " ").trim();
  if (w in WORDS) return WORDS[w];
  if (w.includes("/")) { const [a, b] = w.split("/").map((x) => Number(x.trim())); return b ? a / b : NaN; }
  return parseFloat(w.replace(/,/g, ""));
};
// The M-for-N form runs FIRST: it is the more specific shape, and the each-represents patterns below
// would otherwise read "every 13 ADSs representing 10 Class A" as a ratio of 10. "of which" covers
// "each two of which represent three"; the ADS token is optional because some covers elide it
// ("every three representing two Class A").
const PAIR_PATTERNS = [
  new RegExp(`(?:each|every)\\s+${NUM}\\s*(?:ADSs?|American\\s+Depositary\\s+Shares?|of\\s+which|of\\s+them)?[\\s\\S]{0,20}?represent(?:s|ing)?\\s+${NUM}[\\s\\S]{0,30}?(?:ordinary|common|Class)`, "i"),
];
const PATTERNS = [
  new RegExp(`American\\s+Depositary\\s+Shares?[\\s\\S]{0,60}?(?:each|every)[\\s\\S]{0,40}?represent(?:s|ing)?[\\s\\S]{0,40}?${NUM}[\\s\\S]{0,30}?(?:ordinary|common|Class)`, "i"),
  new RegExp(`each\\s+(?:ADS|American\\s+Depositary\\s+Share)[\\s\\S]{0,60}?represent(?:s|ing)?[\\s\\S]{0,40}?${NUM}[\\s\\S]{0,30}?(?:ordinary|common|Class)`, "i"),
  new RegExp(`(?:ADSs?|American\\s+Depositary\\s+Shares?)[\\s\\S]{0,40}?\\(each[\\s\\S]{0,30}?representing[\\s\\S]{0,30}?${NUM}`, "i"),
];

// Real programs run from fractions (Sanofi's half-share) to tens of thousands (SVREW's 43,200
// post-reverse-split); the old ≤100 cap silently endorsed every comma-truncated read.
const SANE = (r) => Number.isFinite(r) && r > 0 && r <= 100000;

function parseRatio(text) {
  for (const pat of PAIR_PATTERNS) {
    const m = pat.exec(text);
    if (m) {
      const mCount = numVal(m[1]), nCount = numVal(m[2]);
      const ratio = mCount > 0 ? nCount / mCount : NaN;
      if (SANE(ratio)) return { ratio: Math.round(ratio * 1e6) / 1e6, quote: m[0].replace(/\s+/g, " ").slice(0, 160) };
    }
  }
  for (const pat of PATTERNS) {
    const m = pat.exec(text);
    if (m) {
      const ratio = numVal(m[1]);
      if (SANE(ratio)) return { ratio, quote: m[0].replace(/\s+/g, " ").slice(0, 160) };
    }
  }
  return null;
}

const strip = (s) => s.replace(/<[^>]+>|&#160;|&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function forCompany(c) {
  const sub = JSON.parse((await fetchText(`https://data.sec.gov/submissions/CIK${Number(c.cik).toString().padStart(10, "0")}.json`)) || "{}");
  const rec = sub?.filings?.recent;
  if (!rec) return null;
  let f = null;
  for (let i = 0; i < rec.form.length; i++) {
    if (rec.form[i] === "20-F" || rec.form[i] === "40-F") { f = { accn: rec.accessionNumber[i], doc: rec.primaryDocument[i], form: rec.form[i] }; break; }
  }
  if (!f) return null;
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${f.accn.replace(/-/g, "")}/${f.doc}`;
  const html = await fetchText(url);
  if (!html) return null;

  // Structured route first: the cover's registered security titles.
  const titles = [...html.matchAll(/name="dei:Security12bTitle"[^>]*>([\s\S]{0,300}?)</g)].map((m) => strip(m[1])).filter(Boolean);
  for (const t of titles) {
    const hit = parseRatio(t);
    if (hit) return { basis: "ads", ...hit, form: f.form, sourceUrl: url };
  }
  // Full-text fallback (older non-iXBRL covers, prose statements of the program).
  const text = strip(html);
  const hit = parseRatio(text);
  if (hit) return { basis: "ads", ...hit, form: f.form, sourceUrl: url };
  // No parse. If the registered titles exist and none mention a depositary program, the US
  // listing is the ordinary share itself (common for Canadian and some European filers).
  if (titles.length && !titles.some((t) => /depositary/i.test(t)) && !/american\s+depositary/i.test(text.slice(0, 300000))) {
    return { basis: "direct", ratio: 1, quote: titles.find((t) => /shares?/i.test(t))?.slice(0, 160) || titles[0].slice(0, 160), form: f.form, sourceUrl: url };
  }
  return { basis: null, ratio: null, quote: null, form: f.form, sourceUrl: url };
}

async function main() {
  const companies = (adr.companies || []).filter((c) => c.cik && (!ONLY.length || ONLY.includes(String(c.ticker).toUpperCase())));
  const result = {};
  let ads = 0, direct = 0, unknown = 0, done = 0;
  for (const c of companies) {
    done++;
    await sleep(200);
    let r = null;
    try { r = await forCompany(c); } catch (e) { console.warn(`  ! ${c.ticker}: ${e.message}`); continue; }
    if (!r) { unknown++; continue; }
    result[String(c.ticker).toUpperCase()] = r;
    if (r.basis === "ads") { ads++; console.log(`${c.ticker}: 1 ADS = ${r.ratio} — “${(r.quote || "").slice(0, 80)}”`); }
    else if (r.basis === "direct") { direct++; console.log(`${c.ticker}: direct listing (1:1)`); }
    else { unknown++; console.log(`${c.ticker}: depositary program, ratio not parsed — warn mode`); }
    if (done % 100 === 0) console.log(`  …${done}/${companies.length}`);
  }

  const outPath = path.join(dataDir, "adrRatios.json");
  let prior = {};
  try { prior = JSON.parse(fs.readFileSync(outPath, "utf8")).companies || {}; } catch {}
  const merged = ONLY.length ? { ...prior, ...result } : result;
  fs.writeFileSync(outPath, JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), source: "Parsed from each filer's 20-F/40-F cover on SEC EDGAR; the verbatim clause is retained per company", companies: merged }, null, 1));
  console.log(`\n✅ ADS ratios: ${ads} parsed, ${direct} direct listings, ${unknown} unresolved (warn mode) of ${companies.length}`);
}

export { parseRatio };

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
