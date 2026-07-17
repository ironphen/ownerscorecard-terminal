// compareKey.mjs — the ONE place that assigns each company its compare-card identity.
//
// Compare cards live at /compare/<key>.json and every column, chip, ?c= deep-link and search row is
// keyed by the same string. The universe spans four pools (US, ADR, JP, Europe) that share a flat
// ticker space, and a dozen tickers collide across it: AIR is both AAR Corp (US) and Airbus (EU); BA
// is Boeing (US) and BAE Systems (EU); EL, DG, AI, BC, RR, ORA, UCB, AD, BN, SU likewise. Keying the
// card purely by ticker made the FIRST pool win and silently dropped the homonym, so Airbus served
// AAR's record — a wrong company, the worst thing this site can do.
//
// The rule: the first pool to claim a ticker (US → ADR → JP → EU) keeps the bare ticker as its key;
// any later pool with the same ticker is suffixed ".<POOL>" (Airbus becomes AIR.EU while AAR stays
// AIR). Because US/ADR/JP always precede EU, only the real EU homonyms are ever suffixed — every
// existing card URL, bookmark and ?c= link is preserved, and each company now resolves to itself.
//
// Build-time only (imports the data files). Every build-time surface — the card endpoint, the search
// index, the compare page frontmatter, CompareLink — imports from here so no two ever disagree.
import fundamentals from "../data/fundamentals.json" with { type: "json" };
import adrData from "../data/fundamentals.adr.json" with { type: "json" };
import jpData from "../data/fundamentals.jp.json" with { type: "json" };
import euData from "../data/fundamentals.eu.json" with { type: "json" };

export const POOL_ORDER = ["US", "ADR", "JP", "EU"];

const POOLS = {
  US: fundamentals.companies || [],
  ADR: adrData.companies || [],
  JP: jpData.companies || [],
  EU: euData.companies || [],
};

// A company's pool from its record alone: ADR and JP tag it explicitly, EU carries its home exchange
// name (never "ADR"/"JP"), and a US filer has no market field at all. Verified across the whole
// universe (0/2882 US records carry a market; all 45 EU records do). Callers that already know the
// source pool (they loaded one file) should pass it; this is the fallback for a lone company object.
export function poolOf(company) {
  const m = company?.market;
  if (m === "ADR") return "ADR";
  if (m === "JP") return "JP";
  return m ? "EU" : "US";
}

// TICKER within a pool -> its compare key. Built once from the whole universe so collisions are seen.
const KEY_BY_POOL_TICKER = (() => {
  const claimedBy = new Map(); // TICKER -> first pool that took it
  const keys = new Map();      // "POOL:TICKER" -> compare key
  for (const pool of POOL_ORDER) {
    for (const c of POOLS[pool]) {
      const t = String(c.ticker || "").toUpperCase();
      if (!t) continue;
      const id = `${pool}:${t}`;
      if (keys.has(id)) continue; // a dup within one pool keeps the first
      if (!claimedBy.has(t)) { claimedBy.set(t, pool); keys.set(id, t); }
      else keys.set(id, `${t}.${pool}`);
    }
  }
  return keys;
})();

// The compare key for a company. Pass the pool when you know it (you loaded the file); otherwise it
// is inferred from the record. Non-colliding tickers return the bare ticker unchanged.
export function compareKeyOf(company, pool = poolOf(company)) {
  const t = String(company?.ticker || "").toUpperCase();
  return KEY_BY_POOL_TICKER.get(`${pool}:${t}`) || t;
}

// Every company across the universe with its pool and resolved key — for the card endpoint, the
// search index, and the collision gate. Order is pool order, US first.
export function allCompareEntries() {
  const out = [];
  for (const pool of POOL_ORDER) {
    for (const c of POOLS[pool]) {
      const t = String(c.ticker || "").toUpperCase();
      if (!t) continue;
      out.push({ company: c, pool, ticker: t, key: compareKeyOf(c, pool) });
    }
  }
  return out;
}
