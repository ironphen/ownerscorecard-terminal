#!/usr/bin/env node
// fetchPrices.mjs — daily end-of-day closes for the universe.
//
// Vendor-agnostic. Polygon.io's grouped-daily endpoint is the default: ONE request
// returns every US stock's close for a trading day, so we make a single call and
// filter to our tickers (trivial against any rate limit, cheap on any plan). Writes
// src/data/prices.json, a cached snapshot the site reads at build time — no API
// call at request time, no metered surprise.
//
// No key → no-op. The feature stays completely dark (and $0) until a key exists:
//   PRICE_PROVIDER=polygon PRICE_API_KEY=xxxx npm run fetch:prices
//
// End-of-day only — we don't need (or want) real-time for owner-investing.

import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "src", "data");
const fundamentals = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));
const universe = new Set(fundamentals.companies.map((c) => String(c.ticker).toUpperCase()));
const pricesPath = path.join(dataDir, "prices.json");

const KEY = process.env.PRICE_API_KEY || process.env.POLYGON_API_KEY || "";
const PROVIDER = (process.env.PRICE_PROVIDER || "polygon").toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => d.toISOString().slice(0, 10);

async function getJSON(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) { await sleep(1500 * a); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { if (a === 4) throw e; await sleep(700 * a); }
  }
}

const PROVIDERS = {
  // Preferred path: one request returns the whole US market's daily bars; step
  // back over weekends/holidays until a trading day returns data. Works on paid
  // plans and usually on the free plan too.
  async polygon(key) {
    for (let back = 0; back <= 6; back++) {
      const day = ymd(new Date(Date.now() - back * 86400000));
      try {
        const j = await getJSON(`https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${day}?adjusted=true&apiKey=${key}`);
        if (j && Array.isArray(j.results) && j.results.length) {
          const prices = {};
          for (const r of j.results) {
            const t = String(r.T || "").toUpperCase();
            if (universe.has(t) && typeof r.c === "number") prices[t] = r.c;
          }
          if (Object.keys(prices).length) return { asOf: day, prices };
        }
      } catch (e) {
        if (back === 0) break; // grouped not on this plan → drop to the per-ticker path
      }
      await sleep(300);
    }
    // Free-tier fallback: per-ticker previous close, throttled to stay under the
    // 5-requests/minute limit. ~36 tickers ≈ 8 minutes — fine for a nightly job.
    console.log("Grouped endpoint unavailable — falling back to throttled per-ticker pulls.");
    const prices = {};
    let asOf = null;
    for (const t of universe) {
      try {
        const j = await getJSON(`https://api.polygon.io/v2/aggs/ticker/${t}/prev?adjusted=true&apiKey=${key}`);
        const r = j?.results?.[0];
        if (r && typeof r.c === "number") { prices[t] = r.c; if (r.t) asOf = ymd(new Date(r.t)); }
      } catch { /* skip a ticker rather than fail the run */ }
      await sleep(13000); // ≤ 5 requests/minute on the free plan
    }
    return Object.keys(prices).length ? { asOf, prices } : null;
  },

  // Tiingo has no grouped endpoint — one call per ticker. Kept simple and slow so
  // it respects the free-tier rate limit; switch with PRICE_PROVIDER=tiingo.
  async tiingo(key) {
    const prices = {};
    let asOf = null;
    for (const t of universe) {
      try {
        const j = await getJSON(`https://api.tiingo.com/tiingo/daily/${t}/prices?token=${key}`);
        const row = Array.isArray(j) ? j[0] : null;
        if (row && typeof row.close === "number") { prices[t] = row.close; asOf = (row.date || "").slice(0, 10) || asOf; }
      } catch { /* skip a ticker rather than fail the run */ }
      await sleep(900);
    }
    return Object.keys(prices).length ? { asOf, prices } : null;
  },
};

async function main() {
  if (!KEY) {
    console.log("No price API key set — leaving prices dark (no data, no charge).");
    if (!fs.existsSync(pricesPath))
      fs.writeFileSync(pricesPath, JSON.stringify({ asOf: null, source: "(no key yet)", currency: "USD", prices: {} }, null, 2) + "\n");
    else console.log("Kept the existing prices.json.");
    return;
  }
  const fn = PROVIDERS[PROVIDER];
  if (!fn) { console.error(`Unknown PRICE_PROVIDER "${PROVIDER}" (have: ${Object.keys(PROVIDERS).join(", ")}).`); process.exit(1); }

  const got = await fn(KEY);
  if (!got || !Object.keys(got.prices).length) {
    console.error("No prices returned — keeping the previous snapshot untouched.");
    process.exit(1);
  }
  fs.writeFileSync(
    pricesPath,
    JSON.stringify({ asOf: got.asOf, source: `${PROVIDER} (end-of-day close)`, currency: "USD", prices: got.prices }, null, 2) + "\n"
  );
  console.log(`✅ ${Object.keys(got.prices).length}/${universe.size} closes as of ${got.asOf} (${PROVIDER})`);
}

main().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
