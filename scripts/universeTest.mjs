// Offline test for the universe split: the same Nasdaq-screener payload feeds both the US set and
// the ADR set, partitioned by the row's country, so a foreign-listed name lands in exactly one pool.
// No network. Run with `npm test`.
import { parseScreener, parseScreenerADR, classifyRows } from "./buildUniverse.mjs";

const payload = { data: { rows: [
  { symbol: "AAPL", name: "Apple Inc. Common Stock", country: "United States", marketCap: "3500000000000" },
  { symbol: "MSFT", name: "Microsoft Corporation Common Stock", country: "United States", marketCap: "3100000000000" },
  { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing Company Ltd. American Depositary Shares", country: "Taiwan", marketCap: "900000000000" },
  { symbol: "ASML", name: "ASML Holding N.V. New York Registry Shares", country: "Netherlands", marketCap: "350000000000" },
  { symbol: "NVO", name: "Novo Nordisk A/S", country: "Denmark", marketCap: "400000000000" },
  { symbol: "BRK/B", name: "Berkshire Hathaway Inc. Common Stock", country: "United States", marketCap: "1000000000000" },
  { symbol: "^XYZ", name: "Some Preferred", country: "United States", marketCap: "100" }, // junk symbol → dropped
  { symbol: "ZZZ", name: "Unpriced Co", country: "Germany", marketCap: "" }, // unpriced → dropped
  { symbol: "TRI", name: "Thomson Reuters Corporation Common Stock", country: "United States", marketCap: "80000000000" }, // US-labeled foreign 40-F filer: US in the country split, moved to ADR by the form router (below)
  { symbol: "GAB", name: "Gabelli Equity Trust", country: "United States", marketCap: "2000000000" }, // EXCLUDE: closed-end fund, dropped from both
]}};

const us = parseScreener(payload);
const adr = parseScreenerADR(payload);
const usT = us.map((r) => r.ticker);
const adrT = adr.map((r) => r.ticker);

let pass = 0, fail = 0;
const check = (name, cond, got) => { const ok = !!cond; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " -> " + JSON.stringify(got))); ok ? pass++ : fail++; };

// The country-split fallback (no route map): a foreign-COUNTRY row is an ADR; a US-labeled row is US —
// including TRI, whose real 40-F is invisible without the form probe. The router below is what rescues it.
check("US set is US-labeled rows, market-cap sorted, BRK normalized", usT.join(",") === "AAPL,MSFT,BRK-B,TRI", usT);
check("US set excludes every foreign-country name", !usT.some((t) => ["TSM", "ASML", "NVO"].includes(t)), usT);
check("ADR set is the foreign-country names, cap-sorted", adrT.join(",") === "TSM,NVO,ASML", adrT);
check("ADR set excludes every US name", !adrT.some((t) => ["AAPL", "MSFT", "BRK-B"].includes(t)), adrT);
check("ADR carries country", adr.find((r) => r.ticker === "ASML")?.country === "Netherlands", adr[0]);
check("junk symbol and unpriced row dropped from both", usT.length === 4 && adrT.length === 3, { usT, adrT });
check("EXCLUDE (closed-end fund) dropped from both pools", !usT.includes("GAB") && !adrT.includes("GAB"), { usT, adrT });

// ---- form-type routing (classifyRows with a route map): the authoritative signal overrides the
// screener country in both directions, and the EDGAR country labels the ADR name. ----
const routePayload = { data: { rows: [
  { symbol: "AAPL", name: "Apple Inc. Common Stock", country: "United States", marketCap: "3500000000000" },
  { symbol: "SHOP", name: "Shopify Inc. Class A", country: "United States", marketCap: "150000000000" }, // screener says US, files 40-F → ADR
  { symbol: "ACN", name: "Accenture plc", country: "Ireland", marketCap: "200000000000" }, // screener says Ireland, files 10-K → US
  { symbol: "NVO", name: "Novo Nordisk A/S", country: "Denmark", marketCap: "400000000000" }, // no route → country fallback → ADR
]}};
const routeMap = new Map([
  ["SHOP", { route: "ADR", country: "Canada" }],
  ["ACN", { route: "US", country: "Ireland" }],
]);
const routed = classifyRows(routePayload, routeMap);
const rUS = routed.us.map((r) => r.ticker), rADR = routed.adr.map((r) => r.ticker);
check("form-type routes a US-labeled 40-F filer to ADR (self-catch, no FORCE_ADR needed)", rADR.includes("SHOP") && !rUS.includes("SHOP"), { rUS, rADR });
check("form-type keeps a foreign-incorporated 10-K filer in US (Accenture-class)", rUS.includes("ACN") && !rADR.includes("ACN"), { rUS, rADR });
check("auto-routed ADR name carries its EDGAR country", routed.adr.find((r) => r.ticker === "SHOP")?.country === "Canada", routed.adr);
check("no-route name falls back to the screener country (NVO → ADR)", rADR.includes("NVO"), { rUS, rADR });
check("empty route map == the country split (fallback unchanged)", JSON.stringify(classifyRows(payload).us.map((r) => r.ticker)) === JSON.stringify(parseScreener(payload).map((r) => r.ticker)), "wrappers must match");
// The Thomson-Reuters regression guard, now via the form router: a US-labeled 40-F filer routes to ADR
// with its home country — the rescue the FORCE_ADR pin used to provide, now derived and self-maintaining.
const triRouted = classifyRows(payload, new Map([["TRI", { route: "ADR", country: "Canada" }]]));
check("form router rescues the US-labeled foreign filer (TRI → ADR, Canada)",
  !triRouted.us.some((r) => r.ticker === "TRI") && triRouted.adr.find((r) => r.ticker === "TRI")?.country === "Canada",
  { us: triRouted.us.map((r) => r.ticker), tri: triRouted.adr.find((r) => r.ticker === "TRI") });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
