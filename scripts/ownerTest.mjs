#!/usr/bin/env node
// ownerTest.mjs — case law for the owner's statement arithmetic (/owner). The rule under
// test: every figure is the reader's fraction times an as-filed number; a missing filed
// figure stays missing; totals report their coverage; the yield exists only over priced
// rows whose owner earnings exist.
import { holdingRow, statementTotals, combineUsd, money, fractionLabel } from "../src/lib/ownerStatement.mjs";

let failed = 0;
const t = (name, ok) => {
  if (!ok) { failed++; console.error(`✗ ${name}`); }
  else console.log(`ok ${name}`);
};

const aapl = {
  ticker: "AAPL", name: "Apple Inc.", fy: 2025, form: "10-K",
  price: { currency: "USD", sym: "$", shares: 14687356000, oe: 129174000000, oe3: 102386000000, rev: 451442000000, ni: 122575000000, div: 15234000000, netDebt: -63881000000, bvps: 7.250522, mode: "owner-earnings" },
  quality: { roicThroughCycle: { median: 0.420916, n: 10 }, roeThroughCycle: { median: 0.878664, n: 10 }, rotce: null },
  compounding: { perShare: { ownerEarningsPS: { full: 0.11093 }, eps: { full: 0.146499 } } },
  stewardship: { shareChange: -0.328756, buybackSpan: "2016–2025" },
};
const jpm = {
  ticker: "JPM", name: "JPMorgan", fy: 2025, form: "10-K",
  price: { currency: "USD", sym: "$", shares: 2679511418, oe: null, oe3: null, rev: 186973000000, ni: 58899000000, netDebt: 136622000000, bvps: 135.859843, mode: "bank" },
  quality: { roicThroughCycle: { median: null }, rotce: 0.163819 },
  compounding: { perShare: { ownerEarningsPS: { full: null }, eps: { full: 0.09 } } },
  stewardship: { shareChange: null, buybackSpan: null },
};
const toyota = {
  ticker: "7203", name: "Toyota", fy: 2025, form: "有報",
  price: { currency: "JPY", sym: "¥", shares: 13000000000, oe: 3000000000000, oe3: 2800000000000, rev: 48000000000000, ni: 4900000000000, netDebt: 20000000000000, bvps: 2800, mode: "owner-earnings" },
  quality: { roicThroughCycle: { median: 0.071, n: 10 } },
};

const r = holdingRow(aapl, 500);
t("row: the fraction is the reader's shares over the filed count", Math.abs(r.frac - 500 / 14687356000) < 1e-18);
t("row: owner earnings scale by the fraction", Math.abs(r.oe - 129174000000 * r.frac) < 1);
t("row: net cash stays negative (a fact, not a flourish)", r.netDebt < 0);
t("row: refuses without a filed share count", holdingRow({ ticker: "X", price: { shares: null } }, 100) === null);
t("row: refuses zero or garbage shares owned", holdingRow(aapl, 0) === null && holdingRow(aapl, "many") === null);

const bank = holdingRow(jpm, 100);
t("row: a bank's missing owner earnings stays missing", bank.oe === null && bank.ni != null);
t("row: your equity is book per share times your shares", Math.abs(r.bv - 7.250522 * 500) < 1e-6);
t("row: the return lens follows the economics", r.ret.label === "ROIC" && bank.ret.label === "ROTCE" && Math.abs(bank.ret.v - 0.163819) < 1e-9);
t("row: the return carries its span; a bank's says normalized", r.ret.note === "10-yr median" && bank.ret.note === "normalized");
t("row: a company with no readable ROIC falls back to ROE",
  holdingRow({ ...aapl, quality: { roeThroughCycle: { median: 0.2, n: 8 } } }, 10).ret.label === "ROE");
t("row: delivered growth prefers owner earnings per share", r.grow.label === "OE/sh" && Math.abs(r.grow.v - 0.11093) < 1e-9);
t("row: a bank's growth falls back to EPS, labeled", bank.grow.label === "EPS");
t("row: no growth series → no growth line", holdingRow({ ...aapl, compounding: {} }, 10).grow === null);
t("row: averaged owner earnings scale like the year", Math.abs(r.oe3 - 102386000000 * r.frac) < 1);
t("row: the then-fraction restates the buyback record", (() => {
  const first = 14687356000 / (1 - 0.328756);
  return Math.abs(r.thenFrac.frac - 500 / first) < 1e-18 && r.thenFrac.span === "2016–2025" && r.thenFrac.frac < r.frac;
})());
t("row: no share-change record → no then-fraction", bank.thenFrac === null);
// The then/now fractions must share one basis, so their ratio is exactly (1 + shareChange) —
// never divide by the diluted-average firstShares against a cover-count now-count (the basis
// mix the 2026-07-17 sweep caught). firstShares on the card must NOT change the result.
t("row: then/now ratio equals exactly (1 + shareChange), on one basis", (() => {
  const withFs = holdingRow({ ...aapl, stewardship: { ...aapl.stewardship, firstShares: 21000000000 } }, 500);
  const ratio = withFs.thenFrac.frac / withFs.frac;
  return Math.abs(ratio - (1 + -0.328756)) < 1e-12 && Math.abs(withFs.thenFrac.frac - r.thenFrac.frac) < 1e-18;
})());
t("row: dividends scale by the fraction", Math.abs(r.div - 15234000000 * r.frac) < 1);
t("row: a filed zero dividend is a fact, not a hole",
  holdingRow({ ...aapl, price: { ...aapl.price, div: 0 } }, 10).div === 0);
t("row: an absent dividend tag stays null", bank.div === null);
t("fraction: the whole-company guard is declarative", fractionLabel(1.2) === "the whole company, or more than the filed share count");

const rows = [r, bank, holdingRow(toyota, 200)];
const totals = statementTotals(rows, { AAPL: 210.55, "7203": 2800 });
const usd = totals.find((x) => x.ccy === "USD");
const jpy = totals.find((x) => x.ccy === "JPY");
t("totals: currencies never mix", totals.length === 2 && usd.n === 2 && jpy.n === 1);
t("totals: each figure reports its coverage", usd.oeN === 1 && usd.revN === 2 && usd.niN === 2);
t("totals: revenue sums across the covered rows", Math.abs(usd.rev - (r.rev + bank.rev)) < 1);
t("totals: the yield covers only priced rows with owner earnings",
  usd.pricedN === 1 && Math.abs(usd.oeYield - r.oe / (210.55 * 500)) < 1e-12);
t("totals: an unpriced group has no yield", statementTotals([bank], {}).find((x) => x.ccy === "USD").oeYield === null);
t("totals: look-through ROE covers only rows with both profit and equity",
  usd.roeN === 2 && Math.abs(usd.lookRoe - (r.ni + bank.ni) / (r.bv + bank.bv)) < 1e-12);
t("totals: the averaged owner earnings carry their own coverage",
  usd.oe3N === 1 && Math.abs(usd.oe3 - r.oe3) < 1 && jpy.oe3N === 1);
t("totals: the split sums only rows carrying both profit and dividend",
  usd.splitN === 1 && Math.abs(usd.splitDiv - r.div) < 1 && Math.abs(usd.splitNi - r.ni) < 1);
t("totals: split halves add back to their whole",
  Math.abs((usd.splitDiv + (usd.splitNi - usd.splitDiv)) - usd.splitNi) < 1e-6);

const FX = { JPY: 0.006167, EUR: 1.144915 };
const comb = combineUsd(totals, FX);
t("combined: dollars at the dated reference rate", Math.abs(comb.rev - (usd.rev + jpy.rev * 0.006167)) < 1);
t("combined: the yield recombines from converted parts",
  Math.abs(comb.oeYield - (usd.oeOnOutlay + jpy.oeOnOutlay * 0.006167) / (usd.outlay + jpy.outlay * 0.006167)) < 1e-12);
t("combined: names the rates it used", comb.rates.length === 1 && comb.rates[0].ccy === "JPY");
t("combined: a missing rate is named, never silently dropped",
  (() => { const c2 = combineUsd(totals, {}); return c2.skipped.includes("JPY") && c2.n === usd.n; })());
t("combined: look-through ROE spans currencies",
  Math.abs(comb.lookRoe - (usd.roeNi + jpy.roeNi * 0.006167) / (usd.roeBv + jpy.roeBv * 0.006167)) < 1e-12);
t("combined: the split converts with its group", Math.abs(comb.splitDiv - usd.splitDiv) < 1 && comb.splitN === 1);

t("money: billions in the register", money(129174000000) === "$129.17B");
t("money: negative sign precedes the symbol", money(-63881000000) === "−$63.88B");
t("money: yen symbol carries", money(48000000000000, "¥") === "¥48.00T");
t("money: null is a dash", money(null) === "—");
t("fraction: small stakes read as the reciprocal", fractionLabel(500 / 14687356000) === "1/29,374,712th of the company");
t("fraction: readable stakes read as percent", fractionLabel(0.021) === "2.1% of the company");
t("fraction: garbage is a dash", fractionLabel(null) === "—" && fractionLabel(-1) === "—");

if (failed) { console.error(`\n❌ ownerTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ ownerTest passed.");
