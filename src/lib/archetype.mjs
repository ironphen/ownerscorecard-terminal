// Archetype engine, reads a company's economic model (sector) and situation
// (state overlays) from primary-source data. Free: SIC code + financial shape,
// no generative tools. The classification is transparent by design, every call
// carries the reason it was made, so the page can show its work.

// Owner-earnings margin, so the key-figures strip reads the same Buffett figure (operating cash
// less maintenance capex) the scorecard and tables do. Call-time use only, so the fundamentals ↔
// archetype cycle resolves lazily.
import { ownerEarningsMargin, oiReliable } from "./fundamentals.mjs";
import TAXONOMY from "../data/taxonomy.json" with { type: "json" };
// shelves.json, not shelves.mjs: that module imports THIS one for industryOf, so reading the
// generated data file directly is what keeps the two from importing each other in a circle.
import shelvesData from "../data/shelves.json" with { type: "json" };

// Industry label -> the column family the taxonomy seats it in. The families are the site's own
// curated statement of what KIND of business an industry holds (lender, property, fee, insurer,
// producer, general...), maintained by hand and regenerated into shelves.json by buildTaxonomy.mjs.
const FAMILY_OF_INDUSTRY = new Map();
for (const shelf of shelvesData.shelves || shelvesData) {
  for (const ind of shelf.industries || []) FAMILY_OF_INDUSTRY.set(ind.label, shelf.family);
}

const ratio = (n, d) => (n != null && d ? n / d : null);
const pct = (v, dp = 0) => (v == null ? "—" : `${(v * 100).toFixed(dp)}%`);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const medianOf = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

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
  "4512": "Airlines", "4400": "Cruise lines", "4700": "Travel services", "5812": "Restaurants", "2911": "Oil & gas", "3711": "Automakers",
  "6798": "Real estate", "6500": "Real estate",
  "7320": "Financial data & analytics", "7323": "Financial data & analytics",
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
  // 490/496/497/499 complete the utility family: without them a filer re-resolved to SIC 4900
  // ("Electric & Other Services Combined"), 4961 (steam), or 4991 (cogeneration) falls through to
  // its raw sicDescription and lands as an unshelved orphan label — which blocked a full-pool
  // refetch when one did ("Electric", shelvesTest). Every 49xx now reads Utilities-family.
  "461": "Pipelines", "490": "Utilities", "491": "Utilities", "492": "Gas utilities", "493": "Utilities", "494": "Water utilities", "495": "Waste services", "496": "Utilities", "497": "Utilities", "499": "Utilities",
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
  "Financial data & analytics": "Financial data",
  "Media & entertainment": "Media", "Toys & leisure": "Toys", "Steel & metals": "Steel", "Paints & coatings": "Coatings",
  "Specialty retail": "Retail", "General retail": "Retail", "Apparel retail": "Apparel retail",
};

// Within the financial world, which kind: a lender, an insurer and a REIT are read on
// different statements, but so are an asset manager, an exchange and a managed-care
// plan, none of which a bank's net-interest-margin-and-deposits lens fits. We resolve a
// coarse `kind` (which scorecard and vitals to show) and a finer `subtype` (which words
// to use) from the SEC SIC code, with one data tie-break: a "broker" that funds a real
// balance sheet with deposits (Goldman, Schwab) reads like a bank, while one that does
// not (BlackRock) is a fee-earning asset manager. Authoritative ranges: 60-61 and most
// of 62 are depositories and credit; 6280 is investment advice; 6300-64 insurance, with
// 6324 the medical-plan (managed-care) carve-out and 6411 fee-earning brokers; 65-67
// real estate.
// SIC 6500-6799 filers the REIT desk verified are NOT property trusts, by reading their filings for
// the REIT election and their effective tax rates (docs/reits-desk-survey.md, 2026-07-25).
const NOT_REITS = new Set(["CXW", "HHH", "TCI"]);

export function financialProfile(company) {
  const sic = Number(company?.sic) || 0;
  const L = company?.lines || {};
  const deposits = L.deposits != null && L.deposits > 0;
  if (sic >= 6500 && sic <= 6799) {
    // THE TAXONOMY SAYS WHAT KIND OF BUSINESS THIS IS; the shape tests below only decide how to read
    // the ones it calls property. Added 2026-07-27, and it replaces a shape test that had been
    // quietly wrong for every foreign property filer on the site.
    //
    // The old route to the lender lens was a SIGNATURE: net interest income present, depreciation
    // negligible against assets. That describes a mortgage REIT in US GAAP, and it also describes
    // every IFRS landlord on earth — investment property carried at fair value is NOT depreciated, so
    // the depreciation line is absent for a reason that has nothing to do with owning loans. It fired
    // on IRSA (Argentine shopping centres), Vesta (Mexican industrial parks), Fangdd (a Chinese
    // property portal) and four Brookfield Property preferred series, and it fired on Landbridge, a
    // Texas land and royalty company. Each was then shown a BANK scorecard, and each dragged a bench
    // of real-estate operators onto a bank's lens — /c/IRS printed a 140% return on tangible equity
    // for CBRE, whose tangible equity is NEGATIVE $1.145B. That is the Jones Lang LaSalle defect of
    // 2026-07-26 with a different signature underneath it.
    //
    // Measured before it was written, as the fourth blanket rule of this kind demands: across all 222
    // filers in this SIC range, every one of the 33 genuine mortgage REITs — Annaly, AGNC, Arbor,
    // Claros and the rest — is seated by the taxonomy in Mortgage & Specialty Finance, and every one
    // of the 8 false fires is seated somewhere else. The separation is exact, and it rests on a
    // curated human judgment rather than on the shape of a filing.
    //
    // The trade is stated plainly: a mortgage REIT mis-seated onto a REIT shelf would now get the
    // equity-REIT lens. That is a taxonomy error, and the taxonomy is where it should be fixed —
    // shelves.json is regenerated with a build-time guard, whereas the signature it replaces had no
    // guard at all and was wrong for eight companies on the day it was measured.
    const family = FAMILY_OF_INDUSTRY.get(industryOf(company).label) || null;
    if (family === "lender") return { kind: "bank", subtype: "mortgage-reit" };
    // Everything else the taxonomy seats outside the property family is an operating business, and
    // it is read as one. Deliberately NOT mapped to whatever financial family the shelf carries: the
    // first draft of this rule routed a `fee` shelf to the asset-manager lens and an `insurer` shelf
    // to the underwriting lens, and the fourteen-row diff caught it. SIC 6794 is "patent owners and
    // lessors", which seats Dolby, InterDigital and Acacia in Capital Markets & Asset Management and
    // Innventure in Financial Conglomerates — technology licensors, every one, and none of them an
    // asset manager or an insurer. A shelf's family says which COLUMNS its table shows, which is not
    // the same claim as which financial statement a member is read on. Only the lender family above
    // is mapped, because there the two claims were measured to coincide on all 33 rows.
    if (family && family !== "property") return { kind: null, subtype: null };
    // SIC 6795 (mineral-royalty trusts) is not a property REIT either, so it gets no REIT scorecard.
    if (sic === 6795) return { kind: null, subtype: null };
    // Detect it by the net-interest signature plus negligible depreciation — whatever the SIGN of net
    // interest in a given year (a mortgage REIT can run a negative spread when rates invert), and
    // including a null depreciation line, which is the most loan-pool-like of all. An equity REIT
    // carries real building depreciation, so it never trips the negligible-depreciation test.
    // A real-estate SERVICES firm — brokerage, property and facilities management (CBRE, JLL) — sits
    // in the same SIC range but earns fees, not rent: it turns its asset base over many times a year,
    // so revenue is a large fraction of assets. A rent-collecting REIT turns its property slowly —
    // even a high-yield or operating REIT keeps revenue well under half of a heavy, depreciating asset
    // base — so an asset turn above ~0.5 marks a services operator, not a property trust.
    //
    // THIS TEST RUNS FIRST, and the order is the whole point (fixed 2026-07-26). It used to sit
    // BELOW the mortgage-REIT signature, which meant Jones Lang LaSalle — a property brokerage
    // turning its assets over several times a year — was caught by that signature first and shown a
    // BANK scorecard, with deposits and charge-offs, on its live page. The comment here already
    // named JLL as the case this test existed for; execution simply never reached it. A firm that
    // turns its balance sheet over many times a year is an operator, not a bond portfolio, and that
    // is the more certain fact, so it is asked first.
    const assetTurn = L.revenue != null && L.totalAssets ? L.revenue / L.totalAssets : null;
    if (assetTurn != null && assetTurn > 0.5) return { kind: null, subtype: null };
    // (The net-interest-plus-negligible-depreciation signature that used to sit here was removed on
    // 2026-07-27 — see the note at the top of this branch. The lender lens is now reached through the
    // taxonomy, which separates the 33 real mortgage REITs from the 8 IFRS landlords it misread.)
    //
    // Filers whose SIC says property trust and whose filings say otherwise. A REIT election requires
    // distributing most of taxable income, so the parent pays almost no tax — across the sector the
    // effective rate runs from Simon's 0.4% to Realty Income's 7.5%. These three pay a full corporate
    // rate and state no REIT election anywhere in their recent 10-Ks: CoreCivic 25.9% (a prison
    // operator whose SIC dates to its former name, Prison Realty Trust), Howard Hughes 23.3% (a
    // master-planned-community developer), Transcontinental Realty 33.9% (a C-corp holding company).
    // Each was verified by the REIT desk against the filing text, not inferred.
    //
    // A NAMED LIST RATHER THAN A TAX THRESHOLD, deliberately, and this was tested: a median-rate rule
    // set tight enough to catch CoreCivic at 25.9% also caught Equinix and Iron Mountain, which are
    // genuine REITs carrying large taxable subsidiaries. There is no rate that separates a fake from
    // an operating REIT, so the rule would have traded three wrong classifications for two others.
    // Where evidence has to come from the filing text, the honest instrument is a verified list.
    if (NOT_REITS.has(String(company?.ticker || "").toUpperCase())) return { kind: null, subtype: null };
    return { kind: "reit", subtype: "reit" };
  }
  if (sic >= 6300 && sic <= 6499) {
    if (sic === 6324) return { kind: "managedCare", subtype: "managed-care" };
    if (sic >= 6410 && sic <= 6419) return { kind: "fee", subtype: "insurance-broker" };
    // Life (6310–6319) and accident & health (up to 6321, e.g. Aflac) are read on the spread and
    // book value, not the P&C combined ratio — benefits exceed premiums by design, so a combined
    // ratio reads as a permanent underwriting loss and teaches the wrong thing. The managed-care
    // carve-out (6324) is already handled above; fire/marine/casualty (6331+) stays P&C.
    if (sic >= 6310 && sic <= 6321) return { kind: "insurer", subtype: "life-insurer" };
    // A diversified holding company that happens to own insurers (Berkshire) carries a P&C SIC but
    // books insurance as a small minority of a far larger, mixed revenue base — railroads, energy,
    // manufacturing, retail. A combined ratio then describes a sliver of the company and reads mostly
    // blank: the wrong lens. When premiums are a small fraction of revenue, read it as the diversified
    // capital allocator it is, off the insurer scorecard. (A real P&C insurer's premiums are most of
    // its revenue, so this catches only the conglomerate, not a lightly-levered underwriter.)
    if (L.premiumsEarned != null && L.revenue && L.premiumsEarned / L.revenue < 0.25) return { kind: null, subtype: null };
    // FAIL CLOSED when premiums were never tagged at all. The share test above cannot fire with
    // premiumsEarned null, and that hole is how Berkshire — the company the carve-out was written
    // for — stayed ON the insurer scorecard and printed "Float $17.9B" against the ~$171B its own
    // letter states: with no premium, reserve or unearned-premium tags in any of ten fiscal years,
    // floatOf fell through to a life-basis formula on the one liability sliver that did extract.
    // A filer whose premiums are untagged across its whole record cannot run ANY of the insurer
    // arithmetic honestly; the generic scorecard is the truthful lens. Measured exits (2026-08-05):
    // BRK-A/BRK-B, and the title carriers FAF/ITIC/STC, whose title-premium tags live outside the
    // us-gaap concepts the extractor reads — for them every insurer check was already withholding.
    const premiumsEver = L.premiumsEarned != null || (company?.history || []).some((h) => h?.lines?.premiumsEarned != null);
    if (!premiumsEver && L.revenue) return { kind: null, subtype: null };
    return { kind: "insurer", subtype: "insurer" };
  }
  if (sic >= 6000 && sic <= 6299) {
    if (sic >= 6280 && sic <= 6289) return { kind: "fee", subtype: "asset-manager" };
    if (sic >= 6210 && sic <= 6219)
      return deposits ? { kind: "bank", subtype: "broker-dealer" } : { kind: "fee", subtype: "asset-manager" };
    if (sic >= 6200 && sic <= 6299) return { kind: "fee", subtype: "exchange" };
    // Depository institutions — commercial banks, savings institutions, credit unions (6020–6062) —
    // are banks outright.
    if (sic >= 6020 && sic <= 6062) return { kind: "bank", subtype: "bank" };
    // The nondepository and catch-all "finance services" codes (the rest of 6000–6199, especially
    // 6199) are a grab-bag: genuine lenders, but also crypto miners, fintechs and shells that
    // register here. Read as a bank only when the data shows a lending balance sheet — material
    // deposits or real net interest income — so an Argo Blockchain doesn't get a bank scorecard and
    // a meaningless net interest margin just for carrying a finance SIC. Otherwise it reads as the
    // operating business it actually is. (Same data-tiebreak spirit as the broker-dealer line above.)
    const matDeposits = L.deposits != null && L.totalAssets && L.deposits / L.totalAssets >= 0.1;
    const realNII = L.netInterestIncome != null && L.netInterestIncome > 0;
    return matDeposits || realNII ? { kind: "bank", subtype: "bank" } : { kind: null, subtype: null };
  }
  return { kind: null, subtype: null };
}
export function financialKind(company) { return financialProfile(company).kind; }
export function financialSubtype(company) { return financialProfile(company).subtype; }

export function industryOf(company) {
  const sic = String(company?.sic || "");
  const s4 = sic.slice(0, 4), s3 = sic.slice(0, 3);
  // Japanese filers carry no SIC (EDINET), so they resolve through the taxonomy's per-company
  // JP map — the SAME source shelves.industryLabelOf uses, so the compare card's industry
  // matches the shelf/chapter label instead of falling through to "Diversified" for all 204
  // (2026-07-17 correctness sweep: the standardization wired shelves.mjs but not this path).
  if (company?.market === "JP") {
    const jp = TAXONOMY.overrides[company?.ticker] || TAXONOMY.jp[company?.ticker];
    if (jp) return { sic, key: s3 || s4 || "jp", label: jp.industry, sector: jp.sector, short: SHORT_IND[jp.industry] || jp.industry, desc: company?.sicDescription || null };
  }
  // The conventional sector/industry taxonomy (2026-07-17 standardization): per-ticker
  // override → the member-verified SIC map — assigned where the MEMBERS belong, not where a
  // 1987 SIC description puts them. The legacy SIC_LABEL chain remains as the fallback for
  // anything the taxonomy has never seen (a brand-new SIC enters as its cleaned description
  // until the map catches up; buildTaxonomy.mjs regenerates the map).
  const tx = TAXONOMY.overrides[company?.ticker] || TAXONOMY.sic[s4] || null;
  if (tx) {
    return { sic, key: s3 || s4 || "gen", label: tx.industry, sector: tx.sector, short: SHORT_IND[tx.industry] || tx.industry, desc: company?.sicDescription || null };
  }
  const label = SIC_LABEL[s4] || SIC3_LABEL[s3] || cleanSicDescription(company?.sicDescription) || "Diversified";
  return { sic, key: s3 || s4 || "gen", label, sector: null, short: SHORT_IND[label] || label, desc: company?.sicDescription || null };
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
  // Retail — but eating & drinking places (5810–5819) are a brand and an operation, not a
  // thin-margin inventory retailer; the inventory-turns lens misreads a restaurant, so route
  // them to the consumer-brand read (operating margin, gross margin, owner earnings).
  if (c >= 5810 && c <= 5819) return "consumer";
  if (c >= 5200 && c <= 5999) return "retail";
  // Capital-intensive: extraction, heavy manufacturing, transport, utilities
  if (c >= 1000 && c <= 1799) return "capital";          // mining, oil & gas, construction
  if (c >= 2900 && c <= 2999) return "capital";          // petroleum refining
  if (c >= 3200 && c <= 3569) return "capital";          // stone/glass, metals, fabricated, machinery (non-computer)
  if (c >= 3580 && c <= 3669) return "capital";          // machinery, electrical equipment (non-semi)
  if (c >= 3700 && c <= 3799) return "capital";          // transportation equipment (autos, aerospace)
  // Transportation SERVICES — travel agencies and online travel (4700, 4720–4729), freight
  // arrangement and forwarding (4730–4739) — are asset-light arrangers that own no planes, trucks
  // or track. The broad transport-and-utilities bucket below would misread them as capital-intensive,
  // so route them to the financial-shape read, which reads online-travel and freight-broker economics
  // (fat margins, negligible capex) as asset-light — and still catches a genuinely heavy operator in
  // this band (a railcar lessor) by its own capex through the shape read.
  if (c >= 4700 && c <= 4789) return null;               // transport services → shape (asset-light arrangers)
  if (c >= 4000 && c <= 4991) return "capital";          // transport, communications, utilities
  return null;                                           // chemicals, paper, instruments, misc → shape
}

// Financial shape → sector. Fallback when SIC is missing or unmapped. A business that
// holds real inventory or spends real capex makes physical goods at scale, so it reads
// capital-intensive, not retail; only fat-margin, inventory-light models are asset-light.
function sectorFromShape(s) {
  if (s.rev == null) return "general";
  const hiGM = s.grossMargin != null && s.grossMargin >= 0.5;
  // Inventory-light includes carrying NO inventory at all: a pure service or platform (an online
  // marketplace, a ratings or data franchise, a freight broker) reports no inventory line, which is
  // the most inventory-light a business can be — so a null reads as light, not as "unknown/heavy".
  const loInv = s.invToRev == null || s.invToRev < 0.05;
  const someInv = s.invToRev != null && s.invToRev >= 0.1;
  const hiCapex = s.capexToRev != null && s.capexToRev >= 0.08;
  // Owned-or-leased plant that is a large share of the balance sheet marks a capital-intensive
  // operator however fat the margin or however little inventory it holds — a theater chain or a
  // hospital that leases its buildings reads heavy here, where the margin-and-inventory test alone
  // had read it light. Balance-sheet share (not the revenue multiple) is the signal, so a thin-revenue
  // company cannot trip it on a near-zero denominator.
  const heavyPlant = s.ppeToAssets != null && s.ppeToAssets >= 0.35;
  if (hiCapex) return "capital";              // heavy fixed assets
  if (heavyPlant) return "capital";           // owned or leased plant dominates the balance sheet
  if (loInv && hiGM) return "assetLight";     // IP-led, inventory-light, fat margins
  if (hiGM) return "consumer";                // fat margins on modest capex → a brand
  if (someInv) return "capital";              // makes physical goods at scale on thin margins
  // Nothing in the shape positively read as a model — typically a fee/service/holding business that
  // reports no cost-of-revenue line (a payment network, a data franchise, a diversified holding company
  // like Berkshire). Read it honestly as "general / diversified" rather than masquerade the unreadable
  // shape as a confident "consumer brand" — which was wrong for ~3% of the universe, the famous capital
  // allocators and networks worst of all. The default key-figures (operating + owner-earnings margin)
  // then drop the "Gross margin —" a no-COGS business would otherwise show.
  return "general";
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
      return "a lender's balance sheet; the economics live in book value, net interest margin and loan losses";
    case "reit":
      return "a property model where GAAP depreciation distorts earnings; the economics live in FFO and net asset value";
    default:
      return "not enough shape in the filings to read the model with confidence";
  }
}

// ---- overlays: the situation (zero or more) ----

function overlays(company, s) {
  const L = company.lines || {};
  const hist = company.history || [];
  const out = [];

  // Regulated utility: the one situation set by law rather than by the record. Returns are
  // capped and floored by a regulator on an approved rate base, which reframes every other
  // overlay that may follow (heavy capex is the growth mechanism, not an omen). Leads the line.
  // Electric (4911), combination utilities (4931/4932), gas distribution (4924), water (4941).
  // Deliberately NOT gas transmission/pipelines (4922/4923): midstream tolls are contracts and
  // FERC tariffs, not an approved rate base, and the copy below would overclaim there.
  const sicNum = parseInt(company.sic, 10);
  if ([4911, 4924, 4931, 4932, 4941].includes(sicNum)) {
    out.push({ key: "utility", label: "Regulated utility",
      reason: "returns are set by regulation on an approved rate base; the capital spending regulators approve becomes the growth, recovered through allowed rates" });
  }

  if ((L.netIncome != null && L.netIncome < 0) || (L.operatingIncome != null && L.operatingIncome < 0)) {
    // Unprofitable growth, judged on the record rather than one year. Graham would not brand a
    // business unprofitable on a single down year (a writedown, a build-out, a cyclical trough),
    // which the cyclical and build-out overlays and the normalized-earnings read handle. Require
    // the latest year in the red AND the multi-year record to confirm it: too short to tell, or
    // most years unprofitable, or a through-cycle median at or below zero — and no recovery already
    // visible in the trailing twelve months.
    const niHist = hist.map((h) => h.lines.netIncome).filter((v) => v != null);
    const ttmNi = company.ttm?.lines?.netIncome ?? null;
    const negShare = niHist.length ? niHist.filter((v) => v < 0).length / niHist.length : 0;
    const medNi = niHist.length ? medianOf(niHist) : null;
    if ((niHist.length < 3 || negShare >= 0.5 || (medNi != null && medNi <= 0)) && !(ttmNi != null && ttmNi > 0)) {
      // The label tests losses, never growth — plenty of flagged names are shrinking — so it says
      // "Unprofitable" and no more. The reason is declarative only: overlays concatenate when a
      // company carries several, and instructions collide where facts cannot ("judge it on
      // growth" beside distress's "not growth" was a live contradiction on a sixth of the pages).
      // Pre-revenue carve: "the gross-margin trajectory" is nonsense copy for a clinical-stage
      // biotech; when revenue is de minimis the record is the runway and nothing else.
      const preRevenue = s.rev == null || s.rev < 5e7;
      out.push({ key: "unprofitable", label: "Unprofitable",
        reason: preRevenue
          ? "no meaningful revenue yet; the record is the cash on hand against the burn"
          : "no sustained operating profit across the record; an earnings multiple has nothing to rest on. What the record does show is revenue, the gross-margin trajectory, and the burn against the cash on hand" });
    }
  }

  // Distress / turnaround, also read through the cycle: a persistent inability to cover interest,
  // or operating cash that burns against real debt — a pattern, not one rough year on an otherwise
  // sound record (which is a cyclical trough or a one-off, read elsewhere). Three guards, each
  // learned from a live misfire: interest expense must be a real cost (a sign-flipped tag made
  // Disney's positive operating income read as negative coverage), the debt must be material
  // against the balance sheet (net-cash Palantir was "distressed" on a rounding-error interest
  // line), and a trailing twelve months that comfortably covers interest breaks the pattern —
  // the same recovery escape the unprofitable overlay has always had.
  const debtMaterial = L.totalDebt != null && (L.totalAssets ? L.totalDebt / L.totalAssets > 0.05 : L.totalDebt > 0);
  const covHist = hist.map((h) => (h.lines.operatingIncome != null && h.lines.interestExpense > 0 ? h.lines.operatingIncome / h.lines.interestExpense : null)).filter((v) => v != null);
  const medCov = covHist.length ? medianOf(covHist) : null;
  const cfoHist = hist.map((h) => h.lines.cashFromOps).filter((v) => v != null);
  const cfoBurnShare = cfoHist.length ? cfoHist.filter((v) => v < 0).length / cfoHist.length : 0;
  const latestBurn = L.cashFromOps != null && L.cashFromOps < 0 && debtMaterial;
  const ttmL = company.ttm?.lines || null;
  const ttmCov = ttmL && ttmL.operatingIncome != null && ttmL.interestExpense > 0 ? ttmL.operatingIncome / ttmL.interestExpense : null;
  const ttmClear = ttmCov != null ? ttmCov >= 3 : !!(ttmL && ttmL.operatingIncome > 0 && ttmL.cashFromOps > 0);
  if (((medCov != null && medCov < 1.5 && debtMaterial) || (latestBurn && cfoBurnShare >= 0.4)) && !ttmClear) {
    out.push({ key: "distress", label: "Distress / turnaround",
      reason: "thin interest coverage, or operating cash burned against real debt, across the record. The balance sheet carries this situation; the debt schedule sets the clock" });
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
        reason: "margins collapse and recover repeatedly across the record; a single year, good or bad, misstates the through-cycle earning power" });
    }
  }

  // Serial acquirer: growth by purchase — Munger's distinct animal (the Teledyne-vs-Valeant
  // fork). The tell is structural, not one deal: goodwill and acquired intangibles a large share
  // of the balance sheet AND acquisition spending recurring across the record.
  if (hist.length >= 4 && L.totalAssets > 0) {
    const gwShare = ((L.goodwill || 0) + (L.intangibleAssets || 0)) / L.totalAssets;
    const acqYears = hist.filter((h) => {
      const a = Math.abs(h.lines.acquisitionSpend || 0);
      const r = h.lines.revenue;
      return a > 0 && r > 0 && a > 0.02 * r;
    }).length;
    // High bar on purpose: a third of large caps make occasional acquisitions; the overlay is for
    // the business whose balance sheet says buying is the model. The label names the category;
    // the reason states only what the record shows, never the causality.
    if (gwShare > 0.35 && acqYears >= 4) {
      out.push({ key: "rollup", label: "Serial acquirer",
        reason: `goodwill and acquired intangibles are ${pct(gwShare)} of assets, with meaningful acquisition spending in ${acqYears} of the record's ${hist.length} years; much of what this business is was bought, at prices the record carries` });
    }
  }

  // Revenue in runoff: the top line shrinking across the record while operations still throw off
  // cash — the melting ice cube. Not a cyclical down-leg (that overlay claims those pages), and
  // not a burner: this is the shape where the record's most important fact is the shrinkage.
  if (!out.some((o) => o.key === "cyclical") && !out.some((o) => o.key === "unprofitable")) {
    const revPts = hist.filter((h) => h.lines.revenue > 0).map((h) => ({ fy: h.fy, v: h.lines.revenue }));
    if (revPts.length >= 6) {
      const first = revPts[0], last = revPts[revPts.length - 1];
      const span = last.fy - first.fy;
      const cagr = span >= 5 ? Math.pow(last.v / first.v, 1 / span) - 1 : null;
      let downs = 0, steps = 0;
      for (let i = 1; i < revPts.length; i++) { steps++; if (revPts[i].v < revPts[i - 1].v) downs++; }
      const cfoH = hist.map((h) => h.lines.cashFromOps).filter((v) => v != null);
      const medCfo = cfoH.length ? medianOf(cfoH) : null;
      if (cagr != null && cagr < -0.02 && downs >= steps / 2 && medCfo != null && medCfo > 0) {
        out.push({ key: "runoff", label: "Revenue in runoff",
          reason: `revenue has shrunk about ${pct(-cagr)} a year across the record while operations still generate cash` });
      }
    }
  }

  // Graham's asset play: liquid current assets exceed every liability combined — the net-net
  // shape, stated from the balance sheet alone (whether the price sits below it is the reader's
  // arithmetic, with the quote they bring). A bare surplus catches every cash-rich compounder,
  // which is a different situation; the overlay is for the page where the balance sheet IS the
  // story, so the surplus must dominate the whole asset base.
  const totalLiab = L.totalAssets != null && L.stockholdersEquity != null ? L.totalAssets - L.stockholdersEquity : null;
  if (L.currentAssets != null && totalLiab != null && totalLiab > 0 && L.totalAssets > 0) {
    const ncav = L.currentAssets - totalLiab;
    // An established earner with a cash-heavy balance sheet is not an asset play — its earnings
    // are the story (Palantir carried this label for a day). Three straight profitable years
    // retires the shape; Graham's net-nets were businesses the market valued on their assets
    // precisely because the earnings couldn't carry the case.
    const recent = hist.slice(-3).map((h) => h.lines.netIncome);
    const establishedEarner = recent.length >= 3 && recent.every((v) => v != null && v > 0);
    if (ncav > 0 && ncav >= 0.5 * L.totalAssets && !establishedEarner) {
      out.push({ key: "assetplay", label: "Net current asset value",
        reason: "current assets alone exceed every liability combined, and the surplus is most of the balance sheet: the shape Graham called a net-net" });
    }
  }

  return out;
}

// ---- AI exposure: structural contestability of the moat by artificial intelligence ----
// Does cheap, capable AI contest the moat (software, information, advertising, the services
// whose product AI can now produce) or barely touch it (regulated networks, physical assets,
// deposit and float franchises, or hardware that AI is a tailwind for)? A lens on the
// industry from its SIC code, never a verdict on the company; the filing's own words refine it.
export function aiExposure(company) {
  const sic = Number(company?.sic) || 0;
  const inR = (a, b) => sic >= a && sic <= b;
  // Elevated: AI lowers the cost of producing the very thing the business sells.
  if (
    inR(7370, 7379) || sic === 7389 ||  // software, data processing, IT & business services
    inR(2700, 2799) ||                  // publishing and content
    inR(7310, 7319) ||                  // advertising
    inR(8740, 8749) ||                  // management and PR consulting
    inR(7360, 7369)                     // staffing / help supply (labor automation)
  ) return {
    tier: "elevated", label: "AI-contestable",
    reason: "the product is software or information, the very thing capable AI now produces more cheaply, so the moat is more contestable than the record alone implies",
  };
  // Low: a physical, regulated, deposit/float-funded moat AI streamlines costs within but
  // does not contest, or hardware AI is a tailwind for.
  if (
    inR(1000, 1799) ||                  // mining, extraction, construction
    inR(2000, 2199) ||                  // food and beverage
    inR(2800, 2999) ||                  // chemicals, pharma, refining
    inR(3300, 3999) ||                  // metals, machinery, hardware, semis, aerospace, defense
    inR(4000, 4999) ||                  // transport, rail, pipelines, utilities
    inR(6020, 6199) ||                  // depository and credit institutions (deposit moat)
    inR(6300, 6799)                     // insurers, real estate, REITs
  ) return {
    tier: "low", label: null,
    reason: "the moat is physical, regulated or balance-sheet-funded, the kind AI cuts costs within but does not contest",
  };
  // Securities, exchanges, asset managers, ratings and financial-data businesses (6200–6299):
  // network and regulatory moats on one side, an information product AI contests on the other.
  // Moderate: AI reshapes costs and some products without clearly contesting or sparing the moat.
  return {
    tier: "moderate", label: null,
    reason: "AI is likely to reshape costs and some products here without clearly contesting or sparing the core moat; how the company itself frames it is the tell",
  };
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
    // Owned plant (net PP&E) plus the leased plant a business runs on (the operating-lease
    // right-of-use asset). Intensity against sales and against the balance sheet is the evidence
    // that separates a capital-intensive operator from an asset-light one when margins and inventory
    // alone mislead. A null line reads as zero, so a company missing the data simply reads light.
    ppeToRev: ratio((L.netPPE || 0) + (L.operatingLeaseAsset || 0), rev),
    // PP&E plus the lease asset are components of total assets, so the ratio cannot exceed ~1; a value
    // well above it is a mis-scaled or stale data point (GIBO at 130×), not a real reading — decline it
    // rather than let it force a classification.
    ppeToAssets: (() => { const a = L.totalAssets ? ((L.netPPE || 0) + (L.operatingLeaseAsset || 0)) / L.totalAssets : null; return a != null && a <= 1.5 ? a : null; })(),
  };
}

// The few figures that matter most for this kind of business.
export function keyFigures(company, sectorKey) {
  const L = company.lines || {};
  const rev = L.revenue;
  const gm = rev && L.costOfRevenue != null ? 1 - L.costOfRevenue / rev : null;
  const oem = ownerEarningsMargin(L, company);
  const opm = ratio(L.operatingIncome, rev);
  const f = (label, value) => ({ label, value });
  switch (sectorKey) {
    case "assetLight":
      return [f("Gross margin", pct(gm)), f("Stock comp / revenue", pct(ratio(L.stockBasedComp, rev), 1)), f("Owner-earnings margin", pct(oem))];
    case "retail":
      return [f("Inventory turns", L.inventory && L.costOfRevenue ? `${(L.costOfRevenue / L.inventory).toFixed(1)}×` : "—"), f("Operating margin", pct(opm, 1)), f("Owner-earnings margin", pct(oem))];
    case "capital":
      return [f("Capex / revenue", pct(ratio(L.capex != null ? Math.abs(L.capex) : null, rev))), f("Capex vs depreciation", L.capex && L.depreciation ? `${(Math.abs(L.capex) / L.depreciation).toFixed(2)}×` : "—"), f("Owner-earnings margin", pct(oem))];
    case "consumer":
      return [f("Operating margin", pct(opm, 1)), f("Gross margin", pct(gm)), f("Owner-earnings margin", pct(oem))];
    default:
      return [f("Operating margin", pct(opm, 1)), f("Owner-earnings margin", pct(oem))];
  }
}

export function classify(company) {
  const s = shapeOf(company);
  let key = sectorFromSIC(company?.sic);
  let bySic = key != null;
  // A semiconductor maker that owns its fabs (TSMC, Intel, ASE) is capital-intensive, not asset-light,
  // however the chip SIC defaults. Scoped to the semiconductor codes on purpose: a software business
  // pouring capex into AI data centers (Oracle, Microsoft) is still asset-light in character — a temporary
  // build-out, not heavy plant — so it must not be swept up. A fabless chip designer (low capex) stays
  // asset-light too.
  const sicN = Number(company?.sic) || 0;
  if (key === "assetLight" && sicN >= 3670 && sicN <= 3679 && s.capexToRev != null && s.capexToRev >= 0.12) { key = "capital"; bySic = false; }
  // A "cloud" or "AI-infrastructure" operator carries a software SIC but owns or leases the data
  // centers and servers it rents out, so its plant both dwarfs its revenue AND is the bulk of its
  // balance sheet — CoreWeave, Applied Digital. Read it as the capital-intensive operator it is. The
  // dual test holds out a true software business pouring a temporary buildout into AI capacity (Oracle,
  // Microsoft, Google), whose plant stays a minority of a far larger asset base, and a cash-rich
  // pre-revenue name (Aurora, IonQ) whose plant is tiny against its war chest.
  if (key === "assetLight" && sicN >= 7370 && sicN <= 7379 && s.ppeToRev != null && s.ppeToRev >= 1 && s.ppeToAssets != null && s.ppeToAssets >= 0.6) { key = "capital"; bySic = false; }
  // A catch-all finance SIC that the financial-profile tiebreak rejected (a crypto miner or fintech
  // with no lending balance sheet) is not actually a financial; reading it as one would label it a
  // "lender's balance sheet" while showing the industrial scorecard. Recompute its model from shape.
  if (key === "financial" && !financialKind(company)) { key = null; bySic = false; }
  if (!key) key = sectorFromShape(s);
  // A Japanese trading house (sogo shosha — Mitsubishi, Itochu, Mitsui, Sumitomo, Marubeni) earns
  // mostly through equity-method affiliates, so its operating line is dwarfed by net income — the same
  // signature oiReliable flags. That marks a diversified holding-and-trading company, read on the
  // discipline of its capital allocation, not the consumer brand the thin-shape fallback guesses.
  if (company?.market === "JP" && !oiReliable(company)) key = "general";
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
