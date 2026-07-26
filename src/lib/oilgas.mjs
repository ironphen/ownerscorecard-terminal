// oilgas.mjs — the oil & gas desk's surfaces (docs/oil-gas-desk-survey.md, ratified 2026-07-26).
//
// Three readings, and deliberately no more. A producer sells its own inventory and must buy it
// back, so the questions worth asking an owner are: how many years of production are left, whether
// the company replaced what it sold, and how much of what it calls "proved" is still only a plan.
// Everything else about these businesses the general scorecard already answers.
//
// Every figure here is a RATIO and therefore unitless. That is not an accident of design: reserve
// quantities are filed in units that differ by company — barrels, thousand barrels of oil
// equivalent, million cubic feet equivalent, billion cubic feet equivalent — and the unit does not
// travel into the record. A raw quantity whose unit a reader cannot check is not a fact he can use,
// so the desk publishes the ratios the units cancel out of and leaves the quantities in the filing.
import { fmtMoney } from "./fundamentals.mjs";

const pc = (v, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);

export function hasOilGasRead(company) {
  const L = company?.lines || {};
  return L.reserveLifeYears != null || L.reserveReplacement != null || L.pudShare != null;
}

// How long the company could produce at this rate before it had nothing left to sell. The single
// most useful number a producer has, and the one a reader would act on, which is why the extraction
// withholds it rather than estimating it wherever the filing does not support it.
export function reserveLifeCheck(company) {
  const L = company?.lines || {};
  const y = L.reserveLifeYears;
  if (y == null) return null;
  return {
    title: "How many years of production are left?",
    concept: "reserve-life",
    value: `${y.toFixed(1)} years`,
    formula: "Proved reserves ÷ the year's production, both as the filer reports them",
    tone: y < 6 ? "warn" : y < 10 ? "ok" : y < 20 ? "good" : "info",
    label: y < 6 ? "A short runway" : y < 10 ? "Under a decade" : y < 20 ? "A long runway" : "Very long, and worth asking why",
    note: "Proved reserves divided by a year of production. It is not a prediction and not a life expectancy: reserves are added every year and this figure moves with the price deck the SEC mandates for booking them. Read it as the runway the company is currently operating on. A short one means the drill bit has to keep working merely to stand still; a very long one is worth a question, since reserves booked far into the future carry the most estimating and the least certainty.",
  };
}

// Whether the business replaced what it consumed. Revisions are inside this figure, including
// negative ones, because a company that quietly wrote down last year's estimate has told you
// something about the quality of its bookings and excluding that would report only the good news.
export function replacementCheck(company) {
  const L = company?.lines || {};
  const r = L.reserveReplacement;
  if (r == null) return null;
  return {
    title: "Did it replace what it sold?",
    concept: "reserve-replacement",
    value: pc(r),
    formula: "Discoveries and extensions, plus revisions to earlier estimates, ÷ the year's production",
    tone: r < 0.5 ? "bad" : r < 1 ? "warn" : r < 1.5 ? "good" : "info",
    label: r < 0.5 ? "Produced far more than it found" : r < 1 ? "Shrinking the reserve base" : r < 1.5 ? "Replaced what it produced" : "Added well beyond production",
    note: "Every barrel produced is a barrel gone, so a producer is only durable if it finds more than it sells. This counts what the drill bit added, discoveries and extensions, together with revisions to earlier estimates. The revisions belong here even when they are negative: a company that quietly marks down last year's bookings has told an owner something about how those bookings were made, and a figure that showed only the additions would flatter exactly the companies that most need watching. Reserves bought from another company are a different act and are not counted here, because paying a market price for barrels is not the same skill as finding them cheaply.",
  };
}

// How much of "proved" is a plan rather than a well. Undeveloped reserves are booked on an intent
// to drill within five years and require capital the company has not yet spent.
export function pudCheck(company) {
  const L = company?.lines || {};
  const s = L.pudShare;
  if (s == null) return null;
  return {
    title: "How much of it is still only a plan?",
    concept: "proved-undeveloped",
    value: pc(s),
    formula: "Proved undeveloped reserves ÷ total proved reserves",
    tone: s < 0.2 ? "good" : s < 0.35 ? "ok" : s < 0.5 ? "warn" : "bad",
    label: s < 0.2 ? "Almost all of it is producing" : s < 0.35 ? "A normal share awaiting capital" : s < 0.5 ? "A large share awaiting capital" : "Most of it is not yet drilled",
    note: "Proved reserves come in two kinds and the difference matters. Developed reserves sit behind wells that already exist. Undeveloped reserves are booked on management's intent to drill them within five years, and turning them into production requires capital the company has not yet spent. A high share is not by itself a fault, since a company with a long drilling inventory has somewhere to put its money, but it does mean the reserve figure describes a plan as much as an asset, and the plan can be revised away.",
  };
}

export function oilGasSection(company) {
  const checks = [reserveLifeCheck(company), replacementCheck(company), pudCheck(company)].filter(Boolean);
  if (!checks.length) return null;
  return { heading: "The reserves, and what it costs to keep them", checks };
}
