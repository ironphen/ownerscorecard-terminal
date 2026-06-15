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
};
const IND = {
  "491": _util, "492": _util, "493": _util, "494": _util,
  "131": _energy, "132": _energy, "290": _energy, "291": _energy, "299": _energy, "138": _energy, "461": _midstream,
  "451": _airline, "452": _airline, "401": _rail, "470": _logistics, "473": _logistics, "421": _logistics,
  "371": _auto, "372": _aero, "376": _aero,
  "351": _machinery, "352": _machinery, "353": _machinery, "354": _machinery, "355": _machinery, "356": _machinery, "358": _machinery, "359": _machinery,
  "280": _chem, "281": _chem, "282": _chem, "285": _chem, "286": _chem, "287": _chem, "289": _chem,
  "101": _metals, "104": _metals, "140": _metals, "331": _metals, "332": _metals, "333": _metals, "334": _metals, "335": _metals,
  "283": _pharma, "384": _meddev, "381": _instr, "382": _instr,
  "800": _health, "805": _health, "806": _health, "807": _health, "808": _health,
  "367": _semis, "737": _software, "481": _telecom, "482": _telecom, "489": _telecom, "581": _restaurant,
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
export function weakLede(s) {
  if (!s || typeof s !== "string") return true;
  return /^we have entered\b/i.test(s) || WEAK_LEDE.test(s) || /\bvarious (facilities|services|agreements|arrangements)\b/i.test(s);
}
