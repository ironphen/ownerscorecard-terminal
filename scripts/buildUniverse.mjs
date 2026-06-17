#!/usr/bin/env node
// Expands the US universe (src/data/universe.json) toward the investable Russell 3000, sourced
// from the iShares Russell 3000 ETF (IWV) holdings — the canonical constituent list, free. With
// no price feed of our own, index membership is how we define "investable" without market cap.
//
// Safety first: the fetched list is validated before it is allowed to overwrite anything (a
// minimum count and a set of sanity anchors that must be present), and a failed or implausible
// fetch leaves the existing universe untouched and exits 0, so the weekly data refresh still
// runs on the last good universe. It can never corrupt the pipeline's input.
//
//   node scripts/buildUniverse.mjs                     # fetch, validate, write
//   UNIVERSE_DRYRUN=1 node scripts/buildUniverse.mjs   # fetch + report only, no write

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dataDir = path.join(process.cwd(), "src", "data");
const universePath = path.join(dataDir, "universe.json");
const DRYRUN = !!process.env.UNIVERSE_DRYRUN;
const UA = process.env.UNIVERSE_USER_AGENT ||
  "Mozilla/5.0 (compatible; OwnerScorecardBot/1.0; +https://ownerscorecard.com)";

// iShares Russell 3000 (IWV) holdings CSV — ~3,000 constituents.
const IWV =
  "https://www.ishares.com/us/products/239714/ishares-russell-3000-etf/1467271812596.ajax?fileType=csv&fileName=IWV_holdings&dataType=fund";
// A parsed list missing any of these mega-caps is malformed and is rejected outright.
const SANITY = ["AAPL", "MSFT", "AMZN", "JPM", "XOM", "JNJ"];
const MIN_TICKERS = 2500;

async function fetchText(url) {
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (a === 4) throw err;
      await new Promise((r) => setTimeout(r, 600 * a));
    }
  }
}

// A minimal RFC-4180-ish field splitter (the holdings CSV quotes fields containing commas).
export function splitCsv(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const cleanName = (s) => { const t = (s || "").trim(); return t && t.length <= 40 ? t : null; };

// Parse the iShares holdings CSV: a preamble, a header row that begins with "Ticker", then the
// rows. Equity holdings only (drops the cash/derivatives line), ticker normalized to the SEC's
// dash form (BRK.B -> BRK-B), and anything that isn't a plain symbol dropped.
export function parseHoldings(csv) {
  const rows = csv.split(/\r?\n/);
  const h = rows.findIndex((r) => /^"?Ticker"?\s*,/.test(r));
  if (h < 0) return [];
  const header = splitCsv(rows[h]).map((s) => s.replace(/"/g, "").trim().toLowerCase());
  const iTicker = header.indexOf("ticker");
  const iName = header.indexOf("name");
  const iClass = header.findIndex((s) => s.includes("asset class"));
  if (iTicker < 0) return [];
  const out = [];
  for (let i = h + 1; i < rows.length; i++) {
    if (!rows[i].trim()) continue;
    const cells = splitCsv(rows[i]).map((c) => c.replace(/^"|"$/g, ""));
    const tk = (cells[iTicker] || "").trim().toUpperCase();
    if (!/^[A-Z][A-Z.\-]{0,6}$/.test(tk)) continue; // a plain equity symbol
    if (iClass >= 0) { const cls = (cells[iClass] || "").trim().toLowerCase(); if (cls && cls !== "equity") continue; }
    out.push({ ticker: tk.replace(/\./g, "-"), name: iName >= 0 ? cleanName(cells[iName]) : null });
  }
  return out;
}

async function main() {
  const existing = JSON.parse(fs.readFileSync(universePath, "utf8"));
  const curated = new Map((existing.tickers || []).map((t) => [String(t.ticker).toUpperCase(), t.name || null]));
  console.log(`Building US universe (existing: ${curated.size} tickers)…`);

  let holdings = [];
  try {
    holdings = parseHoldings(await fetchText(IWV));
    console.log(`  iShares IWV: parsed ${holdings.length} equity holdings`);
  } catch (err) {
    console.warn(`  ! IWV fetch/parse failed: ${err.message}`);
  }

  const set = new Set(holdings.map((h) => h.ticker));
  const sane = SANITY.every((s) => set.has(s));
  if (holdings.length < MIN_TICKERS || !sane) {
    console.warn(`  ! constituent list rejected (${holdings.length} tickers, min ${MIN_TICKERS}; sanity ${sane ? "ok" : "FAILED, missing " + SANITY.filter((s) => !set.has(s)).join("/")}).`);
    console.warn(`    Keeping the existing universe of ${curated.size} untouched; the pipeline runs on it.`);
    process.exit(0); // non-fatal
  }

  // Union: every index member, plus any curated name not in the index (so curated extras are
  // never dropped). Keep the curated display name where we have one; otherwise carry no name, so
  // the fetch falls back to EDGAR's entity name title-cased (nicer than the index's ALL-CAPS).
  const merged = new Map();
  for (const h of holdings) merged.set(h.ticker, curated.get(h.ticker) ?? null);
  let extras = 0;
  for (const [tk, nm] of curated) if (!merged.has(tk)) { merged.set(tk, nm); extras++; }
  const list = [...merged.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([ticker, name]) => (name ? { ticker, name } : { ticker }));

  console.log(`  merged universe: ${list.length} tickers (${holdings.length} from the index, ${extras} curated extras kept)`);
  if (DRYRUN) { console.log("  DRYRUN: not writing universe.json."); return; }

  const out = {
    note: "US universe: investable names (iShares Russell 3000 / IWV holdings) merged with curated additions. Display names from EDGAR where not curated. Rebuilt via scripts/buildUniverse.mjs.",
    tickers: list,
  };
  fs.writeFileSync(universePath, JSON.stringify(out, null, 2) + "\n");
  console.log(`  ✅ wrote universe.json with ${list.length} tickers`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`\n❌ ${err.message}\n`); process.exit(1); });
}
