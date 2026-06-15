// Archetype engine, reads a company's economic model (sector) and situation
// (state overlays) from primary-source data. Free: SIC code + financial shape,
// no generative tools. The classification is transparent by design, every call
// carries the reason it was made, so the page can show its work.

const ratio = (n, d) => (n != null && d ? n / d : null);
const pct = (v, dp = 0) => (v == null ? "—" : `${(v * 100).toFixed(dp)}%`);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ---- sector: the business model, the lens for how to read the company ----

const SECTORS = {
  assetLight: "Asset-light compounder",
  consumer: "Consumer & brand",
  capital: "Capital-intensive",
  retail: "Retail & distribution",
  financial: "Bank / financial",       // phase 2, different statements
  reit: "REIT / real estate",          // phase 2
  general: "General",
};

// A short adjective for the model, for a chip beside the industry.
const SECTOR_ADJ = {
  assetLight: "asset-light", consumer: "consumer brand", capital: "capital-intensive",
  retail: "retail", financial: "financial", reit: "REIT", general: "diversified",
};

// ---- industry: what the company actually does, from its SEC SIC code. This is the
// identity (and the peer key); the model above is only the lens. SIC cannot be fooled
// by margins the way the financial-shape read can, so a high-margin marketer like
// WD-40 reads as specialty chemicals, not as a software compounder. ----

const SIC_LABEL = {
  "3571": "Computers & devices", "3674": "Semiconductors", "7372": "Enterprise software",
  "7370": "Internet platforms", "5961": "Online retail", "2080": "Beverages", "2086": "Beverages",
  "2840": "Household & personal care", "2844": "Household & personal care", "2842": "Household & personal care",
  "2670": "Household & personal care", "2890": "Specialty chemicals", "5331": "Discount & variety retail",
  "5311": "Department stores", "5211": "Home-improvement retail", "4813": "Telecom", "4812": "Wireless telecom",
  "4512": "Airlines", "4400": "Cruise lines", "5812": "Restaurants", "2911": "Oil & gas", "3711": "Automakers",
  "6798": "Real estate", "6500": "Real estate",
};
const SIC3_LABEL = {
  // technology & electronics
  "357": "Computer hardware", "367": "Semiconductors", "737": "Software & internet",
  "360": "Electrical equipment", "361": "Electrical equipment", "362": "Electrical equipment",
  "363": "Appliances", "366": "Communications equipment", "369": "Electrical equipment",
  "381": "Instruments", "382": "Instruments", "384": "Medical devices", "387": "Instruments",
  // industrial machinery & transport equipment
  "351": "Industrial machinery", "352": "Industrial machinery", "353": "Industrial machinery",
  "354": "Industrial machinery", "355": "Industrial machinery", "356": "Industrial machinery",
  "358": "Industrial machinery", "359": "Industrial machinery",
  "371": "Autos & parts", "372": "Aerospace & defense", "373": "Shipbuilding", "376": "Aerospace & defense",
  // materials, chemicals, energy
  "280": "Chemicals", "281": "Chemicals", "282": "Chemicals", "283": "Pharma",
  "285": "Paints & coatings", "286": "Chemicals", "287": "Agricultural chemicals", "289": "Chemicals",
  "290": "Oil & gas", "291": "Oil & gas", "299": "Oil & gas",
  "131": "Oil & gas", "138": "Oil & gas", "101": "Mining", "104": "Mining", "140": "Mining",
  "331": "Steel & metals", "333": "Metals", "334": "Metals", "335": "Metals",
  "320": "Building materials", "324": "Building materials", "327": "Building materials", "326": "Building materials",
  "260": "Paper & packaging", "261": "Paper & packaging", "262": "Paper & packaging", "265": "Paper & packaging", "267": "Paper & packaging",
  // consumer staples & brands
  "200": "Packaged food", "201": "Packaged food", "202": "Packaged food", "203": "Packaged food",
  "204": "Packaged food", "205": "Packaged food", "206": "Packaged food", "207": "Packaged food", "209": "Packaged food",
  "208": "Beverages", "211": "Tobacco", "220": "Apparel", "230": "Apparel", "231": "Apparel", "232": "Apparel",
  "284": "Household & personal care", "301": "Footwear & apparel", "302": "Footwear & apparel", "314": "Footwear & apparel",
  "394": "Toys & leisure", "395": "Office & toys",
  // transport, comms, utilities
  "401": "Railroads", "421": "Trucking & logistics", "440": "Cruise & shipping", "441": "Cruise & shipping",
  "451": "Airlines", "452": "Airlines", "470": "Logistics", "473": "Logistics",
  "481": "Telecom", "482": "Telecom", "489": "Telecom", "483": "Media", "484": "Media",
  "461": "Pipelines", "491": "Utilities", "492": "Gas utilities", "493": "Utilities", "494": "Water utilities", "495": "Waste services",
  // retail & distribution
  "520": "Home & building retail", "521": "Home & building retail", "523": "Home & building retail",
  "531": "General retail", "533": "Discount retail", "540": "Grocery", "541": "Grocery",
  "550": "Auto retail", "551": "Auto retail", "553": "Auto retail", "561": "Apparel retail", "565": "Apparel retail", "566": "Apparel retail",
  "570": "Home furnishings", "571": "Home furnishings", "573": "Electronics retail", "581": "Restaurants", "591": "Drug stores", "596": "E-commerce", "599": "Specialty retail",
  "501": "Distribution", "504": "Distribution", "511": "Distribution", "512": "Pharma distribution", "514": "Food distribution", "518": "Distribution",
  // finance, insurance, real estate
  "601": "Banks", "602": "Banks", "603": "Savings banks", "612": "Mortgage finance", "614": "Consumer finance",
  "615": "Financial services", "616": "Mortgage finance", "619": "Financial services",
  "620": "Capital markets", "621": "Capital markets", "622": "Capital markets", "623": "Capital markets", "628": "Asset management",
  "631": "Insurance", "632": "Health insurance", "633": "Insurance", "635": "Insurance", "641": "Insurance brokers",
  "651": "Real estate", "653": "Real estate", "655": "Real estate", "671": "Holding company", "679": "Real estate",
  // services & healthcare
  "700": "Hotels", "701": "Hotels", "730": "Business services", "731": "Business services", "732": "Business services",
  "733": "Business services", "736": "Staffing", "738": "Business services",
  "780": "Media & entertainment", "790": "Entertainment", "799": "Entertainment",
  "800": "Healthcare services", "805": "Healthcare services", "806": "Healthcare services", "807": "Lab services", "808": "Healthcare services",
  "873": "Research services", "874": "Professional services",
};

function cleanSicDescription(d) {
  if (!d) return null;
  return d.replace(/^(services?|retail|wholesale)\s*[-–]\s*/i, "").replace(/\s*\([^)]*\)/g, "").replace(/,.*$/, "").replace(/\s{2,}/g, " ").trim() || null;
}

// A compact label for tight spaces (the catalog table).
const SHORT_IND = {
  "Computers & devices": "Computers", "Enterprise software": "Software", "Software & internet": "Software",
  "Internet platforms": "Internet", "Online retail": "E-commerce", "Semiconductors": "Semis",
  "Household & personal care": "Household", "Specialty chemicals": "Chemicals", "Discount & variety retail": "Big-box retail",
  "Discount retail": "Big-box retail", "Department stores": "Dept. stores", "Home-improvement retail": "Home improv.",
  "Home & building retail": "Home retail", "Wireless telecom": "Wireless", "Cruise lines": "Cruise", "Cruise & shipping": "Cruise",
  "Packaged food": "Food", "Paper & packaging": "Paper", "Aerospace & defense": "Aerospace",
  "Industrial machinery": "Machinery", "Autos & parts": "Autos", "Footwear & apparel": "Apparel",
  "Healthcare services": "Healthcare", "Business services": "Services", "Agricultural chemicals": "Ag chemicals",
  "Building materials": "Materials", "Communications equipment": "Comms equip.", "Electrical equipment": "Electrical",
  "Medical devices": "Med devices", "Trucking & logistics": "Logistics", "Capital markets": "Capital mkts",
  "Asset management": "Asset mgmt", "Pharma distribution": "Pharma dist.", "Food distribution": "Food dist.",
  "Media & entertainment": "Media", "Toys & leisure": "Toys", "Steel & metals": "Steel", "Paints & coatings": "Coatings",
  "Specialty retail": "Retail", "General retail": "Retail", "Apparel retail": "Apparel retail",
};

// Within the financial world, which kind: banks, insurers and REITs are read on
// different statements, so the page needs to tell them apart. By SIC, which is
// authoritative: 60-62 depositories and credit, 63-64 insurance, 65-67 real estate.
export function financialKind(company) {
  const sic = Number(company?.sic) || 0;
  if (sic >= 6500 && sic <= 6799) return "reit";
  if (sic >= 6300 && sic <= 6499) return "insurer";
  if (sic >= 6000 && sic <= 6299) return "bank";
  return null;
}

export function industryOf(company) {
  const sic = String(company?.sic || "");
  const s4 = sic.slice(0, 4), s3 = sic.slice(0, 3);
  const label = SIC_LABEL[s4] || SIC3_LABEL[s3] || cleanSicDescription(company?.sicDescription) || "Diversified";
  return { sic, key: s3 || s4 || "gen", label, short: SHORT_IND[label] || label, desc: company?.sicDescription || null };
}


// SIC ranges → sector. Primary signal when we have it. Carve-outs (asset-light,
// consumer brands) come first; the rest of heavy manufacturing and extraction is
// capital-intensive; genuinely ambiguous codes (most chemicals, paper, instruments)
// fall through to the shape read below.
function sectorFromSIC(sic) {
  const c = Number(sic);
  if (!c) return null;
  // Finance / insurance / real estate
  if (c >= 6000 && c <= 6499) return "financial";
  if (c >= 6500 && c <= 6799) return "reit";
  // Asset-light: software & IT services, semiconductors (fabless / IP-led)
  if (c >= 7370 && c <= 7379) return "assetLight";
  if (c >= 3670 && c <= 3679) return "assetLight";
  // Consumer brands & staples (the brand or the IP is the asset, not the plant)
  if (c >= 3570 && c <= 3579) return "consumer";         // computer & office hardware
  if (c >= 2000 && c <= 2399) return "consumer";         // food, beverage, tobacco, textiles, apparel
  if (c >= 2830 && c <= 2836) return "consumer";         // pharma & biologics
  if (c >= 2840 && c <= 2844) return "consumer";         // soap, cosmetics, personal care
  if (c >= 3000 && c <= 3199) return "consumer";         // footwear, leather, rubber goods
  if (c >= 3940 && c <= 3949) return "consumer";         // toys & games
  // Retail
  if (c >= 5200 && c <= 5999) return "retail";
  // Capital-intensive: extraction, heavy manufacturing, transport, utilities
  if (c >= 1000 && c <= 1799) return "capital";          // mining, oil & gas, construction
  if (c >= 2900 && c <= 2999) return "capital";          // petroleum refining
  if (c >= 3200 && c <= 3569) return "capital";          // stone/glass, metals, fabricated, machinery (non-computer)
  if (c >= 3580 && c <= 3669) return "capital";          // machinery, electrical equipment (non-semi)
  if (c >= 3700 && c <= 3799) return "capital";          // transportation equipment (autos, aerospace)
  if (c >= 4000 && c <= 4991) return "capital";          // transport, communications, utilities
  return null;                                           // chemicals, paper, instruments, misc → shape
}

// Financial shape → sector. Fallback when SIC is missing or unmapped. A business that
// holds real inventory or spends real capex makes physical goods at scale, so it reads
// capital-intensive, not retail; only fat-margin, inventory-light models are asset-light.
function sectorFromShape(s) {
  if (s.rev == null) return "general";
  const hiGM = s.grossMargin != null && s.grossMargin >= 0.5;
  const loInv = s.invToRev != null && s.invToRev < 0.05;
  const someInv = s.invToRev != null && s.invToRev >= 0.1;
  const hiCapex = s.capexToRev != null && s.capexToRev >= 0.08;
  if (hiCapex) return "capital";              // heavy fixed assets
  if (loInv && hiGM) return "assetLight";     // IP-led, inventory-light, fat margins
  if (hiGM) return "consumer";                // fat margins on modest capex → a brand
  if (someInv) return "capital";              // makes physical goods at scale on thin margins
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
  // The distress, build-out and cyclical overlays are industrial heuristics (built on
  // operating cash flow, capex and operating margin) that misfire on a bank, whose
  // cash-flow statement and capex mean something different. Keep only "unprofitable"
  // for financials; their soundness is read properly in the bank scorecard instead.
  let ovs = overlays(company, s);
  if (key === "financial" || key === "reit") ovs = ovs.filter((o) => o.key === "unprofitable");
  return {
    sector: { key, label: SECTORS[key] || SECTORS.general, adj: SECTOR_ADJ[key] || SECTOR_ADJ.general, reason: sectorReason(key, s), bySic },
    industry: industryOf(company),
    overlays: ovs,
    figures: keyFigures(company, key),
  };
}
