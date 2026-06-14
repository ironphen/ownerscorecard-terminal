#!/usr/bin/env node
// Fetches monthly closes from Stooq (free, no key) and writes src/data/prices.json:
// the current price plus the close near each fiscal year-end, aligned to each
// company's fiscal calendar (read from fundamentals.json). Needs outbound access
// to stooq.com; runs in CI after fetch:fundamentals.
//
//   npm run fetch:prices

import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "src", "data");
const fundamentals = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getCSV(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Owner Scorecard research (ryanreinsant@gmail.com)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (a === 4) throw e;
      await sleep(600 * a);
    }
  }
}

// CSV: Date,Open,High,Low,Close,Volume → { "YYYY-MM": close }
function parseMonthly(csv) {
  const m = {};
  for (const line of csv.trim().split("\n").slice(1)) {
    const [date, , , , close] = line.split(",");
    if (date && close && !Number.isNaN(+close)) m[date.slice(0, 7)] = +close;
  }
  return m;
}

// Close in the target month, else the nearest month within ±5.
function closeNear(monthly, year, month) {
  for (let d = 0; d <= 5; d++) {
    for (const s of d === 0 ? [0] : [d, -d]) {
      const mm = month + s;
      const y = year + Math.floor((mm - 1) / 12);
      const m2 = ((((mm - 1) % 12) + 12) % 12) + 1;
      const key = `${y}-${String(m2).padStart(2, "0")}`;
      if (monthly[key] != null) return monthly[key];
    }
  }
  return null;
}

// Latest quote (today's close): Symbol,Date,Time,Close
async function latestQuote(tk) {
  const csv = await getCSV(`https://stooq.com/q/l/?s=${tk.toLowerCase()}.us&f=sd2t2c&h&e=csv`);
  const row = (csv.trim().split("\n")[1] || "").split(",");
  const close = +row[row.length - 1];
  const date = row[1];
  if (date && date !== "N/D" && !Number.isNaN(close) && close > 0)
    return { price: Math.round(close * 100) / 100, asOf: date };
  return null;
}

async function main() {
  const prices = {};
  let ok = 0;
  for (const c of fundamentals.companies) {
    const tk = c.ticker;
    const fyEndMonth = c.periodEnd ? Number(c.periodEnd.slice(5, 7)) : 12;

    // Historical year-end prices (monthly series).
    await sleep(120);
    let monthly = {};
    try {
      monthly = parseMonthly(await getCSV(`https://stooq.com/q/d/l/?s=${tk.toLowerCase()}.us&i=m`));
    } catch (e) {
      console.warn(`  ! ${tk}: monthly ${e.message}`);
    }
    // Current price — today's close (falls back to the latest monthly close).
    await sleep(120);
    let quote = null;
    try {
      quote = await latestQuote(tk);
    } catch {
      /* fall back to monthly below */
    }

    const dates = Object.keys(monthly).sort();
    const current = quote?.price ?? (dates.length ? monthly[dates[dates.length - 1]] : null);
    const asOf = quote?.asOf ?? (dates.length ? dates[dates.length - 1] : null);
    if (current == null) {
      console.warn(`  ! ${tk}: no price (delisted? wrong symbol?)`);
      continue;
    }

    const byYear = {};
    for (const h of c.history || []) {
      const p = closeNear(monthly, h.fy, fyEndMonth);
      if (p != null) byYear[h.fy] = Math.round(p * 100) / 100;
    }
    prices[tk] = { current: Math.round(current * 100) / 100, asOf, byYear };
    ok++;
    console.log(`  ✓ ${tk} $${prices[tk].current} as of ${asOf} (${Object.keys(byYear).length} fiscal-year prices)`);
  }

  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    source: "Stooq — monthly close",
    note: "Price-only closes; not adjusted for dividends. Used to derive valuation multiples against earnings already pulled from EDGAR.",
    sample: false,
    prices,
  };
  fs.writeFileSync(path.join(dataDir, "prices.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`\n✅ Wrote prices for ${ok}/${fundamentals.companies.length} companies`);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}\n`);
  process.exit(1);
});
