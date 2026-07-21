#!/usr/bin/env node
// fetchUpcoming.mjs — the filing rhythm: what each company files next, and the clock it runs on.
//
// EDGAR publishes no future earnings dates — but it doesn't need to. The next report is on two
// public clocks: the STATUTE (a 10-Q is due within 40 days of quarter end for accelerated and
// large-accelerated filers, 45 otherwise; a 10-K within 60/75/90 days by the same classes — the
// filer class is stated in each company's SEC submissions record), and the COMPANY'S OWN RHYTHM
// (its historical filed-date lag after each period end, which we take as the median of its recent
// same-form filings). This fetcher stores both per company, plus the last filings themselves; the
// wire's "week ahead" band renders from it, printing only filed facts and the statutory rule —
// the computed expectation selects the rows, it is never printed as a date.
//
// US pool, 10-K/10-Q cadence only (foreign 20-F filers report annually with unscheduled 6-Ks —
// out of scope until their own treatment). Refreshed weekly: rhythms drift at quarter speed.
//
// Usage:
//   ONLY_UP=AAPL,MSFT node scripts/fetchUpcoming.mjs
//   node scripts/fetchUpcoming.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compactJson } from "../src/lib/dataFile.mjs";

const UA = process.env.SEC_USER_AGENT || "OwnerScorecard research hello@ownerscorecard.com";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const THROTTLE_MS = 150;
const dataDir = path.join(process.cwd(), "src", "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) return null;
      if (res.status === 429) { if (a === 4) throw new Error("HTTP 429"); await sleep(1200 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) { if (a === 4) throw err; await sleep(600 * a); }
  }
}

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

// Statutory deadlines, in days after period end, by filer class (Exchange Act rules 13a-13 /
// 15d-13 and Form 10-K general instructions). The class string is the SEC's own.
function deadlines(category) {
  const c = String(category || "").toLowerCase();
  if (c.includes("large accelerated")) return { k: 60, q: 40 };
  if (c.includes("accelerated") && !c.includes("non-accelerated")) return { k: 75, q: 40 };
  return { k: 90, q: 45 };
}

// One company's rhythm from its submissions record. Returns null when the cadence can't be read
// cleanly (fewer than 2 recent 10-Qs, or no 10-K) — an absent row, never a guessed one.
export function rhythmOf(sub) {
  const r = sub?.filings?.recent;
  if (!r) return null;
  const rows = [];
  for (let i = 0; i < r.form.length; i++) {
    if ((r.form[i] === "10-K" || r.form[i] === "10-Q") && r.reportDate[i] && r.filingDate[i])
      rows.push({ form: r.form[i], end: r.reportDate[i], filed: r.filingDate[i] });
  }
  const ks = rows.filter((x) => x.form === "10-K").slice(0, 3);
  const qs = rows.filter((x) => x.form === "10-Q").slice(0, 6);
  if (!ks.length || qs.length < 2) return null;
  const latest = rows.reduce((a, b) => (a.end > b.end ? a : b));
  const dl = deadlines(sub.category);
  // The next period end: one quarter (~91 days) past the latest filed period. Fiscal calendars
  // (4-4-5 retailers included) keep this within a few days — close enough to SELECT a week, and
  // no computed date is ever printed as one. But the band DOES print the period's month, so a
  // month-boundary error is a wrong printed fact: a calendar filer's Q1 computed from its 10-K
  // (Dec 31 + 91 = Apr 1) would read "April" for a quarter that truly ends March 31. When the
  // arithmetic flips a month-end period (day ≥ 25) to a month-start result (day ≤ 5), snap back
  // to the prior month's last day. A filer whose periods genuinely end early in the month (the
  // 4-5-4 retail calendar — Home Depot's quarters end Feb 2, May 4…) starts start-ish and never
  // trips the flip, so its months stay its own.
  let nextEnd = addDays(latest.end, 91);
  const dayOf = (iso) => Number(iso.slice(8, 10));
  if (dayOf(latest.end) >= 25 && dayOf(nextEnd) <= 5) {
    nextEnd = addDays(nextEnd, -dayOf(nextEnd));
  }
  // Whether that period closes the fiscal year: within ~40 days of the anniversary of the last
  // 10-K's period end.
  const kEnd = ks[0].end;
  const anniversary = addDays(kEnd, 364);
  const isAnnual = Math.abs(days(nextEnd, anniversary)) <= 40;
  // An annual period anchors on the 10-K's own anniversary (364 days — a 52-week year), not on
  // quarter arithmetic: a 52/53-week filer's fourth quarter can run 16 weeks (Costco's does), so
  // +91 days from the third quarter lands weeks short of the true year end.
  if (isAnnual) nextEnd = anniversary;
  const lagKs = ks.map((x) => days(x.end, x.filed));
  const lagQs = qs.map((x) => days(x.end, x.filed));
  const nextForm = isAnnual ? "10-K" : "10-Q";
  const lags = isAnnual ? lagKs : lagQs;
  const lag = median(lags);
  const due = isAnnual ? dl.k : dl.q;
  if (lag == null || lag < 10 || lag > 120) return null;
  return {
    category: sub.category || null,
    nextForm,
    nextPeriodEnd: nextEnd,           // internal selection anchor; month-level in display
    dueBy: addDays(nextEnd, due),     // internal selection anchor
    statutoryDays: due,
    typicalLagDays: lag,
    // The lag list behind the median, newest first: the display gates day-level placement on the
    // rhythm's own steadiness (lib/filingRhythm.mjs), so a metronome and a smear read differently.
    lagsSameForm: lags,
    expected: addDays(nextEnd, lag),  // internal selection anchor — never printed as a date
    lastSameForm: (isAnnual ? ks : qs)[0] || null,
  };
}

async function main() {
  const fund = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
  const companies = (fund.companies || []).filter((c) => c.cik);
  const only = (process.env.ONLY_UP || "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  const targets = only.length ? companies.filter((c) => only.includes(String(c.ticker).toUpperCase())) : companies;
  console.log(`upcoming: ${targets.length} companies${only.length ? " (ONLY_UP)" : ""}`);

  const outPath = path.join(dataDir, "upcoming.json");
  let prior = {};
  try { prior = JSON.parse(fs.readFileSync(outPath, "utf8")).companies || {}; } catch {}

  const result = {};
  let ok = 0, none = 0, err = 0, done = 0;
  for (const c of targets) {
    done++;
    const T = String(c.ticker).toUpperCase();
    try {
      await sleep(THROTTLE_MS);
      const sub = await getJSON(`https://data.sec.gov/submissions/CIK${String(c.cik).padStart(10, "0")}.json`);
      const rhythm = sub ? rhythmOf(sub) : null;
      if (rhythm) { result[T] = rhythm; ok++; } else none++;
    } catch (e) { err++; console.warn(`  ! ${T}: ${e.message}`); }
    if (done % 200 === 0) console.log(`  …${done}/${targets.length} (${ok})`);
  }

  const merged = only.length ? { ...prior, ...result } : result;
  const out = { asOf: new Date().toISOString().slice(0, 10), source: "SEC EDGAR submissions: each filer's class, statutory deadline, and its own filed rhythm", companies: merged };
  const tmp = outPath + ".tmp";
  fs.writeFileSync(tmp, compactJson(out));
  fs.renameSync(tmp, outPath);
  console.log(`\n✅ upcoming: ${ok} rhythms, ${none} unreadable, ${err} errors; wrote ${Object.keys(merged).length}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
}
