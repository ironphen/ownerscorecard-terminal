// Utilities: Buffett's regulated compounder, read the way the BHE letters read one. A regulated
// utility's prices are set by commission, so its return is capped by design and the questions are
// different from an operating business's: what return the regulator allows and the company actually
// EARNS on shareholders' capital; how fast the invested base earning that return is GROWING (the
// reinvestment runway — plant, not promises); how much of this year's earnings is AFUDC, the
// non-cash allowed return credited during construction before the plant earns cash; and the
// regulatory assets and liabilities — costs the commission has agreed the utility may recover from
// ratepayers later, and amounts it owes back to them — which are the ledger of the relationship
// with the commissions that decide everything else. Membership in this read is decided at
// extraction by the filer's own tags (the >=5 rate-regulated concept gate, docs/utilities-desk-
// survey.md), never by SIC alone, so a merchant generator on a utility SIC never wears this
// costume. Rate base itself is never printed: the number does not exist in the structured data,
// and net utility plant is the honest proxy labeled as what it is.

import { fmtMoney, recordMedian, shortRecord, latestReported } from "./fundamentals.mjs";
import { returnOnEquity } from "./financials.mjs";

const pc = (v, dp = 1) => (v == null ? "—" : `${v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(dp)}%`);

// The five gate-passing holding companies whose consolidated figures mix a regulated book with
// substantial unregulated businesses, named by the desk survey: the regulated share is not
// separable in the filing, so the mix is disclosed rather than repaired.
export const UTILITY_HOLDCOS = new Set(["NEE", "SRE", "UGI", "AES", "OTTR"]);

// The regulated filers whose utility-plant detail lives only on subsidiary or segment axes the
// structured data drops (censused, wf_be39d3c2): the plant figure is withheld with the reason,
// never substituted with consolidated PP&E, which includes everything the regulator does not set
// a return on.
const PLANT_DIMENSIONED_ONLY = new Set(["AEE", "ALE", "AWR", "BKH", "CNP", "HE", "MGEE", "NEE", "NWN", "SRE", "WTRG", "XEL"]);

// Annualized growth of the utility plant base over the readable record, on the record's own
// basis (net or gross, locked per filer by the pipeline — the two are never mixed). Returns
// {value, years, of, fromFy, toFy, from, to} or null under three readable years.
export function plantGrowth(company) {
  const pts = [];
  for (const h of company?.history || []) {
    if (h?.lines?.utilityPlant != null && h.lines.utilityPlant > 0 && h.fy != null) pts.push({ fy: h.fy, v: h.lines.utilityPlant });
  }
  if (company?.lines?.utilityPlant != null && company.lines.utilityPlant > 0 && company.fy != null && !pts.some((p) => p.fy === company.fy)) {
    pts.push({ fy: company.fy, v: company.lines.utilityPlant });
  }
  pts.sort((a, b) => a.fy - b.fy);
  if (pts.length < 3) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const span = last.fy - first.fy;
  if (span < 2) return null;
  const value = Math.pow(last.v / first.v, 1 / span) - 1;
  return { value, years: pts.length, of: span + 1, fromFy: first.fy, toFy: last.fy, from: first.v, to: last.v };
}

// AFUDC equity credited to earnings as a share of net income — the construction credit's weight
// in this year's reported profit. Withheld where net income is not positive (a share of a loss
// teaches nothing); the dollars still exist for the surface to show.
export function afudcShare(L) {
  return L && L.afudcEquity != null && L.netIncome > 0 ? L.afudcEquity / L.netIncome : null;
}

export function buildUtilityScorecard(company) {
  const $ = (v) => fmtMoney(v, company?.currency || "USD");
  const L = company?.lines || {};
  const none = (title, note, concept = null) => ({ title, concept, value: "—", formula: "", tone: "none", label: "Not enough data", note });

  // --- earned ROE, through the record: the whole game under regulation ---
  const med = recordMedian(company, (l) => returnOnEquity(l));
  const latest = returnOnEquity(L);
  const roeCheck = !med || med.value == null
    ? none("Earned return on equity", "Net income or equity is missing from the structured data.", "return-on-equity")
    : {
      title: "Earned return on equity",
      concept: "return-on-equity",
      value: shortRecord(med) ? `${pc(med.value)} · ${med.years}y` : pc(med.value),
      formula: `Median over ${med.years} readable years${latest != null ? ` · latest FY${company.fy ?? ""}: ${pc(latest)} (net income ${$(L.netIncome)} ÷ equity ${$(L.stockholdersEquity)})` : ""}`,
      tone: med.value < 0 ? "bad" : med.value < 0.06 ? "warn" : med.value < 0.085 ? "ok" : med.value <= 0.13 ? "good" : "info",
      label: med.value < 0 ? "Loss on equity" : med.value < 0.06 ? "Under-earning" : med.value < 0.085 ? "Below the typical allowed band" : med.value <= 0.13 ? "Earning the allowed return" : "Above the typical allowed band",
      note: "A commission caps what a regulated utility may earn on shareholders' capital, so the question is not whether the return is high but whether the company actually earns what it is allowed — persistent under-earning means costs the regulator will not put in rates, and a return above the band usually means unregulated businesses in the mix. Read through the record, because a single year carries rate-case timing noise.",
    };

  // --- AFUDC: the construction credit inside earnings, a flow read with the record fallback ---
  const share = afudcShare(L);
  const priorAfudc = L.afudcEquity == null
    ? latestReported(company, (l) => (l.afudcEquity != null ? { afudc: l.afudcEquity, share: afudcShare(l) } : null))
    : null;
  const afudcCheck = L.afudcEquity != null
    ? {
      title: "AFUDC in earnings",
      concept: null,
      value: share != null ? pc(share) : $(L.afudcEquity),
      formula: `Equity allowance for funds used during construction ${$(L.afudcEquity)}${share != null ? ` ÷ net income ${$(L.netIncome)}` : " (net income not positive; the share is withheld)"}`,
      tone: "info",
      label: share != null && share >= 0.15 ? "Heavy build underway" : "Construction credit in earnings",
      note: "While a plant is under construction the commission lets the utility credit itself the allowed return on the capital tied up — a real, allowed profit that arrives as a bookkeeping entry now and as cash only after the plant enters rates. A large share means heavy reinvestment at the allowed return, the thing Berkshire's utility letters prize; it also means that much of this year's earnings has not yet been collected from anyone.",
    }
    : priorAfudc
    ? {
      title: "AFUDC in earnings",
      concept: null,
      value: `${priorAfudc.value.share != null ? pc(priorAfudc.value.share) : $(priorAfudc.value.afudc)} · FY${priorAfudc.fy}`,
      formula: `FY${priorAfudc.fy}, the most recent year reported: equity AFUDC ${$(priorAfudc.value.afudc)}`,
      tone: "info",
      label: `Last reported FY${priorAfudc.fy}`,
      note: "The construction credit the commission allows into earnings, read at the most recent year the filing data carries it — named, never passed off as current. A year without the line usually means construction paused, which is itself information.",
    }
    : none("AFUDC in earnings", "The equity allowance for funds used during construction is not tagged in this filer's structured data — the construction credit, if any, lives in the 10-K's rate-matters note.", null);

  // --- the invested base: utility plant on the record's own basis, with its growth ---
  const g = plantGrowth(company);
  const basis = company?.utilityPlantBasis || null;
  const plantTitle = basis === "gross" ? "Utility plant in service" : "Net utility plant";
  const plantCheck = L.utilityPlant != null
    ? {
      title: plantTitle,
      concept: null,
      value: $(L.utilityPlant),
      formula: `${basis === "gross" ? "Plant in service at original cost, before depreciation, as filed" : "Utility plant net of depreciation, as filed"}${g ? ` · FY${g.fromFy}→FY${g.toFy}: ${$(g.from)} → ${$(g.to)}, ≈ ${pc(g.value)}/yr${g.years < g.of ? ` (read on ${g.years} of ${g.of} years)` : ""}` : ""}`,
      tone: "info",
      label: g ? `Growing ≈ ${pc(g.value)}/yr` : "The invested base",
      note: "The closest filed figure to the rate base — the invested capital the commission sets the allowed return on. Its growth rate is the utility's reinvestment runway: under regulation, earnings power compounds roughly as fast as the base the return is earned on, funded by capital the regulator lets the company recover with interest. Rate base itself is not tagged in any structured filing, so this is the proxy, labeled as what it is.",
    }
    : PLANT_DIMENSIONED_ONLY.has(String(company?.ticker || "").toUpperCase())
    ? {
      title: plantTitle,
      concept: null,
      value: "—",
      formula: "",
      tone: "none",
      label: "On subsidiary axes only",
      note: "This filer reports its utility plant only on subsidiary or segment axes that the SEC's structured data drops, so the figure is withheld rather than approximated from consolidated property, which includes what the regulator sets no return on. The property schedule in the 10-K carries it.",
    }
    : none(plantTitle, "No undimensioned utility-plant figure is tagged in this filer's structured data.", null);

  // --- the regulatory ledger, as filed ---
  const rA = L.regulatoryAssets, rL = L.regulatoryLiabilities, nra = L.netRegulatoryAssets;
  const regCheck = rA != null || rL != null
    ? {
      title: "Regulatory assets & liabilities",
      concept: null,
      value: `${rA != null ? $(rA) : "—"} / ${rL != null ? $(rL) : "—"}`,
      formula: `Regulatory assets ${rA != null ? $(rA) : "not tagged"} · regulatory liabilities ${rL != null ? $(rL) : "not tagged"}${rA != null && rL != null ? ` · net ${rA - rL >= 0 ? $(rA - rL) + " asset" : $(rL - rA) + " liability"} position` : ""}, as filed`,
      tone: "info",
      label: rA != null && rL != null ? (rA >= rL ? "Owed recovery from ratepayers" : "Owes ratepayers") : "As filed",
      note: "The ledger of the regulatory relationship: assets are costs the commission has agreed the utility may collect from ratepayers in future rates, liabilities are amounts it must give back. Both are promises whose worth depends entirely on the commissions that made them — which is why they are shown as filed and never netted into earnings adjustments here.",
    }
    : nra != null
    ? {
      title: "Net regulatory position",
      concept: null,
      value: nra >= 0 ? $(nra) : `−${$(-nra)}`,
      formula: `Net regulatory assets as filed: ${nra >= 0 ? `${$(nra)} to be recovered from ratepayers` : `${$(-nra)} owed back to ratepayers`} (this filer tags only the net figure)`,
      tone: "info",
      label: nra >= 0 ? "Owed recovery from ratepayers" : "Owes ratepayers",
      note: "The ledger of the regulatory relationship, which this filer reports only as a net figure: positive means costs the commissions have agreed may be collected in future rates, negative means amounts owed back to ratepayers. A promise whose worth depends on the commissions that made it, shown as filed.",
    }
    : none("Regulatory assets & liabilities", "The regulatory balance-sheet lines are not tagged undimensioned in this filer's structured data; the regulatory-matters note in the 10-K carries them.", null);

  const checks2 = [plantCheck, regCheck];
  // The holdco trap, disclosed rather than repaired (desk ruling, 2026-07-28).
  if (UTILITY_HOLDCOS.has(String(company?.ticker || "").toUpperCase())) {
    checks2.push({
      title: "What these figures mix",
      concept: null,
      value: "—",
      formula: "",
      tone: "none",
      label: "Consolidated, not the regulated book alone",
      note: "This is a holding company whose consolidated figures mix the regulated utility with substantial unregulated businesses, and the filing does not separate the regulated share in structured form. The earned return and the balance-sheet lines above describe the whole enterprise; the segment note in the 10-K is where the regulated book stands alone.",
    });
  }

  return {
    sections: [
      { heading: "The allowed return, earned and credited", checks: [roeCheck, afudcCheck] },
      { heading: "The invested base and the regulatory ledger", checks: checks2 },
    ],
  };
}
