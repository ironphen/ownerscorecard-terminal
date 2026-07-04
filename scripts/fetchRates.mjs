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

// Foreign-exchange reference rates, for the ADR pages only: they translate a US ADR quote (the
// price the reader actually holds) into the filing currency the record is stated in. Reference
// FX is central-bank-grade public data, the same standing as the Treasury yield above — not a
// stock quote. Stored as USD per one unit of each currency the ADR and Japan pools file in.
async function fetchFx() {
  const res = await fetch("https://open.er-api.com/v6/latest/USD", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.result !== "success" || !data.rates) throw new Error("unexpected FX payload");
  // The set we actually need: every filing currency in the ADR pool, plus JPY for the Japan pool.
  const needed = new Set(["JPY"]);
  try {
    const adr = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src", "data", "fundamentals.adr.json"), "utf8"));
    for (const c of adr.companies || []) if (c.currency && c.currency !== "USD") needed.add(c.currency);
  } catch {}
  const fx = {};
  for (const ccy of [...needed].sort()) {
    const perUsd = data.rates[ccy];
    if (perUsd > 0) fx[ccy] = +(1 / perUsd).toFixed(6); // USD per one unit
  }
  const fxAsOf = new Date(data.time_last_update_unix ? data.time_last_update_unix * 1000 : Date.now()).toISOString().slice(0, 10);
  return { fx, fxAsOf, fxSource: "open.er-api.com daily reference rates" };
}

async function main() {
  let rec = null;
  for (const fn of [fromFred, fromTreasury]) {
    try { rec = await fn(); break; } catch (e) { console.warn(`  ! ${fn.name}: ${e.message}`); }
  }
  // Each leg fails softly and independently: a broken FX source never loses the yield, and vice
  // versa — the previous file's values carry over for whichever leg didn't fetch.
  let prior = {};
  try { prior = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
  let fxRec = null;
  try { fxRec = await fetchFx(); } catch (e) { console.warn(`  ! fetchFx: ${e.message}`); }
  const out = {
    ...(rec || { tenYear: prior.tenYear, asOf: prior.asOf, source: prior.source }),
    ...(fxRec || (prior.fx ? { fx: prior.fx, fxAsOf: prior.fxAsOf, fxSource: prior.fxSource } : {})),
  };
  if (out.tenYear == null && !out.fx) { console.error("⚠️  Nothing fetched and nothing prior; leaving file untouched."); return; }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`✅ 10-yr Treasury ${out.tenYear}% as of ${out.asOf}${out.fx ? ` · FX ${Object.keys(out.fx).length} currencies as of ${out.fxAsOf}` : ""}`);
}

main().catch((e) => { console.error(`rates fetch failed softly: ${e.message}`); });
