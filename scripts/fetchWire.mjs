#!/usr/bin/env node
// fetchWire.mjs, the Filing Wire.
//
// The site's "alive daily" without a price feed or an LLM: every new filing across
// the catalog, straight from EDGAR, with 8-K item codes turned into plain language
// (so an auditor change or a restatement announces itself). Lightweight, just the
// submissions feeds, so it can run on its own daily schedule. Writes wire.json.
//   npm run fetch:wire

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fetchText } from "./fetchFilings.mjs";
import { toBlocks, mdnaText, splitSentences, pickConsolidated } from "../src/lib/drivers.mjs";
import { annualByYear, quarterFlowMap, deriveOpInc, revenueTagsFor, CONCEPTS } from "./fetchFundamentals.mjs";

const UA = process.env.SEC_USER_AGENT || "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const dataDir = path.join(process.cwd(), "src", "data");
const fundamentals = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAYS = 150; // recency window

async function getJSON(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      // 60s per-attempt timeout so a hung server can't freeze the run; an abort retries like any failure.
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429) { await sleep(1000 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { if (a === 4) throw e; await sleep(500 * a); }
  }
}

const FORM_LABEL = {
  "10-K": "Annual report", "10-K/A": "Annual report (amended)",
  "10-Q": "Quarterly report", "8-K": "Current report", "DEF 14A": "Proxy statement",
};

// 8-K item codes → what actually happened. The grave ones (4.01, 4.02, 2.04) are the
// Graham red flags an owner wants to see the moment they're filed.
const ITEM_8K = {
  "1.01": "Entered a material agreement", "1.02": "Ended a material agreement",
  "2.01": "Completed an acquisition or disposal", "2.02": "Reported results",
  "2.03": "Took on a financial obligation", "2.04": "Debt accelerated or in default",
  "2.05": "Restructuring / exit costs", "2.06": "Material impairment",
  "3.01": "Delisting or listing-rule notice", "3.02": "Sold unregistered shares",
  "3.03": "Changed shareholder rights", "4.01": "Changed its auditor",
  "4.02": "Said prior financials can't be relied on", "5.01": "Change in control",
  "5.02": "Executive or board change", "5.03": "Amended charter or bylaws",
  "5.07": "Shareholder vote", "7.01": "Reg FD disclosure", "8.01": "Other event",
};
const isFiller = (c) => c === "9.01" || c === "7.01" || c === "8.01";

function label8K(items) {
  const codes = (items || "").split(",").map((s) => s.trim()).filter((c) => ITEM_8K[c]);
  codes.sort((a, b) => isFiller(a) - isFiller(b)); // substance before filler
  return codes.length ? ITEM_8K[codes[0]] : "Current report";
}

// ---- moat-deepener: the performance line for a new periodic report ----
// "Revenue up 12.3% year over year; operating income up 9.0%" — the percentages COMPUTED from
// the filing's own XBRL (the new accession carries its own prior-year comparative, so both
// dollar figures trace to the just-filed document), plus the company's verbatim MD&A clause
// when it passes the same anchored/directed/figure-verified gates the company pages' Drivers
// use. Never a word of ours: quotation plus arithmetic, up/down and a percentage, no
// adjectives, no beat/missed. A line whose prior year isn't a clean positive base ships
// nothing: silence over filler.
const RECENT_DAYS = 45; // compute performance only for genuinely new filings
const RETRY_DAYS = 5; // a cached null stays retryable this long (companyfacts lags by hours, not days)
const MATCH_MS = 20 * 86400000; // ±20d period-end match absorbs 52/53-week fiscal calendars

const docURL = (cik, r, idx) =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[idx].replace(/-/g, "")}/${r.primaryDocument[idx]}`;

// The value whose period end falls within ±20 days of the target instant, from an end→value map.
function endValue(map, t) {
  let best = null, bestD = MATCH_MS + 1;
  for (const end in map) {
    const d = Math.abs(Date.parse(end + "T00:00:00Z") - t);
    if (d < bestD) { bestD = d; best = map[end]; }
  }
  return best;
}

// annualByYear keyed by period end instead of fiscal year, for the same ±20d matching.
function annualEndMap(facts, tags, pickMax = false) {
  const m = {};
  for (const e of Object.values(annualByYear(facts, tags, "USD", pickMax))) m[e.end] = e.val;
  return m;
}

// Sub-annual duration observations (a quarter through a nine-month YTD span) for the tags,
// for filers that tag no discrete ~90-day quarter — their 10-Q carries only cumulative
// year-to-date durations, which still yield an honest year-over-year read (basis "ytd").
function subAnnualDurations(facts, tags) {
  const all = [];
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.USD;
    if (!units) continue;
    for (const u of units) {
      if (!u.form || !u.start || !u.end) continue;
      if (!(u.form.startsWith("10-K") || u.form.startsWith("10-Q"))) continue;
      const dur = (Date.parse(u.end) - Date.parse(u.start)) / 86400000;
      if (dur < 80 || dur > 300) continue;
      all.push({ val: u.val, end: u.end, dur, filed: u.filed || "" });
    }
  }
  return all;
}

// The YTD pair: the longest duration ending at the period end, and the same-length span
// (±25d) ending a year earlier. Both null when the filer tagged neither.
function ytdPair(all, tCur, tPri) {
  const cur = all
    .filter((e) => Math.abs(Date.parse(e.end + "T00:00:00Z") - tCur) <= MATCH_MS)
    .sort((a, b) => b.dur - a.dur || b.filed.localeCompare(a.filed))[0];
  if (!cur) return null;
  const pri = all
    .filter((e) => Math.abs(Date.parse(e.end + "T00:00:00Z") - tPri) <= MATCH_MS && Math.abs(e.dur - cur.dur) <= 25)
    .sort((a, b) => b.filed.localeCompare(a.filed))[0];
  return pri ? { cur: cur.val, prior: pri.val } : null;
}

// A printed percentage needs a clean positive base: prior > 0, both figures present.
function lineOf(cur, prior) {
  if (cur == null || prior == null || prior <= 0) return null;
  return { yoy: +((100 * (cur - prior)) / prior).toFixed(1), cur, prior };
}

async function performanceFor(c, r, i) {
  const form = r.form[i], reportDate = r.reportDate?.[i];
  if (!reportDate || !r.primaryDocument[i]) return null;
  try {
    const facts = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${c.cik}.json`);
    await sleep(150);
    const tCur = Date.parse(reportDate + "T00:00:00Z");
    const priD = new Date(tCur);
    priD.setUTCFullYear(priD.getUTCFullYear() - 1);
    const tPri = priD.getTime();

    const sicN = Number(c.sic) || 0;
    const revTags = revenueTagsFor(c.sic, facts);
    const pickMax = (sicN >= 6500 && sicN <= 6799) || (sicN >= 6300 && sicN <= 6399) || sicN === 7359 || sicN === 6211; // REIT rent / insurer total / lessor / broker-or-asset-manager (see fetchFundamentals)

    let basis, rev, oi;
    if (form.startsWith("10-K")) {
      basis = "fy";
      const revM = annualEndMap(facts, revTags, pickMax);
      const oiAt = (t) => deriveOpInc(
        endValue(annualEndMap(facts, CONCEPTS.operatingIncome), t),
        endValue(revM, t),
        endValue(annualEndMap(facts, CONCEPTS.costsAndExpenses), t),
        endValue(annualEndMap(facts, CONCEPTS.netIncome), t),
        endValue(annualEndMap(facts, CONCEPTS.incomeTaxExpense), t),
        endValue(annualEndMap(facts, CONCEPTS.interestExpense), t),
      );
      rev = lineOf(endValue(revM, tCur), endValue(revM, tPri));
      oi = lineOf(oiAt(tCur), oiAt(tPri));
    } else {
      // 10-Q: discrete three-month flows first — the cleanest quarter-on-quarter-a-year-ago read.
      basis = "quarter";
      const revM = quarterFlowMap(facts, revTags);
      const oiAt = (t) => deriveOpInc(
        endValue(quarterFlowMap(facts, CONCEPTS.operatingIncome), t),
        endValue(revM, t),
        endValue(quarterFlowMap(facts, CONCEPTS.costsAndExpenses), t),
        endValue(quarterFlowMap(facts, CONCEPTS.netIncome), t),
        endValue(quarterFlowMap(facts, CONCEPTS.incomeTaxExpense), t),
        endValue(quarterFlowMap(facts, CONCEPTS.interestExpense), t),
      );
      rev = lineOf(endValue(revM, tCur), endValue(revM, tPri));
      oi = lineOf(oiAt(tCur), oiAt(tPri));
      // Fallback: no line proved as a discrete quarter → the filer tags cumulative YTD
      // durations only. Both lines move to the YTD basis together, never mixed.
      if (!rev && !oi) {
        basis = "ytd";
        const p = (tags) => ytdPair(subAnnualDurations(facts, tags), tCur, tPri);
        const revP = p(revTags), oiP = p(CONCEPTS.operatingIncome);
        const ceP = p(CONCEPTS.costsAndExpenses), niP = p(CONCEPTS.netIncome);
        const taxP = p(CONCEPTS.incomeTaxExpense), intP = p(CONCEPTS.interestExpense);
        rev = revP ? lineOf(revP.cur, revP.prior) : null;
        const oiCur = deriveOpInc(oiP?.cur ?? null, revP?.cur ?? null, ceP?.cur ?? null, niP?.cur ?? null, taxP?.cur ?? null, intP?.cur ?? null);
        const oiPri = deriveOpInc(oiP?.prior ?? null, revP?.prior ?? null, ceP?.prior ?? null, niP?.prior ?? null, taxP?.prior ?? null, intP?.prior ?? null);
        oi = lineOf(oiCur, oiPri);
      }
    }
    if (!rev && !oi) return null; // XBRL not up yet, or no clean base: retryable while fresh

    // The company's own words, only when they prove against the numbers above: the same
    // anchored/directed/figure-verified gates the Drivers section uses, on THIS filing's MD&A.
    let driver = null, driverLine = null, check = null;
    const html = await fetchText(docURL(c.cik, r, i));
    if (html) {
      const text = mdnaText(toBlocks(html), form);
      if (text) {
        const fy = new Date(reportDate + "T00:00:00Z").getUTCFullYear();
        const changes = {};
        if (rev) changes.revenue = { pct: rev.yoy, delta: rev.cur - rev.prior };
        if (oi) changes.operatingIncome = { pct: oi.yoy, delta: oi.cur - oi.prior };
        const picks = pickConsolidated(splitSentences(text), { fy, changes });
        if (picks.length) ({ sentence: driver, line: driverLine, check } = picks[0]); // revenue anchor first by CONSOLIDATED order
      }
    }
    return { period: reportDate, basis, rev, oi, driver, driverLine, check };
  } catch { return null; }
}

async function main() {
  const cutoff = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
  const recentCutoff = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString().slice(0, 10);
  const retryCutoff = new Date(Date.now() - RETRY_DAYS * 86400000).toISOString().slice(0, 10);
  const wirePath = path.join(dataDir, "wire.json");

  // Reuse already-computed performance (keyed by accession) so each new filing is analysed
  // once, not re-fetched on every daily run. A cached null stays a miss while the item is
  // fresh (see the retry gate below): companyfacts can lag a filing by hours, and the first
  // morning's miss must not freeze into a permanent blank.
  const cache = {};
  try { for (const it of (JSON.parse(fs.readFileSync(wirePath, "utf8")).items || [])) if (it.accn) cache[it.accn] = it.performance ?? null; } catch {}

  const items = [];
  let attempted = 0, failed = 0;
  for (const c of fundamentals.companies) {
    if (!c.cik) continue;
    await sleep(150);
    attempted++;
    let j;
    try { j = await getJSON(`https://data.sec.gov/submissions/CIK${c.cik}.json`); }
    catch (e) { failed++; console.warn(`  ! ${c.ticker}: ${e.message}`); continue; }
    const r = j.filings?.recent;
    if (!r?.form) continue;
    let diffed = 0;
    for (let i = 0; i < r.form.length; i++) {
      const form = r.form[i], date = r.filingDate[i];
      if (!FORM_LABEL[form] || !date || date < cutoff) continue;
      const accn = r.accessionNumber[i], doc = r.primaryDocument[i];
      const url = accn && doc ? `https://www.sec.gov/Archives/edgar/data/${Number(c.cik)}/${accn.replace(/-/g, "")}/${doc}` : null;
      const label = form === "8-K" ? label8K(r.items?.[i]) : FORM_LABEL[form];
      const grave = form === "8-K" && /can't be relied on|Changed its auditor|default|impairment|Delisting/.test(label);

      // Performance: only for genuinely new 10-K/10-Q, capped per company, computed once —
      // except a cached null, which is retried while the item is at most RETRY_DAYS old.
      let performance = null;
      if ((form === "10-K" || form === "10-Q") && date >= recentCutoff && diffed < 2) {
        if (accn in cache && !(cache[accn] == null && date >= retryCutoff)) performance = cache[accn];
        else { performance = await performanceFor(c, r, i); diffed++; }
      }

      items.push({ ticker: c.ticker, name: c.name || c.ticker, form, date, label, grave, accn, url, performance });
    }
  }
  // Partial-outage fail-safe: the zero-item check below catches a total EDGAR outage, but a
  // partial one (a slice of the submissions fetches failing) would silently drop those
  // companies from the wire — and from every follower's email — in a green run. That is the
  // exact surface where a grave 8-K goes missing unseen. Fail red and keep the prior file.
  if (attempted >= 50 && failed / attempted > 0.10) {
    console.error(`\n❌ Wire: ${failed}/${attempted} submissions fetches failed (>10%); preserving the prior file rather than publishing a partial wire.\n`);
    process.exit(1);
  }
  // Fail-safe: a run that found nothing (every submissions fetch failed, an EDGAR outage) must not
  // blank the wire. Preserve the prior file and exit non-zero so the scheduled job surfaces the failure
  // rather than committing an empty feed.
  if (!items.length) {
    let priorCount = 0;
    try { priorCount = (JSON.parse(fs.readFileSync(wirePath, "utf8")).items || []).length; } catch {}
    if (priorCount > 0) { console.error(`\n❌ Wire fetch returned no filings; preserving the prior ${priorCount}-item file.\n`); process.exit(1); }
  }
  items.sort((a, b) => b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker));
  // Keep a window of recent filing DAYS rather than a fixed item count: the old 90-item cap
  // silently truncated busy days (one earnings-season morning can exceed it on its own), which
  // dropped filings from the page and the follower emails alike. Window: the 7 most recent
  // filing dates, with a hard ceiling as a file-size guard; grave items are never dropped.
  const keepDates = new Set([...new Set(items.map((x) => x.date))].sort().reverse().slice(0, 7));
  let kept = items.filter((x) => keepDates.has(x.date));
  const CEILING = 800;
  if (kept.length > CEILING) {
    console.warn(`  ! wire window holds ${kept.length} items (> ${CEILING}); dropping the oldest non-grave overflow`);
    const grave = kept.filter((x) => x.grave);
    const rest = kept.filter((x) => !x.grave).slice(0, Math.max(0, CEILING - grave.length));
    kept = [...grave, ...rest].sort((a, b) => b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker));
  }
  const today = new Date().toISOString().slice(0, 10);
  const out = { asOf: today, source: "SEC EDGAR, recent filings", items: kept };
  fs.writeFileSync(wirePath, JSON.stringify(out, null, 2) + "\n");
  console.log(`✅ Wire: ${out.items.length} filings across ${keepDates.size} filing days, ${kept.filter((x) => x.performance).length} with performance`);

  // The permanent per-day archive: the rolling wire keeps only the last 7 filing days, so a link
  // to "what filed on 2026-07-11" would rot within a week. Write each day to its own append-only
  // file so /wire/{date} is a permanent, citable page. Days still inside the rolling window are
  // rewritten each run (late filings and backfilled performance still change them); older days
  // are written once and then frozen, which keeps daily git churn to the ~7 window files. Fully
  // fail-soft: the archive can never break the wire.json write above.
  try {
    const daysDir = path.join(dataDir, "wire-days");
    fs.mkdirSync(daysDir, { recursive: true });
    const byDate = new Map();
    for (const it of items) {
      if (!it.date) continue;
      if (!byDate.has(it.date)) byDate.set(it.date, []);
      byDate.get(it.date).push(it);
    }
    let written = 0;
    for (const [date, dayItems] of byDate) {
      const file = path.join(daysDir, `${date}.json`);
      const inWindow = keepDates.has(date);
      // Freeze older days: write once if absent, then leave alone.
      if (!inWindow && fs.existsSync(file)) continue;
      dayItems.sort((a, b) => a.ticker.localeCompare(b.ticker));
      const dayOut = { date, asOf: today, source: out.source, items: dayItems };
      const body = JSON.stringify(dayOut, null, 2) + "\n";
      // Skip a rewrite that would not change the file, so unchanged window days don't churn git.
      let prior = null;
      try { prior = fs.readFileSync(file, "utf8"); } catch {}
      if (prior === body) continue;
      fs.writeFileSync(file, body);
      written++;
    }
    console.log(`   wire archive: ${written} day file(s) written/updated, ${byDate.size} day(s) seen`);
  } catch (e) {
    console.warn(`   ! wire archive skipped (non-fatal): ${e.message}`);
  }
}

export { label8K, ITEM_8K, performanceFor };

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
