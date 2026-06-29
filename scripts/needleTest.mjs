// Offline regression for the data-grounded "what moves the needle" generator (src/lib/needle.mjs), the
// read that replaced the repetitive archetype template with a fingerprint computed from the company's own
// record. The bar is the product's bar — PRECISION OVER RECALL and PRESENT, NEVER PRONOUNCE — so the
// fixtures assert: the right lever for the shape (a thin-margin assembler reads on volume and cost, never
// "pricing power"); the swing read through the cycle, not on two endpoints; the dominant capital sink
// chosen by materiality; loss-makers split by whether the unit economics already work; financials and
// thin records withheld (the caller falls back to the lever); and never a verdict word. The fixtures are
// modelled on real shapes (SMCI, Apple, Coca-Cola, Visa, Nvidia, Snowflake, Rivian). Run with `npm test`.
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
  const mk = (m) => {
    const rev = 1000, L = { revenue: rev, operatingIncome: Math.round(m * rev) };
    if (gm != null) L.costOfRevenue = Math.round((1 - gm) * rev);
    if (inv != null) L.inventory = Math.round(inv * rev);
    if (capex != null) L.capex = -Math.round(capex * rev);
    if (dep != null) L.depreciation = Math.round(dep * rev);
    if (sbc != null) L.stockBasedComp = Math.round(sbc * rev);
    if (recv != null) L.receivables = Math.round(recv * rev);
    if (ap != null) L.accountsPayable = Math.round(ap * rev);
    return L;
  };
  return { ticker: "TEST", sic, market, lines: mk(oms[oms.length - 1]), history: oms.map((m, i) => ({ fy: 2015 + i, lines: mk(m) })) };
}
const txt = (c) => { const r = needleReport(c); return r ? r.text : null; };

// ---- the margin structure: the right lever for the shape, never the archetype's ----

// A thin-margin assembler (SMCI shape): the lever is volume and cost, NOT pricing power — the whole point.
const thin = txt(co({ gm: 0.14, om: [0.026, 0.03, 0.03, 0.03, 0.04, 0.05, 0.06, 0.08, 0.11, 0.038] }));
check("thin spread reads on volume and cost, not pricing", /thin spread/.test(thin) && /volume and the cost/.test(thin) && !/pricing power/.test(thin));
check("thin + high operating leverage → 'swings hard … cost line, not a price list'", /swings hard/.test(thin) && /cost line, not a price list/.test(thin));

// A fat-margin franchise (Coca-Cola shape): the spread is named precisely as a price-vs-cost spread, and
// the durability is handed to the reader as a QUESTION, never asserted as a moat.
const fat = txt(co({ gm: 0.61, om: [0.21, 0.21, 0.27, 0.27, 0.27, 0.27, 0.25, 0.25, 0.21, 0.29] }));
check("fat spread named as price-vs-cost, durability left a question", /wide spread between price and the cost/.test(fat) && /is the question the record is for/.test(fat));

// A mid spread (Apple shape): a solid spread, and an 8-point range on a fat level is "fairly steady",
// not falsely called a "narrow band".
const mid = txt(co({ gm: 0.39, om: [0.24, 0.27, 0.27, 0.25, 0.24, 0.30, 0.30, 0.30, 0.32, 0.28] }));
check("mid spread → 'solid spread'", /solid spread/.test(mid));
check("8-pt range on a fat level → 'fairly steady', not 'narrow band'", /fairly steady relative to where it runs/.test(mid) && !/narrow/.test(mid));

// A genuinely narrow band (Costco shape): held inside a few points → "narrow … band".
const narrow = txt(co({ gm: 0.13, om: [0.031, 0.033, 0.033, 0.033, 0.033, 0.033, 0.033, 0.033, 0.038, 0.038] }));
check("sub-4-point range → 'narrow … band'", /narrow 3\.1%–3\.8% band/.test(narrow));

// No cost-of-revenue line (a fee/network business, Visa shape): read on operating margin alone, and a
// 14-point swing on a 64% margin is steady relative to its level — NOT cyclical.
const noCogs = txt(co({ gm: null, om: [0.52, 0.66, 0.63, 0.65, 0.64, 0.66, 0.64, 0.64, 0.66, 0.60] }));
check("no gross line → reads on operating margin ('for the work it does')", /Operating margin has run about 64%/.test(noCogs) && /for the work it does/.test(noCogs));
check("fat secular margin is NOT mislabelled cyclical", !/cyclical/.test(noCogs) && /fairly steady/.test(noCogs));

// A deep cyclical with a fat headline margin (Nvidia shape): the record collapses repeatedly, so it reads
// cyclical and points to the through-cycle figure and the trough balance sheet.
const cyc = txt(co({ gm: 0.62, om: [0.28, 0.10, 0.32, 0.26, 0.27, 0.37, 0.12, 0.54, 0.62, 0.60] }));
check("repeated collapses → 'margin is cyclical', weigh the trough", /margin is cyclical/.test(cyc) && /balance sheet at the trough/.test(cyc));

// ---- loss-makers: split by whether the unit economics already work ----

// Healthy gross, operating loss (Snowflake shape): the unit economics work; the lever is whether the
// spending below the gross line falls back to a profit — not "a margin at all".
const lossGoodGM = txt(co({ gm: 0.62, om: [-0.9, -0.8, -0.7, -0.6, -0.6, -0.55, -0.5, -0.5, -0.45, -0.59], sbc: 0.40 }));
check("loss + healthy gross → 'unit economics work'", /unit economics work/.test(lossGoodGM) && /falls back to a profit/.test(lossGoodGM));
check("heavy stock-based pay surfaced as a claim on owners", /Stock-based pay runs about 40% of sales/.test(lossGoodGM));

// No gross profit yet (Rivian shape): the harder question of a margin at all.
const lossNoGM = txt(co({ sic: "3711", gm: -0.24, om: [-2.0, -1.8, -1.5, -1.3, -1.29], inv: 0.59 }));
check("loss + no gross profit → 'path to a margin at all'", /path to a margin at all/.test(lossNoGM));
check("heavy inventory surfaced alongside", /Inventory runs near 59% of sales/.test(lossNoGM));

// ---- the dominant sink, chosen by materiality ----

// A negative cash cycle outranks a heavy inventory book — it is the closest thing on the statements to float.
const negWC = txt(co({ gm: 0.14, om: 0.05, inv: 0.20, recv: 0.02, ap: 0.40 }));
check("negative cash cycle wins over inventory as the sink", /negative cash cycle/.test(negWC) && !/Inventory runs near/.test(negWC));

// A marginal cycle (≈ −1 day: DSO 73 − DPO 74 on a 30% gross margin) claims no float, so it is NOT
// named a structural edge — only a materially negative cycle (≤ −5 days) earns the line.
const flatWC = txt(co({ gm: 0.30, om: 0.10, recv: 0.20, ap: 0.142 }));
check("a ≈ −1 day cycle does not claim float", !/negative cash cycle/.test(flatWC));

// Capital spending well above depreciation is named with its multiple of depreciation.
const heavyCapex = txt(co({ gm: 0.40, om: 0.39, capex: 0.15, dep: 0.10 }));
check("heavy capex → 'Capital spending runs about 15%' and 'well above depreciation'", /Capital spending runs about 15% of sales/.test(heavyCapex) && /well above depreciation/.test(heavyCapex));

// ---- precision over recall: withhold where a shape can't be read ----

check("a bank (SIC 6022) is withheld → null (caller keeps the statement lever)", needleReport(co({ sic: "6022", om: 0.30, gm: null })) === null);
check("under three years of operating margin → null", needleReport(co({ om: [0.10, 0.12] })) === null);
check("no revenue → null", needleReport({ ticker: "X", sic: "3571", lines: { revenue: 0 }, history: [] }) === null);

// ---- present, never pronounce ----

const BANNED = /\b(buy|sell|undervalued|overvalued|cheap|expensive|great company|excellent company|must own|guaranteed|will outperform|strong buy)\b/i;
for (const [name, t] of [["thin", thin], ["fat", fat], ["mid", mid], ["cyclical", cyc], ["loss", lossGoodGM]]) {
  check(`no verdict word in the ${name} read`, t && !BANNED.test(t));
}
// A fat spread is the one place tempted to assert a moat; it must hand the durability over as a question.
check("the fat-margin moat read is handed over as a question, never asserted", /is the question the record is for/.test(fat) && !/\b(a moat|durable moat|has a moat)\b/.test(fat));
// The no-COGS fat margin (Visa shape) likewise raises the durability as a question to weigh.
check("a fat operating-only margin raises durability as a question", /is what the record weighs/.test(noCogs));

// ---- the industry-lens capstone: the one thing the margins can't show, named industries only ----

check("a railroad keeps its operating-ratio lens", /operating ratio/i.test(industryLensClause(co({ sic: "4011", om: 0.39, gm: null })) || ""));
check("a drugmaker keeps its patent-cliff lens", /patent cliff/i.test(industryLensClause(co({ sic: "2834", om: 0.26, gm: 0.74 })) || ""));
check("a generic computer-hardware SIC gets NO canned clause (the repetition source)", industryLensClause(co({ sic: "3571", om: 0.05, gm: 0.14 })) === null);
check("a financial gets no industry clause here", industryLensClause(co({ sic: "6022", om: 0.30 })) === null);
const railClause = industryLensClause(co({ sic: "4011", om: 0.39, gm: null }));
check("an industry clause is a single, terminated sentence", railClause && /\.$/.test(railClause) && (railClause.match(/\./g) || []).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log("✅ needleTest passed");
