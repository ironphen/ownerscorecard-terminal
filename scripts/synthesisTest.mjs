// Offline regression for the owner's-questions synthesis. The synthesis is the one place most tempted
// to break the cardinal rule — present, never pronounce — so the test asserts it answers each question
// with a fact and a pointer, in the right order, for both an operator and a financial, and NEVER with a
// verdict word. Synthetic universe, no network. Run with `npm test`.
import { ownerQuestions } from "../src/lib/synthesis.mjs";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); cond ? pass++ : fail++; };

// A compounding operator: high, persistent return on capital, widening margins, shrinking share count.
const year = (i, n) => {
  const rev = 1000 + i * 120;                 // steady top-line growth
  const om = 0.20 + i * 0.016;                // margins widen 20% → ~28%
  return {
    fy: 2018 + i,
    lines: {
      revenue: rev, operatingIncome: rev * om, netIncome: rev * (om - 0.05), incomeTaxExpense: rev * 0.04,
      totalDebt: 200, stockholdersEquity: 600 + i * 90, cashAndEquivalents: 120,
      cashFromOps: rev * (om - 0.02), capex: -rev * 0.04, depreciation: rev * 0.03,
      sharesDiluted: 1000 - i * 12, dividendsPaid: -(40 + i * 6), costOfRevenue: rev * 0.45,
    },
  };
};
const N = 7;
const compounder = {
  ticker: "CMPD", name: "Compounder Inc", sic: "2840",
  history: Array.from({ length: N }, (_, i) => year(i, N)),
  lines: year(N - 1, N).lines, fy: 2018 + N - 1,
};

const q = ownerQuestions(compounder, null);
check("five questions, in order", q.length === 5 && q[0].key === "understand" && q[1].key === "moat" && q[2].key === "survive" && q[3].key === "management" && q[4].key === "price");
check("every question has an answer and a section pointer", q.every((x) => x.q && x.a && x.href?.startsWith("#") && x.hrefLabel));
check("the moat answer is a fact about returns, not a verdict", /return on capital cleared 15%/i.test(q[1].a) && /margins widened/i.test(q[1].a));
check("the survival answer reads the record", /profitable in .* years/i.test(q[2].a));
check("the price answer invites a reader-supplied price", /bring a price/i.test(q[4].a) && /never a target/i.test(q[4].a));
check("a shrinking share count is read as buybacks", /share count is shrinking/i.test(q[3].a));

// The cardinal rule: the synthesis must never pronounce. No verdict, no recommendation, no valuation call.
const VERDICT = /\b(buy|sell|hold|undervalued|overvalued|cheap|expensive|bargain|overpriced|a good business|a bad business|strong moat|wide moat|we recommend|you should|worth buying|a great (business|investment))\b/i;
const allText = q.flatMap((x) => [x.q, x.a]).join("  ");
check("never pronounces a verdict", !VERDICT.test(allText));

// A bank routes to the balance-sheet lens: return on equity through the cycle, and the capital cushion.
const bankYear = (i) => ({
  fy: 2018 + i,
  lines: {
    netIncome: 100 + i * 8, stockholdersEquity: 800 + i * 40, totalAssets: 9000 + i * 300,
    deposits: 7000 + i * 250, netInterestIncome: 300 + i * 12, noninterestIncome: 120,
  },
});
const bank = { ticker: "BNK", name: "Bank Co", sic: "6021", history: Array.from({ length: 6 }, (_, i) => bankYear(i)), lines: bankYear(5).lines, fy: 2023 };
const qb = ownerQuestions(bank, null);
check("a bank's moat answer is read on return on equity", /return on equity/i.test(qb[1].a));
check("a bank's survival answer is read on the capital cushion (equity / assets)", /equity .* of assets/i.test(qb[2].a));
check("the bank synthesis also never pronounces", !VERDICT.test(qb.flatMap((x) => [x.q, x.a]).join("  ")));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
