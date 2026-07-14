// Layered ticker → CIK resolution.
//
// SEC's static company_tickers.json is the primary map, but it is INCOMPLETE: it silently omits
// active large-caps (Marsh McLennan, Coterra, Exact Sciences, Hologic, Pure Storage, Kellanova…)
// and lags ticker renames. Keyed on it alone, those names resolve to "no CIK" and drop out of the
// catalog with no page — which is how mega-caps went missing. This layers three fallbacks:
//   1. the exchange file (company_tickers_exchange.json), which carries a few the main file drops;
//   2. a live EDGAR ticker lookup (browse-edgar), which resolves essentially any active ticker;
//   3. a tiny curated override for renames even the live lookup misses.
// Every layer fails soft: an unresolved ticker returns null and the caller skips it exactly as
// before, so a lookup outage can never corrupt the run — it only reverts to the old behaviour.
//
// Live lookups cache per process, so a full refresh makes only a handful of extra requests (one per
// name the static files lack); the overwhelming majority resolve from the static map with no network.

const SEC_UA = process.env.SEC_USER_AGENT || "OwnerScorecard research hello@ownerscorecard.com";

// Renamed tickers even EDGAR's own ticker index has not caught up to. CIK verified via the prior
// ticker (Fiserv filed as FISV before its 2023 rename to FI).
export const CIK_OVERRIDE = { FI: "0000798354" };

// Merge SEC's two ticker files into one upper-case-ticker → 10-digit-CIK map. The exchange file only
// fills gaps the main file leaves (main wins on any overlap).
export function buildCikMap(mainJson, exchJson) {
  const map = {};
  for (const r of Object.values(mainJson || {})) {
    if (r?.ticker && r.cik_str != null) map[String(r.ticker).toUpperCase()] = String(r.cik_str).padStart(10, "0");
  }
  if (exchJson?.fields && Array.isArray(exchJson.data)) {
    const ti = exchJson.fields.indexOf("ticker"), ci = exchJson.fields.indexOf("cik");
    if (ti >= 0 && ci >= 0) for (const row of exchJson.data) {
      const t = String(row[ti] || "").toUpperCase();
      if (t && !map[t] && row[ci] != null) map[t] = String(row[ci]).padStart(10, "0");
    }
  }
  return map;
}

const liveCache = new Map();
// Live EDGAR ticker → CIK for names absent from the static files. Fail-soft: any error or miss
// yields null. The company header in the atom carries CIK= regardless of whether the type filter
// matches a filing, so this resolves active tickers even when the exact form differs.
export async function resolveCikLive(ticker) {
  const T = ticker.toUpperCase();
  if (liveCache.has(T)) return liveCache.get(T);
  let cik = null;
  try {
    const res = await fetch(
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(T)}&type=10-K&count=1&output=atom`,
      { headers: { "User-Agent": SEC_UA } },
    );
    if (res.ok) {
      const xml = await res.text();
      const m = xml.match(/CIK=(\d+)/i) || xml.match(/<cik>(\d+)<\/cik>/i);
      if (m) cik = m[1].padStart(10, "0");
    }
  } catch {
    /* leave null — caller skips exactly as it did before this fallback existed */
  }
  liveCache.set(T, cik);
  return cik;
}
