// Graham's defensive-investor tests (The Intelligent Investor, ch. 14), run
// mechanically on the filings. We present his framework, not our verdict: meeting
// the tests is a floor of safety, not a buy signal, and failing one is not a veto,// many fine modern businesses fail his strictest liquidity tests by design. Every
// number is sourced and findable in the record. Modernized thresholds are flagged.

import { fmtMoney, currencySymbol, debtReliable } from "./fundamentals.mjs";

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Each test carries, besides the display fields, a numeric `delta`: the shortfall in the test's
// own units (dollars short of the size floor, turns of current ratio, money past working capital,
// loss years, unpaid years, growth points), null when the test passes or can't be run. The raw
// figures behind each verdict (cr, debt vs working capital, paid/total, g, ...) ride along too, so
// a surface like the Defensive Workbook can phrase the shortfall without recomputing anything.
export function grahamTests(company) {
  const L = company.lines || {};
  const H = (company.history || []).filter((h) => h?.lines);
  const t = [];
  const add = (name, criterion, value, status, note, extra) => t.push({ name, criterion, value, status, note, delta: null, ...extra });
  const ccy = company?.currency || "USD";
  const $ = (v) => fmtMoney(v, ccy);
  const sym = currencySymbol(ccy);

  // 1, Adequate size. Graham's floor is a dollar figure, so we only render a pass/fail for a
  // dollar filer. A company reporting in another currency gets its home-currency revenue shown
  // but no verdict: we carry no exchange rate (by design, no external data), so converting to
  // the $2B line would be a guess — and at yen or won scale a raw comparison would wave every
  // name through. The figure is shown; the size bar is the reader's to apply.
  if (L.revenue != null) {
    const r = L.revenue;
    if (ccy === "USD") {
      add("Adequate size", "Revenue ≥ $2B", $(r), r >= 2e9 ? "pass" : r >= 1e9 ? "near" : "fail",
        "Big enough to weather a storm. Graham's 1972 floor was ~$100M of sales (≈ $700M today); we use a $2B revenue line as a conservative modern stand-in.",
        { revenue: r, floor: 2e9, delta: r >= 2e9 ? null : 2e9 - r });
    } else {
      add("Adequate size", "Revenue ≥ $2B (a dollar floor)", $(r), "na",
        "Big enough to weather a storm. Graham's floor is a dollar figure — about $2B of revenue as a conservative modern stand-in. This company reports in its home currency and we carry no exchange rate, so we show the figure and leave the size bar for you to apply rather than convert it with a number we don't have.",
        { revenue: r, floor: 2e9 });
    }
  }

  // GRAHAM'S OWN UTILITY SUBSTITUTION (The Intelligent Investor, ch. 14). For public utilities he
  // replaced BOTH balance-sheet tests — the current ratio and debt-against-working-capital — with a
  // single one: debt not exceeding twice the stock equity at book. His stated reason: the
  // working-capital factor "takes care of itself in this industry as part of the continuous
  // financing of its growth by sales of bonds and shares." Before 2026-07-28 the site ran the
  // industrial tests on the utility shelves anyway, and 75 of 83 utilities failed a liquidity test
  // Graham explicitly exempted them from — his framework misquoted on exactly the industry he
  // carved out. Applied by SIC class (4900-4991), which is how Graham himself applied it — by
  // industry membership; the desk survey's regulated/merchant distinction is a finer cut than his
  // book makes, and the note carries the word "utility" so a merchant generator's reader can see
  // which rule was applied. Test names stay identical so the Almanac's six criteria stay six.
  const isUtility = (() => { const s = Number(company?.sic) || 0; return s >= 4900 && s <= 4991; })();

  // 2, Strong current ratio
  const ca = L.currentAssets, cl = L.currentLiabilities;
  if (isUtility) {
    add("Strong liquidity", "Current ratio ≥ 2× (waived for utilities)", "exempt", "na",
      "Graham exempted public utilities from this test: their working capital “takes care of itself” through the continuous bond-and-share financing of growth, so a thin current ratio is the industry's structure, not a warning. His substitute test — debt no more than twice book equity — is the next line.");
  } else if (ca != null && cl != null && cl > 0) {
    const cr = ca / cl;
    add("Strong liquidity", "Current ratio ≥ 2×", `${cr.toFixed(2)}×`, cr >= 2 ? "pass" : cr >= 1.5 ? "near" : "fail",
      "Current assets at least twice current liabilities, near-term bills covered without touching the business. Strict by design: many cash-rich modern firms run leaner and miss it, holding their cushion in longer-dated securities.",
      { cr, floor: 2, delta: cr >= 2 ? null : 2 - cr });
  } else {
    add("Strong liquidity", "Current ratio ≥ 2×", "—", "na", "Current assets / liabilities not in the data yet.");
  }

  // 3, Conservative debt: total debt ≤ working capital (Graham's industrial test, using total debt
  // as the stricter proxy for long-term debt) — except utilities, which get his substitute test.
  if (isUtility && L.totalDebt != null && L.stockholdersEquity > 0 && debtReliable(L)) {
    const eq = L.stockholdersEquity;
    add("Conservative debt", "Debt ≤ 2× equity (Graham's utility test)", `${$(L.totalDebt)} vs ${$(eq)} equity`,
      L.totalDebt <= 2 * eq ? "pass" : L.totalDebt <= 2.5 * eq ? "near" : "fail",
      "Graham's own substitution for public utilities: debt not exceeding twice the stock equity at book value, in place of the working-capital tests an industrial faces. A utility finances its plant with bonds by design; the question is whether the borrowing stays inside the equity behind it.",
      { debt: L.totalDebt, equity: eq, delta: L.totalDebt <= 2 * eq ? null : L.totalDebt - 2 * eq });
  } else if (isUtility) {
    add("Conservative debt", "Debt ≤ 2× equity (Graham's utility test)", "—", "na",
      debtReliable(L)
        ? "Equity or total debt is not readable in the structured data this year, so Graham's utility debt test can't be run honestly."
        : "The filings tag only a fraction of the debt this company's interest bill implies (much of it sits under segment dimensions the data source strips), so this test can't be run honestly.");
  } else if (ca != null && cl != null && !debtReliable(L)) {
    add("Conservative debt", "Debt ≤ working capital", "—", "na",
      "The filings tag only a fraction of the debt this company's interest bill implies (much of it sits under segment dimensions the data source strips), so this test can't be run honestly.");
  } else if (ca != null && cl != null && L.totalDebt != null) {
    const wc = ca - cl;
    add("Conservative debt", "Debt ≤ working capital", `${$(L.totalDebt)} vs ${$(wc)} WC`,
      wc > 0 && L.totalDebt <= wc ? "pass" : wc > 0 && L.totalDebt <= 1.5 * wc ? "near" : "fail",
      "Graham's rule that borrowings not exceed net current assets. Capital-heavy and buyback-heavy firms routinely fail it, read it next to interest coverage, not alone.",
      { debt: L.totalDebt, workingCapital: wc, delta: wc > 0 && L.totalDebt <= wc ? null : L.totalDebt - wc });
  }

  // 4, Earnings stability: a profit every year on record
  const ni = H.map((h) => h.lines.netIncome).filter((v) => v != null);
  if (ni.length >= 5) {
    const losses = ni.filter((v) => v <= 0).length;
    add("Earnings stability", `A profit every year (${ni.length}-yr record)`, losses === 0 ? "no losses" : `${losses} loss year${losses > 1 ? "s" : ""}`,
      losses === 0 ? "pass" : losses === 1 ? "near" : "fail",
      "Graham wanted earnings in each of the past ten years, the stability a defensive owner leans on.",
      { losses, years: ni.length, delta: losses === 0 ? null : losses });
  }

  // 5, Dividend record. Count over the FULL window: a year with no dividend is a
  // break in the record, not a row to drop (or a COVID suspension reads as "paid every year").
  // A SINGLE year with no dividendsPaid tag, sandwiched between two paid years, is different:
  // the filing simply didn't tag it (LHX's FY2020, paid in fact) — a real suspension shows as a
  // RUN of empty years (Boeing's 2021–24), not one missing year inside a steady record. So an
  // isolated null with a paid year on each side is named as untagged, not counted as a break;
  // a null run, a leading gap (before a company began paying) and a trailing gap (after it
  // stopped) all still count as unpaid, so a non-payer keeps failing and a suspender never
  // reads as unbroken. A missing read is unknown; the streak is judged on the tagged years.
  const total = H.length;
  if (total >= 5) {
    const dv = H.map((h) => h.lines.dividendsPaid);
    // An ALL-NULL column is not a non-payer — it is a record with no dividend line tagged at
    // all (the partnership pattern: EPD pays ~$4.8B a year under distribution tags the chain
    // doesn't carry). Line 111's own doctrine: a missing read is unknown. So the criterion is
    // withheld, never failed, when not one year carries the tag — "none paid" would be a wrong
    // sentence about one of the market's steadiest payers.
    const allNull = dv.every((v) => v == null);
    if (allNull) {
      add("Dividend record", "Uninterrupted dividends", "no dividend line tagged in the data", "na",
        "An unbroken dividend was Graham's mark of durability. This record carries no dividends-paid line in any year — common for partnerships, whose distributions file under tags the chain doesn't read — so the criterion is withheld rather than judged on silence.",
        { paid: 0, years: total, untagged: total, delta: null });
    } else {
    const paidAt = (i) => i >= 0 && i < total && dv[i] != null && Math.abs(dv[i]) > 0;
    const paid = dv.filter((v, i) => paidAt(i)).length;
    const untagged = dv.filter((v, i) => v == null && paidAt(i - 1) && paidAt(i + 1)).length;
    const unpaid = total - paid - untagged;
    const known = total - untagged;
    const value = unpaid === 0 && paid > 0
      ? (untagged === 0 ? `paid every year (${total})` : `paid every tagged year (${paid} of ${total})`)
      : paid === 0 ? "none paid" : untagged > 0 ? `${paid} of ${known} tagged yrs` : `${paid} of ${total} yrs`;
    add("Dividend record", "Uninterrupted dividends", value,
      unpaid === 0 && paid > 0 ? "pass" : paid === 0 ? "fail" : paid >= known * 0.9 ? "near" : "fail",
      "An unbroken dividend was Graham's mark of durability. He wanted twenty years; the filings show about ten, and a single suspension breaks the streak. Non-payers, many fine modern compounders, fall outside his defensive net by design." +
        (untagged > 0 ? ` ${untagged === 1 ? "One year" : `${untagged} years`} of this record ${untagged === 1 ? "is" : "are"} untagged in the data, with the dividend paid on both sides; a lone missing tag is treated as unknown, not a suspension, so the streak is judged on the tagged years.` : ""),
      { paid, years: total, untagged, delta: unpaid === 0 && paid > 0 ? null : unpaid });
    }
  }

  // 6, Earnings growth: net income up ≥ 33% over the record (3-yr averages, to smooth).
  // Total net income, not per-share, avoids stock-split artifacts; dilution is tracked separately.
  if (ni.length >= 6) {
    const early = mean(ni.slice(0, 3)), late = mean(ni.slice(-3));
    if (early > 0) {
      const g = (late - early) / early;
      add("Earnings growth", "Earnings +33% over the record", `${g >= 0 ? "+" : "−"}${Math.abs(g * 100).toFixed(0)}%`,
        g >= 0.33 ? "pass" : g > 0 ? "near" : "fail",
        "At least a third more earnings than a decade ago, averaging three years at each end. Net income (not per-share), so stock splits don't distort it, buybacks and dilution show up in the share-count line instead.",
        { growth: g, floor: 0.33, delta: g >= 0.33 ? null : 0.33 - g });
    } else {
      add("Earnings growth", "Earnings +33% over the record", "—", "na", "Earnings were negative early in the record, a growth rate isn't meaningful.");
    }
  }

  // 7, Moderate price (price-dependent → the reader-supplied calculator). The calculator's Graham
  // gate runs on THREE-YEAR-AVERAGE earnings (Valuation.astro's eps3 — Graham's own guard against
  // paying for one peak year), so quote that same figure here, on the same share basis, with the
  // latest year as the aside; otherwise the reader carries a peak-year EPS into a gate judged on
  // the average.
  const shV = company.sharesForValue?.val > 0
    ? company.sharesForValue.val
    : (company.ttm?.lines?.sharesDiluted ?? L.sharesDiluted); // Valuation.astro's exact share chain
  const ni3 = H.filter((h) => h.lines.netIncome != null).slice(-3).map((h) => h.lines.netIncome);
  const eps3 = ni3.length >= 2 && shV ? mean(ni3) / shV : null;
  const eps = L.netIncome != null && shV ? L.netIncome / shV : null;
  const bvps = L.stockholdersEquity != null && shV ? L.stockholdersEquity / shV : null;
  const epsClause = eps3 != null
    ? `Three-year average earnings are ${sym}${eps3.toFixed(2)}/share (latest year ${sym}${(eps ?? eps3).toFixed(2)}), the averaged base the calculator's gate runs on`
    : eps ? `Earnings are ${sym}${eps.toFixed(2)}/share` : "";
  add("Moderate price", "P/E ≤ 15 and P/E × P/B ≤ 22.5", "decided by the price", "na",
    `Graham's valuation gate, the wall he kept between a sound business and a sound investment. ${epsClause}${epsClause && bvps ? ", and " : ""}${bvps ? `book value is ${sym}${bvps.toFixed(2)}/share` : ""}. Enter a price in “What the price implies” just below for the P/E, P/B, and whether it clears. But this is the rule Buffett outgrew: there's no hard P/E law, and a wonderful business can deserve a far richer multiple if the thesis holds, treat it as the bargain-hunter's floor, not a verdict on the price.`);

  const runnable = t.filter((x) => x.status !== "na");
  const passes = t.filter((x) => x.status === "pass").length;
  return { tests: t, passes, testable: runnable.length };
}
