// Archetype engine, reads a company's economic model (sector) and situation
// (state overlays) from primary-source data. Free: SIC code + financial shape,
// no generative tools. The classification is transparent by design, every call
// carries the reason it was made, so the page can show its work.

const ratio = (n, d) => (n != null && d ? n / d : null);
const pct = (v, dp = 0) => (v == null ? "—" : `${(v * 100).toFixed(dp)}%`);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ---- sector: the business model (pick one) ----

const SECTORS = {
  assetLight: "Asset-light compounder",
  consumer: "Consumer & brand",
  capital: "Capital-intensive",
  retail: "Retail & distribution",
  financial: "Bank / financial",       // phase 2, different statements
  reit: "REIT / real estate",          // phase 2
  general: "General",
};

// SIC ranges → sector. Primary signal when we have it.
function sectorFromSIC(sic) {
  const c = Number(sic);
  if (!c) return null;
  if (c >= 6000 && c <= 6499) return "financial";
  if (c >= 6500 && c <= 6799) return "reit";
  if (c >= 4000 && c <= 4991) return "capital";          // transport, comms, utilities
  if (c >= 1000 && c <= 1499) return "capital";          // mining
  if (c >= 1300 && c <= 1399) return "capital";          // oil & gas extraction
  if (c >= 2900 && c <= 2999) return "capital";          // petroleum refining
  if (c >= 7370 && c <= 7379) return "assetLight";       // software & IT services
  if (c >= 3670 && c <= 3679) return "assetLight";       // semiconductors & components (fabless / IP-led)
  if (c >= 5200 && c <= 5999) return "retail";
  if (c >= 2000 && c <= 2199) return "consumer";         // food, beverage, tobacco
  if (c >= 2300 && c <= 2399) return "consumer";         // apparel
  if (c >= 2800 && c <= 2899) return "consumer";         // household / personal products
  if (c >= 3571 && c <= 3579) return "consumer";         // computer/consumer hardware (brand-led)
  return null;
}

// Financial shape → sector. Fallback when SIC is missing or unmapped.
function sectorFromShape(s) {
  if (s.rev == null) return "general";
  const hiInv = s.invToRev != null && s.invToRev > 0.08;
  const loInv = s.invToRev != null && s.invToRev < 0.04;
  const hiGM = s.grossMargin != null && s.grossMargin >= 0.55;
  const loGM = s.grossMargin != null && s.grossMargin < 0.35;
  const hiCapex = s.capexToRev != null && s.capexToRev > 0.12;
  if (hiInv && loGM) return "retail";
  if (hiCapex && !hiGM) return "capital";
  if (loInv && hiGM) return "assetLight";
  return "consumer";
}

function sectorReason(key, s) {
  switch (key) {
    case "assetLight":
      return `little inventory and a ${pct(s.grossMargin)} gross margin, the value is in IP and people, not factories`;
    case "retail":
      return `inventory near ${pct(s.invToRev)} of sales on a ${pct(s.grossMargin)} gross margin, a thin-margin, inventory-driven model`;
    case "capital":
      return `capital spending runs ${pct(s.capexToRev)} of sales, the model is built on heavy physical assets`;
    case "consumer":
      return `a branded-goods profile${s.grossMargin != null ? ` at a ${pct(s.grossMargin)} gross margin` : ""}, the asset is the brand and shelf position`;
    case "financial":
      return "a lender's balance sheet, judged on book value, net interest margin and loan losses (fuller treatment coming)";
    case "reit":
      return "a property model where GAAP depreciation distorts earnings, judged on FFO and net asset value (fuller treatment coming)";
    default:
      return "not enough shape in the filings to read the model with confidence";
  }
}

// ---- overlays: the situation (zero or more) ----

function overlays(company, s) {
  const L = company.lines || {};
  const hist = company.history || [];
  const out = [];

  if ((L.netIncome != null && L.netIncome < 0) || (L.operatingIncome != null && L.operatingIncome < 0)) {
    out.push({ key: "unprofitable", label: "Unprofitable growth",
      reason: "no operating profit yet, judge it on revenue growth, gross-margin trajectory, cash burn and runway, never on an earnings multiple" });
  }

  const cov = L.operatingIncome != null && L.interestExpense ? L.operatingIncome / L.interestExpense : null;
  // Real distress = can't cover interest, or operations themselves burn cash,  // not merely negative free cash flow, which heavy capex (a build-out) also causes.
  if ((cov != null && cov < 1.5) || (L.cashFromOps != null && L.cashFromOps < 0 && L.totalDebt > 0)) {
    out.push({ key: "distress", label: "Distress / turnaround",
      reason: "thin interest coverage or cash-burning operations against real debt, the first questions are liquidity and the maturity wall, not growth" });
  }

  // Capital build-out (the Chanos lens): capex elevated AND surging vs its own past.
  const capexToRev = ratio(s.capex, s.rev);
  if (capexToRev != null && capexToRev > 0.12 && hist.length >= 4) {
    const half = Math.max(1, Math.floor(hist.length / 2));
    const earlyAvg = avg(hist.slice(0, half).map((h) => ratio(Math.abs(h.lines.capex), h.lines.revenue)).filter((x) => x != null));
    if (earlyAvg != null && capexToRev > earlyAvg * 1.4) {
      out.push({ key: "buildout", label: "Capital build-out",
        reason: `capital spending has surged to ${pct(capexToRev)} of sales, today's earnings are charged less depreciation than tomorrow's will be` });
    }
  }

  // Deep cyclical: margins that recurringly collapse, not a one-off writedown.
  const margins = hist.map((h) => ratio(h.lines.operatingIncome, h.lines.revenue)).filter((x) => x != null);
  if (margins.length >= 5) {
    const sorted = [...margins].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const troughs = margins.filter((x) => x < median * 0.5).length; // recurring bad years, not one
    const range = Math.max(...margins) - Math.min(...margins);
    if (median > 0 && troughs >= 2 && range > 0.1) {
      out.push({ key: "cyclical", label: "Cyclical",
        reason: "margins collapse repeatedly across the cycle, a single year misleads; look at normalized, through-cycle earnings and the balance sheet at the trough" });
    }
  }

  return out;
}

// ---- shape + the public API ----

function shapeOf(company) {
  const L = company.lines || {};
  const rev = L.revenue;
  return {
    rev,
    grossMargin: rev && L.costOfRevenue != null ? 1 - L.costOfRevenue / rev : null,
    invToRev: ratio(L.inventory, rev),
    capexToRev: ratio(L.capex != null ? Math.abs(L.capex) : null, rev),
    sbcToRev: ratio(L.stockBasedComp, rev),
    capex: L.capex != null ? Math.abs(L.capex) : null,
  };
}

// The few figures that matter most for this kind of business.
export function keyFigures(company, sectorKey) {
  const L = company.lines || {};
  const rev = L.revenue;
  const gm = rev && L.costOfRevenue != null ? 1 - L.costOfRevenue / rev : null;
  const oem = L.cashFromOps != null && L.capex != null && rev ? (L.cashFromOps - Math.abs(L.capex)) / rev : null;
  const opm = ratio(L.operatingIncome, rev);
  const f = (label, value) => ({ label, value });
  switch (sectorKey) {
    case "assetLight":
      return [f("Gross margin", pct(gm)), f("Stock comp / revenue", pct(ratio(L.stockBasedComp, rev), 1)), f("Owner Earnings margin", pct(oem))];
    case "retail":
      return [f("Inventory turns", L.inventory && L.costOfRevenue ? `${(L.costOfRevenue / L.inventory).toFixed(1)}×` : "—"), f("Operating margin", pct(opm, 1)), f("Owner Earnings margin", pct(oem))];
    case "capital":
      return [f("Capex / revenue", pct(ratio(L.capex != null ? Math.abs(L.capex) : null, rev))), f("Capex vs depreciation", L.capex && L.depreciation ? `${(Math.abs(L.capex) / L.depreciation).toFixed(2)}×` : "—"), f("Owner Earnings margin", pct(oem))];
    case "consumer":
      return [f("Operating margin", pct(opm, 1)), f("Gross margin", pct(gm)), f("Owner Earnings margin", pct(oem))];
    default:
      return [f("Operating margin", pct(opm, 1)), f("Owner Earnings margin", pct(oem))];
  }
}

export function classify(company) {
  const s = shapeOf(company);
  let key = sectorFromSIC(company?.sic);
  let bySic = key != null;
  if (!key) key = sectorFromShape(s);
  return {
    sector: { key, label: SECTORS[key] || SECTORS.general, reason: sectorReason(key, s), bySic },
    overlays: overlays(company, s),
    figures: keyFigures(company, key),
  };
}
