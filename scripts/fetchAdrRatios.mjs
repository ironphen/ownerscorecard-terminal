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

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, "one-half": 0.5, half: 0.5, "one-tenth": 0.1, "one-quarter": 0.25 };
const NUM = "(one-half|one-tenth|one-quarter|one|two|three|four|five|six|seven|eight|nine|ten|twenty|\\d+(?:\\.\\d+)?|\\d+\\s*/\\s*\\d+)";
const PATTERNS = [
  new RegExp(`American\\s+Depositary\\s+Shares?[\\s\\S]{0,60}?(?:each|every)[\\s\\S]{0,40}?represent(?:s|ing)?[\\s\\S]{0,40}?${NUM}[\\s\\S]{0,30}?(?:ordinary|common|Class)`, "i"),
  new RegExp(`each\\s+(?:ADS|American\\s+Depositary\\s+Share)[\\s\\S]{0,60}?represent(?:s|ing)?[\\s\\S]{0,40}?${NUM}[\\s\\S]{0,30}?(?:ordinary|common|Class)`, "i"),
  new RegExp(`(?:ADSs?|American\\s+Depositary\\s+Shares?)[\\s\\S]{0,40}?\\(each[\\s\\S]{0,30}?representing[\\s\\S]{0,30}?${NUM}`, "i"),
];

function parseRatio(text) {
  for (const pat of PATTERNS) {
    const m = pat.exec(text);
    if (m) {
      const w = m[1].toLowerCase().replace(/\s+/g, "");
      let ratio;
      if (w.includes("/")) { const [a, b] = w.split("/").map(Number); ratio = a / b; }
      else ratio = WORDS[w] ?? parseFloat(w);
      if (ratio > 0 && ratio <= 100) return { ratio, quote: m[0].replace(/\s+/g, " ").slice(0, 160) };
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
