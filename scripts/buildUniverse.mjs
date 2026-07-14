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
const adrPath = path.join(dataDir, "universe.adr.json");
const DRYRUN = !!process.env.UNIVERSE_DRYRUN;
const MAX = Math.max(500, parseInt(process.env.UNIVERSE_MAX || "3000", 10) || 3000);
// The ADR pool is smaller and read for prominence, so a tighter cap by market value keeps it to the
// globally significant names (a TSMC or ASML, not a cross-listed micro-cap).
const ADR_MAX = Math.max(100, parseInt(process.env.ADR_MAX || "1000", 10) || 1000);

// Foreign issuers the Nasdaq screener mislabels as US-domiciled. Left in the US pool they trap in the
// 10-K pipeline (which cannot read their IFRS filings) and are then evicted from the ADR pool by the
// de-dup in main() — so they vanish from the catalog with no page. That is exactly how Thomson Reuters
// disappeared: a manual move to the ADR pool was silently undone by the next rebuild. Each name here
// files a 20-F or 40-F (verified against EDGAR), so it is pinned to the ADR pool by ticker with its
// home country for the label. Pinning in code makes the routing survive every rebuild.
const FORCE_ADR = new Map([
  ["AAUC", "Canada"], ["AERO", "Mexico"], ["AMBP", "Luxembourg"], ["AQN", "Canada"],
  ["AQNB", "Canada"], ["ARIS", "Canada"], ["AS", "Cayman Islands"], ["ASC", "Marshall Islands"],
  ["AUGO", "British Virgin Islands"], ["AVAL", "Colombia"], ["AZUL", "Brazil"], ["BBUC", "Canada"],
  ["BEPC", "Canada"], ["BIRK", "Jersey"], ["BLTE", "Cayman Islands"], ["BNT", "Bermuda"],
  ["BRSL", "United Kingdom"], ["BULL", "Cayman Islands"], ["BULLW", "Cayman Islands"], ["BWLP", "Singapore"],
  ["CAAP", "Luxembourg"], ["CDLR", "Denmark"], ["CEPU", "Argentina"], ["CINT", "Cayman Islands"],
  ["CMBT", "Belgium"], ["CMDB", "Marshall Islands"], ["CNL", "Canada"], ["DLO", "Cayman Islands"],
  ["DOX", "United Kingdom"], ["DSGX", "Canada"], ["ECO", "Marshall Islands"], ["FINV", "Cayman Islands"],
  ["FLNG", "Bermuda"], ["FTS", "Canada"], ["FVRR", "Israel"], ["GFS", "Cayman Islands"],
  ["GLAS", "Canada"], ["GLOB", "Spain"], ["GOOS", "Canada"], ["HAFN", "Bermuda"],
  ["HSHP", "Bermuda"], ["HSLV", "Canada"], ["HUYA", "Cayman Islands"], ["IFS", "Peru"],
  ["IPX", "Australia"], ["ISOU", "Canada"], ["ITRG", "Canada"], ["JBS", "Netherlands"],
  ["JMIA", "Germany"], ["KLAR", "United Kingdom"], ["KOF", "Mexico"], ["LEGN", "Cayman Islands"],
  ["LUXE", "Netherlands"], ["MICC", "Netherlands"], ["MSC", "British Virgin Islands"], ["MTA", "Canada"],
  ["NFGC", "Canada"], ["NIO", "Cayman Islands"], ["ONON", "Switzerland"], ["ORLA", "Canada"],
  ["PSFE", "Bermuda"], ["QNC", "Canada"], ["RSKD", "Israel"], ["RTO", "United Kingdom"],
  ["SE", "Cayman Islands"], ["SGHC", "Guernsey"], ["SII", "Canada"], ["SKE", "Canada"],
  ["SLSR", "Canada"], ["SMWB", "Israel"], ["SSYS", "Israel"], ["STN", "Canada"],
  ["STVN", "Italy"], ["SUPV", "Argentina"], ["TME", "Cayman Islands"], ["TRI", "Canada"],
  ["TTAM", "Belgium"], ["VIK", "Bermuda"], ["VLRS", "Mexico"], ["VTMX", "Mexico"],
  ["ZGN", "Netherlands"], ["ZIM", "Israel"],
]);

// Closed-end funds (BlackRock/Calamos/Gabelli/PIMCO): portfolios of securities, not operating
// businesses, so they do not belong in a catalog meant to be read "as an owner would." They file
// N-CSR, never a 10-K, so they never produced a scorecard — this only keeps them out of the input.
const EXCLUDE = new Set([
  "AEF", "AIO", "ASA", "BCAT", "BCX", "BDJ", "BGR", "BKT", "BLW", "BME", "BST", "BSTZ",
  "BTX", "BTZ", "CET", "CII", "CSQ", "DLY", "DSL", "ECAT", "ECCC", "ECCV", "ETB", "ETO",
  "ETV", "ETW", "EVN", "FMN", "FOF", "FRA", "FSCO", "FTHY", "GAB", "GAM", "GDV", "GUT",
  "HQH", "HQL", "IIM", "IQI", "KTF", "KYN", "LEO", "MCI", "MHD", "MIY", "MQY", "MUA",
  "MUC", "MUJ", "MYI", "NAN", "NCV", "NCZ", "NDMO", "NIE", "NMCO", "NXP", "OXLC", "OXLCL",
  "OXLCM", "OXLCN", "OXLCO", "OXLCZ", "PDI", "PDO", "PDX", "PMO", "PPT", "PSF", "PSUS", "PTA",
  "RFI", "RFMZ", "RMT", "RNP", "RQI", "RVT", "SDHY", "SOR", "TBLD", "TY", "TYG", "VCV",
  "VGM", "VKI", "VKQ", "VMO", "WHFCL", "XFLT",
]);
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
        signal: AbortSignal.timeout(60_000), // 60s timeout so a hung screener can't freeze the run
      });
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 1000 * a)); continue; } // back off on throttle, then retry
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
    if (FORCE_ADR.has(tk) || EXCLUDE.has(tk)) continue; // pinned to the ADR pool, or excluded outright
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

// The ADR universe, from the very same screener fetch: the rows the US parse drops — foreign
// companies listed on a US exchange. Because they are exchange-listed, they file Form 20-F with the
// SEC, so EDGAR carries their XBRL (in IFRS), and they self-maintain by market cap exactly like the
// US set. Country is kept, to label the pool and because it is what defines membership.
export function parseScreenerADR(json) {
  const rows = json?.data?.rows || json?.data?.table?.rows || [];
  const out = [];
  for (const r of rows) {
    const tk = String(r.symbol || "").trim().toUpperCase().replace(/[./]/g, "-");
    if (!/^[A-Z][A-Z-]{0,6}$/.test(tk)) continue;
    if (EXCLUDE.has(tk)) continue;
    const country = String(r.country || "").trim();
    const forced = FORCE_ADR.get(tk);
    if (!forced && (!country || country === "United States")) continue; // the ADRs are the non-US rows, plus the pinned foreign filers
    const cap = parseFloat(String(r.marketCap || "").replace(/[^0-9.]/g, ""));
    if (!(cap > 0)) continue;
    out.push({ ticker: tk, name: cleanName(r.name), cap, country: forced || country });
  }
  out.sort((a, b) => b.cap - a.cap);
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
  for (const [tk, nm] of curated) if (!merged.has(tk) && !FORCE_ADR.has(tk) && !EXCLUDE.has(tk)) { merged.set(tk, nm); extras++; }
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

  // The ADR pool, from the same validated payload: the top foreign-listed names by market cap, kept
  // distinct so the IFRS/20-F pipeline and the separate "ADRs" tab read from it. Curated ADR names
  // already on file are preserved and unioned in, the same as the US set, so nothing is lost on a
  // rebuild. Written only after the US payload passed its sanity gate above.
  const adrCurated = new Map(
    (() => { try { return JSON.parse(fs.readFileSync(adrPath, "utf8")).tickers || []; } catch { return []; } })()
      .map((t) => [String(t.ticker).toUpperCase(), t])
  );
  // The ADR bar is the US universe's own market-cap floor — a foreign name is in iff it is at least
  // as large as our smallest US name, so the two pools share one size standard rather than a separate
  // arbitrary cap. That is the honest reading of "the ADRs that belong in the same index." ADR_MAX
  // remains only as a safety ceiling in case the floor is ever implausibly low.
  const floorCap = floor.cap;
  const adrRanked = parseScreenerADR(raw);
  const adrTop = adrRanked.filter((r) => r.cap >= floorCap).slice(0, ADR_MAX);
  const adrMerged = new Map();
  for (const r of adrTop) adrMerged.set(r.ticker, { ticker: r.ticker, name: adrCurated.get(r.ticker)?.name ?? r.name ?? undefined, country: r.country });
  let adrExtras = 0;
  for (const [tk, t] of adrCurated) if (!adrMerged.has(tk) && !EXCLUDE.has(tk)) { adrMerged.set(tk, t); adrExtras++; }
  // A foreign-incorporated company that files a us-GAAP 10-K (Chubb, NXP, Garmin, Eaton…) is read by
  // the US pipeline and already lives in the US universe; drop it from the ADR pool so it isn't
  // double-listed in both catalogs. The ADR pool is for the IFRS/20-F filers the US side can't read.
  for (const tk of merged.keys()) adrMerged.delete(tk);
  const adrList = [...adrMerged.values()]
    .sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0))
    .map((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v != null)));
  console.log(`  ADR pool: ${adrList.length} foreign-listed names (cap ≥ US floor $${(floorCap / 1e9).toFixed(2)}B → ${adrTop.length}, ${adrExtras} curated extras kept)`);
  if (!DRYRUN && adrList.length) {
    fs.writeFileSync(adrPath, JSON.stringify({
      note: `ADR universe: foreign companies listed on US exchanges (Nasdaq screener, non-US rows) with market cap at least the US universe's floor — i.e. as large as the smallest US name we cover. They file Form 20-F with the SEC; read in IFRS/US-GAAP by the ADR pipeline. Rebuilt via scripts/buildUniverse.mjs.`,
      tickers: adrList,
    }, null, 2) + "\n");
    console.log(`  ✅ wrote universe.adr.json with ${adrList.length} ADRs`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`\n❌ ${err.message}\n`); process.exit(1); });
}
