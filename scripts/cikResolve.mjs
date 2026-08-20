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

// Pinned fetch, not the global: newer node builds bundle an undici (6.26+) whose socket teardown
// asserts the process to death mid-parse (nodejs/undici#5360). See fetchWire.mjs for the full story.
import { fetch } from "undici";

const SEC_UA = process.env.SEC_USER_AGENT || "OwnerScorecard research hello@ownerscorecard.com";

// Tickers SEC's own map resolves to the WRONG entity, verified case by case against companyfacts:
//  - FI: Fiserv, filed as FISV before its 2023 rename; EDGAR's ticker index lags.
//  - XOM: SEC maps XOM to CIK 2115436, an empty reorg shell with no annual financials; the real
//    Exxon Mobil record (Revenues FY2011-2025, latest $332B) lives under the classic CIK 34088.
export const CIK_OVERRIDE = { FI: "0000798354", XOM: "0000034088" };

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
    // 30s timeout (this was the one wire-path fetch with none — a hung lookup froze the run) and a
    // body discharge on the miss path, so an abandoned response can't park a paused parser on the socket.
    const res = await fetch(
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(T)}&type=10-K&count=1&output=atom`,
      { headers: { "User-Agent": SEC_UA }, signal: AbortSignal.timeout(30_000) },
    );
    if (res.ok) {
      const xml = await res.text();
      const m = xml.match(/CIK=(\d+)/i) || xml.match(/<cik>(\d+)<\/cik>/i);
      if (m) cik = m[1].padStart(10, "0");
    } else {
      await res.body?.cancel().catch(() => {});
    }
  } catch {
    /* leave null — caller skips exactly as it did before this fallback existed */
  }
  liveCache.set(T, cik);
  return cik;
}
