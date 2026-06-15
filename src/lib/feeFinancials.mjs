// Fee-earning financials: asset managers, exchanges and insurance brokers. None of
// these is a lender, so the bank lens (net interest margin, deposit funding, credit
// losses) tells you nothing about them. They are toll booths: capital-light businesses
// that earn a fee on someone else's money or someone else's risk, so they are read on
// the margin they keep, the return on the little capital they tie up, and above all the
// durability of the fee stream. Pure arithmetic on the filing data; the verdict is the
// reader's.

import { fmtUSD, operatingMargin } from "./fundamentals.mjs";
import { returnOnEquity } from "./financials.mjs";

const pc = (v, dp = 0) => (v == null ? "—" : `${v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(dp)}%`);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

export function netMargin(L) {
  return L && L.netIncome != null && L.revenue ? L.netIncome / L.revenue : null;
}
// ROE is meaningful here, but buybacks can shrink equity to nothing (or below), which
// makes the ratio explode or flip sign and stop meaning anything; guard for that.
export function feeReturnOnEquity(L) {
  return L && L.stockholdersEquity != null && L.stockholdersEquity > 0 && L.netIncome != null
    ? L.netIncome / L.stockholdersEquity : null;
}

// What the fee actually rides on, per kind of fee business. Teaches the lens; no verdict.
const DRIVER = {
  "asset-manager": "Fees ride on assets under management, so the swing factors are net flows in or out and the market's move on the assets already there; the cost base is largely fixed, which lifts margins in a bull market and squeezes them in a bear one.",
  "exchange": "Revenue is a toll on trading volume plus the recurring market-data and listing fees the venue generates, protected by the network economics of a deep liquidity pool that rivals cannot easily replicate.",
  "insurance-broker": "Commissions are a slice of the premiums it places, earned without taking the underwriting risk itself, so it is a capital-light fee stream that rises with new business, retention and the price of insurance.",
  "fee": "It earns a fee rather than a spread on a balance sheet, so the read is the margin it keeps and how durable the franchise is, not leverage or loan losses.",
};
function driverOf(subtype) { return DRIVER[subtype] || DRIVER.fee; }

const KIND_NOUN = {
  "asset-manager": "asset manager", "exchange": "exchange",
  "insurance-broker": "insurance broker", "fee": "fee business",
};

export function buildFeeScorecard(company, subtype = "fee") {
  const L = company?.lines || {};
  const none = (title, note, concept = null) => ({ title, concept, value: "—", formula: "", tone: "none", label: "Not enough data", note });
  const noun = KIND_NOUN[subtype] || KIND_NOUN.fee;

  const om = operatingMargin(L);
  const omCheck = om == null ? none("Operating margin", "Operating income or revenue wasn't found in the filing data.", "operating-margin") : {
    title: "Operating margin",
    concept: "operating-margin",
    value: pc(om, 1), formula: `Operating income ${fmtUSD(L.operatingIncome)} ÷ revenue ${fmtUSD(L.revenue)}`,
    tone: om < 0.08 ? "bad" : om < 0.18 ? "warn" : om < 0.3 ? "ok" : "good",
    label: om < 0.08 ? "Thin for a fee business" : om < 0.18 ? "Modest fee margin" : om < 0.3 ? "Healthy fee margin" : "Toll-booth economics",
    note: `The heart of a ${noun}: how much of each fee dollar survives the cost of running the business. ${driverOf(subtype)} A high margin held for years, through a market it does not control, is the operational mark of a real franchise.`,
  };

  const nm = netMargin(L);
  const nmCheck = nm == null ? none("Net margin", "Net income or revenue missing.") : {
    title: "Net margin",
    value: pc(nm, 1), formula: `Net income ${fmtUSD(L.netIncome)} ÷ revenue ${fmtUSD(L.revenue)}`,
    tone: nm < 0.05 ? "warn" : nm < 0.15 ? "ok" : "good",
    label: nm < 0.05 ? "Slim" : nm < 0.15 ? "Solid" : "Rich",
    note: "What reaches the owner after tax and interest. For a capital-light fee business this should be a wide share of revenue; when it is thin despite a high operating margin, debt taken on for acquisitions is usually the reason, so read it next to the balance sheet.",
  };

  const roe = feeReturnOnEquity(L);
  const roeCheck = roe == null ? none("Return on equity", "Equity is zero or negative (often from buybacks), so the ratio would mislead.", "return-on-equity") : {
    title: "Return on equity",
    concept: "return-on-equity",
    value: pc(roe), formula: `Net income ${fmtUSD(L.netIncome)} ÷ equity ${fmtUSD(L.stockholdersEquity)}`,
    tone: roe < 0.1 ? "warn" : roe < 0.15 ? "ok" : "good",
    label: roe < 0.1 ? "Below the cost of equity" : roe < 0.15 ? "Solid" : roe < 0.25 ? "Strong" : "Exceptional",
    note: "Because the business ties up little capital, a healthy fee stream throws off a high return on the equity behind it. Read it with the buyback record: returning capital lifts this ratio honestly, but heavy debt taken to do so can flatter it.",
  };

  return {
    sections: [
      { heading: "Is it a good business?", checks: [omCheck, nmCheck, roeCheck] },
    ],
  };
}

// The "is it a good business?" read for the brief: the durability of the fee margin and
// the high return on a small capital base, with the franchise question left to the filing.
export function feeQuality(company, subtype = "fee") {
  const H = (company?.history || []).filter((h) => h?.lines?.revenue != null);
  const omSeries = H.map((h) => operatingMargin(h.lines)).filter((v) => v != null);
  if (omSeries.length < 3) return null;
  const med = median(omSeries);
  const n = omSeries.length;
  const above = omSeries.filter((v) => v >= 0.25).length;
  const roeSeries = H.map((h) => feeReturnOnEquity(h.lines)).filter((v) => v != null);
  const roeMed = median(roeSeries);
  const noun = KIND_NOUN[subtype] || KIND_NOUN.fee;

  let s1;
  if (med >= 0.35) s1 = `Operating margin has run at toll-booth levels across the record (median ${pc(med)}, above 25% in ${above} of ${n} years), the economics of a franchise that takes a cut without carrying the risk`;
  else if (med >= 0.22) s1 = `Operating margin has held high for a ${noun} (median ${pc(med)} across the record)`;
  else s1 = `Operating margin has been modest for a fee business (median ${pc(med)})`;
  s1 += ".";

  let s2 = "";
  if (roeMed != null) s2 = ` It earns this on little capital, so return on equity has run near ${pc(roeMed)}, the leverage of a model that needs almost no plant to grow.`;

  const driverEnd = {
    "asset-manager": "whether the assets stay (net flows, not last year's market) is what the flow disclosures and the 10-K settle",
    "exchange": "whether the volumes and the data franchise hold their pricing is what the 10-K settles",
    "insurance-broker": "whether the commissions keep renewing as rates turn is what the 10-K settles",
  }[subtype] || "whether the fee stream is durable is what the 10-K settles";
  const s3 = ` A high return that does not fade can mark a moat, but ${driverEnd}, not the multiple.`;

  return { text: [s1, s2, s3].filter(Boolean).join(" ") };
}
