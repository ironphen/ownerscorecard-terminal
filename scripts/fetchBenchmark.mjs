#!/usr/bin/env node
// Fetches monthly SPY closes from Stooq and writes src/data/benchmark.json
// so The Record can show the portfolio against the S&P 500.
//
// Price-only (excludes dividends) — the page labels it accordingly.
// Run from a machine with open network access:
//
//   npm run fetch:benchmark

import fs from "node:fs";
import path from "node:path";

const FROM = "20220501"; // month before performance inception, for a baseline
const URL = `https://stooq.com/q/d/l/?s=spy.us&d1=${FROM}&d2=20991231&i=m`;

const outPath = path.join(process.cwd(), "src", "data", "benchmark.json");

let csv;
try {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  csv = await res.text();
} catch (err) {
  console.error(`\n❌ Could not reach stooq.com (${err.message}).`);
  console.error(`   Run this from a machine with open network access.\n`);
  process.exit(1);
}

const lines = csv.trim().split("\n").slice(1); // Date,Open,High,Low,Close,Volume
const closes = [];
for (const line of lines) {
  const [date, , , , close] = line.split(",");
  if (!date || !close) continue;
  closes.push({ month: date.slice(0, 7), close: Number(close) });
}

if (closes.length < 2) {
  console.error("\n❌ Unexpected response from stooq.com — no rows parsed.\n");
  process.exit(1);
}

// Close-to-close monthly returns; first row is the baseline month
const months = {};
for (let i = 1; i < closes.length; i++) {
  const r = closes[i].close / closes[i - 1].close - 1;
  months[closes[i].month] = Math.round(r * 10000) / 10000;
}

const benchmark = {
  symbol: "SPY",
  label: "S&P 500 (SPY, price only)",
  note: "Monthly close-to-close returns from stooq.com; excludes dividends.",
  fetched: new Date().toISOString().slice(0, 10),
  months,
};

fs.writeFileSync(outPath, JSON.stringify(benchmark, null, 2) + "\n");
console.log(`✅ Wrote ${Object.keys(months).length} months to src/data/benchmark.json`);
