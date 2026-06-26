#!/usr/bin/env node
// fetchRates.mjs — the one macro number the valuation anchors to: the 10-year Treasury yield, the
// risk-free rate Graham measured a stock against and Buffett calls gravity on every asset price.
//
// Treasury yields are public-domain U.S. government data, not licensed market data like stock prices —
// so, unlike the reader-supplied price, we can carry a current value as an editable DEFAULT. Fetched on
// the daily wire refresh, dated, and always overridable in the tool. Writes src/data/rates.json:
//   { tenYear, asOf, source }
// A fetch hiccup leaves the committed default untouched and exits 0, so it can never break the run.
//
//   npm run fetch:rates

import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "src", "data", "rates.json");
const UA = process.env.SEC_USER_AGENT || "ownerscorecard rates fetch (contact: github.com/ironphen)";

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// FRED's 10-Year Treasury Constant Maturity (DGS10) — a free CSV, no key. Rows are "date,value"; the
// value is "." on non-trading days, so walk up from the bottom and take the most recent numeric row.
async function fromFred() {
  const csv = await get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10");
  const lines = csv.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i >= 1; i--) {
    const [date, val] = lines[i].split(",");
    const v = Number(val);
    if (Number.isFinite(v) && v > 0) return { tenYear: +v.toFixed(2), asOf: (date || "").trim(), source: "FRED DGS10 (10-yr Treasury, constant maturity)" };
  }
  throw new Error("no numeric DGS10 row");
}

// The U.S. Treasury's own daily par yield curve (public domain), as a fallback. Atom XML; the last
// entry is the most recent. Best-effort regex parse of BC_10YEAR and NEW_DATE. Tries this year, then
// last year (the feed for a new year is empty in its first days).
async function fromTreasury() {
  const year = new Date().getUTCFullYear();
  for (const y of [year, year - 1]) {
    let xml;
    try { xml = await get(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${y}`); }
    catch { continue; }
    const tens = [...xml.matchAll(/<d:BC_10YEAR>([\d.]+)<\/d:BC_10YEAR>/g)].map((m) => m[1]);
    const dates = [...xml.matchAll(/<d:NEW_DATE>([^<]+)<\/d:NEW_DATE>/g)].map((m) => m[1].slice(0, 10));
    if (tens.length) {
      const v = Number(tens[tens.length - 1]);
      if (Number.isFinite(v) && v > 0) return { tenYear: +v.toFixed(2), asOf: dates[dates.length - 1] || `${y}`, source: "U.S. Treasury daily par yield curve" };
    }
  }
  throw new Error("no Treasury 10-year value");
}

async function main() {
  let rec = null;
  for (const fn of [fromFred, fromTreasury]) {
    try { rec = await fn(); break; } catch (e) { console.warn(`  ! ${fn.name}: ${e.message}`); }
  }
  if (!rec) { console.error("⚠️  Could not fetch the 10-year yield; leaving the committed default in place."); return; }
  fs.writeFileSync(OUT, JSON.stringify(rec, null, 2) + "\n");
  console.log(`✅ 10-yr Treasury ${rec.tenYear}% as of ${rec.asOf} (${rec.source})`);
}

main().catch((e) => { console.error(`rates fetch failed softly: ${e.message}`); });
