// Offline test for the universe split: the same Nasdaq-screener payload feeds both the US set and
// the ADR set, partitioned by the row's country, so a foreign-listed name lands in exactly one pool.
// No network. Run with `npm test`.
import { parseScreener, parseScreenerADR } from "./buildUniverse.mjs";

const payload = { data: { rows: [
  { symbol: "AAPL", name: "Apple Inc. Common Stock", country: "United States", marketCap: "3500000000000" },
  { symbol: "MSFT", name: "Microsoft Corporation Common Stock", country: "United States", marketCap: "3100000000000" },
  { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing Company Ltd. American Depositary Shares", country: "Taiwan", marketCap: "900000000000" },
  { symbol: "ASML", name: "ASML Holding N.V. New York Registry Shares", country: "Netherlands", marketCap: "350000000000" },
  { symbol: "NVO", name: "Novo Nordisk A/S", country: "Denmark", marketCap: "400000000000" },
  { symbol: "BRK/B", name: "Berkshire Hathaway Inc. Common Stock", country: "United States", marketCap: "1000000000000" },
  { symbol: "^XYZ", name: "Some Preferred", country: "United States", marketCap: "100" }, // junk symbol → dropped
  { symbol: "ZZZ", name: "Unpriced Co", country: "Germany", marketCap: "" }, // unpriced → dropped
]}};

const us = parseScreener(payload);
const adr = parseScreenerADR(payload);
const usT = us.map((r) => r.ticker);
const adrT = adr.map((r) => r.ticker);

let pass = 0, fail = 0;
const check = (name, cond, got) => { const ok = !!cond; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " -> " + JSON.stringify(got))); ok ? pass++ : fail++; };

check("US set is US-only, market-cap sorted, BRK normalized", usT.join(",") === "AAPL,MSFT,BRK-B", usT);
check("US set excludes every ADR", !usT.some((t) => ["TSM", "ASML", "NVO"].includes(t)), usT);
check("ADR set is the foreign names, cap-sorted", adrT.join(",") === "TSM,NVO,ASML", adrT);
check("ADR set excludes every US name", !adrT.some((t) => ["AAPL", "MSFT", "BRK-B"].includes(t)), adrT);
check("ADR carries country", adr.find((r) => r.ticker === "ASML")?.country === "Netherlands", adr[0]);
check("junk symbol and unpriced row dropped from both", usT.length === 3 && adrT.length === 3, { usT, adrT });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
