#!/usr/bin/env node
// compareKeyTest.mjs — the permanent gate on the cross-pool compare-card collision (2026-07-17).
//
// A dozen tickers name a different company in each of two pools: AIR is AAR Corp (US) and Airbus
// (Europe); BA is Boeing and BAE; EL, DG, AI, BC, RR, ORA, UCB, AD, BN, SU likewise. The compare
// card used to be keyed by the bare ticker, so the first pool won and the homonym was served the
// wrong company's record — the worst error this site can make. lib/compareKey.mjs now gives each
// company a unique compare key (the bare ticker, or ticker.POOL for the later claimant). This gate
// proves: (1) no two companies share a key; (2) every known homonym resolves to its own company on
// its own card; (3) every European card is labeled its own pool, not "US".
import { readFileSync } from "node:fs";
import { allCompareEntries, compareKeyOf, poolOf } from "../src/lib/compareKey.mjs";
import { buildCompareCard } from "../src/lib/compareCard.mjs";

const load = (f) => { try { return JSON.parse(readFileSync("src/data/" + f, "utf8")).companies || []; } catch { return []; } };
const us = load("fundamentals.json"), adr = load("fundamentals.adr.json"), jp = load("fundamentals.jp.json"), eu = load("fundamentals.eu.json");

let failed = 0;
const t = (name, ok) => { if (!ok) { failed++; console.error(`✗ ${name}`); } else console.log(`ok ${name}`); };

// 1. Every compare key is unique across the whole universe — the collision cannot recur.
const entries = allCompareEntries();
const byKey = new Map();
for (const e of entries) {
  if (byKey.has(e.key)) {
    const other = byKey.get(e.key);
    console.error(`  key "${e.key}" shared by ${e.pool}:${e.company.name} and ${other.pool}:${other.company.name}`);
  } else byKey.set(e.key, e);
}
t(`every compare key is unique (${entries.length} companies → ${byKey.size} keys)`, byKey.size === entries.length);

// 2. The known homonyms: each collides on the bare ticker but resolves to a distinct key, US keeping
//    the bare ticker and the European (or ADR-vs-EU) claimant suffixed. Verified against the pools so
//    the list can't silently rot as the universe grows.
const HOMONYMS = ["AIR", "BA", "EL", "DG", "AI", "BC", "RR", "ORA", "UCB", "AD", "BN", "SU"];
const byT = (pool, cos) => new Map(cos.map((c) => [String(c.ticker).toUpperCase(), c]));
const M = { US: byT("US", us), ADR: byT("ADR", adr), JP: byT("JP", jp), EU: byT("EU", eu) };
for (const tk of HOMONYMS) {
  const euCo = M.EU.get(tk);
  const firstCo = M.US.get(tk) || M.ADR.get(tk); // the pool that keeps the bare ticker
  if (!euCo || !firstCo) { t(`homonym ${tk} still spans two pools`, false); continue; }
  const euPool = poolOf(euCo), firstPool = poolOf(firstCo);
  const euKey = compareKeyOf(euCo, euPool), firstKey = compareKeyOf(firstCo, firstPool);
  t(`${tk}: ${firstPool} keeps bare "${tk}", ${euPool} suffixed → "${euKey}"`,
    firstKey === tk && euKey === `${tk}.${euPool}` && euKey !== firstKey);
}

// 3. Cross-surface proof: build BOTH cards for a homonym and confirm they are different companies —
//    the European card is Airbus (its own name, its own /eu link), not AAR. This is the bug's death.
const airUS = M.US.get("AIR"), airEU = M.EU.get("AIR");
if (airUS && airEU) {
  const cUS = buildCompareCard(airUS, null, "US");
  const cEU = buildCompareCard(airEU, null, "EU");
  t("AIR (US) compare card is AAR, keyed AIR, pool US", cUS.key === "AIR" && cUS.pool === "US" && /AAR/i.test(cUS.name));
  t("AIR (EU) compare card is Airbus, keyed AIR.EU, pool EU", cEU.key === "AIR.EU" && cEU.pool === "EU" && /airbus/i.test(cEU.name));
  t("the two AIR cards are different companies", cUS.name !== cEU.name && cUS.key !== cEU.key);
}

// 4. No European card is mislabeled pool "US" (which linked it to a nonexistent /c/ page). Every EU
//    company resolves to pool EU and, on the card, carries it.
let euMislabeled = 0;
for (const c of eu) {
  const card = buildCompareCard(c, null, "EU");
  if (card.pool !== "EU") { euMislabeled++; if (euMislabeled <= 5) console.error(`  ${c.ticker} (${c.name}) card pool = ${card.pool}`); }
}
t(`every European card is labeled pool "EU" (${eu.length} companies)`, euMislabeled === 0);

if (failed) { console.error(`\n❌ compareKeyTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ compareKeyTest passed.");
