// Munger's inversion, made mechanical. "Invert, always invert": instead of asking why a
// business is good, ask what would make owning it a mistake, then look for those marks in
// the record. Each test below is a disconfirming question run on figures the pipeline
// already pulls, returning the actual numbers and whether the fingerprint is present. None
// is a verdict: a flag is a question to put to the filing, a clear test is one fewer way to
// be wrong. Present, never pronounce.
import { ownerEarningsMargin, ownerEarningsAbs, operatingMargin, fmtMoney, debtReliable, normalizedTrend } from "./fundamentals.mjs";
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
  const oeAbs = lines.map((L) => ownerEarningsAbs(L, company));
  const cap = capitalHistory(company);
  const checks = [];

  // 1. Profitability fade: the through-record drift of margin, early years vs recent years.
  // Owner-earnings margin where the record carries it, else operating margin. A multi-year
  // slide, not one soft year, is the mark; a cyclical trough reads as a slide too, which is
  // why the note sends the reader to the cause rather than calling it.
  {
    const oem = lines.map((L) => ownerEarningsMargin(L, company));
    const useOpm = oem.filter((v) => v != null).length < 4;
    const raw = useOpm ? lines.map((L) => operatingMargin(L)) : oem;
    const series = raw.filter((v) => v != null && Math.abs(v) <= 1.5);
    // Through-cycle windowing via the shared normalizer: averaged, non-overlapping early/recent ends
    // sized to the record (so a five-year history doesn't double-count its middle years the way a fixed
    // three-year window would), with the latest single year carried for the cyclical-recovery read.
    const mt = normalizedTrend(series, { band: 0.02 });
    if (mt && mt.n >= 4) {
      const { early, recent, latest } = mt;
      // A deep cyclical's recent window is dragged below the early window by a single trough year even
      // when the latest year has fully recovered. So flag a fade only when the recent average AND the
      // most recent single year are both below the early baseline; a recovered latest year is a cycle,
      // not a slide. And the note asks rather than pronounces.
      //
      // A margin that STARTS negative needs its own branch: "recent < early × 0.9" can never be true
      // when early is negative (the product flips sign), so a money-loser whose losses were deepening
      // read as clean, always. On a negative base the test is the loss widening in absolute points —
      // recent at least five points deeper — and "recovered" means the latest year is back near the
      // early loss level or better.
      const negBase = early <= 0;
      const faded = negBase ? recent < early - 0.05 : recent < early * 0.9;
      const recovered = latest != null && (negBase ? latest >= early - 0.02 : latest >= early * 0.9);
      const flagged = faded && !recovered;
      const mLabel = useOpm ? "operating" : "owner-earnings";
      checks.push({
        key: "margin",
        label: "Is it less profitable than it was?",
        value: `${pct(recent, 1)} vs ${pct(early, 1)}`,
        flagged,
        note: flagged
          ? negBase
            ? `The business ran at a loss early in the record (an ${mLabel} margin of ${pct(early, 1)}) and the loss has widened to ${pct(recent, 1)} across the last three years${latest != null ? `, with the latest year at ${pct(latest, 1)}` : ""}. Ask the filing where the widening sits — price, cost, or spending growing faster than revenue — and what would narrow it.`
            : `The ${mLabel} margin averaged ${pct(early, 1)} early in the record and ${pct(recent, 1)} across the last three years, and the latest year has not recovered. Ask the filing whether that is a structural drift or a cyclical trough — price, mix, cost, or a competitor — and whether it is permanent.`
          : faded && recovered
          ? `The ${mLabel} margin averaged ${pct(early, 1)} early and ${pct(recent, 1)} across the last three years, but the latest year is back near that early level (${pct(latest, 1)}): a trough pulling the three-year average down, not a one-way slide. Read it across the cycle, not on the three-year window.`
          : negBase
          ? `The ${mLabel} margin has been negative throughout (about ${pct(early, 1)} early, ${pct(recent, 1)} lately); the losses have not widened across the record.`
          : `The ${mLabel} margin held across the record (about ${pct(early, 1)} early, ${pct(recent, 1)} lately), so profitability has not quietly eroded underneath the headline.`,
      });
    }
  }

  // 2. Dilution: did the diluted share count rise over the span, the more so if the company
  // was buying back stock at the same time (the buyback treadmill that masks issuance).
  if (cap && cap.shareChange != null) {
    // Material net dilution only: a sub-2%-over-a-decade rise is usually an endpoint artifact
    // (a spin-off, a share-count restatement), not the "treadmill" the flagged note describes,
    // so the threshold sits at ~3% cumulative rather than 1%.
    const flagged = cap.shareChange > 0.03;
    const boughtBack = cap.bb > 0;
    // Name a CAUSE only when the record supports it. Stock issued to staff is one of several ways a
    // count rises — a raise, a merger, a preferred conversion all add shares without a dollar of
    // stock comp (AZZ's rise was a conversion) — so "staff outran the buybacks" is stated only when
    // cumulative stock comp could plausibly have paid for the added shares, valued at the record's
    // own average buyback price. Otherwise the note states the issuance and leaves the cause to the
    // filing, which is the only place it is actually named.
    const added = cap.firstShares != null && cap.lastShares != null ? cap.lastShares - cap.firstShares : null;
    const sbcSum = lines.reduce((a, L) => a + (L.stockBasedComp || 0), 0);
    const staffCovered =
      added != null && added > 0 && sbcSum > 0 && cap.avgBuybackPrice != null && sbcSum >= 0.5 * added * cap.avgBuybackPrice;
    checks.push({
      key: "dilution",
      label: "Did the share count rise anyway?",
      value: pct(cap.shareChange, 1),
      flagged,
      note: flagged
        ? `Diluted shares grew ${pct(cap.shareChange, 1)} over ${cap.span}${boughtBack ? `, even as the company spent ${$(cap.bb)} on buybacks` : ""}. ${
            boughtBack
              ? staffCovered
                ? "The repurchases were a treadmill: stock issued to staff outran them, so owners' slice still shrank."
                : "The repurchases were outrun by issuance — to staff, in a raise, or in a deal — and the filing says which; owners' slice still shrank."
              : "Owners were diluted on net; each share owns less of the business than it did."
          } Read the buyback line beside this one, not on its own.`
        : `Diluted shares ${cap.shareChange < -0.01 ? `fell ${pct(cap.shareChange, 1)}` : "barely moved"} over ${cap.span}${boughtBack ? ", so the buybacks more than covered the shares issued along the way" : ""}, and owners were not diluted away.`,
    });
  }

  // 3. Leverage creep: did debt grow faster than the business earned? Early-to-recent owner
  // earnings (averaged, so a single noisy endpoint can't decide it) against start-to-end debt.
  {
    const oeEarly = avg(firstN(oeAbs, 3));
    const oeRecent = avg(lastN(oeAbs, 3));
    const d0 = startL.totalDebt, d1 = endL.totalDebt;
    // Only when the debt is reliably captured at both ends. If interest proves it grossly
    // under-tagged, a "debt did not outrun the business" clear would be a false reassurance —
    // the exact fiction debtReliable() exists to prevent — so withhold the check entirely.
    if (d0 != null && d1 != null && d0 >= 0 && d1 >= 0 && oeEarly != null && oeRecent != null && debtReliable(startL) && debtReliable(endL)) {
      const debtUp = d1 > d0 * 1.25 && d1 > 0;
      // The question is the RATIO of debt to what the business earns, not whether earnings grew. The
      // old gate cleared any debt growth so long as owner earnings rose 10% — which waved through a
      // debt pile growing from a rounding error to more than a year's earnings (Crocs: ~$4M to $1.5B
      // beside earnings up 12x) and made 700-odd fast growers structurally unflaggable. So: flag when
      // debt rose materially AND the debt-to-owner-earnings ratio drifted up by the same 25% the debt
      // test uses AND the debt now exceeds a year's owner earnings (a trivial borrower can't flag) —
      // or when owner earnings have gone to zero or negative underneath rising debt, where no ratio
      // exists to read. A start from losses has no early ratio; only a heavy end point (three years'
      // owner earnings of debt) flags there.
      const r0 = oeEarly > 0 ? d0 / oeEarly : null;
      const r1 = oeRecent > 0 ? d1 / oeRecent : null;
      const flagged =
        debtUp && (r1 == null || (r0 != null && r1 > r0 * 1.25 && r1 > 1) || (r0 == null && r1 > 3));
      const yrs = (r) => (r < 0.1 ? "under 0.1" : `about ${r >= 10 ? r.toFixed(0) : r.toFixed(1)}`);
      const ratioTxt =
        r0 != null && r1 != null
          ? ` — ${yrs(r0)} year${r0 >= 0.95 && r0 < 1.05 ? "" : "s"} of owner earnings in debt then, ${yrs(r1)} now`
          : "";
      checks.push({
        key: "leverage",
        label: "Did debt outgrow the business?",
        value: `${$(d0)} → ${$(d1)}`,
        flagged,
        note: flagged
          ? r1 == null
            ? `Debt rose from ${$(d0)} to ${$(d1)} while owner earnings went from about ${$(oeEarly)} to ${$(oeRecent)}: the borrowing grew and the earnings that would carry it are not there now. Debt raised for buybacks or deals rather than growth is the kind that bites in a downturn.`
            : `Debt rose from ${$(d0)} to ${$(d1)} while owner earnings went from about ${$(oeEarly)} to ${$(oeRecent)}${ratioTxt}: measured against what the business earns, the balance sheet carries more debt than it did. Debt raised for buybacks or deals rather than growth is the kind that bites in a downturn.`
          : r0 != null && r1 != null && r1 > r0 * 1.25 && r1 <= 1
          ? `Debt moved from ${$(d0)} to ${$(d1)} against owner earnings of about ${$(oeEarly)} then ${$(oeRecent)}${ratioTxt}; set against what the business earns the debt sits higher than it did, but the whole of it remains under a year's owner earnings.`
          : `Debt moved from ${$(d0)} to ${$(d1)} against owner earnings of about ${$(oeEarly)} then ${$(oeRecent)}${ratioTxt}, so borrowing did not run ahead of what the business earns.`,
      });
    }
  }

  // (Return on retained capital — Buffett's one-dollar test — lives in "How the cash was used,"
  // its rightful home, where it is the climax of the capital-allocation read. It was duplicated
  // here as a disconfirming check; removed so the figure is stated once, in one place.)

  // 5. Earnings quality, the long way: cumulative operating cash against cumulative net income
  // over the whole record. Accruals wash out year to year, so a multi-year shortfall is the
  // real signal. Operating cash (not owner earnings) on purpose: this isolates earnings
  // quality from the reinvestment question, so a heavy grower's growth capex doesn't read as
  // a red flag here.
  {
    // Both sums over the SAME matched window — only years where net income and operating cash are
    // both present. Summing each over its own independent set of years would divide a sum over one
    // period by a sum over a different one, and the accrual cancellation the check relies on would
    // no longer hold (a company with more profit years than cash years reads falsely well).
    const matched = lines.filter((L) => L.netIncome != null && L.cashFromOps != null);
    const niSum = matched.reduce((a, L) => a + L.netIncome, 0);
    const cfoSum = matched.reduce((a, L) => a + L.cashFromOps, 0);
    if (matched.length >= 4 && niSum > 0) {
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
    // Only count a component (receivables, inventory) present in BOTH endpoints. When one is
    // untagged in the start year but tagged later, treating the missing year as zero manufactures
    // apparent working-capital growth out of a data gap, then narrates it as customers paying
    // slower or stock building up. Same components both ends, or withhold the check.
    const bothRecv = startL.receivables != null && endL.receivables != null;
    const bothInv = startL.inventory != null && endL.inventory != null;
    const wc = (L) => (bothRecv ? L.receivables : 0) + (bothInv ? L.inventory : 0);
    const w0 = bothRecv || bothInv ? wc(startL) : null;
    const w1 = bothRecv || bothInv ? wc(endL) : null;
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

  // 7. Serial "one-time" charges: impairments and write-downs taken year after year. Munger's
  // tell — when the charge management keeps calling one-time recurs across the record, the
  // "one-time" is the business: past deals coming due, an admission the assets were worth less
  // than their price. Only the US pool carries the impairment lines, and the test is shown only
  // where there has been at least one write-down, so it is a read, not noise on a clean filer.
  if (company.market !== "JP") {
    const impYears = lines.filter((L) => (L.goodwillImpairment || 0) > 0 || (L.assetImpairment || 0) > 0).length;
    const cum = lines.reduce((a, L) => a + (L.goodwillImpairment || 0) + (L.assetImpairment || 0), 0);
    if (impYears >= 1) {
      // A genuine "yearly habit" is a majority of the years, not 3 of 10 (which would flag most
      // impairment-takers and lose the signal). Require at least half the record, and at least
      // four years, before calling the "one-time" the business; the note's force scales with how
      // relentless it is.
      const half = Math.max(4, Math.ceil(H.length / 2));
      const flagged = impYears >= half;
      const relentless = impYears >= Math.ceil(H.length * 0.8);
      checks.push({
        key: "writeoffs",
        label: `Are "one-time" charges a yearly habit?`,
        value: `${impYears} of ${H.length} years`,
        flagged,
        note: flagged
          ? `Management took an impairment or write-down in ${impYears} of the last ${H.length} years, ${$(cum)} in all. ${relentless ? "A charge taken almost every year is not one-time; it is the business — past deals coming due, and an admission the assets were worth less than what was paid. Munger's rule: when the \"one-time\" keeps happening, it is the business." : "Taken across the majority of the record, the \"one-time\" label is wearing thin — ask whether these are past deals coming due rather than genuinely isolated events."} Read it beside the goodwill the company still carries.`
          : `Impairments hit ${impYears} of the last ${H.length} years (${$(cum)} in all) — a real write-down to read in the record, but not the yearly habit that turns a "one-time" charge into the business.`,
      });
    }
  }

  if (checks.length < 3) return null;

  // Flagged tests first, so the questions worth asking surface to the top; clear tests follow
  // as the record of what was checked and came back clean.
  checks.sort((a, b) => (a.flagged === b.flagged ? 0 : a.flagged ? -1 : 1));
  return {
    // The panel header spans the full record the checks actually run over (every year with
    // lines), not cap.span — which capitalHistory truncates to the years carrying both operating
    // cash and capex, and so would understate the window the margin, conversion and leverage tests
    // compute across. The capital-allocation notes keep cap.span, which is the right window for
    // their buyback/retention quantities.
    span: `${fy[0]}–${fy[fy.length - 1]}`,
    checks,
    flaggedCount: checks.filter((c) => c.flagged).length,
    total: checks.length,
  };
}
