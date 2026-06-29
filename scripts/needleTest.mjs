// Offline regression for the data-grounded "what moves the needle" generator (src/lib/needle.mjs), the
// read that replaced the repetitive archetype template with a fingerprint computed from the company's own
// record. The bar is the product's bar — PRECISION OVER RECALL and PRESENT, NEVER PRONOUNCE — so the
// fixtures assert: the right lever for the shape (a thin-margin assembler reads on volume and cost, never
// "pricing power"); the swing read through the cycle by its true MECHANISM (a commodity cycle, operating
// spend below a fat gross line, or a thin spread's cost arithmetic — never one template for all three); a
// negative cash cycle described, never crowned "a structural edge"; a price-taker's spread "set by the
// cycle", never "commanded"; loss-makers split three ways (charge-driven, healthy-gross burner, no-gross
// burner); financials and thin records withheld; and never a verdict. Fixtures are modelled on real shapes
// (SMCI, Apple, Coca-Cola, Visa, Nvidia, Chevron, 3M, Salesforce, Snowflake, GE, Lockheed). Run with `npm test`.
import { needleReport } from "../src/lib/needle.mjs";
import { industryLensClause } from "../src/lib/business.mjs";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); cond ? pass++ : fail++; };

// Build a synthetic company with a controlled record. `om` is the operating-margin series (chronological,
// oldest→newest); a single number means a flat record. Lines are scaled to revenue 1000 each year so the
// ratios are exact. Only the fields a fixture sets are present, so an unset line reads as missing (null),
// exactly as a real filing that doesn't tag it would.
function co({ sic = "3571", market, om, gm = null, inv = null, capex = null, dep = null, sbc = null, recv = null, ap = null }) {
  const oms = Array.isArray(om) ? om : Array(10).fill(om);
  // `gm` may be a single number (a steady gross margin) or a per-year series (a swinging one — a commodity
  // or demand cycle moving the price through the gross line). A series lets a fixture exercise the
  // grossSwings gate that separates a true cycle from a one-off charge below a steady gross line.
  const gms = Array.isArray(gm) ? gm : gm == null ? null : Array(oms.length).fill(gm);
  const mk = (m, g) => {
    const rev = 1000, L = { revenue: rev, operatingIncome: Math.round(m * rev) };
    if (g != null) L.costOfRevenue = Math.round((1 - g) * rev);
    if (inv != null) L.inventory = Math.round(inv * rev);
    if (capex != null) L.capex = -Math.round(capex * rev);
    if (dep != null) L.depreciation = Math.round(dep * rev);
    if (sbc != null) L.stockBasedComp = Math.round(sbc * rev);
    if (recv != null) L.receivables = Math.round(recv * rev);
    if (ap != null) L.accountsPayable = Math.round(ap * rev);
    return L;
  };
  const n = oms.length;
  return { ticker: "TEST", sic, market, lines: mk(oms[n - 1], gms ? gms[n - 1] : null), history: oms.map((m, i) => ({ fy: 2015 + i, lines: mk(m, gms ? gms[i] : null) })) };
}
const txt = (c) => { const r = needleReport(c); return r ? r.text : null; };

// ---- the margin structure: the right lever for the shape, never the archetype's ----

// A thin-margin assembler (SMCI shape): the lever is volume and cost, NOT pricing power — the whole point.
const thin = txt(co({ gm: 0.14, om: [0.026, 0.03, 0.03, 0.03, 0.04, 0.05, 0.06, 0.08, 0.11, 0.038] }));
check("thin spread reads on volume and cost, not pricing", /thin spread/.test(thin) && /volume and the cost/.test(thin) && !/pricing power/.test(thin));
check("thin + high operating leverage → 'the cost line is where the needle moves' (no self-contradicting denial)",
  /the operating result swings hard on small moves in cost or volume/.test(thin) && /the cost line is where the needle moves/.test(thin) && !/not a price list/.test(thin));

// A fat-margin franchise (Coca-Cola shape): the spread is named precisely as a price-vs-cost spread, and
// the durability is handed to the reader as a QUESTION, never asserted as a moat.
const fat = txt(co({ gm: 0.61, om: [0.21, 0.21, 0.27, 0.27, 0.27, 0.27, 0.25, 0.25, 0.21, 0.29] }));
check("fat spread named as price-vs-cost, durability left a question", /wide spread between price and the cost/.test(fat) && /is the question the record is for/.test(fat));

// A mid spread, non-cyclical (Apple shape): a solid spread named as a neutral price-vs-cost gap with NO
// agency verb ("commands"), and an 8-point range on a fat level is "fairly steady", not a "narrow band".
const mid = txt(co({ gm: 0.39, om: [0.24, 0.27, 0.27, 0.25, 0.24, 0.30, 0.30, 0.30, 0.32, 0.28] }));
check("mid non-cyclical → 'solid spread between what it charges…', never 'commands'", /a solid spread between what it charges and what the product costs to make/.test(mid) && !/commands/.test(mid));
check("8-pt range on a fat level → 'fairly steady', not 'narrow band'", /fairly steady relative to where it runs/.test(mid) && !/narrow/.test(mid));

// A mid spread on a CYCLICAL price-taker whose GROSS margin itself swings (Micron shape): the spread is
// "set by the cycle", never "commanded" — and the swing reads as the cycle, not a thin-margin cost story.
const midCyc = txt(co({ gm: [0.45, 0.40, 0.42, 0.30, 0.28, 0.46, 0.32, 0.44, 0.43, 0.41], om: [0.10, 0.02, 0.12, 0.26, 0.27, 0.37, 0.03, 0.20, 0.25, 0.22] }));
check("mid cyclical price-taker → 'a spread the cycle sets', never 'the price it commands'", /a spread the cycle sets more than the company does/.test(midCyc) && !/commands/.test(midCyc));
check("cyclical → 'margin is cyclical', weigh the trough", /margin is cyclical/.test(midCyc) && /balance sheet at the trough/.test(midCyc));

// A genuinely narrow band (Costco shape): held inside a few points → "narrow … band".
const narrow = txt(co({ gm: 0.13, om: [0.031, 0.033, 0.033, 0.033, 0.033, 0.033, 0.033, 0.033, 0.038, 0.038] }));
check("sub-4-point range → 'narrow … band'", /narrow 3\.1%–3\.8% band/.test(narrow));

// No cost-of-revenue line (a fee/network business, Visa shape): read on operating margin alone, and a
// 14-point swing on a 64% margin is steady relative to its level — NOT cyclical.
const noCogs = txt(co({ gm: null, om: [0.52, 0.66, 0.63, 0.65, 0.64, 0.66, 0.64, 0.64, 0.66, 0.60] }));
check("no gross line → reads on operating margin ('for the work it does')", /Operating margin has run about 64%/.test(noCogs) && /for the work it does/.test(noCogs));
check("fat secular margin is NOT mislabelled cyclical", !/cyclical/.test(noCogs) && /fairly steady/.test(noCogs));

// No gross line, THIN operating margin (Chipotle shape): does NOT deny pricing — "what it can charge"
// bears on the result alongside volume and cost.
const noCogsThin = txt(co({ gm: null, om: [0.06, 0.07, 0.08, 0.08, 0.079, 0.08, 0.085, 0.09, 0.07, 0.075] }));
check("no-COGS thin margin does not deny pricing, nor grant agency to a price-taker", /the price it gets all bear on the result/.test(noCogsThin) && !/more than the price of any one sale/.test(noCogsThin) && !/what it can charge/.test(noCogsThin));

// ---- the swing mechanism must match the business ----

// A deep cyclical whose gross margin swings with the cycle (memory/chip shape): the record collapses
// repeatedly AND the gross line itself moves → genuine commodity cycle, weigh the trough.
const cyc = txt(co({ gm: [0.55, 0.50, 0.60, 0.52, 0.56, 0.66, 0.50, 0.64, 0.66, 0.64], om: [0.28, 0.10, 0.32, 0.26, 0.27, 0.37, 0.12, 0.54, 0.62, 0.60] }));
check("repeated collapses → 'margin is cyclical', weigh the trough", /margin is cyclical/.test(cyc) && /balance sheet at the trough/.test(cyc));

// A wide swing on a STEADY high gross margin, NOT flagged cyclical (Salesforce / 3M-charge shape): the
// swing sits below the gross line in operating spend and charges — never the price-taker "cost line".
const belowGross = txt(co({ gm: 0.74, om: [0.02, 0.025, 0.03, 0.03, 0.033, 0.035, 0.04, 0.20, 0.18, 0.017] }));
check("wide swing on a steady fat gross → 'below the gross line', not the price-taker cost line",
  /swung widely/.test(belowGross) && /below the gross line, in operating spend and one-off charges/.test(belowGross) && !/the cost line is where the needle moves/.test(belowGross));

// ---- loss-makers: split three ways by whether (and how) a profit has ever been earned ----

// Charge-driven / turning-the-corner: a clearly positive operating-margin HIGH but a negative median
// (GE absorbing charges; Palantir turning) — NOT a never-earned-a-profit name, and NO "cash runway".
const chargeDriven = txt(co({ gm: 0.36, om: [-0.149, -0.05, -0.04, -0.03, -0.02, -0.01, 0.02, 0.05, 0.10, 0.186] }));
check("loss median but a real profit at the high → 'reached … at its best … which reading is truer', no startup framing",
  /reached 19% at its best but run negative through the cycle/.test(chargeDriven) && /which reading is truer/.test(chargeDriven) && !/the lever is which is/.test(chargeDriven) && !/cash runway/.test(chargeDriven) && !/has not yet earned/.test(chargeDriven));

// Never cleared a profit but a high gross margin (Snowflake shape): the loss is below the gross line.
// No "the unit economics work" verdict, no evaluative "healthy".
const lossGoodGM = txt(co({ gm: 0.62, om: [-0.9, -0.8, -0.7, -0.6, -0.6, -0.55, -0.5, -0.5, -0.45, -0.59], sbc: 0.40 }));
check("loss + high gross, never profitable → 'in the red even at its best', not 'unit economics work'",
  /in the red even at its best/.test(lossGoodGM) && /whether the spending below the gross line can fall back to a profit/.test(lossGoodGM) && !/unit economics work/.test(lossGoodGM) && !/healthy/.test(lossGoodGM));
check("heavy stock-based pay surfaced as a claim on owners", /Stock-based pay runs about 40% of sales/.test(lossGoodGM));

// No gross profit yet (Rivian shape): the harder question of a margin at all.
const lossNoGM = txt(co({ sic: "3711", gm: -0.24, om: [-2.0, -1.8, -1.5, -1.3, -1.29], inv: 0.59 }));
check("loss + no gross profit → 'path to a margin at all'", /path to a margin at all/.test(lossNoGM));
check("heavy inventory surfaced alongside", /Inventory runs near 59% of sales/.test(lossNoGM));

// ---- cost-plus / program economics (Lockheed shape): thin spread, but gross ≈ operating ----

const costPlus = txt(co({ sic: "3760", gm: 0.14, om: [0.11, 0.12, 0.13, 0.13, 0.127, 0.13, 0.135, 0.12, 0.10, 0.13] }));
check("thin spread where gross ≈ operating → cost-plus/program read, not a volume price-taker",
  /the mark of cost-plus or fixed-price program work/.test(costPlus) && /the contract structure and the order book set the result/.test(costPlus));

// ---- the dominant sink, chosen by materiality, described not crowned ----

// A negative cash cycle is DESCRIBED mechanically — never "a structural edge" or "other people's money".
const negWC = txt(co({ gm: 0.14, om: 0.05, inv: 0.20, recv: 0.02, ap: 0.40 }));
check("negative cash cycle described mechanically, no verdict words", /cash cycle runs negative/.test(negWC) && !/structural edge/.test(negWC) && !/other people's money/.test(negWC));
check("negative cash cycle outranks a heavy inventory book as the sink", /cash cycle runs negative/.test(negWC) && !/Inventory runs near/.test(negWC));

// A marginal cycle (≈ −1 day) claims no float, so the line does not fire.
const flatWC = txt(co({ gm: 0.30, om: 0.10, recv: 0.20, ap: 0.142 }));
check("a ≈ −1 day cycle does not fire the cash-cycle line", !/cash cycle runs negative/.test(flatWC));

// An impossible cycle (more negative than a year: a data artifact, Oracle's −1,838d) is suppressed.
const artifactWC = txt(co({ gm: 0.30, om: 0.10, recv: 0.02, ap: 4.0 }));
check("a cycle beyond −365 days is a data artifact, suppressed", !/cash cycle runs negative/.test(artifactWC));

// Capital spending well above depreciation is named with its multiple of depreciation.
const heavyCapex = txt(co({ gm: 0.40, om: 0.39, capex: 0.15, dep: 0.10 }));
check("heavy capex → 'Capital spending runs about 15%' and 'well above depreciation'", /Capital spending runs about 15% of sales/.test(heavyCapex) && /well above depreciation/.test(heavyCapex));

// ---- precision over recall: withhold where a shape can't be read ----

check("a bank (SIC 6022) is withheld → null (caller keeps the statement lever)", needleReport(co({ sic: "6022", om: 0.30, gm: null })) === null);
check("under three years of operating margin → null", needleReport(co({ om: [0.10, 0.12] })) === null);
check("no revenue → null", needleReport({ ticker: "X", sic: "3571", lines: { revenue: 0 }, history: [] }) === null);

// ---- present, never pronounce ----

const BANNED = /\b(buy|sell|undervalued|overvalued|cheap|expensive|great company|excellent company|must own|guaranteed|will outperform|strong buy)\b/i;
// And the SEMANTIC verdicts the regex above can't see, that the adversarial review caught: a moat/edge
// asserted as fact, pricing agency given to a price-taker, the business model declared validated.
const PRONOUNCE = /\b(structural edge|the price it commands|the unit economics work|has a moat|is a great|is a good business|other people's money)\b/i;
for (const [name, t] of [["thin", thin], ["fat", fat], ["mid", mid], ["midCyc", midCyc], ["cyclical", cyc], ["belowGross", belowGross], ["chargeDriven", chargeDriven], ["lossGoodGM", lossGoodGM], ["costPlus", costPlus], ["negWC", negWC]]) {
  check(`no verdict, banned or semantic, in the ${name} read`, t && !BANNED.test(t) && !PRONOUNCE.test(t));
}
check("the fat-margin moat read is handed over as a question, never asserted", /is the question the record is for/.test(fat) && !/\b(a moat|durable moat|has a moat)\b/.test(fat));
check("a fat operating-only margin raises durability as a question", /is what the record weighs/.test(noCogs));

// ---- the industry-lens capstone: a complete sentence, the one thing the margins can't show, named industries only ----

check("a railroad keeps its operating-ratio lens, as a full sentence", /operating ratio/i.test(industryLensClause(co({ sic: "4011", om: 0.39, gm: null })) || ""));
check("a drugmaker keeps its patent-cliff lens", /patent cliff/i.test(industryLensClause(co({ sic: "2834", om: 0.26, gm: 0.74 })) || ""));
check("a generic computer-hardware SIC gets NO canned clause (the repetition source)", industryLensClause(co({ sic: "3571", om: 0.05, gm: 0.14 })) === null);
check("a financial gets no industry clause here", industryLensClause(co({ sic: "6022", om: 0.30 })) === null);
const railClause = industryLensClause(co({ sic: "4011", om: 0.39, gm: null }));
check("the capstone is a single, complete, terminated sentence (no dangling fragment)",
  railClause && /^Read this kind of business on /.test(railClause) && /\.$/.test(railClause) && (railClause.match(/\./g) || []).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log("✅ needleTest passed");
