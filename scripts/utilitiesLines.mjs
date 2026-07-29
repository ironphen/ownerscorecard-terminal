// utilitiesLines.mjs — Wave C of the utilities desk (docs/utilities-desk-survey.md, rulings under
// the delegated grant of 2026-07-28): the regulated balance sheet and the reinvestment engine,
// extracted from SEC companyfacts under the gates the desk's census drew. Same architecture as the
// insurance and banks modules — named tags, per-filer guards, withhold-never-guess.
//
// THE MEMBERSHIP GATE. A filer earns these lines only by its own testimony: at least five distinct
// rate-regulated us-gaap concepts, each with at least one fact. Censused over every cached filer
// and hostile-replicated (wf_be39d3c2): failers top out at 4 concepts (NRG, ONEOK), passers begin
// at 7 (UGI) — the >=5 threshold sits inside a clean two-wide empty band, so any cut in 5..7 admits
// the identical cohort. Genie Energy and Hallador, which a presence test admits, count 1 each. The
// count runs only for utility-candidate filers (SIC 4900-4991 or a taxonomy Utilities override):
// EQT would pass on the legacy concepts of its pre-spin pipeline business, which is exactly why the
// gate is candidate-scoped rather than universe-wide.
//
// The census's verified hazards, encoded:
//   - Southern's undimensioned RegulatoryAssets (66M) is a COMPONENT ~100x below its
//     NetRegulatoryAssets series (6.9B) — a naive total-tag read returns a wrong number, not a
//     missing one. Total tags are therefore not read at all in this wave: the gross series is the
//     current+noncurrent pair, both legs present in the year, or nothing. (ATO's and NFG's total
//     tags run 1.3-105x the pair — note-disclosure scopes; a corroborated total fill is a
//     measured follow-up, not a default.)
//   - Composition drift: current-portion tags appear or vanish mid-record while noncurrent
//     continues (Ameren's liability-current dies after fy2023, Atmos's asset-current begins
//     fy2024). The both-present guard makes those years dark rather than letting a sum silently
//     change composition. A filer that NEVER tags a current portion reads on noncurrent alone —
//     its own complete filed classification — and the surface's basis line says so.
//   - Net vs gross plant differ 23-49% relative (SO's FY2025 gross 146.1B vs net 114.4B): the
//     plant series is BASIS-LOCKED per filer, never a per-year fallthrough, and the basis ships
//     with the record so no surface can label gross as net. Deriving net from gross minus
//     accumulated depreciation is refused — it reconciles for some filers and misses 3-10% for
//     others because construction work in progress sits inside presented net.
//   - The AFUDC equity leg is a single-tag read (zero mid-record switches, zero overlap
//     disagreements across 39 carriers). The ..Additions tag is NOT a fallback (scope is
//     filer-idiosyncratic: Duke 2012 Additions 300M vs equity+borrowed 476M); InterestCosts-
//     Capitalized is proven distinct from AFUDC-borrowed; both are left unread. Dark years mean
//     construction paused — they must render withheld, never zero.
//   - Canadian US-GAAP filers (AQN, EMA, FTS) carry these concepts on 40-F forms in CAD only; a
//     10-K USD reader correctly returns nothing for them. The ADR pool's read is a separate,
//     deliberate piece of work, not a silent extension of this one.

const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function flowByYear(facts, tag, unit = "USD") {
  const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
  if (!units) return null;
  const out = {};
  for (const u of units) {
    if (!u.form || !u.form.startsWith("10-K") || !u.start || !u.end) continue;
    const dur = days(u.start, u.end);
    if (dur < 350 || dur > 380) continue;
    const fy = new Date(u.end).getUTCFullYear();
    if (!out[fy] || (u.filed || "") > (out[fy].filed || "")) out[fy] = { val: u.val, filed: u.filed || "" };
  }
  return Object.keys(out).length ? Object.fromEntries(Object.entries(out).map(([fy, e]) => [fy, e.val])) : null;
}

// Instants under the F2 fiscal-calendar pin (the banks desk's mechanism): the year's value is the
// latest end within 14 days of the fiscal calendar, latest filed on ties — so Entergy's 2015-10-31
// mid-year balance can never masquerade as the fiscal year's value beside its 2015-12-31 true end.
function instantByYear(facts, tag, fyEnds, unit = "USD") {
  const units = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
  if (!units) return null;
  const perYear = {};
  for (const u of units) {
    if (!u.form || !u.form.startsWith("10-K") || !u.end || u.start) continue;
    const fy = new Date(u.end).getUTCFullYear();
    if (fyEnds?.[fy] && Math.abs(days(fyEnds[fy], u.end)) > 14) continue;
    (perYear[fy] ||= []).push({ val: u.val, end: u.end, filed: u.filed || "" });
  }
  const out = {};
  for (const fy of Object.keys(perYear)) {
    const xs = perYear[fy].sort((a, b) => (a.end !== b.end ? (a.end > b.end ? -1 : 1) : (a.filed > b.filed ? -1 : 1)));
    out[fy] = xs[0].val;
  }
  return Object.keys(out).length ? out : null;
}

const RATE_REGULATED_PATTERN = /Regulatory(Asset|Liabilit)|^Regulated|PublicUtilities|AllowanceForFundsUsedDuringConstruction|PhaseInPlan/;

// Distinct rate-regulated concepts carrying at least one fact, in any unit. The threshold that
// consumes this is >=5 (see the header); the count itself is returned so the gate's evidence can
// be logged and re-measured.
export function rateRegulatedConceptCount(facts) {
  const g = facts?.facts?.["us-gaap"] || {};
  let n = 0;
  for (const k of Object.keys(g)) {
    if (!RATE_REGULATED_PATTERN.test(k)) continue;
    const units = g[k]?.units || {};
    if (Object.values(units).some((arr) => Array.isArray(arr) && arr.length)) n++;
  }
  return n;
}

// The gross regulatory series: current + noncurrent where both legs carry the year; noncurrent
// alone only for a filer that never tags a current portion (its complete filed classification).
function regulatorySeries(facts, curTag, nonTag, fyEnds) {
  const cur = instantByYear(facts, curTag, fyEnds);
  const non = instantByYear(facts, nonTag, fyEnds);
  if (!non) return null; // the noncurrent leg is the workhorse; a current-only filer proves nothing
  if (!cur) return non;
  const out = {};
  for (const fy of Object.keys(non)) if (cur[fy] != null) out[fy] = non[fy] + cur[fy];
  return Object.keys(out).length ? out : null;
}

export function utilitiesLines(facts, fyEnds = null) {
  const warns = [];
  const flags = { warns };
  const instants = {};
  const flows = {};

  const regA = regulatorySeries(facts, "RegulatoryAssetsCurrent", "RegulatoryAssetsNoncurrent", fyEnds);
  if (regA) instants.regulatoryAssets = regA;
  const regL = regulatorySeries(facts, "RegulatoryLiabilityCurrent", "RegulatoryLiabilityNoncurrent", fyEnds);
  if (regL) instants.regulatoryLiabilities = regL;
  // As-filed NET position (assets minus liabilities), the only long series Southern files.
  // Stored beside the gross pair, never summed with it; negative values are a net regulatory
  // liability position — economics, not a data fault.
  const nra = instantByYear(facts, "NetRegulatoryAssets", fyEnds);
  if (nra) instants.netRegulatoryAssets = nra;

  // Utility plant, basis-locked per filer: presented NET where the filer gives it a real record,
  // gross plant-in-service only where net is absent or too thin to read a trend on (SO: gross 17y
  // vs net 3y). The basis travels with the record via flags.utilityPlantBasis.
  const net = instantByYear(facts, "PublicUtilitiesPropertyPlantAndEquipmentNet", fyEnds);
  const gross = instantByYear(facts, "PublicUtilitiesPropertyPlantAndEquipmentPlantInService", fyEnds);
  const netYears = net ? Object.keys(net).length : 0;
  const grossYears = gross ? Object.keys(gross).length : 0;
  if (netYears >= 4 || (netYears > 0 && netYears >= grossYears)) {
    instants.utilityPlant = net;
    flags.utilityPlantBasis = "net";
  } else if (grossYears > 0) {
    instants.utilityPlant = gross;
    flags.utilityPlantBasis = "gross";
    if (netYears > 0) warns.push(`utilityPlant: gross basis (net carries only ${netYears}y against gross ${grossYears}y; the two differ by design and are never mixed)`);
  }

  // The AFUDC equity leg: the return the commission allows on shareholder capital tied up in
  // construction, credited to earnings before the plant earns cash. A single-tag read.
  const afudc = flowByYear(facts, "PublicUtilitiesAllowanceForFundsUsedDuringConstructionCapitalizedCostOfEquity");
  if (afudc) flows.afudcEquity = afudc;

  return { flows, instants, flags };
}

export const UTILITY_LINE_NAMES = [
  "regulatoryAssets",
  "regulatoryLiabilities",
  "netRegulatoryAssets",
  "utilityPlant",
  "afudcEquity",
];
