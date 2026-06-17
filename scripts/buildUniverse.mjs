#!/usr/bin/env node
// Expands the US universe (src/data/universe.json) to the largest investable US companies,
// sourced from the Nasdaq stock screener — the canonical free listing that carries market cap.
// With no price feed of our own, "investable" is defined as the top N by market value, which is
// both more principled and more honest than borrowing a third-party index: as companies list,
// grow, shrink, or delist, the top-N set follows on its own, so the universe self-maintains.
//
// (iShares/BlackRock answers GitHub runners with a datacenter-IP block page — a 200 labelled
// text/csv whose body is marketing HTML — so it cannot be used from CI. The Nasdaq screener
// answers with real JSON, and the SEC's own list is the reachable fallback if it ever stops.)
//
// Safety first: the fetched list is validated before it is allowed to overwrite anything (a
// minimum count and a set of mega-cap sanity anchors that must be present), and a failed or
// implausible fetch leaves the existing universe untouched and exits 0, so the weekly data
// refresh still runs on the last good universe. It can never corrupt the pipeline's input.
//
//   node scripts/buildUniverse.mjs                     # fetch, validate, write
//   UNIVERSE_DRYRUN=1 node scripts/buildUniverse.mjs   # fetch + report only, no write
//   UNIVERSE_MAX=3000 node scripts/buildUniverse.mjs   # how many top names to keep (default 3000)

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dataDir = path.join(process.cwd(), "src", "data");
const universePath = path.join(dataDir, "universe.json");
const DRYRUN = !!process.env.UNIVERSE_DRYRUN;
const MAX = Math.max(500, parseInt(process.env.UNIVERSE_MAX || "3000", 10) || 3000);
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// The Nasdaq screener: every US-listed common stock with market cap, in one JSON download.
const NASDAQ =
  "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true";
// A parsed list missing any of these mega-caps is malformed and is rejected outright.
const SANITY = ["AAPL", "MSFT", "AMZN", "JPM", "XOM", "JNJ"];
const MIN_TICKERS = 2500;

async function fetchJson(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.nasdaq.com/",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (a === 4) throw err;
      await new Promise((r) => setTimeout(r, 600 * a));
    }
  }
}

// The screener appends a security descriptor to the issuer name ("Apple Inc. Common Stock");
// strip it for a clean display name, and drop anything implausibly long.
const cleanName = (s) => {
  const t = String(s || "")
    .replace(/\s+(common stock|common shares|ordinary shares|class [a-z] (common stock|ordinary shares)|american depositary shares.*|depositary shares.*|warrant.*|unit.*)$/i, "")
    .trim();
  return t && t.length <= 40 ? t : null;
};

// Parse the screener payload into ranked US common-stock rows. Tickers are normalized to the
// SEC's dash form (BRK/B or BRK.B -> BRK-B); preferred/warrant/unit/when-issued symbols and
// explicitly non-US rows are dropped; unpriced rows are dropped (they can't be ranked); the
// result is sorted by descending market cap so the caller can keep the top N.
export function parseScreener(json) {
  const rows = json?.data?.rows || json?.data?.table?.rows || [];
  const out = [];
  for (const r of rows) {
    let tk = String(r.symbol || "").trim().toUpperCase().replace(/[./]/g, "-");
    if (!/^[A-Z][A-Z-]{0,6}$/.test(tk)) continue; // a plain equity symbol (drops ^ = etc.)
    const country = String(r.country || "").trim();
    if (country && country !== "United States") continue; // keep the US universe US
    const cap = parseFloat(String(r.marketCap || "").replace(/[^0-9.]/g, ""));
    if (!(cap > 0)) continue; // unpriced rows can't be ranked
    out.push({ ticker: tk, name: cleanName(r.name), cap });
  }
  out.sort((a, b) => b.cap - a.cap);
  // De-dupe (dual classes can collide after normalization), keeping the larger cap.
  const seen = new Set();
  return out.filter((r) => (seen.has(r.ticker) ? false : (seen.add(r.ticker), true)));
}

async function main() {
  const existing = JSON.parse(fs.readFileSync(universePath, "utf8"));
  const curated = new Map((existing.tickers || []).map((t) => [String(t.ticker).toUpperCase(), t.name || null]));
  console.log(`Building US universe (existing: ${curated.size} tickers; target top ${MAX})…`);

  let ranked = [];
  let raw = null;
  try {
    raw = await fetchJson(NASDAQ);
    ranked = parseScreener(raw);
    console.log(`  Nasdaq screener: ${ranked.length} ranked US common stocks`);
  } catch (err) {
    console.warn(`  ! Nasdaq fetch/parse failed: ${err.message}`);
  }

  const set = new Set(ranked.map((r) => r.ticker));
  const sane = SANITY.every((s) => set.has(s));
  if (ranked.length < MIN_TICKERS || !sane) {
    console.warn(`  ! constituent list rejected (${ranked.length} tickers, min ${MIN_TICKERS}; sanity ${sane ? "ok" : "FAILED, missing " + SANITY.filter((s) => !set.has(s)).join("/")}).`);
    // If a payload arrived but didn't parse, surface its shape so a format drift is self-evident.
    if (raw) {
      const rows = raw?.data?.rows || raw?.data?.table?.rows || [];
      console.warn(`    payload: data keys=[${Object.keys(raw.data || {}).join(",")}], rows=${rows.length}; sample=${JSON.stringify(rows[0] || {}).slice(0, 180)}`);
    }
    console.warn(`    Keeping the existing universe of ${curated.size} untouched; the pipeline runs on it.`);
    process.exit(0); // non-fatal
  }

  const top = ranked.slice(0, MAX);
  const floor = top[top.length - 1];

  // Union: the top N by market cap, plus any curated name not in that set (so curated additions
  // are never dropped). Keep a curated display name where we have one; otherwise carry the
  // screener's cleaned name, falling back at fetch time to EDGAR's title-cased entity name.
  const merged = new Map();
  for (const r of top) merged.set(r.ticker, curated.get(r.ticker) ?? r.name ?? null);
  let extras = 0;
  for (const [tk, nm] of curated) if (!merged.has(tk)) { merged.set(tk, nm); extras++; }
  const list = [...merged.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([ticker, name]) => (name ? { ticker, name } : { ticker }));

  console.log(`  merged universe: ${list.length} tickers (top ${top.length} by market cap, ${extras} curated extras kept)`);
  console.log(`  market-cap floor at rank ${top.length}: ${floor.ticker} ~$${(floor.cap / 1e9).toFixed(2)}B`);
  if (DRYRUN) { console.log("  DRYRUN: not writing universe.json."); return; }

  const out = {
    note: `US universe: the largest investable US companies by market cap (Nasdaq screener, top ${MAX}) merged with curated additions. Display names from EDGAR where not curated. Rebuilt via scripts/buildUniverse.mjs.`,
    tickers: list,
  };
  fs.writeFileSync(universePath, JSON.stringify(out, null, 2) + "\n");
  console.log(`  ✅ wrote universe.json with ${list.length} tickers`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`\n❌ ${err.message}\n`); process.exit(1); });
}
