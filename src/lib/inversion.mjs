// Munger's inversion, made mechanical. "Invert, always invert": instead of asking why a
// business is good, ask what would make owning it a mistake, then look for those marks in
// the record. Each test below is a disconfirming question run on figures the pipeline
// already pulls, returning the actual numbers and whether the fingerprint is present. None
// is a verdict: a flag is a question to put to the filing, a clear test is one fewer way to
// be wrong. Present, never pronounce.
import { ownerEarningsMargin, operatingMargin, fmtMoney } from "./fundamentals.mjs";
import { capitalHistory } from "./capital.mjs";

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const firstN = (arr, n) => arr.filter((v) => v != null).slice(0, n);
const lastN = (arr, n) => arr.filter((v) => v != null).slice(-n);

export function inversionChecks(company) {
  const ccy = company.currency || "USD";
  const $ = (v) => fmtMoney(v, ccy);
  const pct = (v, dp = 0) => (v == null ? "—" : `${v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%`);

  const H = (company.history || []).filter((h) => h?.lines);
  if (H.length < 4) return null;
  const fy = H.map((h) => h.fy);
  const lines = H.map((h) => h.lines);
  const endL = company.ttm?.lines || lines[lines.length - 1];
  const startL = lines[0];
  const oeAbs = lines.map((L) => (L.cashFromOps != null && L.capex != null ? L.cashFromOps - Math.abs(L.capex) : null));
  const cap = capitalHistory(company);
  const checks = [];

  // 1. Profitability fade: the through-record drift of margin, early years vs recent years.
  // Owner-earnings margin where the record carries it, else operating margin. A multi-year
  // slide, not one soft year, is the mark; a cyclical trough reads as a slide too, which is
  // why the note sends the reader to the cause rather than calling it.
  {
    const oem = lines.map((L) => ownerEarningsMargin(L));
    const useOpm = oem.filter((v) => v != null).length < 4;
    const raw = useOpm ? lines.map((L) => operatingMargin(L)) : oem;
    const series = raw.filter((v) => v != null && Math.abs(v) <= 1.5);
    if (series.length >= 4) {
      const early = avg(firstN(series, 3));
      const recent = avg(lastN(series, 3));
      const flagged = early > 0 && recent < early * 0.9;
      checks.push({
        key: "margin",
        label: "Is it less profitable than it was?",
        value: `${pct(recent, 1)} vs ${pct(early, 1)}`,
        flagged,
        note: flagged
          ? `The ${useOpm ? "operating" : "owner-earnings"} margin averaged ${pct(early, 1)} early in the record and ${pct(recent, 1)} across the last three years. That is a structural drift, not one soft year. Ask the filing what is compressing it, price, mix, cost, or a competitor, and whether it is cyclical or permanent.`
          : `The ${useOpm ? "operating" : "owner-earnings"} margin held across the record (about ${pct(early, 1)} early, ${pct(recent, 1)} lately), so profitability has not quietly eroded underneath the headline.`,
      });
    }
  }

  // 2. Dilution: did the diluted share count rise over the span, the more so if the company
  // was buying back stock at the same time (the buyback treadmill that masks issuance).
  if (cap && cap.shareChange != null) {
    const flagged = cap.shareChange > 0.01;
    const boughtBack = cap.bb > 0;
    checks.push({
      key: "dilution",
      label: "Did the share count rise anyway?",
      value: pct(cap.shareChange, 1),
      flagged,
      note: flagged
        ? `Diluted shares grew ${pct(cap.shareChange, 1)} over ${cap.span}${boughtBack ? `, even as the company spent ${$(cap.bb)} on buybacks` : ""}. ${boughtBack ? "The repurchases were a treadmill: stock issued to staff outran them, so owners' slice still shrank." : "Owners were diluted on net; each share owns less of the business than it did."} Read the buyback line beside this one, not on its own.`
        : `Diluted shares ${cap.shareChange < -0.01 ? `fell ${pct(cap.shareChange, 1)}` : "barely moved"} over ${cap.span}${boughtBack ? ", so the buybacks more than covered the stock issued to staff" : ""}, and owners were not diluted away.`,
    });
  }

  // 3. Leverage creep: did debt grow faster than the business earned? Early-to-recent owner
  // earnings (averaged, so a single noisy endpoint can't decide it) against start-to-end debt.
  {
    const oeEarly = avg(firstN(oeAbs, 3));
    const oeRecent = avg(lastN(oeAbs, 3));
    const d0 = startL.totalDebt, d1 = endL.totalDebt;
    if (d0 != null && d1 != null && d0 >= 0 && d1 >= 0 && oeEarly != null && oeRecent != null) {
      const debtUp = d1 > d0 * 1.25 && d1 > 0;
      const earnFlat = oeRecent < oeEarly * 1.1;
      const flagged = debtUp && earnFlat;
      checks.push({
        key: "leverage",
        label: "Did debt outgrow the business?",
        value: `${$(d0)} → ${$(d1)}`,
        flagged,
        note: flagged
          ? `Debt rose from ${$(d0)} to ${$(d1)} while owner earnings went from about ${$(oeEarly)} to ${$(oeRecent)}: the balance sheet levered up faster than the business earned. Debt raised for buybacks or deals rather than growth is the kind that bites in a downturn.`
          : `Debt moved from ${$(d0)} to ${$(d1)} against owner earnings of about ${$(oeEarly)} then ${$(oeRecent)}, so borrowing did not run ahead of what the business earns.`,
      });
    }
  }

  // 4. Reinvestment that didn't compound: Buffett's one-dollar test, run on owner earnings.
  // Each dollar the company kept should have produced more than a dollar could earn elsewhere.
  if (cap && cap.returnOnRetained != null && cap.retainedEarnings > 0) {
    const r = cap.returnOnRetained;
    const flagged = r < 0.08;
    checks.push({
      key: "retention",
      label: "Did the cash it kept earn its keep?",
      value: `${pct(r, 0)} on each ${currencyUnit(ccy)}`,
      flagged,
      note: flagged
        ? `Over ${cap.span} the company retained ${$(cap.retainedEarnings)} of earnings rather than paying it out, and annual owner earnings changed by ${$(cap.incrementalOE)}: about ${pct(r, 0)} on each retained ${currencyUnit(ccy)}. Below the return the cash could have earned elsewhere, the owners would have been better served by a dividend. Buffett's test for whether earnings were worth keeping.`
        : `The earnings it kept compounded: ${$(cap.retainedEarnings)} retained over ${cap.span} turned into about ${$(cap.incrementalOE)} of added annual owner earnings, roughly ${pct(r, 0)} on each ${currencyUnit(ccy)}, so reinvestment cleared a reasonable bar.`,
    });
  }

  // 5. Earnings quality, the long way: cumulative operating cash against cumulative net income
  // over the whole record. Accruals wash out year to year, so a multi-year shortfall is the
  // real signal. Operating cash (not owner earnings) on purpose: this isolates earnings
  // quality from the reinvestment question, so a heavy grower's growth capex doesn't read as
  // a red flag here.
  {
    const niVals = lines.map((L) => L.netIncome).filter((v) => v != null);
    const cfoVals = lines.map((L) => L.cashFromOps).filter((v) => v != null);
    const niSum = lines.reduce((a, L) => a + (L.netIncome != null ? L.netIncome : 0), 0);
    const cfoSum = lines.reduce((a, L) => a + (L.cashFromOps != null ? L.cashFromOps : 0), 0);
    if (niVals.length >= 4 && cfoVals.length >= 4 && niSum > 0) {
      const ratio = cfoSum / niSum;
      const flagged = ratio < 0.85;
      checks.push({
        key: "conversion",
        label: "Did reported profit become cash?",
        value: `${ratio.toFixed(2)}×`,
        flagged,
        note: flagged
          ? `Across the record the business reported ${$(niSum)} of net income but generated ${$(cfoSum)} of operating cash, a ${ratio.toFixed(2)}-to-one conversion. Profit that does not turn into cash over many years is the classic mark of earnings that are softer than they look. Ask where the gap sits, receivables, inventory, or costs being capitalized rather than expensed.`
          : `Over the record ${$(niSum)} of net income produced ${$(cfoSum)} of operating cash, a ${ratio.toFixed(2)}-to-one conversion, so reported profit has been backed by cash rather than accruals. (This is operating cash, before reinvestment, so it speaks to quality, not to how much capex the business then chose to spend.)`,
      });
    }
  }

  // 6. Working-capital drift: did receivables and inventory grow faster than sales? Rising
  // faster is the fingerprint of customers paying slower, inventory piling up, or sales
  // pulled forward, each a way growth can quietly eat cash or flatter the top line.
  {
    const wc = (L) => (L.receivables == null && L.inventory == null ? null : (L.receivables || 0) + (L.inventory || 0));
    const w0 = wc(startL), w1 = wc(endL);
    const r0 = startL.revenue, r1 = endL.revenue;
    if (w0 != null && w1 != null && w0 > 0 && r0 && r1 && r0 > 0 && r1 > 0) {
      const wcGrow = w1 / w0, revGrow = r1 / r0;
      const flagged = w1 > w0 && wcGrow > revGrow * 1.25;
      const s0 = w0 / r0, s1 = w1 / r1;
      checks.push({
        key: "workingcap",
        label: "Did receivables and inventory outpace sales?",
        value: `${pct(s0, 0)} → ${pct(s1, 0)} of sales`,
        flagged,
        note: flagged
          ? `Receivables and inventory grew from ${$(w0)} to ${$(w1)} while revenue grew ${pct(revGrow - 1, 0)}: working capital is climbing faster than sales (${pct(s0, 0)} of revenue then, ${pct(s1, 0)} now). That can mean customers paying slower, stock building up, or revenue pulled forward. The filing's cash-flow and receivables notes say which.`
          : `Receivables and inventory grew roughly in step with sales (${pct(s0, 0)} of revenue then, ${pct(s1, 0)} now), so growth is not being quietly funded by a swelling working-capital base.`,
      });
    }
  }

  if (checks.length < 3) return null;

  // Flagged tests first, so the questions worth asking surface to the top; clear tests follow
  // as the record of what was checked and came back clean.
  checks.sort((a, b) => (a.flagged === b.flagged ? 0 : a.flagged ? -1 : 1));
  return {
    span: cap?.span || `${fy[0]}–${fy[fy.length - 1]}`,
    checks,
    flaggedCount: checks.filter((c) => c.flagged).length,
    total: checks.length,
  };
}

// "$1" / "¥1": the unit the one-dollar test is phrased in, so the yen pool reads naturally.
function currencyUnit(ccy) {
  return `${ccy === "JPY" ? "¥" : "$"}1`;
}
