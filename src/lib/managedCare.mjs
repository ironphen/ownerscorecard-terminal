// Managed care (health plans): UNH, Cigna, Humana, Elevance, Centene. These look like
// insurers on the SEC's books, but they are not the float-and-combined-ratio business
// Buffett means by "insurer." A health plan pays most claims within weeks, so there is
// almost no investable float; the whole game is the medical loss ratio (the share of
// premiums paid back out as care), a thin operating margin earned on enormous volume,
// and membership growth across commercial, Medicare and Medicaid. A regulated floor
// (the ACA requires roughly 80-85% of premiums be spent on care or rebated) caps how
// wide that spread can ever be. Arithmetic on the filings; the verdict is the reader's.

import { fmtMoney, operatingMargin } from "./fundamentals.mjs";
import { returnOnEquity } from "./financials.mjs";

const pc = (v, dp = 0) => (v == null ? "—" : `${v < 0 ? "−" : ""}${(Math.abs(v) * 100).toFixed(dp)}%`);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Medical loss ratio: medical costs over premiums earned. Guarded to a believable band,
// because some filers tag only a slice of premiums (Centene shows a nonsense 364%
// otherwise), in which case we'd rather show nothing than a wrong number.
export function medicalLossRatio(L) {
  if (!L || L.claimsIncurred == null || !L.premiumsEarned) return null;
  const r = Math.abs(L.claimsIncurred) / L.premiumsEarned;
  return r >= 0.6 && r <= 1.1 ? r : null;
}

export function buildManagedCareScorecard(company) {
  const $ = (v) => fmtMoney(v, company?.currency || "USD");
  const L = company?.lines || {};
  const none = (title, note, concept = null) => ({ title, concept, value: "—", formula: "", tone: "none", label: "Not enough data", note });

  const mlr = medicalLossRatio(L);
  const mlrCheck = mlr == null ? none("Medical loss ratio", "Premiums or medical claims weren't cleanly tagged in the filing data.", "medical-loss-ratio") : {
    title: "Medical loss ratio",
    concept: "medical-loss-ratio",
    value: pc(mlr, 1), formula: `Medical costs ${$(Math.abs(L.claimsIncurred))} ÷ premiums earned ${$(L.premiumsEarned)}`,
    tone: mlr < 0.82 ? "info" : mlr < 0.87 ? "good" : mlr < 0.9 ? "ok" : mlr < 0.93 ? "warn" : "bad",
    label: mlr < 0.82 ? "Low, near the rebate floor" : mlr < 0.87 ? "Profitable band" : mlr < 0.9 ? "Costs well-covered" : mlr < 0.93 ? "Costs running high" : "Little spread on premiums",
    note: "The number that runs a health plan: cents of every premium dollar paid back out as medical care. A regulated floor (about 80-85% under the ACA, or rebates are owed) means the plan keeps only a thin sliver, so the discipline is in pricing premiums ahead of medical cost trend. Read it across years, because a single bad cost trend, like the recent Medicare Advantage squeeze, shows up here first.",
  };

  const om = operatingMargin(L);
  const omCheck = om == null ? none("Operating margin", "Operating income or revenue missing.", "operating-margin") : {
    title: "Operating margin",
    concept: "operating-margin",
    value: pc(om, 1), formula: `Operating income ${$(L.operatingIncome)} ÷ revenue ${$(L.revenue)}`,
    tone: om < 0.02 ? "bad" : om < 0.04 ? "warn" : om < 0.06 ? "ok" : "good",
    label: om < 0.02 ? "Very thin (<2%)" : om < 0.04 ? "Thin, as the model runs" : om < 0.06 ? "Typical for a plan" : "Wide for a plan",
    note: "Health plans earn a sliver on enormous revenue, so a few points of margin is the norm and the business is really a volume-and-cost-control game. Because the margin is so thin, a small miss on medical costs swings profit hard, which is why membership scale and cost management matter more than price.",
  };

  const roe = returnOnEquity(L);
  const roeCheck = roe == null ? none("Return on equity", "Net income or equity missing.", "return-on-equity") : {
    title: "Return on equity",
    concept: "return-on-equity",
    value: pc(roe), formula: `Net income ${$(L.netIncome)} ÷ equity ${$(L.stockholdersEquity)}`,
    tone: roe < 0 ? "bad" : roe < 0.1 ? "warn" : roe < 0.13 ? "ok" : "good",
    label: roe < 0 ? "Loss on equity" : roe < 0.1 ? "Below the cost of equity" : roe < 0.15 ? "Solid" : "Strong",
    note: "The thin margin turns over fast on a modest capital base, so a plan earning its keep still shows a good return on equity. Durably above the ~10% cost of equity is what compounds value; a year below it usually means medical costs outran premiums.",
  };

  return {
    sections: [
      { heading: "Is it a good business?", checks: [mlrCheck, omCheck, roeCheck] },
    ],
  };
}

export function managedCareQuality(company) {
  const H = (company?.history || []).filter((h) => h?.lines?.revenue != null);
  const mlrSeries = H.map((h) => medicalLossRatio(h.lines)).filter((v) => v != null);
  const omSeries = H.map((h) => operatingMargin(h.lines)).filter((v) => v != null);
  const roeSeries = H.map((h) => returnOnEquity(h.lines)).filter((v) => v != null);
  if (omSeries.length < 3) return null;
  const mlrMed = median(mlrSeries);
  const omMed = median(omSeries);
  const roeMed = median(roeSeries);

  let s1;
  if (mlrMed != null) s1 = `It pays out about ${pc(mlrMed)} of premiums as medical care across the record (the medical loss ratio), keeping the rest to cover administration and profit against a regulated floor`;
  else s1 = "The split between premiums and medical costs is not cleanly tagged in the filings";
  s1 += ".";

  let s2 = "";
  if (omMed != null) s2 = ` That leaves a thin operating margin, a median of about ${pc(omMed, 1)}, the sign of a volume-and-cost-control business rather than a high-margin one`;
  if (roeMed != null) s2 += `${omMed != null ? ", though" : " It"} turns that sliver over fast enough to earn roughly ${pc(roeMed)} on equity`;
  if (s2) s2 += ".";

  const s3 = " Whether membership keeps growing and medical costs stay below premiums, especially as the Medicare Advantage and Medicaid mix shifts, is what the 10-K decides, not an earnings multiple.";
  return { text: [s1, s2, s3].filter(Boolean).join(" ") };
}
