// Offline regression for the peer engine. No network: a small synthetic universe asserts that peers are
// drawn TAXONOMY-FIRST (the same industry label the heading and the /groupings tables use — the
// 2026-07-21 alignment; before it, SIC-digit distance seated Airbnb beside Shopify under a Hotels
// heading), that a financial subject keeps its kind, that thin labels widen honestly (shelf → sector →
// model, the basis naming the rung), ranked by structural likeness, and that the distribution helper
// places a value with a median and a percentile rather than crowning a winner. A sampled sweep of the
// real pool then holds the alignment floor. Run with `npm test`.
import { selectPeers, peerStat, throughCycleMetric, peerMedian, floatYield, FLOAT_YIELD_CAP } from "../src/lib/peers.mjs";
import { industryLabelOf, shelfOfIndustry } from "../src/lib/shelves.mjs";
import { financialKind, financialProfile } from "../src/lib/archetype.mjs";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); cond ? pass++ : fail++; };

const co = (ticker, sic, revenue, capex, extra = {}, cik) => ({
  ticker, name: ticker, sic, cik, history: [],
  lines: { revenue, capex, netIncome: revenue * 0.1, operatingIncome: revenue * 0.15, ...extra },
});
const bank = (ticker, sic, nii) => co(ticker, sic, null, 0, { netInterestIncome: nii, noninterestIncome: nii * 0.4, deposits: nii * 18, totalAssets: nii * 22, stockholdersEquity: nii * 2 });

// A software company (asset-light) among software, a bank, a grocer, and an automaker.
const SOFT1 = co("SOFT1", "7372", 10e9, 0.3e9);
const universe = [
  SOFT1,
  co("SOFT2", "7372", 12e9, 0.36e9),  // same engine, close size & intensity → should rank first
  co("SOFT3", "7373", 2e9, 0.06e9),   // same engine, smaller and a step out in sub-industry
  bank("BANK1", "6021", 11e9),         // bank — a different engine, must be excluded
  co("GROCER1", "5411", 11e9, 0.5e9),  // retailer — different engine, excluded
  co("AUTO1", "3711", 11e9, 1.5e9),    // capital-intensive — different engine, excluded
];

const { peers } = selectPeers(SOFT1, universe);
const t = peers.map((p) => p.ticker);
check("peers drawn from the same engine only (no bank, grocer, automaker)", !t.includes("BANK1") && !t.includes("GROCER1") && !t.includes("AUTO1"));
check("the software peers are selected", t.includes("SOFT2") && t.includes("SOFT3"));
check("closest by scale & sub-industry ranks first (SOFT2 before SOFT3)", t.indexOf("SOFT2") < t.indexOf("SOFT3"));

// A bank peers only with banks — not a software firm or a REIT.
const BANK_A = bank("BANK_A", "6022", 8e9);
const bankUniv = [BANK_A, bank("BANK_B", "6021", 9e9), bank("BANK_C", "6022", 3e9), SOFT1, co("REIT1", "6798", 4e9, 0.1e9, { depreciation: 0.2e9 })];
const bp = selectPeers(BANK_A, bankUniv).peers.map((p) => p.ticker);
check("a bank peers only with banks", bp.includes("BANK_B") && bp.includes("BANK_C") && !bp.includes("SOFT1") && !bp.includes("REIT1"));

// Multi-share-class entities collapse to one peer (same CIK), and the company's own sibling classes are
// not peers. (Microsoft's table once showed GOOG, GOOGL, GOOGM and GOOGN as four separate "peers".)
const HW = co("HW", "3571", 10e9, 0.3e9, {}, 500);
const dedupUniv = [
  HW,
  co("HW_B", "3571", 10e9, 0.3e9, {}, 500),    // the company's own B share — same CIK, must be excluded
  co("PEERA", "3571", 8e9, 0.2e9, {}, 600),    // a peer, class A
  co("PEERA2", "3571", 8e9, 0.2e9, {}, 600),   // the same peer's other class — same CIK, must count once
  co("PEERB", "3572", 5e9, 0.15e9, {}, 700),
  co("PEERC", "3576", 3e9, 0.1e9, {}, 800),
];
const dp = selectPeers(HW, dedupUniv).peers.map((p) => p.ticker);
check("a company's own sibling share class is not a peer", !dp.includes("HW_B"));
check("a multi-class peer entity appears once, not as both classes", (dp.includes("PEERA") || dp.includes("PEERA2")) && !(dp.includes("PEERA") && dp.includes("PEERA2")));

// A REIT peers within its own NAREIT subsector, not merely within SIC 6798: a net-lease trust sits beside
// other net-lease trusts, never beside a mall (retail) or a cell-tower operator. All REITs share the same
// SIC, so without the curated subsector map the table would seat Realty Income next to Simon and American
// Tower. Depreciation present (so it reads as an equity REIT, not a mortgage REIT) and a slow asset turn.
const reit = (ticker, rev) => co(ticker, "6798", rev, rev * 0.05, { depreciation: rev * 0.2, totalAssets: rev * 12, totalDebt: rev * 5 });
const reitUniv = [
  reit("O", 4e9), reit("NNN", 0.8e9), reit("ADC", 0.5e9), reit("WPC", 1.5e9),  // net-lease — the bench
  reit("SPG", 5e9), reit("KIM", 1.7e9),   // retail — a different property model, must be excluded
  reit("AMT", 11e9), reit("CCI", 7e9),    // towers — a different property model, must be excluded
];
const reitResult = selectPeers(reitUniv[0], reitUniv);  // O = Realty Income, net-lease
const rt = reitResult.peers.map((p) => p.ticker);
check("a REIT peers within its NAREIT subsector (net-lease with net-lease)", rt.includes("NNN") && rt.includes("ADC") && rt.includes("WPC"));
check("a REIT is not peered across subsectors (no mall or tower beside a net-lease trust)", !rt.includes("SPG") && !rt.includes("KIM") && !rt.includes("AMT") && !rt.includes("CCI"));
check("selectPeers reports the REIT subsector", reitResult.subsector === "net-lease");

// ---- the taxonomy alignment (2026-07-21) ----
// The bench under a heading that names an industry label is drawn from that label, even when a company
// in a NEIGHBORING label sits closer by SIC digits and scale. Gold miners bench with gold miners; the
// identically-sized base-metal miners next door stay off the bench.
const gold = (ticker, rev) => co(ticker, "1040", rev, rev * 0.15);
const metal = (ticker, rev) => co(ticker, "1000", rev, rev * 0.15);
const GOLD1 = gold("GOLD1", 10e9);
const mineUniv = [GOLD1, gold("GOLD2", 1e9), gold("GOLD3", 40e9), gold("GOLD4", 0.5e9), metal("METAL1", 10e9), metal("METAL2", 11e9)];
const mineResult = selectPeers(GOLD1, mineUniv);
const mt = mineResult.peers.map((p) => p.ticker);
check("same-label peers win over closer-SIC-and-scale neighbors (gold with gold)", mt.includes("GOLD2") && mt.includes("GOLD3") && mt.includes("GOLD4"));
check("a neighboring label's companies stay off the bench even at identical scale", !mt.includes("METAL1") && !mt.includes("METAL2"));
check("the basis names the industry rung", mineResult.basis === "industry");

// A thin label widens honestly: with one same-label peer, the bench widens to the shelf's sibling
// industries (or the sector where the shelf has no siblings), and the basis says so — it never claims
// "industry" for a bench it could not draw from the label. The expected rung is computed from the live
// shelf curation, so a re-shelving cannot silently break the test.
const thinUniv = [GOLD1, gold("GOLD2", 1e9), metal("METAL1", 10e9), metal("METAL2", 11e9), metal("METAL3", 9e9)];
const thinResult = selectPeers(GOLD1, thinUniv);
{
  const goldShelf = shelfOfIndustry(industryLabelOf(GOLD1));
  const metalLabel = industryLabelOf(thinUniv[2]);
  const sameShelf = !!goldShelf && goldShelf.industries.some((i) => i.label === metalLabel);
  const expected = sameShelf ? "shelf" : "sector";
  check(`a thin label widens with an honest basis (${expected}, never a false "industry")`, thinResult.basis === expected && thinResult.peers.length >= 3);
}

// The real pool, sampled: the alignment holds in production data, not just fixtures. Every sampled
// subject whose label holds enough entities must bench entirely within its own label (REIT subsector
// benches are the deliberate finer-than-label exception). Floor at 99% with a sample step of 10 so the
// sweep stays fast; a regression to SIC-distance benching craters this immediately.
{
  const fund = JSON.parse(readFileSync(new URL("../src/data/fundamentals.json", import.meta.url), "utf8"));
  const all = fund.companies || [];
  const labelCount = new Map();
  for (const c of all) { const l = industryLabelOf(c); if (l) labelCount.set(l, (labelCount.get(l) || 0) + 1); }
  let checked = 0, clean = 0;
  for (let i = 0; i < all.length; i += 10) {
    const c = all[i];
    const label = industryLabelOf(c);
    if (!label || (labelCount.get(label) || 0) < 5) continue;
    const r = selectPeers(c, all);
    // A bench whose basis is NOT "industry" widened on the ladder's own law and its heading
    // names the rung (shelf noun or sector) — honest, labeled widening, like the REIT subsector
    // exception beside it. The floor exists to catch off-label rows under an INDUSTRY-claiming
    // heading; counting a declared sector bench as misalignment failed the suite the first time
    // the pool's thin labels (Cadiz's water micro-caps) lawfully widened (2026-07-31).
    if (!r.peers.length || r.subsector || r.basis !== "industry") continue;
    checked++;
    if (r.peers.every((p) => industryLabelOf(p) === label)) clean++;
  }
  check(`real-pool alignment floor: ${clean}/${checked} sampled benches fully same-label (≥99%)`, checked > 50 && clean / checked >= 0.99);

  // The taxonomy corrections that the alignment surfaced, pinned: the 4700 travel-services bucket no
  // longer carries the logistics spinouts into Hotels & Resorts, the cruise lines sail together, and
  // Texas Pacific Land (a C-corp, never a REIT) is out of the REIT benches.
  const labelOfTicker = (t) => { const c = all.find((x) => x.ticker === t); return c ? industryLabelOf(c) : null; };
  check("GXO/XPO/RXO carry Trucking & Logistics, not Hotels & Resorts", ["GXO", "XPO", "RXO"].every((t) => labelOfTicker(t) === null || labelOfTicker(t) === "Trucking & Logistics"));
  check("RCL/NCLH/LIND carry Cruise Lines, not Marine Shipping", ["RCL", "NCLH", "LIND"].every((t) => labelOfTicker(t) === null || labelOfTicker(t) === "Cruise Lines"));
  const epr = all.find((x) => x.ticker === "EPR");
  check("TPL sits in no REIT bench", !epr || !selectPeers(epr, all).peers.some((p) => p.ticker === "TPL"));
}

// ---------------------------------------------------------------------------------------------
// THE LENS GUARD, unconditional since 2026-07-27. A subject benches only its own financial kind, at
// every rung of the widening ladder — and because the guard runs INSIDE the ladder rather than over
// the finished bench, a rung it thins simply fails its own three-row test and the ladder widens.
//
// The guard used to be skipped wherever it would have thinned a bench, which is how 404 peer rows
// came to be read on a lens that does not describe them. The two facts asserted here are the ones
// that were measured before the change and must not silently move: NO bench carries an off-lens
// peer, and NO bench was emptied to achieve that.
// ---------------------------------------------------------------------------------------------
{
  const fund = JSON.parse(readFileSync(new URL("../src/data/fundamentals.json", import.meta.url), "utf8"));
  // The universe the SITE uses since 2026-07-27: every pool. The bench crosses borders because the
  // companies compete across them (owner ruling) — Taiwan Semiconductor's bench could not contain
  // ASML while selectPeers was handed the US pool alone, and ASML's could not contain Tokyo Electron.
  const adr = JSON.parse(readFileSync(new URL("../src/data/fundamentals.adr.json", import.meta.url), "utf8"));
  const jpPool = JSON.parse(readFileSync(new URL("../src/data/fundamentals.jp.json", import.meta.url), "utf8"));
  const euPool = JSON.parse(readFileSync(new URL("../src/data/fundamentals.eu.json", import.meta.url), "utf8"));
  const universe = [...(fund.companies || []), ...(adr.companies || []), ...(jpPool.companies || []), ...(euPool.companies || [])];
  const pages = universe;

  let benches = 0, noSection = 0, offLens = 0, offLensBenches = 0;
  for (const c of pages) {
    const r = selectPeers(c, universe);
    if (!r.peers.length) { noSection++; continue; }
    benches++;
    const mine = financialKind(c) || null;
    const bad = r.peers.filter((p) => (financialKind(p) || null) !== mine).length;
    if (bad) { offLens += bad; offLensBenches++; }
  }
  check(`no bench carries an off-lens peer (${offLens} rows across ${offLensBenches} benches)`, offLens === 0);
  check(`the guard empties no bench (${benches} benches, ${noSection} without a peer section)`, noSection === 0 && benches > 3800);

  // The bench crosses borders, and the SCALE test that ranks candidates converts to one currency
  // before comparing. Without that second half a yen filer looks a hundred times larger than it is:
  // Nissan files 12.0 trillion yen against Nvidia's 215.9 billion dollars, and on the raw numbers
  // Nissan reads as fifty-five times the larger when it is roughly a third.
  const tick = (t) => pages.find((x) => String(x.ticker).toUpperCase() === t) || null;
  const bench = (t) => { const c = tick(t); return c ? selectPeers(c, universe).peers.map((p) => p.ticker) : []; };
  check("Taiwan Semiconductor benches the American chipmakers", ["NVDA", "INTC", "AMD"].filter((t) => bench("TSM").includes(t)).length >= 2);
  check("Nvidia benches Taiwan Semiconductor", bench("NVDA").includes("TSM"));
  check("ASML benches the other semiconductor-equipment makers, across three pools",
    ["LRCX", "KLAC"].every((t) => bench("ASML").includes(t)) && bench("ASML").some((t) => /^[0-9]{4}$/.test(t)));
  check("Exxon benches the integrated majors rather than only US filers",
    ["BP", "SHEL", "TTE"].filter((t) => bench("XOM").includes(t)).length >= 2);
  // A Japanese filer gets a bench at all, which it never had: /jp/[ticker] rendered no peer section.
  check("Tokyo Electron has a bench", bench("8035").length >= 3);
  check("Toyota has a bench", bench("7203").length >= 3);

  // The named cases the guard exists for. Each was live on 2026-07-26.
  const byT = (t) => pages.find((x) => String(x.ticker).toUpperCase() === t) || null;
  const peersOf = (t) => { const c = byT(t); return c ? selectPeers(c, universe).peers.map((p) => p.ticker) : []; };
  const SERVICES = ["CBRE", "JLL", "CWK"];
  check("IRSA no longer benches the real-estate services firms on a bank's lens",
    !peersOf("IRS").some((t) => SERVICES.includes(t)));
  check("Landbridge benches oil & gas royalties, not mortgage lenders",
    peersOf("LB").includes("TPL") && !peersOf("LB").some((t) => ["ARR", "CIM", "RWT", "AGNC", "NLY"].includes(t)));

  // Howard Hughes and Transcontinental Realty are not REITs (the REIT desk read their filings), so
  // they belong in no REIT's bench — they were seating on fourteen of them through the curated
  // NAREIT subsector map, which the archetype's NOT_REITS list could not reach.
  const inSomeReitBench = (t) => pages.some((c) => {
    if ((financialKind(c) || null) !== "reit") return false;
    return selectPeers(c, universe).peers.some((p) => p.ticker === t);
  });
  check("Howard Hughes sits in no REIT bench", !inSomeReitBench("HHH"));
  check("Transcontinental Realty sits in no REIT bench", !inSomeReitBench("TCI"));
}

// ---------------------------------------------------------------------------------------------
// THE ARCHETYPE'S REAL-ESTATE BRANCH, taxonomy-anchored since 2026-07-27. The lender lens is
// reached through the industry the taxonomy seats a filer in, not through a shape test that read
// "no depreciation line" as "owns loans" — which is true of a US mortgage REIT and equally true of
// every IFRS landlord, because investment property carried at fair value is not depreciated.
// ---------------------------------------------------------------------------------------------
{
  const fund = JSON.parse(readFileSync(new URL("../src/data/fundamentals.json", import.meta.url), "utf8"));
  const adr = JSON.parse(readFileSync(new URL("../src/data/fundamentals.adr.json", import.meta.url), "utf8"));
  const all = [...(fund.companies || []), ...(adr.companies || [])];
  const kindOf = (t) => { const c = all.find((x) => String(x.ticker).toUpperCase() === t); return c ? financialProfile(c) : null; };

  // The eight that were being read as banks and are not lenders of any kind.
  for (const t of ["IRS", "VTMX", "DUO", "LB", "BPYPM"]) {
    const p = kindOf(t);
    check(`${t} is no longer read on the bank lens`, !p || p.subtype !== "mortgage-reit");
  }
  // The genuine mortgage REITs keep the lender lens — the whole point of anchoring rather than
  // deleting. Annaly, AGNC and Claros are seated in Mortgage & Specialty Finance.
  for (const t of ["NLY", "AGNC", "ABR", "CMTG"]) {
    const p = kindOf(t);
    check(`${t} still reads as a mortgage REIT`, !p || p.subtype === "mortgage-reit");
  }
  // SIC 6794 is "patent owners and lessors", which had been handing a REIT scorecard to technology
  // licensors. A shelf's family says which columns its table shows, not which statement a member is
  // read on, so these resolve to operating businesses rather than to that shelf's financial lens.
  for (const t of ["DLB", "IDCC", "ACTG", "TPL"]) {
    const p = kindOf(t);
    check(`${t} is not read as a REIT`, !p || p.kind !== "reit");
  }
  check("Dolby is read as an operating business", (kindOf("DLB") || {}).kind == null);
}

// The distribution helper: median, the subject's percentile, the band — context, no winner.
const s = peerStat([0.10, 0.12, 0.14, 0.16, 0.18], 0.16);
check("peerStat median is 0.14", s && Math.abs(s.median - 0.14) < 1e-9);
check("peerStat percentile is 3 of 5 below 0.16", s && Math.abs(s.percentile - 0.6) < 1e-9);
check("peerStat reports the band and count", s && s.min === 0.10 && s.max === 0.18 && s.count === 5);
check("peerStat withholds on too few points", peerStat([0.1, 0.2], 0.15) === null);
check("peerStat withholds on a null subject", peerStat([0.1, 0.2, 0.3], null) === null);

// Through-cycle metric and peer median: a company is read across its record, and the peer median is the
// median of those through-cycle figures — the context a company's own number is read against.
const withHist = (vals) => ({ history: vals.map((v) => ({ lines: { _m: v } })), lines: { _m: vals[vals.length - 1] } });
check("throughCycleMetric is the record median", Math.abs(throughCycleMetric(withHist([0.1, 0.2, 0.3, 0.4, 0.5]), (L) => L._m) - 0.3) < 1e-9);
check("peerMedian is the median of peers' through-cycle figures",
  Math.abs(peerMedian([withHist([0.1, 0.1, 0.1]), withHist([0.2, 0.2, 0.2]), withHist([0.3, 0.3, 0.3])], (L) => L._m) - 0.2) < 1e-9);
check("peerMedian withholds under three peers", peerMedian([withHist([0.1, 0.1, 0.1])], (L) => L._m) === null);

// Yield on float, behind the plausibility cap: the pipeline's only float line is the P&C
// loss-reserve tag, so a life insurer (MetLife's 110%, RGA's 82%) prints an impossible "yield" —
// withheld rather than shown wrong. A real P&C reading passes through untouched.
check("floatYield passes a plausible P&C reading", Math.abs(floatYield({ investmentIncome: 1e9, lossReserves: 20e9 }) - 0.05) < 1e-9);
check("floatYield withholds an impossible life-insurer reading (MET-shaped, 110%)", floatYield({ investmentIncome: 22e9, lossReserves: 20e9 }) === null);
check("floatYield withholds just past the cap and keeps just under it",
  floatYield({ investmentIncome: 16e8, lossReserves: 1e10 }) === null && floatYield({ investmentIncome: 14e8, lossReserves: 1e10 }) != null && FLOAT_YIELD_CAP === 0.15);
check("floatYield withholds when either line is missing", floatYield({ investmentIncome: 1e9 }) === null && floatYield({ lossReserves: 1e9 }) === null && floatYield(null) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
