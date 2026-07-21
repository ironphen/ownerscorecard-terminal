#!/usr/bin/env node
// correctnessGatesTest.mjs — permanent gates for the 2026-07-17 platform correctness sweep.
// Every confirmed cross-surface / basis defect the sweep found becomes an assertion here, so it
// cannot silently return. These run against the REAL pool, not fixtures, because the defects were
// about how real companies render across surfaces.
import { readFileSync } from "node:fs";
import { buildCompareCard } from "../src/lib/compareCard.mjs";
import { valuationModel } from "../src/lib/valuationInputs.mjs";
import { industryOf } from "../src/lib/archetype.mjs";
import { netDebtOf, oiReliable, ownerEarningsAbs } from "../src/lib/fundamentals.mjs";
import { floatYield, FLOAT_YIELD_CAP } from "../src/lib/peers.mjs";
import { acquisitionRecord } from "../src/lib/acquisitions.mjs";
import TAXONOMY from "../src/data/taxonomy.json" with { type: "json" };
import ADR_RATIOS from "../src/data/adrRatios.json" with { type: "json" };

const load = (f) => { try { return JSON.parse(readFileSync("src/data/" + f, "utf8")).companies || []; } catch { return []; } };
const us = load("fundamentals.json"), adr = load("fundamentals.adr.json"), jp = load("fundamentals.jp.json");
const all = [...us, ...adr, ...jp];
const byT = new Map(all.map((c) => [c.ticker, c]));
const lang = (() => { try { return JSON.parse(readFileSync("src/data/language.json", "utf8")).companies || {}; } catch { return {}; } })();
const card = (t) => { const c = byT.get(t); return c ? buildCompareCard(c, lang[t] || null) : null; };

let failed = 0;
const t = (name, ok) => { if (!ok) { failed++; console.error(`✗ ${name}`); } else console.log(`ok ${name}`); };

// 1. ONE net-debt definition on every surface: the compare card's figure IS netDebtOf(L), the
//    same formula the grouping table and company entry block use. No sign-flip across surfaces.
for (const tk of ["AAPL", "MSFT", "JPM"]) {
  const c = byT.get(tk); if (!c) continue;
  const L = c.ttm?.lines || c.lines || {};
  const cd = card(tk);
  t(`net debt on the compare card matches netDebtOf for ${tk}`, cd && cd.price && Math.abs((cd.price.netDebt ?? 0) - Math.round(netDebtOf(L))) <= 1);
}
t("netDebtOf excludes long-term marketable (cash + short-term only)",
  netDebtOf({ totalDebt: 100, cashAndEquivalents: 30, shortTermInvestments: 10, longTermMarketable: 50 }) === 60);

// 2. The operating-line returns (ROIC, operating margin) are withheld on the compare card exactly
//    where oiReliable is false — the JP holding/trading houses — matching the grouping n/a and the
//    company page. No compare card shows a −1% ROIC another surface refuses.
for (const tk of ["8058", "8001", "8002"]) { // Mitsubishi, Itochu, Marubeni (trading houses)
  const c = byT.get(tk); if (!c) continue;
  if (oiReliable(c)) continue; // only assert where the gate says the operating line is unreliable
  const cd = card(tk);
  t(`compare card withholds ROIC/op-margin for oiReliable-false ${tk}`,
    cd && cd.quality && cd.quality.roicThroughCycle == null && cd.quality.operatingMarginThroughCycle == null && cd.quality.roeThroughCycle != null);
}

// 3. JP companies read their real industry on the compare card, not "Diversified" (industryOf must
//    consult the taxonomy JP map, the same source the shelf/chapter surfaces use).
for (const [tk, want] of [["7203", "Automobiles"], ["6758", "Entertainment & Studios"], ["1332", "Food Products"]]) {
  const c = byT.get(tk); if (!c) continue;
  t(`JP ${tk} industry is "${want}", not Diversified`, industryOf(c).label === want);
}

// 4. The per-ticker taxonomy overrides the sweep added resolve correctly (override beats SIC).
for (const [tk, want] of [["GLW", "Electronic Components & Instruments"], ["CAE", "Aerospace & Defense"], ["HUBB", "Electrical Equipment"], ["MRCY", "Aerospace & Defense"]]) {
  const c = byT.get(tk); if (!c) continue;
  t(`override ${tk} → ${want}`, industryOf(c).label === want);
}
t("SIC 3670 maps to Information Technology / Electronic Components & Instruments",
  TAXONOMY.sic["3670"]?.sector === "Information Technology" && TAXONOMY.sic["3670"]?.industry === "Electronic Components & Instruments");

// 5. The card's oe3 (feeds /owner's "averaged owner earnings, last three filed years") is a genuine
//    3-year average or null — never a 2-year or single-year figure wearing the three-year label.
const synth = (oeYears) => ({
  ticker: "TEST", name: "Test", market: "US", sic: "7372", fy: 2025,
  lines: { cashFromOps: 1000, capex: 100, revenue: 5000, netIncome: 800, stockholdersEquity: 3000, sharesDiluted: 1000, totalDebt: 0, cashAndEquivalents: 500 },
  history: oeYears.map((oe, i) => ({ fy: 2020 + i, lines: { cashFromOps: oe + 100, capex: 100, netIncome: oe } })),
});
t("oe3 is null with only two owner-earnings years", valuationModel(synth([700, 900])).oe3 == null);
t("oe3 is the mean with three owner-earnings years", (() => {
  const m = valuationModel(synth([600, 800, 1000])).oe3; return m != null && Math.abs(m - 800) < 1;
})());

// 6. The compare card exposes the price block's true vintage, so /owner labels TTM figures as TTM
//    (not "FY · 10-K"). A company with a ttm stitch must carry vintage.ttm === true.
const ttmName = us.find((c) => c.ttm?.lines && c.ticker);
if (ttmName) {
  const cd = card(ttmName.ticker);
  t(`price.vintage.ttm true for a TTM-stitched filer (${ttmName.ticker})`, cd?.price?.vintage?.ttm === true && !!cd.price.vintage.asOf);
}

// ---- sweep #2 gates ----

// 7. The "yield on float" is capped (a life insurer's tagged lossReserves is a P&C sliver, so the
//    raw ratio prints impossibles). floatYield — the one shared computation — withholds above 15%.
t("floatYield withholds MetLife's impossible ratio (130% > cap)", floatYield({ investmentIncome: 23029e6, lossReserves: 17640e6 }) === null);
t("floatYield keeps a plausible insurer yield (8%)", (() => { const y = floatYield({ investmentIncome: 800, lossReserves: 10000 }); return y != null && Math.abs(y - 0.08) < 1e-9; })());
t("FLOAT_YIELD_CAP is 15%", FLOAT_YIELD_CAP === 0.15);

// 8. Financials are excluded from the survival Graham tests and interest-coverage on the card, so
//    the almanac census / interest-coverage distribution don't count banks/insurers/REITs.
for (const tk of ["JPM", "ACGL", "O"]) { // bank, insurer, REIT
  const cd = card(tk); if (!cd) continue;
  const gr = cd.survival?.graham;
  t(`${tk} (financial) carries no Graham defensive tests on the card`, Array.isArray(gr) && gr.length === 0);
  t(`${tk} (financial) has no interest-coverage on the card`, cd.survival?.interestCoverage == null);
}

// 9. The ADR ratios the sweep corrected stay corrected (parser-error regression guard), and no
//    "ads" ratio is comma-truncated (a quote's "N,NNN" thousands number must match the ratio).
const RATIO_FIX = { LTM: 2000, NAAS: 3200, TC: 4800, XHG: 2400, SVREW: 43200, SY: 0.769231, GOTU: 0.666667, RERE: 0.666667, DDL: 1.5, JG: 13.333333, SNY: 0.5, WKEY: 0.5, ADAG: 1.25, DDI: 0.05, TAL: 0.333333 };
for (const [tk, want] of Object.entries(RATIO_FIX)) {
  const r = ADR_RATIOS.companies?.[tk]?.ratio;
  if (r != null) t(`ADR ratio ${tk} = ${want}`, Math.abs(r - want) < 1e-4);
}
let commaTrunc = 0;
for (const [tk, e] of Object.entries(ADR_RATIOS.companies || {})) {
  if (e.basis !== "ads" || e.ratio == null) continue;
  const m = String(e.quote || "").match(/(\d{1,3}(?:,\d{3})+)\s+(?:class|ordinary|common|shares)/i);
  if (m) { const q = Number(m[1].replace(/,/g, "")); if (Math.abs(q - e.ratio) > 1) { commaTrunc++; console.error(`  comma-truncated ratio: ${tk} stored ${e.ratio} vs quote ${q}`); } }
}
t("no ADS ratio is comma-truncated (quote thousands-number matches the ratio)", commaTrunc === 0);

// 10. Sony's net income is the continuing-ops (positive) figure, not the discontinued-ops sign-flip.
const sony = jp.find((c) => c.ticker === "6758");
if (sony) t("Sony (6758) net income is positive continuing-ops, not the discontinued-ops loss", sony.lines.netIncome > 0);

// ---- sweep #3 gates ----

// 11. "Goodwill exceeds all book equity" is a warning that only makes sense when equity is POSITIVE.
//     goodwill > (a negative equity) is trivially true and would fire the flag on a deficit balance
//     sheet where it means nothing (sweep #3). The gate: negative equity never fires exceedsEquity,
//     and gwVsEquity is withheld; positive equity below goodwill still fires it.
const acqSynth = (equity) => ({
  lines: { goodwill: 500, totalAssets: 1000, stockholdersEquity: equity, intangibleAssets: 0 },
  history: [],
});
{
  const neg = acquisitionRecord(acqSynth(-200));
  t("acquisitions: negative equity never fires 'goodwill exceeds equity'",
    neg && neg.exceedsEquity === false && neg.equityPositive === false && neg.gwVsEquity == null);
  const pos = acquisitionRecord(acqSynth(300));
  t("acquisitions: goodwill above positive equity still fires exceedsEquity",
    pos && pos.exceedsEquity === true && pos.equityPositive === true);
}

// 12. The share-count staleness guard (sharesForValueOf recency window). The figure that turns a
//     price into a per-share value is company.sharesForValue — a dei cover / instant / weighted-
//     average count with its own asOf date. When that date drifts far from the financials it prices,
//     the count is a different era's share base (Visa's 2010 cover of ~469M standing in for ~1.9B
//     today — a 4× per-share error). The fetcher's recency window rejects a stale count and falls to
//     the current weighted-average diluted figure (or withholds → null, which is fine). The gate:
//     no US filer's sharesForValue.asOf is more than 460 days from the period it values.
//     DUAL_CLASS_DEFERRED carries the names whose share basis is a separate dual-class pass.
const DUAL_CLASS_DEFERRED = new Set(["BRK-A", "BRK-B"]);
{
  // SIGNED, not absolute: the bug is a share count OLDER than the financials it prices (asOf earlier
  // than periodEnd by >460d — Visa's 2010 base against 2025 earnings). The inverse (a share cover
  // fresher than the financials — a filer whose XBRL financials lag behind its latest 10-Q cover) is
  // a separate FY-lag matter, not a stale share base, and must not trip this gate.
  const staleShareDays = (asOf, pe) => (new Date(pe) - new Date(asOf)) / 864e5;
  const stale = [];
  for (const c of us) {
    if (DUAL_CLASS_DEFERRED.has(c.ticker)) continue;
    const sfv = c.sharesForValue;
    if (!sfv || sfv.val == null || !sfv.asOf) continue;
    const pe = c.ttm?.periodEnd || c.periodEnd;
    if (!pe) continue;
    if (staleShareDays(sfv.asOf, pe) > 460) stale.push(`${c.ticker}(${sfv.asOf} vs ${pe})`);
  }
  if (stale.length) console.error(`  stale sharesForValue: ${stale.slice(0, 20).join(", ")}${stale.length > 20 ? ` +${stale.length - 20} more` : ""}`);
  t("no US filer prices on a share count >460 days older than its own financials", stale.length === 0);
  const visa = us.find((c) => c.ticker === "V");
  if (visa && visa.sharesForValue?.val != null)
    t("Visa (V) prices on the current ~1.9B share base, not the 2010 cover ~469M", visa.sharesForValue.val > 1.2e9);
}

// 13. Berkshire dual-class equivalence: BRK-A prices on A-equivalents (~1.4M) and BRK-B on
//     B-equivalents (~2.1B) — never each other's basis, never the naive A+B sum, never the 2015
//     average both records carried for a decade (a B price × an A count valued Berkshire at
//     ~1/1300th of itself). The two must agree through the 1,500:1 conversion.
{
  const a = us.find((c) => c.ticker === "BRK-A")?.sharesForValue;
  const b = us.find((c) => c.ticker === "BRK-B")?.sharesForValue;
  if (a?.val != null) t("BRK-A prices on A-equivalents (1.3–1.6M)", a.val > 1.3e6 && a.val < 1.6e6 && /A-equivalent/.test(a.basis || ""));
  if (b?.val != null) t("BRK-B prices on B-equivalents (1.9–2.4B)", b.val > 1.9e9 && b.val < 2.4e9 && /B-equivalent/.test(b.basis || ""));
  if (a?.val != null && b?.val != null)
    t("the two Berkshire records agree through the 1,500:1 conversion", Math.abs(b.val - a.val * 1500) / b.val < 0.01);
}

// 14. PAGP prices on its cover count: the filing's own cover states ONLY the Class A count (the
//     B and C classes live in the capital note, and Class C is held by the consolidated
//     subsidiary). The convention is the company's own presentation — we print the cover.
{
  const p = us.find((c) => c.ticker === "PAGP")?.sharesForValue;
  if (p?.val != null) t("PAGP prices on the Class A cover count (~198M)", p.val > 1.85e8 && p.val < 2.15e8);
}

// 15. A filer whose diluted share tagging lapsed while the basic series continues carries
//     sharesBasis "basic", so no page labels its basic average "diluted" (Exxon's diluted
//     concept stops in 2013; basic runs to the present).
{
  const x = us.find((c) => c.ticker === "XOM");
  if (x) t("XOM carries sharesBasis 'basic' (diluted tagging lapsed 2013)", x.sharesBasis === "basic");
}

// 16. The valuation page quotes the ONE net-debt definition (sweep #1, extended 2026-07-19): its
//     local computation once netted against liquidAssets (long-term marketable folded in), so the
//     company-page DCF and the compare-card DCF disagreed on cash-rich names. Source-level guard:
//     the component must consume netDebtOf and must not net liquidAssets.
{
  const src = readFileSync("src/components/Valuation.astro", "utf8");
  t("Valuation.astro nets debt with netDebtOf", /netDebtOf\(L\)/.test(src));
  t("Valuation.astro no longer nets against liquidAssets", !/liquidAssets\(L\)\s*\)?\s*\|\|\s*0/.test(src));
}

// 17. The owner-earnings / free-cash-flow split is DESIGN, pinned (the CMCL finding, 2026-07-19):
//     the valuation family's default base is operating cash less ALL capex (the conservative,
//     filed-fact figure — the library's freeCashFlowAbs), with the maintenance basis offered as
//     the reader's Steady-state election; the record table's "Owner earnings" row is Buffett's
//     maintenance-based figure. For a build-out filer the two MUST diverge (that divergence is
//     what the labels now disclose); a future change that silently equates them — or renames
//     either — must come through this gate deliberately.
{
  const buildOut = {
    ticker: "BOUT", name: "Buildout Co", market: "US", sic: "1040", fy: 2025,
    lines: { cashFromOps: 42000000, capex: -27500000, depreciation: 12000000, revenue: 120000000, netIncome: 9000000, stockholdersEquity: 80000000, sharesDiluted: 20000000, totalDebt: 5000000, cashAndEquivalents: 10000000 },
    history: [2021, 2022, 2023, 2024, 2025].map((fy, i) => ({ fy, lines: { revenue: 80000000 + i * 10000000, cashFromOps: 30000000 + i * 3000000, capex: -(20000000 + i * 2000000), depreciation: 10000000 + i * 500000, netIncome: 7000000 + i * 500000 } })),
  };
  const vm = valuationModel(buildOut);
  const oeRecord = ownerEarningsAbs(buildOut.lines, buildOut);
  t("build-out filer: valuation base is CFO − total capex (free cash flow)", vm.oe === 42000000 - 27500000);
  t("build-out filer: the record's owner earnings uses maintenance capex and diverges", oeRecord === 42000000 - 12000000 && oeRecord !== vm.oe);
  t("build-out filer: the Steady-state basis is offered so the reader can elect it", vm.offerMaint === true && vm.oeMaint === oeRecord);
}

// 18. The three 20-F cover-text traps the adversarial verify caught stay dead: a stated total is
//     never summed with its own components (iQIYI printed 2×), a treasury tranche never joins the
//     outstanding count (ReNew +10.7%), a prior-year restatement never doubles the current year
//     (Bilibili 2×). Each pinned to the band around its independently verified count; a withheld
//     null is acceptable (missing beats wrong), a value outside the band is the trap reopening.
for (const [tk, lo, hi] of [["BILI", 3.8e8, 4.6e8], ["IQ", 6.2e9, 7.3e9], ["RNW", 3.3e8, 4.0e8]]) {
  const c = adr.find((x) => x.ticker === tk);
  const v = c?.sharesForValue?.val ?? null;
  if (c) t(`${tk} cover-text count is in the verified band (or honestly withheld)`, v == null || (v >= lo && v <= hi));
}

if (failed) { console.error(`\n❌ correctnessGatesTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ correctnessGatesTest passed.");
