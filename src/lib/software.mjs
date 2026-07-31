// software.mjs — the software desk's surfaces (docs/software-desk-survey.md).
//
// Three readings, and deliberately no more. A software business sells a promise to keep serving,
// so the questions worth asking an owner are: how much of next year is already sold, what the
// selling costs, and whether the shares an owner holds are being quietly diluted by the pay
// packet. Everything else about these companies is already answered by the general scorecard.
//
// What this file refuses to do is as important as what it does. It never turns the twelve-month
// share into dollars-of-backlog beyond the filed arithmetic, never shows a backlog total without
// the band that qualifies it, and never repeats a company's own adjusted margin.
import { fmtMoney } from "./fundamentals.mjs";

const pc = (v, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);

// Does the desk have anything to say about this company?
export function hasSoftwareRead(company) {
  const L = company?.lines || {};
  return L.rpoTotal != null || L.sellingMarketing != null || L.stockComp != null;
}

// How much of the coming year is already under contract. The total alone is a duration figure and
// misleads badly on its own — Oracle's rose elevenfold while the part landing within a year fell
// from 62% to 12% — so the desk withholds the total wherever the band cannot be read, and this
// check simply never appears for those filers.
export function backlogCheck(company) {
  const L = company?.lines || {};
  const $ = (v) => fmtMoney(v, company?.currency || "USD");
  const total = L.rpoTotal, share = L.rpoTwelveMonthShare, rev = L.revenue;
  if (total == null || share == null) return null;
  const withinYear = total * share;
  const cover = rev > 0 ? withinYear / rev : null;
  return {
    title: "How much of next year is already sold?",
    concept: "remaining-performance-obligations",
    value: cover == null ? $(withinYear) : pc(cover),
    formula: `Contracted and not yet earned ${$(total)}, of which the filing expects ${pc(share)} within twelve months = ${$(withinYear)}${rev > 0 ? ` against revenue of ${$(rev)}` : ""}`,
    tone: cover == null ? "info" : cover >= 0.9 ? "good" : cover >= 0.6 ? "ok" : cover >= 0.35 ? "info" : "warn",
    label: cover == null ? "Backlog landing within a year"
      : cover >= 0.9 ? "Next year is essentially contracted"
      : cover >= 0.6 ? "Most of next year is contracted"
      : cover >= 0.35 ? "A meaningful head start"
      : "Most of next year still has to be sold",
    note: "Remaining performance obligations are revenue the customer has committed to and the company has not yet earned — the nearest thing a software business has to an insurer's float. The headline total is a duration figure and can mislead badly on its own, because a contract signed for seven years counts the same as one signed for one. What matters is the part the filing itself expects to recognise within twelve months, shown here against a year of revenue. Where a company does not tag that band, both figures are withheld rather than shown half-told.",
  };
}

// What growth costs. This is the number the pipeline could not see until the overhead row was
// rebuilt, and it is the one that answers whether growth was bought or earned.
export function acquisitionCheck(company) {
  const L = company?.lines || {};
  const $ = (v) => fmtMoney(v, company?.currency || "USD");
  const sm = L.sellingMarketing, rev = L.revenue;
  if (sm == null || !(rev > 0)) return null;
  const ratio = sm / rev;
  return {
    title: "What does winning a customer cost?",
    concept: "sales-and-marketing",
    value: pc(ratio),
    formula: `Selling and marketing ${$(sm)} ÷ revenue ${$(rev)}`,
    tone: ratio < 0.15 ? "good" : ratio < 0.3 ? "ok" : ratio < 0.45 ? "info" : "warn",
    label: ratio < 0.15 ? "Sells itself" : ratio < 0.3 ? "Modest selling cost" : ratio < 0.45 ? "Heavy selling cost" : "Growth is being bought",
    note: "Sales and marketing as a share of revenue, kept apart from administrative overhead because it answers a different question: how much a business must spend to win the next customer. A company whose product pulls customers in spends little here and keeps the difference; one that must buy its growth is running to stand still, and the spending has to keep rising for revenue to keep rising. Read it beside the growth rate, not alone.",
  };
}

// Whether the buyback is buying ownership or merely mopping up the pay packet. The arithmetic is
// entirely from filed figures, and it separates three genuinely different states that a single
// repurchase number would blur into one.
export function dilutionCheck(company) {
  const L = company?.lines || {};
  const $ = (v) => fmtMoney(v, company?.currency || "USD");
  const sbc = L.stockComp, buyback = L.buybacks, rev = L.revenue;
  if (sbc == null || !(rev > 0)) return null;

  // The share count, read over the last three years. The window is deliberate: a decade-long
  // drift buries a reversal, and both directions of that error are live in this industry.
  // Oracle's count fell hard through 2023 and has risen every year since as the buyback stopped,
  // while Salesforce's rose for years and has fallen since 2023 — measured start-to-end over five
  // years, each reads as the opposite of what it is now doing. Three years is long enough to
  // survive one odd year and short enough to describe the regime an owner is buying into.
  //
  // Two contaminations must be refused outright rather than shown. A stock split rebases the
  // count without changing anything an owner holds (ServiceNow's five-for-one reads as +536% if
  // taken literally), and a company's first years as a public filer are not comparable to its
  // later ones (Snowflake reads +784% across its listing). Both announce themselves the same way:
  // a single year moving more than 40%, which no ordinary issuance or buyback does. Where that
  // appears, the drift is withheld and the check still reports what it can honestly report.
  // Detection runs one year wider than measurement. A restatement reaches back only as far as the
  // statements' own comparative depth, so a split can leave its seam just outside the measured
  // window and silently rebase the baseline without showing a jump inside it. Looking one year
  // further back closes that edge.
  const hist = (company?.history || []).filter((h) => h.lines?.sharesDiluted > 0);
  const window = hist.slice(-4);
  const detect = hist.slice(-5);
  let drift = null, span = null, contaminated = false;
  // First and most reliable: the filer tags the split itself. Inferring one from the size of a
  // jump catches a five-for-one and misses a four-for-three, and a one-for-1.5 reverse split would
  // manufacture a shrinking share count out of nothing at all.
  const rebasedFy = company?.lines?.shareCountRebasedFy;
  if (rebasedFy != null && detect.length && rebasedFy >= detect[0].fy) contaminated = true;
  // The size test still runs, for filers that never tagged the event.
  for (let i = 1; i < detect.length; i++) {
    const a = detect[i - 1].lines.sharesDiluted, b = detect[i].lines.sharesDiluted;
    if (Math.abs(b - a) / a > 0.4) contaminated = true;
  }
  if (!contaminated && window.length >= 2) {
    const from = window[0], to = window[window.length - 1];
    if (to.fy > from.fy) {
      span = { from, to };
      drift = (to.lines.sharesDiluted - from.lines.sharesDiluted) / from.lines.sharesDiluted;
    }
  }
  const sbcShare = sbc / rev;

  // The bar for "genuinely shrinking" is deliberately high. Microsoft retired $57.9B of stock
  // across this window and moved its diluted count by one percent — its actual outstanding count
  // did not move at all — so a percent of drift is not a shrinking share count, it is a large
  // buyback cancelling a large pay packet. Only a company whose count falls by more than a
  // twentieth over three years is meaningfully buying its owners a larger slice.
  const bought = buyback != null && buyback > 0;
  const tone = drift == null ? "info"
    : drift > 0.02 ? "warn"
    : drift > -0.01 ? (bought ? "warn" : "info")
    : drift > -0.05 ? "ok"
    : "good";
  const label = drift == null ? "Stock pay, share count unread"
    : drift > 0.02 ? "The count is rising"
    : drift > -0.01 ? (bought ? "The buyback only stands still" : "The count is flat")
    : drift > -0.05 ? "The count is edging down"
    : "The count is genuinely shrinking";

  const parts = [`Stock compensation ${$(sbc)} (fiscal ${company?.fy ?? "year"}), ${pc(sbcShare, 1)} of revenue`];
  if (bought) parts.push(`repurchases ${$(buyback)}`);
  else parts.push("no repurchases");
  if (span) parts.push(`diluted shares ${drift >= 0 ? "+" : ""}${(drift * 100).toFixed(1)}% since ${span.from.fy}`);
  else if (contaminated) parts.push("the share count is not comparable across these years (a split or a first listing sits in the record), so the drift is withheld");

  return {
    title: "Is the buyback buying ownership, or mopping up?",
    concept: "stock-based-compensation",
    value: pc(sbcShare, 1),
    formula: parts.join(" · "),
    tone,
    label,
    note: "Stock handed to employees is a real cost paid in the owner's own currency: it is charged against profit, but the shares it creates are permanent. Many companies repurchase stock at the same time, which looks like a return of capital and often is not — if the count barely moves, the cash merely cancelled the pay packet and bought the owner nothing. The three states worth telling apart are a count genuinely shrinking, a count standing still despite large repurchases, and a count rising because the issuance was never offset at all.",
  };
}

export function softwareSection(company) {
  const checks = [backlogCheck(company), acquisitionCheck(company), dilutionCheck(company)].filter(Boolean);
  if (!checks.length) return null;
  return { heading: "The promise and the pay packet", checks };
}
