#!/usr/bin/env node
// Build-time fundamentals pipeline.
//
// Reads src/data/universe.json (tickers + names), resolves each ticker to a CIK
// via SEC's official ticker map, pulls the latest annual (10-K) figures from the
// EDGAR XBRL "companyfacts" API, and writes src/data/fundamentals.json, the
// static dataset every fundamentals tool reads.
//
//   npm run fetch:fundamentals
//
// Needs outbound access to sec.gov / data.sec.gov. SEC asks for a descriptive
// User-Agent with contact info; override via SEC_USER_AGENT if you like.
// Free, no API key. Runs unattended in CI (see .github/workflows/fundamentals.yml).

import fs from "node:fs";
import path from "node:path";

const UA =
  process.env.SEC_USER_AGENT ||
  "Owner Scorecard research (ryanreinsant@gmail.com)";
const HEADERS = { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" };
const THROTTLE_MS = 150; // stay well under SEC's ~10 req/s guidance

const dataDir = path.join(process.cwd(), "src", "data");
const universe = JSON.parse(fs.readFileSync(path.join(dataDir, "universe.json"), "utf8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Operating income, with a fallback for filers that don't tag OperatingIncomeLoss
// (Nike, IBM, the oil majors, much of pharma run gross profit straight to pretax):
// revenue minus total costs and expenses, else pretax (net income + tax) plus interest
// as an EBIT proxy. Returns null only when none of the inputs are present.
function deriveOpInc(opInc, rev, costsExp, ni, tax, interest) {
  if (opInc != null) return opInc;
  if (rev != null && costsExp != null) return rev - costsExp;
  if (ni != null && tax != null) return ni + tax + (interest || 0);
  return null;
}

// Title-case EDGAR's all-caps entityName for use as a display-name fallback when the
// universe doesn't carry a curated name. Keeps short all-caps acronyms (HP, AMD, IBM),
// normalizes the common legal suffixes, and lowercases the little joining words.
const NAME_FIXED = { INC: "Inc", "INC.": "Inc.", CORP: "Corp", "CORP.": "Corp.", CO: "Co", "CO.": "Co.", LTD: "Ltd", "LTD.": "Ltd.", LLC: "LLC", PLC: "PLC", LP: "LP", HLDGS: "Holdings", HLDG: "Holding", GRP: "Group", CL: "Class", NV: "NV", SA: "SA", AG: "AG", "&": "&" };
const NAME_SMALL = new Set(["a", "an", "and", "of", "the", "for"]);
function prettifyName(s) {
  if (!s) return null;
  return s.trim().split(/\s+/).map((w, i) => {
    const u = w.toUpperCase(), lo = w.toLowerCase();
    if (NAME_FIXED[u]) return NAME_FIXED[u];
    if (i > 0 && NAME_SMALL.has(lo)) return lo; // joining words, before the acronym rule
    if (w.length <= 3 && /^[A-Z0-9.&'-]+$/.test(w)) return w; // short all-caps: acronym/ticker
    return lo.charAt(0).toUpperCase() + lo.slice(1);
  }).join(" ") || null;
}

async function getJSON(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429) {
        await sleep(1000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(500 * attempt);
    }
  }
}

// Concept tags in priority order. Companies report under different tags, so we
// try each and take the first that yields a usable annual figure.
const CONCEPTS = {
  operatingIncome: ["OperatingIncomeLoss"],
  costsAndExpenses: ["CostsAndExpenses"], // total operating costs incl COGS; revenue − this = operating income
  interestExpense: ["InterestExpense", "InterestExpenseNonoperating", "InterestAndDebtExpense"],
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax"],
  netIncome: ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"],
  cashFromOps: ["NetCashProvidedByUsedInOperatingActivities"],
  depreciation: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  longTermDebt: ["LongTermDebtNoncurrent", "LongTermDebt"],
  currentDebt: ["LongTermDebtCurrent", "DebtCurrent"],
  // Aggregate total-debt tags for filers whose borrowings sit outside the standard
  // noncurrent/current pair, e.g. a securitized or secured-note structure like
  // Domino's ~$5B. Used only as a floor via max(), so it can correct under-capture
  // but never reduce a figure the component tags already got right.
  debtTotal: [
    "DebtAndCapitalLeaseObligations",
    "DebtLongtermAndShorttermCombinedAmount",
    "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities",
    "LongTermDebtAndCapitalLeaseObligations",
    "SecuredLongTermDebt",
    "SecuredDebt",
    "SeniorNotes",
    "NotesPayableNoncurrent",
  ],
  incomeTaxExpense: ["IncomeTaxExpenseBenefit"],
  costOfRevenue: ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold"],
  stockBasedComp: ["ShareBasedCompensation"],
  dividendsPaid: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
  buybacks: ["PaymentsForRepurchaseOfCommonStock"],
  stockholdersEquity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  cashAndEquivalents: [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsAndShortTermInvestmentsAtCarryingValue",
    "CashCashEquivalentsAndShortTermInvestments",
  ],
  // Liquid securities held alongside cash, netted against debt for a truer
  // leverage read (a company like Apple parks most of its war chest here, not in
  // "cash"). Marketable-securities tags only, so strategic/illiquid stakes stay out.
  shortTermInvestments: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesCurrent", "OtherShortTermInvestments"],
  longTermMarketable: ["MarketableSecuritiesNoncurrent", "AvailableForSaleSecuritiesNoncurrent"],
  receivables: ["AccountsReceivableNetCurrent"],
  inventory: ["InventoryNet"],
  accountsPayable: ["AccountsPayableCurrent", "AccountsPayableTradeCurrent", "AccountsPayableAndAccruedLiabilitiesCurrent"],
  currentAssets: ["AssetsCurrent"],
  currentLiabilities: ["LiabilitiesCurrent"],
  sharesDiluted: [
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
    "WeightedAverageNumberOfSharesOutstandingBasic",
  ],
  // --- banking & insurance (the financials archetype; null for industrials) ---
  netInterestIncome: ["InterestIncomeExpenseNet"],
  noninterestIncome: ["NoninterestIncome"],
  noninterestExpense: ["NoninterestExpense"],
  provisionForCreditLosses: ["ProvisionForLoanLeaseAndOtherLosses", "ProvisionForLoanAndLeaseLosses", "ProvisionForCreditLossExpenseReversal"],
  totalAssets: ["Assets"],
  deposits: ["Deposits"],
  goodwill: ["Goodwill"],
  intangibleAssets: ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"],
  // --- REITs (the reit archetype): FFO = net income + real-estate D&A − gains on sale ---
  gainOnSaleRealEstate: ["GainLossOnSaleOfPropertiesNetOfApplicableIncomeTaxes", "GainLossOnDispositionOfRealEstate", "GainsLossesOnSalesOfInvestmentRealEstate", "GainLossOnSaleOfProperties", "GainLossOnDispositionOfAssets1"],
  realEstateGross: ["RealEstateInvestmentPropertyAtCost", "RealEstateGrossAtCarryingValue"],
  // --- insurers (financials, the underwriting + float lens) ---
  premiumsEarned: ["PremiumsEarnedNet", "PremiumsEarnedNetPropertyAndCasualty"],
  claimsIncurred: ["PolicyholderBenefitsAndClaimsIncurredNet", "IncurredClaimsPropertyCasualtyAndLiability", "PolicyholderBenefitsAndClaimsIncurredHomeAndAutomobile"],
  underwritingExpense: ["OtherUnderwritingExpense", "DeferredPolicyAcquisitionCostAmortizationExpense"],
  // The full combined-ratio numerator in one tag (losses + loss-adjustment + all
  // underwriting expenses), which our component pick of a single expense line misses.
  lossesAndExpenses: ["BenefitsLossesAndExpenses", "PolicyholderBenefitsAndClaimsIncurredNetAndOtherUnderwritingExpense"],
  investmentIncome: ["NetInvestmentIncome"],
  lossReserves: ["LiabilityForClaimsAndClaimsAdjustmentExpense", "LiabilityForFuturePolicyBenefits"],
};

const days = (a, b) => Math.abs((new Date(b) - new Date(a)) / 86400000);

// ---- value extraction (tag-merged) ----
// EDGAR concepts get renamed and companies switch tags, so one tag can go stale
// mid-decade. Merge across the candidate tags in priority order: a higher-priority
// tag wins a year; lower-priority tags fill the years it lacks (so a stale tag is
// supplemented, not frozen). Within a tag, the latest filing wins, picking up
// restatements and split adjustments. Keyed by PERIOD-end year, not filing fy.

function annualByYear(facts, tags, unit = "USD") {
  const out = {};
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    const perTag = {};
    for (const u of units) {
      if (!u.form || !u.form.startsWith("10-K") || !u.start || !u.end) continue;
      const dur = days(u.start, u.end);
      if (dur < 350 || dur > 380) continue;
      const fy = new Date(u.end).getUTCFullYear();
      if (!perTag[fy] || (u.filed || "") > (perTag[fy].filed || ""))
        perTag[fy] = { val: u.val, end: u.end, filed: u.filed || "", accn: u.accn, form: u.form };
    }
    for (const fy in perTag) if (!(fy in out)) out[fy] = perTag[fy];
  }
  return out;
}

function instantByYear(facts, tags, unit = "USD") {
  const out = {};
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    const perTag = {};
    for (const u of units) {
      if (!u.form || !u.form.startsWith("10-K") || !u.end || u.start) continue;
      const fy = new Date(u.end).getUTCFullYear();
      if (!perTag[fy] || (u.filed || "") > (perTag[fy].filed || ""))
        perTag[fy] = { val: u.val, end: u.end, filed: u.filed || "" };
    }
    for (const fy in perTag) if (!(fy in out)) out[fy] = perTag[fy];
  }
  return out;
}

const valuesByYear = (by) => Object.fromEntries(Object.entries(by).map(([fy, e]) => [fy, e.val]));
const latestEntry = (by) => {
  const fys = Object.keys(by).map(Number);
  if (!fys.length) return null;
  const fy = Math.max(...fys);
  return { ...by[fy], fy };
};

const pickAnnual = (facts, tags, unit = "USD") => latestEntry(annualByYear(facts, tags, unit));
const pickInstant = (facts, tags, unit = "USD") => latestEntry(instantByYear(facts, tags, unit));
const collectAnnual = (facts, tags, unit = "USD") => valuesByYear(annualByYear(facts, tags, unit));
const collectInstant = (facts, tags, unit = "USD") => valuesByYear(instantByYear(facts, tags, unit));

// ---- trailing twelve months ----
// All duration observations (10-K and 10-Q) for a concept.
function durations(facts, tags, unit = "USD") {
  const all = [];
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    for (const u of units) {
      if (!u.form || !u.start || !u.end) continue;
      if (!(u.form.startsWith("10-K") || u.form.startsWith("10-Q"))) continue;
      all.push({ val: u.val, start: u.start, end: u.end, dur: days(u.start, u.end), filed: u.filed || "" });
    }
  }
  return all;
}

// TTM(flow) = prior full year + current year-to-date − prior-year same-period YTD,
// using the cumulative durations 10-Qs report. If the freshest data is already a
// full year (a 10-K with no newer quarter), TTM equals that year. null if unclean.
function ttmFlow(facts, tags, unit = "USD") {
  const all = durations(facts, tags, unit);
  if (!all.length) return null;
  const maxEnd = all.reduce((m, e) => (new Date(e.end) > new Date(m) ? e.end : m), all[0].end);
  const cur = all.filter((e) => e.end === maxEnd).sort((a, b) => b.dur - a.dur || b.filed.localeCompare(a.filed))[0];
  if (!cur) return null;
  if (cur.dur >= 350 && cur.dur <= 380) return { val: cur.val, asOf: cur.end, isFY: true };
  const prevEnd = new Date(cur.end);
  prevEnd.setUTCFullYear(prevEnd.getUTCFullYear() - 1);
  const prevEndStr = prevEnd.toISOString().slice(0, 10);
  const priorYTD = all
    .filter((e) => Math.abs(days(e.end, prevEndStr)) <= 20 && Math.abs(e.dur - cur.dur) <= 25)
    .sort((a, b) => b.filed.localeCompare(a.filed))[0];
  const priorFY = all
    .filter((e) => e.dur >= 350 && e.dur <= 380 && Math.abs(days(e.end, cur.start)) <= 45)
    .sort((a, b) => b.filed.localeCompare(a.filed))[0];
  if (priorYTD && priorFY) return { val: priorFY.val + cur.val - priorYTD.val, asOf: cur.end, isFY: false };
  const fy = all.filter((e) => e.dur >= 350 && e.dur <= 380).sort((a, b) => new Date(b.end) - new Date(a.end))[0];
  return fy ? { val: fy.val, asOf: fy.end, isFY: true } : null;
}

// Latest period value across 10-K and 10-Q, for the freshest share count (flow)
// and balance-sheet items (instant).
function latestObservation(facts, tags, unit = "USD", instant = false) {
  let best = null;
  for (const tag of tags) {
    const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!units) continue;
    for (const u of units) {
      if (!u.form || !u.end || (instant ? !!u.start : !u.start)) continue;
      if (!(u.form.startsWith("10-K") || u.form.startsWith("10-Q"))) continue;
      if (!best || new Date(u.end) > new Date(best.end) || (u.end === best.end && (u.filed || "") > best.filed))
        best = { val: u.val, end: u.end, filed: u.filed || "" };
    }
  }
  return best;
}

async function main() {
  process.stdout.write("Resolving tickers → CIK from SEC… ");
  const map = await getJSON("https://www.sec.gov/files/company_tickers.json");
  const cikByTicker = {};
  for (const row of Object.values(map)) {
    cikByTicker[String(row.ticker).toUpperCase()] = String(row.cik_str).padStart(10, "0");
  }
  console.log("done.");

  const companies = [];
  for (const { ticker, name } of universe.tickers) {
    const cik = cikByTicker[ticker.toUpperCase()];
    if (!cik) {
      console.warn(`  ! ${ticker}: no CIK in SEC map, skipping`);
      continue;
    }
    await sleep(THROTTLE_MS);
    let facts;
    try {
      facts = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    } catch (err) {
      console.warn(`  ! ${ticker}: companyfacts failed (${err.message}), skipping`);
      continue;
    }

    // Industry code (drives the archetype classifier). Non-fatal if it fails.
    let sic = null, sicDescription = null;
    try {
      await sleep(THROTTLE_MS);
      const sub = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`);
      sic = sub?.sic || null;
      sicDescription = sub?.sicDescription || null;
    } catch {
      /* leave null */
    }

    // Display name: a curated universe name wins; otherwise fall back to EDGAR's own
    // entity name, title-cased. Lets the catalog grow by listing tickers alone.
    const displayName = (name && name.trim().toUpperCase() !== ticker.toUpperCase())
      ? name
      : (prettifyName(facts?.entityName) || name);

    const oi = pickAnnual(facts, CONCEPTS.operatingIncome);
    const anchor = oi || pickAnnual(facts, CONCEPTS.revenue); // for fy / period / filing link
    const maxOf = (...vals) => { const xs = vals.filter((v) => v != null); return xs.length ? Math.max(...xs) : null; };
    // Total debt: long-term + current from the component tags, taken against the max of
    // every aggregate total-debt tag. We take the MAX across the tags (not a priority
    // merge) because a filer can tag its debt under different concepts in different
    // years; the max keeps the year-to-year series consistent and complete, and can
    // only correct an under-capture, never reduce a figure the components already got.
    const ltd = pickInstant(facts, CONCEPTS.longTermDebt);
    const cur = pickInstant(facts, CONCEPTS.currentDebt);
    const componentDebt = ltd || cur ? (ltd?.val || 0) + (cur?.val || 0) : null;
    const aggInstantVals = CONCEPTS.debtTotal.map((t) => pickInstant(facts, [t])?.val ?? null);
    const aggSeriesByTag = CONCEPTS.debtTotal.map((t) => collectInstant(facts, [t]));
    const aggTTMVals = CONCEPTS.debtTotal.map((t) => latestObservation(facts, [t], "USD", true)?.val ?? null);
    const aggYear = (fy) => maxOf(...aggSeriesByTag.map((s) => s[fy] ?? null));
    const totalDebt = maxOf(componentDebt, ...aggInstantVals);

    // Diagnostic: DEBT_DEBUG=DPZ dumps every debt-like us-gaap tag and its latest annual
    // value, so a debt-capture problem can be diagnosed from the actual filings.
    if (process.env.DEBT_DEBUG && process.env.DEBT_DEBUG.toUpperCase().split(",").map((s) => s.trim()).includes(ticker.toUpperCase())) {
      const ug = facts?.facts?.["us-gaap"] || {};
      const TOTAL = /^(Debt|LongTermDebt|SecuredLongTermDebt|SecuredDebt|SeniorNotes|NotesPayable)/;
      console.log(`\n=== DEBT_DEBUG ${ticker}: componentDebt=${componentDebt}, totalDebt=${totalDebt} ===`);
      for (const concept of Object.keys(ug)) {
        if (!/debt|notespay|borrow|capitallease|senior/i.test(concept)) continue;
        const usd = ug[concept]?.units?.USD;
        if (!usd) continue;
        const byYear = {};
        for (const o of usd) { if (o.form !== "10-K" || o.fp !== "FY" || o.fy == null) continue; if (!byYear[o.fy] || o.end > byYear[o.fy].end) byYear[o.fy] = o; }
        const years = Object.keys(byYear).sort();
        if (!years.length) continue;
        if (TOTAL.test(concept)) console.log(`  [series] ${concept}: ${years.map((y) => `${y}=${(byYear[y].val / 1e6).toFixed(0)}M`).join(" ")}`);
        else console.log(`  ${concept.padEnd(56)} ${(byYear[years[years.length - 1]].val / 1e6).toFixed(0).padStart(9)}M  (FY${years[years.length - 1]})`);
      }
      console.log("=== end DEBT_DEBUG ===\n");
    }

    const pick = (tags) => pickAnnual(facts, tags)?.val ?? null;
    const inst = (tags) => pickInstant(facts, tags)?.val ?? null;
    const accnNoDash = anchor?.accn ? anchor.accn.replace(/-/g, "") : null;
    const sourceUrl = accnNoDash
      ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}/${anchor.accn}-index.htm`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&count=10`;

    // Up to ~10 years of history for the durability strips.
    const ha = {
      revenue: collectAnnual(facts, CONCEPTS.revenue),
      operatingIncome: collectAnnual(facts, CONCEPTS.operatingIncome),
      costsAndExpenses: collectAnnual(facts, CONCEPTS.costsAndExpenses),
      interestExpense: collectAnnual(facts, CONCEPTS.interestExpense),
      incomeTaxExpense: collectAnnual(facts, CONCEPTS.incomeTaxExpense),
      netIncome: collectAnnual(facts, CONCEPTS.netIncome),
      cashFromOps: collectAnnual(facts, CONCEPTS.cashFromOps),
      capex: collectAnnual(facts, CONCEPTS.capex),
      costOfRevenue: collectAnnual(facts, CONCEPTS.costOfRevenue),
      depreciation: collectAnnual(facts, CONCEPTS.depreciation),
      dividendsPaid: collectAnnual(facts, CONCEPTS.dividendsPaid),
      buybacks: collectAnnual(facts, CONCEPTS.buybacks),
      sharesDiluted: collectAnnual(facts, CONCEPTS.sharesDiluted, "shares"),
      netInterestIncome: collectAnnual(facts, CONCEPTS.netInterestIncome),
      noninterestIncome: collectAnnual(facts, CONCEPTS.noninterestIncome),
      noninterestExpense: collectAnnual(facts, CONCEPTS.noninterestExpense),
      provisionForCreditLosses: collectAnnual(facts, CONCEPTS.provisionForCreditLosses),
      gainOnSaleRealEstate: collectAnnual(facts, CONCEPTS.gainOnSaleRealEstate),
      premiumsEarned: collectAnnual(facts, CONCEPTS.premiumsEarned),
      claimsIncurred: collectAnnual(facts, CONCEPTS.claimsIncurred),
      underwritingExpense: collectAnnual(facts, CONCEPTS.underwritingExpense),
      lossesAndExpenses: collectAnnual(facts, CONCEPTS.lossesAndExpenses),
      investmentIncome: collectAnnual(facts, CONCEPTS.investmentIncome),
    };
    const hi = {
      equity: collectInstant(facts, CONCEPTS.stockholdersEquity),
      cash: collectInstant(facts, CONCEPTS.cashAndEquivalents),
      stInv: collectInstant(facts, CONCEPTS.shortTermInvestments),
      ltMkt: collectInstant(facts, CONCEPTS.longTermMarketable),
      ltd: collectInstant(facts, CONCEPTS.longTermDebt),
      cur: collectInstant(facts, CONCEPTS.currentDebt),
      ca: collectInstant(facts, CONCEPTS.currentAssets),
      cl: collectInstant(facts, CONCEPTS.currentLiabilities),
      assets: collectInstant(facts, CONCEPTS.totalAssets),
      deposits: collectInstant(facts, CONCEPTS.deposits),
      goodwill: collectInstant(facts, CONCEPTS.goodwill),
      intangibles: collectInstant(facts, CONCEPTS.intangibleAssets),
      realEstateGross: collectInstant(facts, CONCEPTS.realEstateGross),
      lossReserves: collectInstant(facts, CONCEPTS.lossReserves),
    };
    const history = Object.keys(ha.revenue)
      .map(Number)
      .sort((a, b) => a - b)
      .slice(-10)
      .map((fy) => ({
        fy,
        lines: {
          revenue: ha.revenue[fy] ?? null,
          operatingIncome: deriveOpInc(ha.operatingIncome[fy] ?? null, ha.revenue[fy] ?? null, ha.costsAndExpenses[fy] ?? null, ha.netIncome[fy] ?? null, ha.incomeTaxExpense[fy] ?? null, ha.interestExpense[fy] ?? null),
          incomeTaxExpense: ha.incomeTaxExpense[fy] ?? null,
          netIncome: ha.netIncome[fy] ?? null,
          totalDebt: maxOf(hi.ltd[fy] != null || hi.cur[fy] != null ? (hi.ltd[fy] || 0) + (hi.cur[fy] || 0) : null, aggYear(fy)),
          stockholdersEquity: hi.equity[fy] ?? null,
          cashAndEquivalents: hi.cash[fy] ?? null,
          shortTermInvestments: hi.stInv[fy] ?? null,
          longTermMarketable: hi.ltMkt[fy] ?? null,
          currentAssets: hi.ca[fy] ?? null,
          currentLiabilities: hi.cl[fy] ?? null,
          cashFromOps: ha.cashFromOps[fy] ?? null,
          capex: ha.capex[fy] ?? null,
          costOfRevenue: ha.costOfRevenue[fy] ?? null,
          depreciation: ha.depreciation[fy] ?? null,
          dividendsPaid: ha.dividendsPaid[fy] ?? null,
          buybacks: ha.buybacks[fy] ?? null,
          sharesDiluted: ha.sharesDiluted[fy] ?? null,
          netInterestIncome: ha.netInterestIncome[fy] ?? null,
          noninterestIncome: ha.noninterestIncome[fy] ?? null,
          noninterestExpense: ha.noninterestExpense[fy] ?? null,
          provisionForCreditLosses: ha.provisionForCreditLosses[fy] ?? null,
          totalAssets: hi.assets[fy] ?? null,
          deposits: hi.deposits[fy] ?? null,
          goodwill: hi.goodwill[fy] ?? null,
          intangibleAssets: hi.intangibles[fy] ?? null,
          gainOnSaleRealEstate: ha.gainOnSaleRealEstate[fy] ?? null,
          realEstateGross: hi.realEstateGross[fy] ?? null,
          premiumsEarned: ha.premiumsEarned[fy] ?? null,
          claimsIncurred: ha.claimsIncurred[fy] ?? null,
          underwritingExpense: ha.underwritingExpense[fy] ?? null,
          lossesAndExpenses: ha.lossesAndExpenses[fy] ?? null,
          investmentIncome: ha.investmentIncome[fy] ?? null,
          lossReserves: hi.lossReserves[fy] ?? null,
        },
      }));

    // Trailing twelve months, the freshest 12-month picture; folds in any
    // quarter filed since the last 10-K. Flows are TTM-summed; balance sheet and
    // share count are taken at the latest quarter.
    const tf = (tags, unit = "USD") => ttmFlow(facts, tags, unit)?.val ?? null;
    const ttmRev = ttmFlow(facts, CONCEPTS.revenue);
    const ttmLtd = latestObservation(facts, CONCEPTS.longTermDebt, "USD", true)?.val;
    const ttmCurDebt = latestObservation(facts, CONCEPTS.currentDebt, "USD", true)?.val;
    const ttm = ttmRev
      ? {
          asOf: ttmRev.asOf,
          isFY: ttmRev.isFY,
          lines: {
            revenue: ttmRev.val,
            operatingIncome: deriveOpInc(tf(CONCEPTS.operatingIncome), ttmRev?.val ?? null, tf(CONCEPTS.costsAndExpenses), tf(CONCEPTS.netIncome), tf(CONCEPTS.incomeTaxExpense), tf(CONCEPTS.interestExpense)),
            netIncome: tf(CONCEPTS.netIncome),
            incomeTaxExpense: tf(CONCEPTS.incomeTaxExpense),
            cashFromOps: tf(CONCEPTS.cashFromOps),
            capex: tf(CONCEPTS.capex),
            costOfRevenue: tf(CONCEPTS.costOfRevenue),
            depreciation: tf(CONCEPTS.depreciation),
            stockholdersEquity: latestObservation(facts, CONCEPTS.stockholdersEquity, "USD", true)?.val ?? null,
            cashAndEquivalents: latestObservation(facts, CONCEPTS.cashAndEquivalents, "USD", true)?.val ?? null,
            shortTermInvestments: latestObservation(facts, CONCEPTS.shortTermInvestments, "USD", true)?.val ?? null,
            longTermMarketable: latestObservation(facts, CONCEPTS.longTermMarketable, "USD", true)?.val ?? null,
            totalDebt: maxOf(ttmLtd != null || ttmCurDebt != null ? (ttmLtd || 0) + (ttmCurDebt || 0) : null, ...aggTTMVals),
            sharesDiluted: latestObservation(facts, CONCEPTS.sharesDiluted, "shares", false)?.val ?? null,
            netInterestIncome: tf(CONCEPTS.netInterestIncome),
            noninterestIncome: tf(CONCEPTS.noninterestIncome),
            noninterestExpense: tf(CONCEPTS.noninterestExpense),
            provisionForCreditLosses: tf(CONCEPTS.provisionForCreditLosses),
            totalAssets: latestObservation(facts, CONCEPTS.totalAssets, "USD", true)?.val ?? null,
            deposits: latestObservation(facts, CONCEPTS.deposits, "USD", true)?.val ?? null,
            goodwill: latestObservation(facts, CONCEPTS.goodwill, "USD", true)?.val ?? null,
            intangibleAssets: latestObservation(facts, CONCEPTS.intangibleAssets, "USD", true)?.val ?? null,
            gainOnSaleRealEstate: tf(CONCEPTS.gainOnSaleRealEstate),
            realEstateGross: latestObservation(facts, CONCEPTS.realEstateGross, "USD", true)?.val ?? null,
            premiumsEarned: tf(CONCEPTS.premiumsEarned),
            claimsIncurred: tf(CONCEPTS.claimsIncurred),
            underwritingExpense: tf(CONCEPTS.underwritingExpense),
            lossesAndExpenses: tf(CONCEPTS.lossesAndExpenses),
            investmentIncome: tf(CONCEPTS.investmentIncome),
            lossReserves: latestObservation(facts, CONCEPTS.lossReserves, "USD", true)?.val ?? null,
          },
        }
      : null;

    companies.push({
      ticker: ticker.toUpperCase(),
      name: displayName,
      cik,
      sic,
      sicDescription,
      fy: anchor?.fy ?? null,
      periodEnd: anchor?.end ?? null,
      form: anchor?.form ?? "10-K",
      sourceUrl,
      lines: {
        operatingIncome: deriveOpInc(oi?.val ?? null, pick(CONCEPTS.revenue), pick(CONCEPTS.costsAndExpenses), pick(CONCEPTS.netIncome), pick(CONCEPTS.incomeTaxExpense), pick(CONCEPTS.interestExpense)),
        interestExpense: pick(CONCEPTS.interestExpense),
        revenue: pick(CONCEPTS.revenue),
        netIncome: pick(CONCEPTS.netIncome),
        totalDebt,
        cashFromOps: pick(CONCEPTS.cashFromOps),
        depreciation: pick(CONCEPTS.depreciation),
        capex: pick(CONCEPTS.capex),
        incomeTaxExpense: pick(CONCEPTS.incomeTaxExpense),
        costOfRevenue: pick(CONCEPTS.costOfRevenue),
        stockBasedComp: pick(CONCEPTS.stockBasedComp),
        dividendsPaid: pick(CONCEPTS.dividendsPaid),
        buybacks: pick(CONCEPTS.buybacks),
        stockholdersEquity: inst(CONCEPTS.stockholdersEquity),
        cashAndEquivalents: inst(CONCEPTS.cashAndEquivalents),
        shortTermInvestments: inst(CONCEPTS.shortTermInvestments),
        longTermMarketable: inst(CONCEPTS.longTermMarketable),
        receivables: inst(CONCEPTS.receivables),
        inventory: inst(CONCEPTS.inventory),
        accountsPayable: inst(CONCEPTS.accountsPayable),
        currentAssets: inst(CONCEPTS.currentAssets),
        currentLiabilities: inst(CONCEPTS.currentLiabilities),
        sharesDiluted: pickAnnual(facts, CONCEPTS.sharesDiluted, "shares")?.val ?? null,
        netInterestIncome: pick(CONCEPTS.netInterestIncome),
        noninterestIncome: pick(CONCEPTS.noninterestIncome),
        noninterestExpense: pick(CONCEPTS.noninterestExpense),
        provisionForCreditLosses: pick(CONCEPTS.provisionForCreditLosses),
        totalAssets: inst(CONCEPTS.totalAssets),
        deposits: inst(CONCEPTS.deposits),
        goodwill: inst(CONCEPTS.goodwill),
        intangibleAssets: inst(CONCEPTS.intangibleAssets),
        gainOnSaleRealEstate: pick(CONCEPTS.gainOnSaleRealEstate),
        realEstateGross: inst(CONCEPTS.realEstateGross),
        premiumsEarned: pick(CONCEPTS.premiumsEarned),
        claimsIncurred: pick(CONCEPTS.claimsIncurred),
        underwritingExpense: pick(CONCEPTS.underwritingExpense),
        lossesAndExpenses: pick(CONCEPTS.lossesAndExpenses),
        investmentIncome: pick(CONCEPTS.investmentIncome),
        lossReserves: inst(CONCEPTS.lossReserves),
      },
      history,
      ttm,
    });
    console.log(`  ✓ ${ticker} (CIK ${cik}, FY${anchor?.fy ?? "?"})`);
  }

  if (!companies.length) {
    console.error("\n❌ No companies resolved, aborting so the sample file is preserved.\n");
    process.exit(1);
  }

  const out = {
    asOf: new Date().toISOString().slice(0, 10),
    source: "SEC EDGAR XBRL (companyfacts)",
    sample: false,
    note: "Latest annual (10-K) figures pulled from EDGAR. Values are raw USD.",
    companies,
  };
  fs.writeFileSync(path.join(dataDir, "fundamentals.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`\n✅ Wrote ${companies.length} companies to src/data/fundamentals.json`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
