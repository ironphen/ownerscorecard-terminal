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
import { buildCikMap, resolveCikLive, CIK_OVERRIDE } from "./cikResolve.mjs";
import { probeRoute } from "./formType.mjs";
// Pinned fetch, not the global: newer node builds bundle an undici (6.26+) whose socket teardown
// asserts the process to death mid-parse (nodejs/undici#5360). See fetchWire.mjs for the full story.
import { fetch } from "undici";

const dataDir = path.join(process.cwd(), "src", "data");
const universePath = path.join(dataDir, "universe.json");
const adrPath = path.join(dataDir, "universe.adr.json");
// The form-type route cache: ticker → { route, country, form, date, checked }, seeded from EDGAR and
// refreshed incrementally so a rebuild probes only the names it hasn't seen (or hasn't re-checked in a
// while), not the whole universe every month.
const routesPath = path.join(dataDir, "formRoutes.json");
const ROUTE_TTL_DAYS = 150; // re-probe a cached route this stale, to catch a filer that changed form
const SEC_UA = process.env.SEC_USER_AGENT || "OwnerScorecard research hello@ownerscorecard.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DRYRUN = !!process.env.UNIVERSE_DRYRUN;
const MAX = Math.max(500, parseInt(process.env.UNIVERSE_MAX || "3000", 10) || 3000);
// The ADR pool is smaller and read for prominence, so a tighter cap by market value keeps it to the
// globally significant names (a TSMC or ASML, not a cross-listed micro-cap).
const ADR_MAX = Math.max(100, parseInt(process.env.ADR_MAX || "1000", 10) || 1000);

// Manual ADR pins — an explicit override of last resort, highest priority in classifyRows. This used
// to hold ~82 foreign issuers the Nasdaq screener mislabels as US-domiciled (Thomson Reuters read
// "United States"), each hand-verified to file a 20-F/40-F and pinned so it wasn't trapped in the 10-K
// pipeline. The form-type router (scripts/formType.mjs) now derives that routing from EDGAR for every
// name and caches it (src/data/formRoutes.json), so all of those pins became redundant — a rebuild
// routes them from their actual filed form, no hand-maintenance. The map is kept (empty) for the one
// class the probe can't settle on its own: a ticker whose EDGAR CIK lookup resolves to the WRONG entity
// (a merger-CIK tangle), where the filed form read would be for the wrong company. Add such a name here
// with its home country if one ever surfaces; otherwise routing is self-maintaining.
const FORCE_ADR = new Map([]);

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
      // An abandoned body leaves undici's parser paused on a live socket — the exact state whose
      // teardown crashes the process — so every early exit discharges it first.
      if (res.status === 429) { await res.body?.cancel().catch(() => {}); await new Promise((r) => setTimeout(r, 1000 * a)); continue; } // back off on throttle, then retry
      if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`HTTP ${res.status}`); }
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

// A readable place name for a country chip: has a lowercase letter and real length, and is not a bare
// EDGAR code or a truncated stub ("British", "Republic of"). Rejects a cache country that isn't a clean
// name, so the screener country (or no chip) is shown instead of garbage.
const readableCountry = (c) => !!c && /[a-z]/.test(c) && c.length > 3 && !/^(british|republic of|federal level)$/i.test(c);

// Partition the screener payload into the US and ADR pools. Tickers are normalized to the SEC's dash
// form (BRK/B or BRK.B -> BRK-B); preferred/warrant/unit/when-issued symbols are dropped; unpriced rows
// are dropped (they can't be ranked); closed-end funds are excluded outright; each list is sorted by
// descending market cap and de-duped (dual classes can collide after normalization), keeping the larger.
//
// The route for each row, in priority order:
//   1. FORCE_ADR — an explicit pin, for the few edge cases the form probe can't resolve (a merger-CIK
//      tangle where EDGAR's ticker→CIK points at the wrong entity);
//   2. routeMap — the AUTHORITATIVE form-type route (20-F/40-F → ADR, 10-K → US) from formType.mjs,
//      which routes a foreign filer correctly however the screener labels its country;
//   3. the screener country — the original signal, used only where the probe had no answer, so an
//      empty routeMap reproduces exactly the old country split (what the pure wrappers below expose).
// The ADR country label prefers EDGAR's authoritative country, then the screener's, then the FORCE_ADR
// pin — so a name the screener mislabels "United States" still carries its real home country.
export function classifyRows(json, routeMap = new Map()) {
  const rows = json?.data?.rows || json?.data?.table?.rows || [];
  const us = [], adr = [];
  for (const r of rows) {
    const tk = String(r.symbol || "").trim().toUpperCase().replace(/[./]/g, "-");
    if (!/^[A-Z][A-Z-]{0,6}$/.test(tk)) continue; // a plain equity symbol (drops ^ = etc.)
    if (EXCLUDE.has(tk)) continue; // closed-end funds: never in either pool
    const cap = parseFloat(String(r.marketCap || "").replace(/[^0-9.]/g, ""));
    if (!(cap > 0)) continue; // unpriced rows can't be ranked
    const name = cleanName(r.name);
    const screenerCountry = String(r.country || "").trim();
    const routed = routeMap.get(tk);
    let route, country;
    if (FORCE_ADR.has(tk)) { route = "ADR"; country = FORCE_ADR.get(tk); }
    else if (routed?.route) {
      route = routed.route;
      // The ADR chip's country: the screener's foreign country is the proven-good label (it built the
      // shipped pool), so it wins; the probed EDGAR country only fills a name the screener mislabels
      // "United States" (a trapped filer), and only when it is a readable place name — never a raw code.
      const screenerForeign = screenerCountry && screenerCountry !== "United States" ? screenerCountry : null;
      country = screenerForeign || (readableCountry(routed.country) ? routed.country : null);
    }
    else { route = (!screenerCountry || screenerCountry === "United States") ? "US" : "ADR"; country = screenerCountry || null; }
    if (route === "US") us.push({ ticker: tk, name, cap });
    else adr.push({ ticker: tk, name, cap, country: country || null });
  }
  const dedup = (arr) => {
    arr.sort((a, b) => b.cap - a.cap);
    const seen = new Set();
    return arr.filter((x) => (seen.has(x.ticker) ? false : (seen.add(x.ticker), true)));
  };
  return { us: dedup(us), adr: dedup(adr) };
}

// The pure country-split parsers the offline test exercises: classifyRows with no route map is exactly
// the old behaviour (the screener country decides), so these stay a faithful, network-free fallback.
export function parseScreener(json) { return classifyRows(json).us; }
export function parseScreenerADR(json) { return classifyRows(json).adr; }

// SEC's two static ticker files, for the CIK map the route probe needs. Fail-soft: a fetch problem
// returns null and the caller proceeds with whatever resolves (an empty map → the country fallback).
async function fetchSecJson(url) {
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": SEC_UA }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 429) { await res.body?.cancel().catch(() => {}); await sleep(800 * a); continue; }
      if (!res.ok) { await res.body?.cancel().catch(() => {}); return null; }
      return await res.json();
    } catch { await sleep(400 * a); }
  }
  return null;
}

const loadRoutesCache = () => { try { return JSON.parse(fs.readFileSync(routesPath, "utf8")).routes || {}; } catch { return {}; } };
function saveRoutesCache(routes) {
  const ordered = Object.fromEntries(Object.keys(routes).sort().map((k) => [k, routes[k]]));
  fs.writeFileSync(routesPath, JSON.stringify({
    note: "Form-type route cache for the US/ADR split (see scripts/formType.mjs): ticker → the pipeline its most recent SEC annual report routes it to (10-K → US, 20-F/40-F → ADR), with the EDGAR country for the ADR label. Seeded from EDGAR and refreshed incrementally by scripts/buildUniverse.mjs; safe to delete (it rebuilds).",
    routes: ordered,
  }, null, 2) + "\n");
}

// Every priced equity row's ticker + cap (cap-sorted), for choosing which names to route: both pools'
// membership is decided at the top by market value, so routes are resolved for everything down to the
// US floor and no further.
function rowTickersByCap(json) {
  const rows = json?.data?.rows || json?.data?.table?.rows || [];
  const out = [];
  for (const r of rows) {
    const tk = String(r.symbol || "").trim().toUpperCase().replace(/[./]/g, "-");
    if (!/^[A-Z][A-Z-]{0,6}$/.test(tk) || EXCLUDE.has(tk)) continue;
    const cap = parseFloat(String(r.marketCap || "").replace(/[^0-9.]/g, ""));
    if (cap > 0) out.push({ ticker: tk, cap });
  }
  return out.sort((a, b) => b.cap - a.cap);
}

// Resolve each candidate ticker to a route, from cache where fresh, else by probing EDGAR (throttled to
// stay well under the SEC rate limit). Returns Map<ticker, {route, country}> for the names that
// resolved; the rest fall back to the screener country in classifyRows. Fail-soft per name: a probe
// miss leaves the name unrouted (country decides), never mis-routed.
async function resolveRoutes(tickers, cache, cikMap) {
  const now = new Date();
  const fresh = (e) => e && e.route && e.checked && (now - new Date(e.checked)) / 86_400_000 <= ROUTE_TTL_DAYS;
  const map = new Map();
  let probed = 0, unresolved = 0, adrCount = 0;
  for (const tk of tickers) {
    let entry = cache[tk];
    if (!fresh(entry)) {
      let cik = CIK_OVERRIDE[tk] || cikMap[tk];
      if (!cik) { await sleep(120); cik = await resolveCikLive(tk); }
      if (cik) {
        await sleep(120);
        const r = await probeRoute(cik);
        if (r.route) { entry = { route: r.route, country: r.country || null, form: r.form, date: r.date, checked: now.toISOString().slice(0, 10) }; cache[tk] = entry; probed++; }
        else { unresolved++; } // keep any prior cache entry; otherwise it stays unrouted → country fallback
      } else unresolved++;
    }
    if (entry?.route) { map.set(tk, { route: entry.route, country: entry.country || null }); if (entry.route === "ADR") adrCount++; }
  }
  console.log(`  form-type routes: ${map.size} resolved (${adrCount} ADR, ${probed} freshly probed this run, ${unresolved} unresolved → screener country)`);
  return map;
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

  // Curated ADR names on file (loaded here, before routing, for two reasons: their routes must be
  // resolved alongside the screener candidates below so a re-routed one is never stranded, and a name
  // the router sends to US is carried into the US merge rather than dropped from both pools).
  const adrCurated = new Map(
    (() => { try { return JSON.parse(fs.readFileSync(adrPath, "utf8")).tickers || []; } catch { return []; } })()
      .map((t) => [String(t.ticker).toUpperCase(), t])
  );

  // Payload validated. Resolve authoritative form-type routes and re-split the same payload: a foreign
  // filer the screener mislabels "United States" moves to the ADR pool (Thomson Reuters), and a foreign-
  // incorporated 10-K filer mislabeled by its charter country moves to the US pool (Accenture) — so new
  // trapped filers self-correct without a hand-added FORCE_ADR pin. Fail-soft: any failure leaves
  // routeMap empty and classifyRows falls back to the screener country, i.e. the split just validated.
  let routeMap = new Map();
  const routesCache = loadRoutesCache();
  try {
    const [mainJson, exchJson] = await Promise.all([
      fetchSecJson("https://www.sec.gov/files/company_tickers.json"),
      fetchSecJson("https://www.sec.gov/files/company_tickers_exchange.json"),
    ]);
    const cikMap = buildCikMap(mainJson, exchJson);
    // Resolve routes down to the US floor and no further (both pools' membership is decided above it).
    // Fall back to the smallest ranked name when the US list is shorter than MAX, so a short list never
    // collapses the floor to 0 and probes the entire screener. Union in every curated ADR name too: some
    // are absent from the current screener view (it lists them under another country, or drops them), so
    // their route must be resolved from the cache or the US-carry below can't see it and strands them.
    const provFloorCap = (ranked[MAX - 1] ?? ranked[ranked.length - 1])?.cap ?? 0;
    const candidates = [...new Set([
      ...rowTickersByCap(raw).filter((r) => r.cap >= provFloorCap).map((r) => r.ticker),
      ...adrCurated.keys(),
    ])];
    console.log(`  resolving form-type routes for ${candidates.length} names (cap ≥ $${(provFloorCap / 1e9).toFixed(2)}B)…`);
    routeMap = await resolveRoutes(candidates, routesCache, cikMap);
    if (!DRYRUN) saveRoutesCache(routesCache);
  } catch (err) {
    console.warn(`  ! form-type routing unavailable (${err.message}); using the screener country split`);
  }
  let split = classifyRows(raw, routeMap);
  // Routing must never drop a bellwether from the US pool — that would mean a cache-poisoned or mis-probed
  // anchor (a US mega-cap routed to ADR). If it does, the route map is untrustworthy, so discard it and
  // fall back to the plain country split for this run; the anchors are all domestic 10-K filers that the
  // country split keeps in the US pool. The re-split cannot itself drop them, so this can't loop.
  const routedUS = new Set(split.us.map((r) => r.ticker));
  const droppedAnchors = SANITY.filter((s) => !routedUS.has(s));
  if (droppedAnchors.length) {
    console.warn(`  ! form-type routing dropped sanity anchor(s) ${droppedAnchors.join("/")} from US — reverting to the country split for this run`);
    routeMap = new Map();
    split = classifyRows(raw);
  }
  ranked = split.us;
  console.log(`  after form-type routing: ${ranked.length} US, ${split.adr.length} ADR candidates`);

  const top = ranked.slice(0, MAX);
  const floor = top[top.length - 1];

  // Union: the top N by market cap, plus any curated name not in that set (so curated additions
  // are never dropped). Keep a curated display name where we have one; otherwise carry the
  // screener's cleaned name, falling back at fetch time to EDGAR's title-cased entity name.
  // A curated name the form probe now routes to ADR is NOT re-pinned here — otherwise a foreign filer
  // already sitting (trapped) in universe.json would be held in the US pool by its own curated entry,
  // defeating the very re-route this phase exists to make. It flows to the ADR pool below instead.
  const merged = new Map();
  for (const r of top) merged.set(r.ticker, curated.get(r.ticker) ?? r.name ?? null);
  let extras = 0;
  for (const [tk, nm] of curated) if (!merged.has(tk) && !FORCE_ADR.has(tk) && !EXCLUDE.has(tk) && routeMap.get(tk)?.route !== "ADR") { merged.set(tk, nm); extras++; }
  // A curated ADR name the router now sends to US must not fall through both pools: the ADR extras loop
  // will skip it (route==="US") and it isn't in the US curated list, so without this it would be written
  // to NEITHER universe and silently lose its page. Carry it into the US pool here (below the cap floor,
  // as a curated extra — the fetcher's quality floor still withholds a non-readable one), so the invariant
  // "a curated name is never dropped" holds through the re-route. This is the ADR→US mirror of the skip above.
  let usFromAdr = 0;
  for (const [tk, t] of adrCurated) if (!merged.has(tk) && !EXCLUDE.has(tk) && routeMap.get(tk)?.route === "US") { merged.set(tk, t.name ?? null); usFromAdr++; }
  const list = [...merged.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([ticker, name]) => (name ? { ticker, name } : { ticker }));

  console.log(`  merged universe: ${list.length} tickers (top ${top.length} by market cap, ${extras} curated extras, ${usFromAdr} re-routed from the ADR pool)`);
  console.log(`  market-cap floor at rank ${top.length}: ${floor.ticker} ~$${(floor.cap / 1e9).toFixed(2)}B`);
  if (DRYRUN) { console.log("  DRYRUN: not writing universe.json."); return; }

  const out = {
    note: `US universe: the largest investable US companies by market cap (Nasdaq screener, top ${MAX}) merged with curated additions. Display names from EDGAR where not curated. Rebuilt via scripts/buildUniverse.mjs.`,
    tickers: list,
  };
  fs.writeFileSync(universePath, JSON.stringify(out, null, 2) + "\n");
  console.log(`  ✅ wrote universe.json with ${list.length} tickers`);

  // The ADR pool, from the same validated payload: the top foreign-listed names by market cap, kept
  // distinct so the IFRS/20-F pipeline and the separate "ADRs" tab read from it. adrCurated (loaded
  // above, before the US merge) is preserved and unioned in, the same as the US set, so nothing is lost
  // on a rebuild. Written only after the US payload passed its sanity gate above.
  // The ADR bar is the US universe's own market-cap floor — a foreign name is in iff it is at least
  // as large as our smallest US name, so the two pools share one size standard rather than a separate
  // arbitrary cap. That is the honest reading of "the ADRs that belong in the same index." ADR_MAX
  // remains only as a safety ceiling in case the floor is ever implausibly low.
  const floorCap = floor.cap;
  const adrRanked = split.adr;
  const adrTop = adrRanked.filter((r) => r.cap >= floorCap).slice(0, ADR_MAX);
  const adrMerged = new Map();
  for (const r of adrTop) adrMerged.set(r.ticker, { ticker: r.ticker, name: adrCurated.get(r.ticker)?.name ?? r.name ?? undefined, country: r.country });
  let adrExtras = 0;
  for (const [tk, t] of adrCurated) if (!adrMerged.has(tk) && !EXCLUDE.has(tk) && routeMap.get(tk)?.route !== "US") { adrMerged.set(tk, t); adrExtras++; }
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
