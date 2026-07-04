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

// ---- HTML → text blocks (block-level tags become breaks; entities decoded; tags stripped) ----
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", "#8217": "’", "#8216": "‘", "#8220": "“", "#8221": "”", "#8212": "—", "#8211": "–", "#160": " ", "#38": "&" };
function decode(s) {
  return s.replace(/&(#?\w+);/g, (m, e) => {
    if (ENT[e] !== undefined) return ENT[e];
    if (e[0] === "#") { const n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : " "; }
    return " ";
  });
}
function toBlocks(html) {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<\/?(?:p|div|li|tr|h[1-6]|br|table|td|th)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decode(s);
  return s.split("\n").map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// ---- MD&A span: Item 7 → Item 7A/8, longest candidate (a TOC row is short; the real one is huge) ----
const MDNA_START = /item\s*7\.?\s*[—:\-]?\s*management/i;
const MDNA_END = /item\s*7a\.?\s*[—:\-]?\s*quantitative|item\s*8\.?\s*[—:\-]?\s*financial\s+statements/i;
function mdnaText(blocks) {
  const spans = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].length < 140 && MDNA_START.test(blocks[i])) {
      let end = blocks.length;
      for (let j = i + 1; j < blocks.length; j++) {
        if (blocks[j].length < 140 && MDNA_END.test(blocks[j])) { end = j; break; }
      }
      let size = 0;
      for (let k = i; k < end; k++) size += blocks[k].length;
      spans.push({ size, i, end });
    }
  }
  if (!spans.length) return null;
  spans.sort((a, b) => b.size - a.size);
  const { i, end } = spans[0];
  return blocks.slice(i, end).join(" ");
}

function splitSentences(text) {
  return text
    // A boundary is a sentence end followed by a capital — or by Apple-style lowercase brands
    // (iPhone, iPad, iMac...), which otherwise glue "…desktops. iPad iPad net sales…" into one.
    .split(/(?<=[.!?])\s+(?=[A-Z(“"$]|i[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length < 50 || s.length > 460) return false;
      if (/table of contents|%%/i.test(s)) return false;
      // Lenient on digits: the classical driver sentence ("increased $63.2 million, or 28.7%,
      // to $282.4 million for the year ended December 31, 2025...") legitimately runs ~25%
      // digits. Table debris is killed downstream by the anchor + direction-verb + cause gates,
      // which a header row can never satisfy.
      const digits = (s.match(/\d/g) || []).length;
      const letters = (s.match(/[a-zA-Z]/g) || []).length;
      return letters >= 60 && digits / (digits + letters) <= 0.40;
    });
}

// ---- gates ----
// Verb form ("revenue increased 22%") and noun form ("…, an increase of $92.4 million or
// 22.5%") — midcap filings overwhelmingly narrate in the second.
const UP = /\b(increased|grew|rose|improved|was\s+up|higher|an?\s+increase\s+of|growth\s+of)\b/i;
const DOWN = /\b(decreased|declined|fell|deteriorated|was\s+down|lower|a\s+decrease\s+of|a\s+decline\s+of)\b/i;
// The cause often lives in the NEXT sentence: "The increase in transaction revenue was
// primarily driven by…". A continuation opens on the change noun.
const CONTINUATION = /^["“']?(?:The|This)\s+(?:increase|decrease|growth|decline|improvement)\b/i;
const CAUSE = /driven\s+by|due\s+to|primarily|attributable\s+to|reflecting|led\s+by|because\s+of|as\s+a\s+result\s+of|resulting\s+from|partially\s+offset/i;
const FORWARD = /\b(expect(?:s|ed|ations?)?|anticipat\w*|outlook|guidance|going\s+forward|we\s+believe\s+.{0,40}\bwill\b)\b/i;
const SEG_GLUE = /^["“']?(?:revenues?|net\s+sales|sales)\s*[-–—:]/i;

// A named year must include the current fiscal year — kills prior-year comparison narration
// ("increased ... in 2024" inside an FY2025 filing). Sentences naming no year pass; the figure
// verification carries them.
function yearOk(s, fy) {
  const yrs = [...s.matchAll(/\b(20\d\d)\b/g)].map((m) => parseInt(m[1], 10));
  return !yrs.length || Math.max(...yrs) >= fy;
}

// A narrated figure adjacent to the anchor must match the computed change.
function verifyFigure(s, from, actualPct, actualDelta, pctTol) {
  const windowText = s.slice(from, from + 260);
  for (const m of windowText.matchAll(/(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)/g)) {
    if (Math.abs(parseFloat(m[1]) - Math.abs(actualPct)) <= pctTol) return { kind: "pct", quote: `${m[1]}%` };
  }
  if (actualDelta) {
    for (const m of windowText.matchAll(/\$\s*([\d,]+(?:\.\d+)?)\s*(billion|million)/gi)) {
      const v = parseFloat(m[1].replace(/,/g, "")) * (/billion/i.test(m[2]) ? 1e9 : 1e6);
      if (Math.abs(v - Math.abs(actualDelta)) / Math.abs(actualDelta) <= 0.06) return { kind: "dollar", quote: m[0] };
    }
  }
  return null;
}

const CONSOLIDATED = [
  { key: "revenue", label: "Revenue", re: /^["“']?(?:In\s+(?:fiscal\s+(?:year\s+)?)?\d{4},?\s+)?(?:Our\s+|The\s+Company['’]s\s+)?(?:Total\s+|Consolidated\s+|Net\s+)?(?:revenues?|net\s+sales|sales)\b/i },
  { key: "operatingIncome", label: "Operating income", re: /^["“']?(?:In\s+(?:fiscal\s+(?:year\s+)?)?\d{4},?\s+)?(?:Our\s+|The\s+Company['’]s\s+)?(?:Total\s+|Consolidated\s+)?(?:operating\s+income|income\s+from\s+operations|operating\s+profit)\b/i },
  { key: "netIncome", label: "Net income", re: /^["“']?(?:In\s+(?:fiscal\s+(?:year\s+)?)?\d{4},?\s+)?(?:Our\s+|The\s+Company['’]s\s+)?(?:Consolidated\s+)?(?:net\s+income|net\s+earnings)\b/i },
];

function changeFrom(c, key) {
  const h = c.history || [];
  if (h.length < 2) return null;
  const cur = h[h.length - 1]?.lines?.[key], pri = h[h.length - 2]?.lines?.[key];
  if (cur == null || !pri) return null;
  return { pct: (100 * (cur - pri)) / Math.abs(pri), delta: cur - pri };
}

function directionAgrees(s, head, wantUp) {
  const up = UP.test(head), down = DOWN.test(head);
  if (!up && !down) return false;
  if (up && down) return true; // mixed sentence ("increased ... partially offset by lower ..."): allow; figure check decides
  return up === wantUp;
}

// The cause requirement, satisfiable by the sentence itself or by its continuation ("The
// increase was primarily driven by…"). Returns the text to ship, or null.
function withCause(s, next, fy) {
  if (CAUSE.test(s)) return s;
  if (next && CONTINUATION.test(next) && CAUSE.test(next) && yearOk(next, fy) && !FORWARD.test(next.slice(0, 200))) {
    const joined = `${s} ${next}`;
    return joined.length <= 560 ? joined : s + " " + next.slice(0, 540 - s.length) + "…";
  }
  return null;
}

function pickConsolidated(sents, c) {
  const out = [];
  const fy = c.fy || 2025;
  for (const { key, label, re } of CONSOLIDATED) {
    const chg = changeFrom(c, key);
    if (!chg) continue;
    for (let i = 0; i < sents.length; i++) {
      const s = sents[i];
      const m = re.exec(s);
      if (!m) continue;
      if (key === "revenue" && SEG_GLUE.test(s)) continue;
      if (FORWARD.test(s.slice(0, 200))) continue;
      if (!yearOk(s, fy)) continue;
      if (!directionAgrees(s, s.slice(0, 300), chg.pct > 0)) continue;
      const text = withCause(s, sents[i + 1], fy);
      if (!text) continue;
      const v = verifyFigure(s, m[0].length, chg.pct, chg.delta, 1.0);
      if (!v) continue; // consolidated lines ship only figure-verified
      out.push({ line: key, label, pct: +chg.pct.toFixed(1), sentence: text, check: v.kind });
      break;
    }
  }
  return out;
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
  const text = mdnaText(toBlocks(html));
  if (!text || text.length < 4000) return null;
  const sents = splitSentences(text);
  const tk = String(c.ticker).toUpperCase();
  const consolidated = pickConsolidated(sents, c);
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

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
