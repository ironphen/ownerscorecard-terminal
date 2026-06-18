#!/usr/bin/env node
// One-shot validation for the ADR financial re-fetch: did SIC populate (so foreign banks and
// insurers route to their own scorecards), and did the IFRS financial concepts resolve (so those
// scorecards have something to read)? Read-only, offline — run after the ADR fetch lands.
//   node scripts/checkAdrFinancials.mjs
import fs from "node:fs";
import path from "node:path";
import { buildFinancialScorecard } from "../src/lib/financials.mjs";
import { buildInsurerScorecard } from "../src/lib/insurers.mjs";

const { financialProfile: profile, financialKind } = await import("../src/lib/archetype.mjs");
const { topLineRevenue, fmtMoney } = await import("../src/lib/fundamentals.mjs");

const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/data/fundamentals.adr.json"), "utf8"));
const comps = data.companies || [];
const pc = (v, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);

console.log(`ADR file asOf ${data.asOf} — ${comps.length} companies\n`);

// 1) SIC coverage
const withSic = comps.filter((c) => c.sic && c.sic.length >= 3);
console.log(`SIC populated: ${withSic.length}/${comps.length} (${pc(withSic.length / comps.length)})`);

// 2) Archetype routing distribution
const kinds = {};
for (const c of comps) { const k = financialKind(c) || "industrial"; kinds[k] = (kinds[k] || 0) + 1; }
console.log("Routing:", Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(", "), "\n");

// 3) Financial-concept coverage among the financial-kinded names
const fins = comps.filter((c) => ["bank", "insurer", "managedCare", "fee"].includes(financialKind(c)));
const has = (c, k) => c.lines && c.lines[k] != null;
const cov = (k) => fins.filter((c) => has(c, k)).length;
console.log(`Financial-kinded names: ${fins.length}`);
for (const k of ["netInterestIncome", "noninterestIncome", "noninterestExpense", "provisionForCreditLosses", "deposits", "premiumsEarned", "claimsIncurred", "investmentIncome", "lossReserves"]) {
  console.log(`  ${k.padEnd(26)} ${cov(k)}/${fins.length}`);
}

// 4) Spot-checks: read the key metric the way the scorecard will, in home currency.
const spot = ["SAN", "ITUB", "MUFG", "HDB", "TD", "RY", "BCS", "SHG", "KB", "MFG", "AEG", "SLF", "MFC", "DB", "BBVA", "ING", "NU", "BSAC"];
console.log("\nSpot-checks (ticker | kind | currency | top line | key metric):");
for (const tk of spot) {
  const c = comps.find((x) => x.ticker === tk);
  if (!c) { console.log(`  ${tk}: not in pool`); continue; }
  const k = financialKind(c), L = c.lines || {};
  const ccy = c.currency || "USD";
  const $ = (v) => (v == null ? "—" : fmtMoney(v, ccy));
  const top = topLineRevenue(L, c);
  let metric = "";
  if (k === "bank") {
    const nim = L.netInterestIncome != null && L.totalAssets ? L.netInterestIncome / L.totalAssets : null;
    const fund = L.deposits != null && L.totalAssets ? L.deposits / L.totalAssets : null;
    metric = `NII ${$(L.netInterestIncome)} | NIM ${pc(nim, 2)} | deposits ${$(L.deposits)} (${pc(fund)} of assets)`;
  } else if (k === "insurer") {
    metric = `premiums ${$(L.premiumsEarned)} | float ${$(L.lossReserves)} | inv.income ${$(L.investmentIncome)}`;
  } else {
    metric = `revenue ${$(L.revenue)}`;
  }
  console.log(`  ${tk.padEnd(5)} | ${String(k || "industrial").padEnd(9)} | ${ccy.padEnd(3)} | top ${$(top).padEnd(10)} | ${metric}`);
}

// 5) Does a bank/insurer actually build a non-broken scorecard?
console.log("\nScorecard render check (does it produce sections without throwing?):");
for (const tk of ["SAN", "MUFG", "AEG", "SLF"]) {
  const c = comps.find((x) => x.ticker === tk);
  if (!c) { console.log(`  ${tk}: not in pool`); continue; }
  const k = financialKind(c);
  try {
    const sc = k === "insurer" ? buildInsurerScorecard(c, profile(c).subtype) : k === "bank" ? buildFinancialScorecard(c) : null;
    if (!sc) { console.log(`  ${tk}: kind=${k}, no financial scorecard`); continue; }
    const checks = sc.sections.flatMap((s) => s.checks);
    const live = checks.filter((ch) => ch.value && ch.value !== "—").length;
    console.log(`  ${tk}: ${k} — ${live}/${checks.length} checks have a value`);
  } catch (e) { console.log(`  ${tk}: THREW ${e.message}`); }
}
