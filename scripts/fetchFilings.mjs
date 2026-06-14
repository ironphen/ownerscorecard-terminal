#!/usr/bin/env node
// fetchFilings.mjs — the qualitative "what changed" layer.
//
// Pulls each company's two most recent 10-K documents from EDGAR, extracts the
// MD&A (Item 7) and Risk Factors (Item 1A), and computes what changed year over
// year: genuinely new sentences (number-normalized so only language shifts
// surface, not figure updates), length, readability, hedging density, and
// red-flag phrase first-appearances. Writes src/data/language.json.
//
// 100% EDGAR — no key, no LLM. Runs in CI (needs data.sec.gov + www.sec.gov).
//   npm run fetch:filings

import fs from "node:fs";
import path from "node:path";

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const THROTTLE = 200;

const dataDir = path.join(process.cwd(), "src", "data");
const fundamentals = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429) { await sleep(1000 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) { if (a === 4) throw e; await sleep(600 * a); }
  }
}

// ---- text processing ----

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&rsquo;|&#39;/gi, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/gi, '"')
    .replace(/&#8212;|&mdash;/gi, "—")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Capture from a start heading to the earliest following end heading. With a TOC
// at the front, the real section is the longest candidate, so keep the largest.
function section(text, startRe, endRes) {
  let best = "";
  let m;
  const re = new RegExp(startRe, "gi");
  while ((m = re.exec(text)) !== null) {
    const from = m.index;
    let to = text.length;
    for (const er of endRes) {
      const e = new RegExp(er, "gi");
      e.lastIndex = from + 40;
      const em = e.exec(text);
      if (em && em.index < to) to = em.index;
    }
    const chunk = text.slice(from, to);
    if (chunk.length > best.length) best = chunk;
  }
  return best;
}

// Keep prose only — drop table rows, figure dumps, and page artifacts.
function isProse(s) {
  const digits = (s.match(/\d/g) || []).length;
  const letters = (s.match(/[a-z]/gi) || []).length;
  if (letters < 40) return false;
  if (digits / (digits + letters) > 0.15) return false;
  return !/table of contents|form 10-k|dollars in millions|^\s*index\b/i.test(s);
}

function sentences(text) {
  return text
    .replace(/\d+\s+table of contents/gi, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z(“"])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 50 && s.length <= 500 && isProse(s));
}

const tokenize = (s) => new Set(normalize(s).split(" ").filter((w) => w.length > 3));
const jaccard = (a, b) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
};

// Normalize so only language changes (not figures) count as "new".
function normalize(s) {
  return s
    .toLowerCase()
    .replace(/\$?\d[\d,.]*\s*(million|billion|thousand|percent|%)?/g, "#")
    .replace(/\b(19|20)\d{2}\b/g, "#")
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/g, "#")
    .replace(/[^a-z #]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const HEDGE = /\b(may|might|could|would|believe|estimate|expect|intend|anticipate|potential|possibly|uncertain|depends?|adverse|risk|expose|fluctuat|assum|approximat)\w*/gi;
const SIGNAL = /\b(risk|uncertain|adverse|declin|decreas|loss|weak|impair|litigation|competit|concentration|customer|supply|shortage|inflation|recession|headwind|slow|default|covenant|regulat|tariff)\w*/i;

function countSyllables(w) {
  w = w.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const v = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").match(/[aeiouy]{1,2}/g);
  return v ? v.length : 1;
}

function metrics(text) {
  const sents = sentences(text);
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  const n = words.length || 1;
  const complex = words.filter((w) => countSyllables(w) >= 3).length;
  const fog = 0.4 * (n / (sents.length || 1) + (100 * complex) / n);
  const hedges = (text.match(HEDGE) || []).length;
  return { words: n, sentences: sents.length, fog: Math.round(fog * 10) / 10, hedgeDensity: hedges / n, sents };
}

// ---- EDGAR document discovery ----

async function latestTenKs(cik, n = 2) {
  const sub = await fetchText(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const j = JSON.parse(sub);
  const r = j.filings?.recent;
  if (!r) return [];
  const out = [];
  for (let i = 0; i < r.form.length && out.length < n; i++) {
    if (r.form[i] === "10-K" && r.primaryDocument[i]) {
      out.push({ accn: r.accessionNumber[i], doc: r.primaryDocument[i], date: r.filingDate[i], reportDate: r.reportDate?.[i] });
    }
  }
  return out;
}

async function getFiling(cik, f) {
  const accnNoDash = f.accn.replace(/-/g, "");
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}/${f.doc}`;
  const html = await fetchText(url);
  const text = htmlToText(html);
  const mdna = section(text, "item\\s*7[\\.\\s]+management", ["item\\s*7a[\\.\\s]+quantitative", "item\\s*8[\\.\\s]+financial"]);
  const risk = section(text, "item\\s*1a[\\.\\s]+risk\\s*factors", ["item\\s*1b[\\.\\s]", "item\\s*2[\\.\\s]+propert"]);
  return { url, mdna: metrics(mdna), risk: metrics(risk), reportDate: f.reportDate };
}

// "New" = a prose sentence carrying a signal term whose wording doesn't closely
// match anything in last year's filing (fuzzy, so figure updates and light edits
// don't count). Returns only the notable handful — never a raw "everything
// changed" count.
function diff(curSents, priorSents) {
  const priorTok = priorSents.map(tokenize);
  const isNew = (s) => {
    const t = tokenize(s);
    if (t.size < 6) return false;
    for (const pt of priorTok) if (jaccard(t, pt) >= 0.55) return false;
    return true;
  };
  const notable = curSents
    .filter((s) => SIGNAL.test(s) && isNew(s))
    .sort((a, b) => b.length - a.length)
    .slice(0, 4)
    .map((s) => s.replace(/\s+/g, " ").trim().slice(0, 300));
  return { notableCount: notable.length, notable };
}

async function main() {
  const out = {};
  let ok = 0;
  for (const c of fundamentals.companies) {
    const tk = c.ticker;
    if (!c.cik) continue;
    await sleep(THROTTLE);
    let filings;
    try {
      filings = await latestTenKs(c.cik, 2);
    } catch (e) { console.warn(`  ! ${tk}: submissions ${e.message}`); continue; }
    if (!filings.length) { console.warn(`  ! ${tk}: no 10-K found`); continue; }

    let cur, prior;
    try {
      await sleep(THROTTLE);
      cur = await getFiling(c.cik, filings[0]);
      if (filings[1]) { await sleep(THROTTLE); prior = await getFiling(c.cik, filings[1]); }
    } catch (e) { console.warn(`  ! ${tk}: filing ${e.message}`); continue; }

    // Quality gate: a clean Item 7 extraction is a few thousand words. Skip
    // companies we couldn't parse rather than emit garbage.
    if (cur.mdna.words < 1000) {
      console.warn(`  ! ${tk}: MD&A not cleanly extracted (${cur.mdna.words}w) — skipping`);
      continue;
    }

    const mdnaDiff = prior ? diff(cur.mdna.sents, prior.mdna.sents) : null;
    const riskDiff = prior ? diff(cur.risk.sents, prior.risk.sents) : null;

    out[tk] = {
      fy: cur.reportDate?.slice(0, 4) || null,
      priorFy: prior?.reportDate?.slice(0, 4) || null,
      sourceUrl: cur.url,
      mdna: {
        words: cur.mdna.words, fog: cur.mdna.fog, hedgeDensity: Math.round(cur.mdna.hedgeDensity * 1e4) / 1e4,
        wordsPrior: prior?.mdna.words ?? null, fogPrior: prior?.mdna.fog ?? null,
        hedgePrior: prior ? Math.round(prior.mdna.hedgeDensity * 1e4) / 1e4 : null,
      },
      risk: { words: cur.risk.words, wordsPrior: prior?.risk.words ?? null },
      mdnaChange: mdnaDiff,
      riskChange: riskDiff,
    };
    ok++;
    console.log(`  ✓ ${tk}: MD&A ${cur.mdna.words}w fog ${cur.mdna.fog}` + (mdnaDiff ? `, ${mdnaDiff.notableCount} notable new` : ""));
  }

  fs.writeFileSync(
    path.join(dataDir, "language.json"),
    JSON.stringify({ asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR — 10-K documents", sample: false, companies: out }, null, 2) + "\n"
  );
  console.log(`\n✅ Wrote language analysis for ${ok}/${fundamentals.companies.length} companies`);
}

main().catch((e) => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
