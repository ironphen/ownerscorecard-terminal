// The qualitative "what it is" / "what moves the needle" copy, shared by the page hero
// and the business brief so they read from one source. The industry layer (by SIC) is
// finer than the 8 economic models, so a utility, an airline and an oil major don't all
// read as a generic "capital-intensive business." Every line teaches the lens for that
// kind of business; none is a verdict on this one.
import { classify, financialKind, financialSubtype } from "./archetype.mjs";

// One lever and one one-line characterization per economic model (the fallback layer).
const LEVER = {
  assetLight: "Whether the advantage is durable, not just the margin high. What decides it: the moat that keeps the returns up, a network, switching costs, intellectual property; whether stock paid to staff is quietly diluting owners; and whether the cash can be reinvested at the same high rate or only handed back.",
  consumer: "Pricing power, the surest mark of a moat. What decides it: whether it can raise prices with inflation and not lose the customer, whether the brand still earns its place on the shelf, and whether volume holds when a cheaper rival appears.",
  capital: "Whether the heavy assets earn more than they cost to keep. What decides it: the return on the capital sunk into them, how much of the capex is merely standing still versus growing, and what a downturn does to a fixed-cost base. Here the balance sheet is the defense and cyclicality the enemy.",
  retail: "Unit economics, and whether the moat is real low cost or genuine convenience. What decides it: same-store sales, how fast inventory turns back into cash, and whether thin margins survive the next price war or the shift online.",
  financial: "Net interest margin, loan losses, and book value. A lender is read on the quality of its balance sheet, not an earnings multiple, and the worst year of credit losses matters more than the best.",
  insurer: "Underwriting discipline and the float. What decides it: whether the combined ratio stays below 100% so the policies make money on their own, how large the float is against equity, and what that float earns once it is invested.",
  reit: "Occupancy, rents, and the cost of debt. Read on funds from operations and net asset value, because GAAP depreciation distorts the earnings, and a property downturn meets a balance sheet built on leverage.",
  general: "Where the revenue and the profit actually come from, and whether the returns are earned by a real advantage or bought with capital. The segment detail in the 10-K is where this one is settled.",
};
const MODEL_PHRASE = {
  assetLight: "An asset-light business: the value sits in intellectual property and people, not plant, so the question is how durable the advantage is, not how high the margin.",
  consumer: "A consumer-brand business, where the durable asset is the brand and the pricing power it commands.",
  capital: "A capital-intensive business, run on heavy physical assets that must be kept working and earn a return above what they cost to maintain.",
  retail: "A retailer, earning thin margins on high volume, where inventory turns, unit economics and scale decide the outcome.",
  financial: "A balance-sheet business, read on book value, net interest margin and credit losses rather than an earnings multiple.",
  insurer: "An insurance business, read on its underwriting result, the combined ratio, and the float it invests, rather than an earnings multiple.",
  reit: "A property business, read on funds from operations and net asset value rather than reported earnings.",
  general: "A diversified business; where the profit really comes from, and whether it is earned or bought, is what the segment detail settles.",
};

// The industry layer (3-digit SIC), overriding the model copy for non-financials.
const _util = { p: "A regulated utility, earning a set return on the capital it sinks into its network.", l: "Rate base and the allowed return. What decides it: the capital plan the regulator approves, the return allowed on that base, and the cost of the debt that funds it. Growth is the rate base; the risk is the regulatory compact and rising rates." };
const _energy = { p: "An oil and gas business, whose fortunes rise and fall with a price it does not set.", l: "The commodity price, and the cost to lift a barrel. What decides it: the price of oil and gas, reserve replacement, and how low the break-even sits when the price falls. It controls its costs, not its prices." };
const _midstream = { p: "A midstream energy business, paid to move and store hydrocarbons under contract.", l: "Throughput and the contracts behind it. What decides it: volumes across the network, how much revenue is fee-based rather than commodity-exposed, and the leverage carried against those cash flows." };
const _airline = { p: "An airline, a high-fixed-cost business selling a perishable seat.", l: "Load factor against unit cost, and fuel. What decides it: how full the planes fly, cost per available seat mile, and the price of jet fuel, with heavy fixed costs and little pricing power in a downturn." };
const _rail = { p: "A freight railroad, hauling goods across a heavy fixed-cost network it alone owns.", l: "Volume and pricing against the operating ratio. What decides it: carloads, which track the economy; pricing power on a network rivals cannot replicate; and how much of each revenue dollar the network consumes." };
const _logistics = { p: "A logistics business, moving goods across a network of assets and partners.", l: "Volume, density and yield. What decides it: shipment volumes, which track trade and the economy; how densely the network runs; and pricing against a largely fixed cost base." };
const _auto = { p: "An automaker, turning heavy plant and development spend into vehicles sold through the cycle.", l: "Volume, mix and the cost of the platform. What decides it: units sold, how rich the mix is, and whether the fixed cost of plants and engineering is covered when demand softens." };
const _aero = { p: "An aerospace and defense contractor, working a multi-year backlog of large programs.", l: "The backlog and program execution. What decides it: the order book, whether big programs are delivered on cost, and the balance between defense, which is budget-driven, and commercial, which is cycle-driven." };
const _machinery = { p: "A capital-goods maker, whose demand swings with its customers' own spending.", l: "The capital-goods cycle and the aftermarket. What decides it: new-equipment demand, which tracks customers' capex; the steadier parts-and-service stream that cushions it; and operating leverage on a fixed cost base." };
const _chem = { p: "A chemicals business, converting feedstocks into products at a spread the cycle moves.", l: "The spread and utilization. What decides it: the gap between product prices and feedstock costs, how full the plants run, and where it sits when the commodity cycle turns down." };
const _metals = { p: "A metals and mining business, a price-taker on a global commodity.", l: "The commodity price and the cost position. What decides it: the price of the metal, which is out of its hands; where the operation sits on the cost curve; and the discipline not to overbuild at the top." };
const _pharma = { p: "A pharmaceutical business, where patents grant a temporary monopoly the pipeline must keep refilling.", l: "The pipeline against the patent cliff, and pricing. What decides it: whether new drugs replace those losing exclusivity, the odds in the clinical pipeline, and how durable pricing stays against payers and generics." };
const _meddev = { p: "A medical-device business, placing equipment that pulls consumables and service behind it.", l: "The installed base and what follows it. What decides it: placing the device, then the higher-margin consumables and service it drags along, and the R&D and regulatory path to the next generation." };
const _instr = { p: "A precision-instruments business, selling measurement and electronic gear into labs and production lines.", l: "The installed base and the upgrade cycle. What decides it: design wins and placements, the recurring consumables and service, and the R&D pace in a fragmented, specification-driven market." };
const _health = { p: "A healthcare-services business, paid to deliver or facilitate care.", l: "Volume, payer mix and reimbursement. What decides it: patient or procedure volume, the mix of who pays and how well, and the rates set by payers and regulators." };
const _semis = { p: "A semiconductor business, riding a brutal capacity cycle on the edge of Moore's Law.", l: "Process leadership and the capex cycle. What decides it: staying ahead on the node, or designing around it as a fabless firm; the pricing power that lead brings; and not overbuilding into the downturn." };
const _software = { p: "A software business, earning high margins on code once it is written.", l: "Retention and the cost of growth. What decides it: whether customers expand rather than churn, how much of revenue is spent winning the next one, and whether software's gross margin holds as it scales." };
const _telecom = { p: "A telecom carrier, renting access to a network that must be constantly rebuilt.", l: "Subscribers, revenue per user, and network capex. What decides it: net adds against churn, ARPU, and the relentless capital to keep the network competitive." };
const _restaurant = { p: "A restaurant business, earning on traffic through its doors and the returns on each new unit.", l: "Same-store sales and unit economics. What decides it: traffic and check at existing locations, the return on each new unit, and whether the model is franchised, an asset-light royalty stream, or company-owned." };
const _hotel = { p: "A hotel and lodging business, earning on rooms filled and the brand that fills them.", l: "Occupancy and revenue per available room, and the model. What decides it: how full the rooms run and at what rate (RevPAR), the shift toward asset-light franchising and management fees over owning the real estate, and how demand holds when travel softens." };
const _ship = { p: "A shipbuilder and defense contractor, working a multi-year backlog of large naval programs.", l: "The backlog and program execution. What decides it: the order book of naval and commercial vessels, whether large multi-year programs are delivered on cost, and the balance between budget-driven defense work and the cycle in commercial shipping." };
const _findata = { p: "A financial-data and analytics business, selling the information, ratings and benchmarks the markets run on.", l: "Recurring subscriptions and the data moat. What decides it: how much revenue renews each year against the share that rides the cycle of new debt issuance on the ratings side, the pricing power of being embedded in customers' workflows and benchmarks, and the operating leverage as the same data is sold again at almost no extra cost." };
// Finer than the eight economic models where a financial subtype earns its own lens: an
// asset manager, an exchange, an insurance broker and a health plan are each read on
// something a bank's deposit-and-spread lens would miss entirely. Teaches the lens for
// that kind of business; never a verdict on this one.
const SUBTYPE_COPY = {
  "asset-manager": {
    p: "An asset manager, paid a fee on the money it runs for other people.",
    l: "Assets under management and the fee rate on them. What decides it: net flows in or out, the market's move on the assets already there (the firm rises and falls with the indices it invests in), the drift toward cheaper passive products, and the operating leverage on a largely fixed cost base.",
  },
  "exchange": {
    p: "An exchange, a toll booth on trading and the market data that trading generates.",
    l: "Trading volume and the data franchise. What decides it: volumes across its markets, which spike when volatility does; the network economics of a deep liquidity pool rivals cannot easily replicate; and the recurring, high-margin market-data and listing fees layered on top.",
  },
  "insurance-broker": {
    p: "An insurance broker, paid a commission to place coverage without bearing the risk itself.",
    l: "Commissions on the premiums it places, and organic growth. What decides it: insurance prices in the market, since it earns a slice of them; new business won and kept; and a capital-light fee stream that carries none of the underwriting risk of the insurers it sells for.",
  },
  "managed-care": {
    p: "A managed-care business, taking in premiums and paying out its members' medical claims.",
    l: "The medical loss ratio and membership. What decides it: keeping medical costs below the premiums collected, where a regulated floor sets how much must be paid out as care, so the spread is thin; membership growth across commercial, Medicare and Medicaid; and the cost discipline on what little is left.",
  },
  "life-insurer": {
    p: "A life insurer, collecting premiums for decades and earning a spread on the reserves it invests until claims fall due.",
    l: "The spread on the float and the growth in book value. What decides it: the gap between what the invested reserves earn and what is credited to policyholders, the mortality and fee margins on top, and the scale of the float against equity. Benefits exceed premiums by design, so a P&C combined ratio is the wrong lens; the risks are interest rates and reserve adequacy.",
  },
};
const IND = {
  "491": _util, "492": _util, "493": _util, "494": _util,
  "131": _energy, "132": _energy, "290": _energy, "291": _energy, "299": _energy, "138": _energy, "461": _midstream,
  "451": _airline, "452": _airline, "401": _rail, "470": _logistics, "473": _logistics, "421": _logistics,
  "371": _auto, "372": _aero, "376": _aero, "373": _ship,
  "351": _machinery, "352": _machinery, "353": _machinery, "354": _machinery, "355": _machinery, "356": _machinery, "358": _machinery, "359": _machinery,
  "280": _chem, "281": _chem, "282": _chem, "285": _chem, "286": _chem, "287": _chem, "289": _chem,
  "101": _metals, "104": _metals, "140": _metals, "331": _metals, "332": _metals, "333": _metals, "334": _metals, "335": _metals,
  "283": _pharma, "384": _meddev, "381": _instr, "382": _instr,
  "800": _health, "805": _health, "806": _health, "807": _health, "808": _health,
  "367": _semis, "737": _software, "481": _telecom, "482": _telecom, "489": _telecom, "581": _restaurant,
  "700": _hotel, "701": _hotel,
};
// A few four-digit overrides where the three-digit group is too coarse: credit-reporting
// and ratings/data firms (S&P Global, Moody's) sit in a generic "business services" SIC.
const IND4 = { "7320": _findata, "7323": _findata };

function modelKeyOf(company) {
  const fk = financialKind(company);
  if (fk === "insurer") return "insurer";
  if (fk === "reit") return "reit";
  if (fk === "bank") return "financial";
  return classify(company).sector.key;
}
// Industry copy overrides only the non-financial models; banks, insurers and REITs keep
// their own lens, which their financialKind-routed scorecards depend on. The fee and
// managed-care subtypes are handled before this by SUBTYPE_COPY.
function indEntryOf(company) {
  if (financialKind(company)) return null;
  const sic = String(company?.sic || "");
  return IND4[sic.slice(0, 4)] || IND[sic.slice(0, 3)] || null;
}

// What moves the needle: the lever for this business. A financial subtype with its own
// lens (asset manager, exchange, broker, health plan) wins first, then the industry, then
// the economic model.
export function businessLever(company) {
  const sub = financialSubtype(company);
  if (sub && SUBTYPE_COPY[sub]) return SUBTYPE_COPY[sub].l;
  const ind = indEntryOf(company);
  return (ind && ind.l) || LEVER[modelKeyOf(company)] || LEVER.general;
}
// The lens clause for a SPECIFIC industry, to capstone the data-grounded needle (lib/needle.mjs) with
// the one thing the margins can't show: the freight railroad's operating ratio, the drugmaker's patent
// cliff, the oil major's commodity price, the data franchise's recurring subscriptions. Only the named
// industries earn a clause — the eight generic economic models (the source of the repetition) get none,
// so a thin-margin assembler reads its own numbers and nothing canned. Returns the lever's lead lens
// sentence (the part before "What decides it:"), or null. Financials route to their statement-specific
// lever instead and never reach here.
export function industryLensClause(company) {
  const ind = indEntryOf(company);
  if (!ind || !ind.l) return null;
  const lead = ind.l.split(/\.\s/)[0];
  return lead ? lead.replace(/\.*$/, "") + "." : null;
}
// A one-line characterization of what the business is, the computed fallback for the
// hero when the filing has no clean description, and the brief's "what it is".
export function businessPhrase(company) {
  const sub = financialSubtype(company);
  if (sub && SUBTYPE_COPY[sub]) return SUBTYPE_COPY[sub].p;
  const ind = indEntryOf(company);
  return (ind && ind.p) || MODEL_PHRASE[modelKeyOf(company)] || MODEL_PHRASE.general;
}

// A weak lede: the extracted Item 1 sentence is about the company's contracts or
// structure, not what it does, so the hero should fall back to the computed phrase.
const WEAK_LEDE = /\b(entered into|agreements?|arrangements?)\b[^.]{0,50}\b(contractor|third part|provider|supplier|vendor|counterpart)/i;
// A sentence that the ranking surfaced but that does not actually say what the business
// is: a strategy or aspiration, a governance note, a production or sales-channel detail,
// or one named segment standing in for the whole. When the hero is one of these, the
// computed industry phrase is the better opener, so we treat the verbatim as weak.
const NOT_A_DESCRIPTION = new RegExp(
  "^(" +
    "we are (leveraging|committed to|pursuing|executing|positioned|transforming|dedicated to|focused on (being|delivering|creating))|" +
    "we (strive|seek|aim|intend|plan|continue to|are confident)|" +
    "our (public benefit |corporate )?(purpose|mission|vision|strateg|goals?|values|history|story|charter|culture)|" +
    "we (centrally )?produce our|" +
    "we (currently )?(market|sell)\\b[^.]{0,70}\\b(directly through|in (more than|over|excess of)|across (the )?(globe|world|\\d))|" +
    "we operate (our|the) business through|" +
    "[A-Z][a-z]+ includes our\\b" +
  ")",
  "i"
);
// Boilerplate or non-company sentences that occasionally lead the extraction: the
// auditor's own statement (the PCAOB independence language from the audit report), a
// named property standing in for the business, or a forward-looking / mission line. When
// the hero is one of these, the computed industry phrase is the better opener.
const LEAKED = /public accounting firm|registered with the pcaob|\bstudio lot\b|we expect to (continue|make|invest|incur|spend)\b|deliver value and|operates under a consistent business/i;
// A leaked all-caps heading or banner the extraction mistook for a sentence: a long run of
// uppercase before any lowercase (Kroger's "OUR VALUE CREATION MODEL…", a stray "MANAGEMENT'S
// DISCUSSION AND ANALYSIS…", an "MD&A ABOUT…" prefix). Not a description, so the hero falls back to
// the segment mix or the computed phrase. Measured against every stored lede: matches only genuine
// headings, no real description.
const ALLCAPS_HEADING = /^[A-Z0-9][A-Z0-9 ,&'’.\/-]{17,}/;
// A competition list ("Our competitors include banks, thrifts…") or an operating-process sentence
// ("We normally purchase our feedstocks weeks before…") that the extraction took for a description.
// Render-time twin of the fetch scorer's BIZ_NOTDESC, so a name already carrying one of these in
// the data falls back to the segment mix or the phrase now, without waiting on a re-fetch.
const NOT_DESC = /\bcompetitors?\s+(include|are|consist|compete|comprise)|^(we|our)\s+(normally|typically|generally|usually|principally|routinely)\s+(purchase|buy|sell|acquire|obtain|source|procure|market|distribute|manufacture|produce)\b/i;
// A sentence describing one of the company's products, not the company: "Apple Vision Pro is the
// Company's spatial computer based on its visionOS operating system." The "<thing> is the Company's
// <thing>" form means the subject is a product or subsidiary the company owns, never the company
// itself — so fall back to the segment mix. (A real company description says "<Company> is a …",
// never "is the Company's …".)
const PRODUCT_REF = /\bis\s+the\s+(compan|registrant|firm|group|corporation|business|parent)\w*['’]s\b/i;
export function weakLede(s) {
  if (!s || typeof s !== "string") return true;
  return /^we have entered\b/i.test(s) || WEAK_LEDE.test(s) || ALLCAPS_HEADING.test(s) || NOT_DESC.test(s) || PRODUCT_REF.test(s) ||
    /\bvarious (facilities|services|agreements|arrangements)\b/i.test(s) || NOT_A_DESCRIPTION.test(s) || LEAKED.test(s);
}

// A reviewed, model-drafted note (src/data/notes.json, governed by
// docs/qualitative-doctrine.md) overrides the computed template for the two
// descriptive reads — "what it is" and "what moves the needle" — for the names a
// human has actually written up. A pure selector: the caller passes the notes data
// in, so this lib stays runnable under plain node (which needs an import attribute
// to load JSON) while the .astro components feed it the Vite-imported object. Only
// a note explicitly marked reviewed renders; anything else falls back to the
// template, so nothing un-reviewed reaches a page. The number is never in here —
// notes carry prose only; every figure stays arithmetic in the sections below.
export function pickNote(notesData, ticker) {
  const companies = notesData?.companies || {};
  let n = companies[String(ticker || "").toUpperCase()];
  // A share-class sibling (BRK-A beside BRK-B, GOOG beside GOOGL) carries only { alias } and points
  // at the canonical note on the company's main ticker — same business, so the prose lives once.
  if (n && n.alias) n = companies[String(n.alias).toUpperCase()];
  return n && n.reviewed === true && (n.whatItIs || n.needle) ? n : null;
}

// A flag whose quote is plainly a financial-statement or table fragment the extractor mis-tagged
// as a risk — a geography/segment table header, a cash-flow line, a results sentence — rather than
// a real risk the filing raises. Munger's "no flim-flam": "what the filing emphasizes" must show the
// company's own words on what could go wrong, not a mis-read table caption. Render-side only; the raw
// flag stays in the data.
const MISTAGGED_FLAG = new RegExp([
  // statement / table headers and cash-flow lines
  "\\bthe following table\\b", "\\btable (below|presents)\\b",
  "\\b(financing|investing|operating) activities\\s*\\$", "\\bcash (used in|provided by) (operating|investing|financing) activities\\b",
  // MD&A variance and results sentences (a movement, not a risk)
  "\\bcost of (sales|revenue|goods)\\b[^.]{0,30}\\b(increased|decreased|was|associated)\\b",
  "\\boperating margins?\\b[^.]{0,45}\\b(reflect|was|were|impacted|positively|negatively|for \\d{4})\\b",
  "\\b(revenues?|net (sales|income|cash)|operating (income|cash|expenses?)|gross (profit|margin))\\b[^.]{0,30}\\b(increased|decreased|by geography|by segment|by region)\\b",
  "\\b\\d+(\\.\\d+)?\\s*%\\s+(growth|increase|decrease) in\\b",
  // accounting-policy definitions
  "\\b(includes all|classif\\w+ all)\\b[^.]{0,40}\\b(highly liquid|debt instruments|marketable|cash equivalents)\\b",
  // exhibit / contract / indenture indices
  "\\bas trustee,?\\s+relating to\\b", "\\bmaterial contracts\\b", "\\b\\d+(\\.\\d+)?\\s*% (senior|subordinated)\\b",
  // currency-sensitivity tables
  "\\bchange in (usd|eur|jpy|fx|exchange|[a-z]{3}) rate\\b[^.]{0,30}\\beffect on\\b", "\\bschedule of foreign currency\\b",
  // affirmations of NO dependence — the opposite of a risk
  "\\bdoes not consider any of its businesses\\b", "\\bnot materially (dependent|reliant)\\b", "\\bneither our business as a whole\\b",
  // cross-references to another item, not a risk in themselves
  "\\bin item \\d+[a-z]? of this (annual report|report|form)\\b",
  // geography / segment revenue tables
  "^\\s*revenues? by (geography|segment|region|product)\\b",
].join("|"), "i");
export function cleanOwnerFlags(flags) {
  return (Array.isArray(flags) ? flags : []).filter((f) => f && typeof f.quote === "string" && f.quote.length >= 30 && !MISTAGGED_FLAG.test(f.quote));
}

// Customer concentration, read off the filing's own sentence so the weld can turn "who the revenue
// leans on" into dollars: what share of the top line — and so how many dollars — ride on the biggest
// buyer(s). The extractor's Customer-concentration flag carries the share-of-revenue percentage in its
// quote; this parses it conservatively, the integrity bar being precision over coverage. It must see a
// real concentration phrase ("largest customer", "top N customers"), bind the percentage to revenue or
// sales (never accounts receivable, backlog, new-insurance-written, a deposit or a loan book), and
// reject the three things that wear concentration's clothes: a GEOGRAPHIC split ("revenue from
// customers outside the U.S."), a customer-TYPE breakdown ("commercial and residential customers"),
// and a DENIAL ("we did not have any customer over 10%"). A compound sentence that names both a single
// largest customer and a separate top-N is ambiguous about which figure is which, so it is declined
// rather than guessed. Returns { pct, multi } — the share of revenue and whether it leans on more than
// one buyer — or null when no figure can be read with confidence and the number must stand alone.
const CC_SINGLE = /\b(?:(?:our|its|the)\s+)?(?:single\s+)?(?:largest|biggest|principal|most\s+significant|number\s+one|#?\s?1)\s+(?:end[\s-]?)?customer\b/i;
const CC_ONE = /\b(?:one|a\s+single)\s+(?:end[\s-]?)?customer\b/i;
const CC_MULTI = /\b(?:top\s+(?:\w+|\d+)|(?:two|three|four|five|six|seven|eight|nine|ten|\d+|several|few)\s+(?:of\s+(?:these\s+|our\s+)?)?(?:end[\s-]?)?customers|(?:\w+|\d+)\s+largest\s+(?:end[\s-]?)?customers)\b/i;
const CC_DENIAL = /\b(?:no|did\s+not\s+have|does\s+not\s+have|have\s+not\s+had|without|not)\s+(?:any\s+|a\s+|one\s+|had\s+any\s+)?(?:single\s+|individual\s+)?customers?\b/i;
const CC_GEO_TYPE = /\bcustomers?\s+(?:located\s+|based\s+)?(?:in|outside|within)\b|\boutside\s+(?:of\s+)?(?:the\s+)?(?:u\.?s\.?|united states)\b|\bby\s+(?:geograph|region|customer\s+type)\b|\b(?:commercial|residential|industrial)\s+and\s+(?:commercial|residential|industrial)\s+customers\b|\bcustomer\s+type\b/i;
const CC_NON_REVENUE = /\b(accounts?\s+receivable|receivables?|backlog|deferred|bookings?|niw|new\s+insurance\s+written|in\s?force|autopay|automatic|deposits?|loans?|aum|assets\s+under|capacity|proppant)\b/i;
const CC_REV = "(?:net\\s+sales|net\\s+revenues?|total\\s+(?:net\\s+)?revenues?|consolidated\\s+(?:net\\s+)?(?:revenues?|sales)|company\\s+revenues?|revenues?|sales)";
const CC_SEP = "\\s*(?:,\\s*and\\s+|,\\s*&\\s*|,\\s*|\\s+and\\s+|\\s*&\\s*)";
function ccRevenueBoundPcts(quote) {
  const out = [];
  let m;
  const fwd = new RegExp(`(\\d{1,3}(?:\\.\\d+)?)\\s*(?:%|percent)\\s*(?:to|of)\\s+([^.%]{0,28}?)\\b${CC_REV}\\b`, "gi");
  while ((m = fwd.exec(quote))) { if (!CC_NON_REVENUE.test(m[2] || "")) out.push({ pct: parseFloat(m[1]), idx: m.index }); }
  const lst = new RegExp(`((?:\\d{1,3}(?:\\.\\d+)?\\s*%${CC_SEP})+\\d{1,3}(?:\\.\\d+)?\\s*%)\\s*(?:to|of)\\s+([^.%]{0,28}?)\\b${CC_REV}\\b`, "gi");
  while ((m = lst.exec(quote))) {
    if (CC_NON_REVENUE.test(m[2] || "")) continue;
    for (const x of m[1].matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)) out.push({ pct: parseFloat(x[1]), idx: m.index });
  }
  const bwd = new RegExp(`\\b${CC_REV}\\b([^.%]{0,34}?)\\b(?:was|were|represent\\w*|account\\w*|comprised|attributable|attributed|derived)\\b([^.%]{0,18}?)(\\d{1,3}(?:\\.\\d+)?)\\s*(?:%|percent)`, "gi");
  while ((m = bwd.exec(quote))) { if (!CC_NON_REVENUE.test((m[1] || "") + (m[2] || ""))) out.push({ pct: parseFloat(m[3]), idx: m.index }); }
  return out.filter((o) => o.pct >= 5 && o.pct <= 99).sort((a, b) => a.idx - b.idx);
}
export function customerConcentration(quote) {
  if (!quote || typeof quote !== "string") return null;
  if (CC_GEO_TYPE.test(quote) || CC_DENIAL.test(quote)) return null;
  const single = CC_SINGLE.test(quote) || CC_ONE.test(quote);
  const multi = CC_MULTI.test(quote);
  if (!single && !multi) return null;
  if (single && multi) return null; // a compound statement — ambiguous which figure belongs to which
  const bound = ccRevenueBoundPcts(quote);
  if (!bound.length) return null;
  // A multi-year series ("77%, 93%, 97% in fiscal 2025, 2024, 2023") leads with the latest period;
  // distinct customers in one year ("23%, 19%, 12%, respectively") lead with the largest.
  const years = new Set([...quote.matchAll(/\b(?:19|20)\d{2}\b/g)].map((x) => x[0]));
  const pcts = bound.map((b) => b.pct);
  const pct = (years.size >= 2 ? pcts[0] : Math.max(...pcts)) / 100;
  return { pct, multi };
}
