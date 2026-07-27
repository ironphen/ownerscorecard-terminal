// THE PEER BENCH'S COLUMNS, declared once (2026-07-27).
//
// The owner reported the gap that produced this file: "the column wins that exist in the various
// industries on the groupings page don't exist in the peers section columns on each company page."
// He was right, and the cause was structural rather than an oversight. The /groupings tables pick
// their columns from the shelf's FAMILY; the peer bench picked its own from financialKind, in a
// hand-written list inside the component. Nothing forced the two to agree, so six analyst desks
// shipped specialist columns onto one surface and none onto the other. 3,502 of the 3,600 counted
// businesses could see a figure on their industry table that their own page never showed them.
//
// WHAT IS ADMITTED, AND WHY IT IS NOT EVERYTHING. A grouping table has forty rows and can carry a
// column that answers a third of them: the eight that answer still teach, and empty cells beside full
// ones are honest. A BENCH IS SEVEN ROWS, where the same column is two numbers and five dashes, which
// teaches nothing and reads as broken. So every candidate was measured across the benches it would
// actually render on, and a column is admitted only where it clears half the bench on the large
// majority of them:
//
//   ADMITTED   stock pay          clears half on 253 of 253 software benches
//              capex intensity                   103 of 103 semiconductor
//              R&D intensity                     103 of 103
//              inventory days                    102 of 103
//              sales & marketing                 201 of 253 software
//              noninterest-bearing share         294 of 353 bank
//
//   REFUSED    next year contracted               25 of 253 — blank entirely on 121 of them
//              years of production left            8 of 62 oil & gas producer benches
//              replaced what it sold               6 of 62
//              undeveloped share                  16 of 62
//
// The four refusals are the honest cost of the bench being small. Contracted revenue is the software
// desk's best column and it is unreadable at bench scale: only 34 of 253 filers tag the twelve-month
// band at all. It stays on /groupings/software, where forty rows make thirty-four readings a column
// worth having. The oil & gas desk contributes nothing here for the same reason, which is a finding
// rather than a failure — reserve quantities are tagged by a fifth of producers.
//
// MONEY COLUMNS ARE REFUSED OUTRIGHT, all of them, on every lens. The bench's device is a
// distribution: each figure read against the group median at the foot. Rendering the families' money
// lines would turn 0 group medians into 12,097, and 70% of the net-debt ones would be mixed-sign —
// a median of a set containing both net cash and net debt is not a fact about anything. Deposits,
// float, reserve development, owner earnings in dollars and tangible equity all stay on the tables
// where a reader compares levels rather than distributions. Where a desk's read exists in both forms
// the bench takes the ratio: the banks desk's franchise column is the noninterest-bearing SHARE, not
// the deposit dollars.
//
// THE BASIS TRAVELS WITH THE COLUMN. Quality ratios are read through the cycle, the median over the
// readable record. The specialist intensities are read at the latest fiscal year, because that is
// what the /groupings tables read them at, and a concept that prints two figures on two surfaces is
// the defect this whole day was spent removing. Each column states its own basis in the header rather
// than the table making one blanket claim over columns that do not share one.
import {
  grossMargin,
  gmCorrupt,
  operatingMargin,
  roicValue,
  ownerEarningsMargin,
  recordMedian,
} from "./fundamentals.mjs";
import { returnOnEquity, returnOnTangibleEquity, efficiencyRatio, netInterestMargin, roteOverRecord } from "./financials.mjs";
import { cashPayout, debtToAssets } from "./reits.mjs";
import { combinedRatio, lossRatio } from "./insurers.mjs";
import { medicalLossRatio } from "./managedCare.mjs";
import { floatYield } from "./peers.mjs";
import { financialKind, financialSubtype } from "./archetype.mjs";
import { industryLabelOf, shelfOfIndustry } from "./shelves.mjs";

// A ratio read through the cycle: the median over every readable year, carrying the count so a short
// record is marked rather than either blanked or disguised. Shared with the grouping tables.
const cyc = (fn) => (c) => recordMedian(c, fn);

// A ratio read at the latest fiscal year, on the same basis its /groupings column uses. `years: null`
// means "not a record median", so the surface never marks it with a year count.
const now = (fn) => (c) => {
  const v = fn(c?.lines || {}, c);
  return v != null && Number.isFinite(v) ? { value: v, years: null } : null;
};

const share = (num, den) => (L) => (L?.[num] != null && L?.[den] > 0 ? L[num] / L[den] : null);
const CYCLE = "median over the record";
const LATEST = "latest FY";

export const PEER_COL = {
  // ---- the operating read ----
  grossMargin: { key: "grossMargin", label: "Gross margin", concept: "gross-margin", dp: 0, basis: CYCLE,
    read: cyc((L, co) => { const v = grossMargin(L); return v != null && gmCorrupt(v, co) ? null : v; }) },
  opMargin: { key: "opMargin", label: "Op. margin", concept: "operating-margin", dp: 1, basis: CYCLE,
    read: cyc((L) => operatingMargin(L)) },
  roic: { key: "roic", label: "ROIC", concept: "roic", dp: 0, basis: CYCLE, read: cyc((L) => roicValue(L)) },
  oeMargin: { key: "oeMargin", label: "Owner earn. margin", concept: "owner-earnings", dp: 0, basis: CYCLE,
    read: cyc((L, co) => ownerEarningsMargin(L, co)) },
  netMargin: { key: "netMargin", label: "Net margin", concept: null, dp: 1, basis: CYCLE,
    read: cyc((L) => share("netIncome", "revenue")(L)) },

  // ---- the software desk (2026-07-24). Contracted revenue is deliberately absent; see the header. ----
  salesMarketing: { key: "salesMarketing", label: "Sales & marketing", concept: "sales-and-marketing", dp: 1, basis: LATEST,
    read: now(share("sellingMarketing", "revenue")) },
  stockComp: { key: "stockComp", label: "Stock pay", concept: "dilution", dp: 1, basis: LATEST,
    read: now(share("stockComp", "revenue")) },

  // ---- the semiconductor desk: what a chipmaker must spend to stay where it is, and the cycle ----
  rdIntensity: { key: "rdIntensity", label: "R&D / revenue", concept: "rd-intensity", dp: 1, basis: LATEST,
    read: now(share("researchDevelopment", "revenue")) },
  capexIntensity: { key: "capexIntensity", label: "Capex / revenue", concept: "capex-intensity", dp: 1, basis: LATEST,
    read: now((L) => (L?.capex != null && L?.revenue > 0 ? Math.abs(L.capex) / L.revenue : null)) },
  inventoryDays: { key: "inventoryDays", label: "Inventory days", concept: "inventory-days", dp: 0, basis: LATEST, type: "num",
    read: now((L) => { const daily = L?.costOfRevenue > 0 ? L.costOfRevenue / 365 : null; return L?.inventory != null && daily ? L.inventory / daily : null; }) },

  // ---- lenders ----
  roe: { key: "roe", label: "ROE", concept: "return-on-equity", dp: 0, basis: CYCLE, read: cyc((L) => returnOnEquity(L)) },
  // Gated on the latest balance sheet: no tangible equity today, no return on it to report.
  rotce: { key: "rotce", label: "ROTCE", concept: "rotce", dp: 0, basis: CYCLE, read: (c) => roteOverRecord(c, recordMedian) },
  efficiency: { key: "efficiency", label: "Efficiency", concept: "efficiency-ratio", dp: 0, basis: CYCLE, read: cyc((L) => efficiencyRatio(L)) },
  nim: { key: "nim", label: "NII / assets", concept: "net-interest-margin", dp: 1, basis: CYCLE, read: cyc((L) => netInterestMargin(L)) },
  // The banks desk's franchise read (2026-07-21): the deposits the bank pays nothing for, as a share
  // of the total. The moat, one column wide — and the ratio form of a money column, which is why it
  // is the one the bench takes.
  nibShare: { key: "nibShare", label: "Noninterest-bearing share", concept: null, dp: 0, basis: LATEST,
    read: now(share("noninterestBearingDeposits", "deposits")) },

  // ---- insurers ----
  combined: { key: "combined", label: "Combined ratio", concept: "combined-ratio", dp: 0, basis: CYCLE, read: cyc((L) => combinedRatio(L)) },
  lossR: { key: "lossR", label: "Loss ratio", concept: "combined-ratio", dp: 0, basis: CYCLE, read: cyc((L) => lossRatio(L)) },
  // Investment income against the float that funds it, behind the plausibility cap in peers.mjs —
  // the wrong-denominator tripwire that keeps an impossible three-digit "yield" off the page.
  invYield: { key: "invYield", label: "Yield on float", concept: "insurance-float", dp: 1, basis: CYCLE, read: cyc((L) => floatYield(L)) },
  roa: { key: "roa", label: "Return on assets", concept: "return-on-assets", dp: 1, basis: CYCLE,
    read: cyc(share("netIncome", "totalAssets")) },
  mlr: { key: "mlr", label: "Medical loss ratio", concept: "medical-loss-ratio", dp: 0, basis: CYCLE, read: cyc((L) => medicalLossRatio(L)) },

  // ---- property ----
  cashMargin: { key: "cashMargin", label: "Cash margin", concept: "free-cash-flow", dp: 0, basis: CYCLE,
    read: cyc(share("cashFromOps", "revenue")) },
  cashOnAssets: { key: "cashOnAssets", label: "Cash / assets", concept: "free-cash-flow", dp: 1, basis: CYCLE,
    read: cyc(share("cashFromOps", "totalAssets")) },
  payout: { key: "payout", label: "Dividend / cash", concept: "dividend-coverage", dp: 0, basis: CYCLE, read: cyc((L) => cashPayout(L)) },
  debtToAssets: { key: "debtToAssets", label: "Debt / assets", concept: "net-debt", dp: 0, basis: CYCLE, read: cyc((L) => debtToAssets(L)) },
};

const C = PEER_COL;

// The lenses. A financial kind decides which STATEMENT a company is read on, so it wins wherever it
// applies. For an operating business — where there is no financial kind at all — the taxonomy's own
// column family decides which specialist columns it earns, which is the same source the /groupings
// table for that industry uses. The two can never contradict each other because the family route is
// only ever reached when the kind route has nothing to say.
export const PEER_LENSES = {
  operating: [C.grossMargin, C.opMargin, C.roic, C.oeMargin],
  software: [C.grossMargin, C.opMargin, C.roic, C.oeMargin, C.salesMarketing, C.stockComp],
  semiconductor: [C.grossMargin, C.opMargin, C.roic, C.oeMargin, C.rdIntensity, C.capexIntensity, C.inventoryDays],
  bank: [C.roe, C.rotce, C.efficiency, C.nim, C.nibShare],
  // Return on tangible equity rather than on equity, matching the insurer table: an underwriter is
  // read on hard capital, and only 5 of 121 insurance rows have no tangible equity to read it on.
  insurer: [C.combined, C.lossR, C.invYield, C.rotce],
  lifeInsurer: [C.roe, C.invYield, C.roa],
  managedCare: [C.mlr, C.opMargin, C.roe],
  fee: [C.opMargin, C.netMargin, C.roe],
  reit: [C.cashMargin, C.cashOnAssets, C.payout, C.debtToAssets],
};

// Which /groupings families map to a specialist operating lens. Everything else operating — general,
// heavy, producer — reads on the plain owner-economics lens, producer because its three desk columns
// were measured too sparse for a seven-row bench (see the header).
const FAMILY_LENS = { software: "software", semiconductor: "semiconductor" };

export function lensKeyFor(company) {
  const kind = financialKind(company) || null;
  if (kind === "bank") return "bank";
  if (kind === "insurer") return financialSubtype(company) === "life-insurer" ? "lifeInsurer" : "insurer";
  if (kind === "managedCare") return "managedCare";
  if (kind === "fee") return "fee";
  if (kind === "reit") return "reit";
  const label = industryLabelOf(company);
  const family = label ? shelfOfIndustry(label)?.family : null;
  return FAMILY_LENS[family] || "operating";
}

export function peerColumnsFor(company) {
  return PEER_LENSES[lensKeyFor(company)] || PEER_LENSES.operating;
}

// ---------------------------------------------------------------------------------------------
// THE COMPLETENESS GUARD, which is the durable answer to what the owner reported.
//
// Fixing the six desks' columns fixes six desks. The seventh desk — utilities is next on the docket —
// would recreate the gap on the day it ships, because nothing in the codebase ever asked whether a
// new /groupings column belonged on the bench too. So every ratio column on a family table must be
// either PRESENT on the matching peer lens or named here with the measurement that refused it. A new
// column merges only after somebody answers the question one way or the other.
//
// Money columns are exempt by construction: the bench refuses all of them, for the reason in the
// header, and listing thirty of them here would bury the four decisions that were actually made.
// ---------------------------------------------------------------------------------------------
export const REFUSED_ON_BENCH = {
  bookedYear: "clears half the bench on 25 of 253 software benches and is entirely blank on 121; only 34 of 253 filers tag the twelve-month band",
  reserveLife: "clears half on 8 of 62 producer benches; 12 of 63 producers tag both reserves and production",
  reserveReplacement: "clears half on 6 of 62 producer benches",
  pudShare: "clears half on 16 of 62 producer benches",
};

// Refusals that hold on SOME lenses only, keyed `lens.column`. Return on tangible equity is the whole
// list, and it is a genuine split rather than an inconsistency: tangible book is the right denominator
// for a bank or an insurer and the wrong one for a fee earner, whose capital is mostly the goodwill of
// what it bought. Measured across the four families that carry the column on /groupings: 58 of 220 fee
// rows and 2 of 9 managed-care rows have NEGATIVE tangible equity today, against 5 of 121 insurers and
// 1 of 353 lenders. Where the denominator is gone the figure is withheld outright (financials
// .roteOverRecord), so on those two lenses the column would be a hole for a quarter of the bench while
// return on equity answers 217 of 220 and 9 of 9. The bench asks the same question against a
// denominator that exists.
export const REFUSED_BY_LENS = {
  "fee.rote": "58 of 220 fee rows carry negative tangible equity; ROE answers 217 of 220 against ROTE's 196",
  "managedCare.rote": "2 of 9 managed-care rows carry negative tangible equity; ROE answers 9 of 9 against ROTE's 8",
};
