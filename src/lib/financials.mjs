// Financials (banks): the lens Buffett actually brings to a bank. A bank is not read
// on revenue, operating margin, ROIC or owner earnings, which do not mean for a
// lender what they mean for an industrial. It is read on the return it earns on
// equity and tangible book, how efficiently it runs, how disciplined the lending is,
// and how cheap and sticky the funding is. Pure arithmetic on the filing data.

import { fmtMoney } from "./fundamentals.mjs";

const pc = (v, dp = 0) => (v == null ? "—" : `${(v * 100).toFixed(dp)}%`);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// --- raw metrics, each null when not honestly computable ---
export function returnOnEquity(L) {
  // Require positive equity: a loss over negative book yields a positive ratio that reads
  // as a strength when it is the opposite, so withhold rather than flatter (mirrors the
  // tangible-equity and fee-side guards).
  return L && L.netIncome != null && L.stockholdersEquity > 0 ? L.netIncome / L.stockholdersEquity : null;
}
export function tangibleEquity(L) {
  if (!L || L.stockholdersEquity == null) return null;
  return L.stockholdersEquity - (L.goodwill || 0) - (L.intangibleAssets || 0);
}
export function returnOnTangibleEquity(L) {
  const tce = tangibleEquity(L);
  return L && L.netIncome != null && tce && tce > 0 ? L.netIncome / tce : null;
}
export function returnOnAssets(L) {
  return L && L.netIncome != null && L.totalAssets ? L.netIncome / L.totalAssets : null;
}
export function netInterestMargin(L) {
  return L && L.netInterestIncome != null && L.totalAssets ? L.netInterestIncome / L.totalAssets : null;
}
export function efficiencyRatio(L) {
  if (!L || L.noninterestExpense == null || L.noninterestExpense <= 0) return null;
  // Both revenue components must be present and positive. A partially-tagged income
  // statement — a bank whose net interest income or fee income sits in a company extension
  // the facts API strips — cannot yield a comparable ratio, and a missing component
  // silently changes what the ratio means across the pools.
  if (L.netInterestIncome == null || L.netInterestIncome <= 0 || L.noninterestIncome == null || L.noninterestIncome <= 0) return null;
  const rev = L.netInterestIncome + L.noninterestIncome;
  const r = rev > 0 ? L.noninterestExpense / rev : null;
  // Outside a believable band (~20%–110%) the inputs are mis-tagged, not the bank
  // extraordinary, so show nothing rather than a "Lean" or "Bloated" verdict on garbage.
  return r != null && r >= 0.2 && r <= 1.1 ? r : null;
}
export function depositFunding(L) {
  if (!(L && L.deposits != null && L.totalAssets)) return null;
  const r = L.deposits / L.totalAssets;
  // Below ~10% of assets the standard deposit tag has almost always captured an interbank
  // sub-line, not the customer deposit base — foreign banks tag the real total in a company
  // extension the SEC facts API doesn't expose. Publishing that would paint a deposit-rich bank
  // (a TD, a Royal Bank) as wholesale-funded, so we show nothing rather than a wrong funding mix.
  return r >= 0.1 ? r : null;
}
export function equityToAssets(L) {
  return L && L.stockholdersEquity != null && L.totalAssets ? L.stockholdersEquity / L.totalAssets : null;
}
export function provisionRate(L) {
  return L && L.provisionForCreditLosses != null && L.netInterestIncome ? L.provisionForCreditLosses / L.netInterestIncome : null;
}

// The financials archetype is best judged on these. Returns the same shape the
// industrial scorecard uses, so the page renders it through the same component.
export function buildFinancialScorecard(company, subtype = "bank") {
  const $ = (v) => fmtMoney(v, company?.currency || "USD");
  const L = company?.lines || {};
  const none = (title, note, concept = null) => ({ title, concept, value: "—", formula: "", tone: "none", label: "Not enough data", note });
  // A mortgage REIT is read on the same lender lens (return on equity, tangible book) but it funds a
  // pool of mortgages with borrowing, not deposits, so the deposit-funding check is replaced with the
  // leverage that actually defines it.
  const isMReit = subtype === "mortgage-reit";

  // Is it a good business: return on equity, on tangible equity, and efficiency.
  const roe = returnOnEquity(L);
  const roeCheck = roe == null ? none("Return on equity", "Net income or equity wasn't found in the filing data.", "return-on-equity") : (() => {
    const tone = roe < 0 ? "bad" : roe < 0.1 ? "warn" : roe < 0.13 ? "ok" : "good";
    const label = roe < 0 ? "Loss on equity" : roe < 0.1 ? "Below the cost of equity" : roe < 0.13 ? "Adequate" : roe < 0.17 ? "Strong" : "Very high (≥17%)";
    return {
      title: "Return on equity",
      concept: "return-on-equity",
      value: pc(roe), formula: `Net income ${$(L.netIncome)} ÷ equity ${$(L.stockholdersEquity)}`,
      tone, label,
      note: "The bank's north star, what it earns on shareholders' capital. Cost of equity is roughly 10%, so a return durably above that builds value and below it destroys it. One year is noisy; the durability across a full credit cycle is what counts.",
    };
  })();
  const rotce = returnOnTangibleEquity(L);
  const rotceCheck = rotce == null ? none("Return on tangible equity", "Equity, goodwill or intangibles missing.", "rotce") : {
    title: "Return on tangible equity",
    concept: "rotce",
    value: pc(rotce), formula: `Net income ÷ (equity − goodwill ${$(L.goodwill || 0)} − intangibles ${$(L.intangibleAssets || 0)})`,
    tone: rotce < 0 ? "bad" : rotce < 0.12 ? "warn" : rotce < 0.15 ? "ok" : "good",
    // Label bands track the tone bands exactly — the [0.12, 0.15) ok-band read "Strong" while its
    // amber tone said otherwise (2026-07-17 correctness sweep #2).
    label: rotce < 0 ? "Loss" : rotce < 0.12 ? "Modest" : rotce < 0.15 ? "Solid" : rotce < 0.18 ? "Strong" : "Very high (≥18%)",
    note: "The cleaner return, stripping out the goodwill paid for past acquisitions. This is the number a buyer of the whole bank actually earns on the hard capital.",
  };
  const eff = efficiencyRatio(L);
  // A 20-F/IFRS filer structures its income statement without the clean US noninterest-income /
  // -expense split, so the same formula picks up partial sub-lines and lands systematically lower.
  // For those we keep the figure but drop the lean/bloated grade, the way depositFunding suppresses
  // a sub-10% deposit ratio, rather than apply US thresholds to a number whose definition differs.
  const effAdr = company?.market === "ADR";
  const effCheck = eff == null ? none("Efficiency ratio", "Noninterest expense or revenue missing.", "efficiency-ratio") : {
    title: "Efficiency ratio",
    concept: "efficiency-ratio",
    value: pc(eff), formula: `Noninterest expense ${$(L.noninterestExpense)} ÷ (net interest income + fees)`,
    tone: effAdr ? "info" : eff > 0.75 ? "bad" : eff > 0.65 ? "warn" : eff > 0.58 ? "ok" : "good",
    label: effAdr ? "Cost-income, not comparable to the US grades" : eff > 0.75 ? "High cost ratio (>75%)" : eff > 0.65 ? "Average" : eff > 0.58 ? "Efficient (<65%)" : "Low cost ratio (<58%)",
    note: effAdr
      ? "The share of revenue eaten by running costs. A 20-F/IFRS filer structures its income statement differently from a US bank, so this figure is not comparable to the US thresholds and is shown without a lean/bloated grade — read it against the bank's own history, not across the pool."
      : "The share of revenue eaten by running costs; lower is better, and below about 60% marks a genuinely efficient operation. A low ratio held for years is the operational side of a moat.",
  };

  // Is it sound: capital, funding, credit cost.
  const cap = equityToAssets(L);
  const capCheck = cap == null ? none("Capital cushion", "Equity or total assets missing.") : {
    title: "Capital (equity / assets)",
    value: pc(cap, 1), formula: `Equity ${$(L.stockholdersEquity)} ÷ assets ${$(L.totalAssets)}`,
    tone: cap < 0.06 ? "bad" : cap < 0.08 ? "warn" : cap < 0.1 ? "ok" : "good",
    label: cap < 0.06 ? "Thin" : cap < 0.08 ? "Modest" : cap < 0.1 ? "Adequate" : "Well capitalized",
    note: "A plain-English leverage read: how much of the balance sheet is the owners' own money. This is a rough proxy; the regulatory figure is the CET1 ratio, which is risk-weighted and reported in the filing. The point is the same, how much loss the bank can absorb before depositors are at risk.",
  };
  // A mortgage REIT funds its pool mostly with short-term repo, which the filings carry in liabilities
  // rather than as tagged debt, so debt/equity reads near zero and badly understates the leverage. The
  // honest read is the whole financed balance sheet against the owners' equity: assets / equity.
  const aoe = L.totalAssets > 0 && L.stockholdersEquity > 0 ? L.totalAssets / L.stockholdersEquity : null;
  const fund = depositFunding(L);
  const fundCheck = isMReit
    ? (aoe == null ? none("Leverage", "Assets or equity missing.", "net-debt") : {
        title: "Leverage (assets / equity)",
        concept: "net-debt",
        value: `${aoe.toFixed(1)}×`, formula: `Assets ${$(L.totalAssets)} ÷ equity ${$(L.stockholdersEquity)}`,
        tone: "info",
        label: "Borrowed against book",
        note: "A mortgage REIT finances a pool of mortgages with borrowed money — mostly short-term repo, which sits in liabilities rather than as tagged debt — so its true leverage is the whole balance sheet against the owners' equity, not just labeled debt. That leverage magnifies both the spread it earns and the loss when rates or credit move against it; read it beside the book value, the question being whether the spread compensated for the leverage through a cycle.",
      })
    : fund == null ? none("Funding", "Deposits or total assets missing.", "net-interest-margin") : {
        title: "Deposit funding",
        concept: "net-interest-margin",
        value: pc(fund), formula: `Deposits ${$(L.deposits)} ÷ assets ${$(L.totalAssets)}`,
        tone: fund < 0.5 ? "warn" : fund < 0.65 ? "ok" : "good",
        label: fund < 0.5 ? "Leans on wholesale funding" : fund < 0.65 ? "Mostly deposit-funded" : "Deposit-funded",
        note: "Low-cost, sticky deposits are a bank's real moat, the cheap raw material it lends out at a spread. A bank funded mostly by deposits earns more durably than one that rents its money in the wholesale market.",
      };
  const prov = provisionRate(L);
  const provCheck = prov == null ? none("Credit cost", "Provision or net interest income missing.") : {
    title: "Credit cost (provision / NII)",
    value: pc(prov), formula: `Provision for credit losses ${$(L.provisionForCreditLosses)} ÷ net interest income ${$(L.netInterestIncome)}`,
    tone: "info",
    label: prov < 0 ? "Net reserve release" : prov < 0.1 ? "Low" : prov < 0.2 ? "Moderate" : "Elevated",
    note: "What the bank set aside this year against loans going bad, as a share of its lending income. This swings hard with the cycle, low in good years and spiking in recessions, so read it across the record, not in one year. Disciplined underwriting shows up as low, stable provisions through a downturn.",
  };

  // The deposit franchise (banks desk Wave A, ratified 2026-07-21): noninterest-bearing deposits
  // as a share of the total — the moat made visible, money the bank pays nothing for and that
  // tends to stay. Beside it, the price actually paid for the interest-bearing rest, on the
  // labeled average-of-two-year-ends convention. A de-novo whose only tag is demand accounts is
  // labeled as such (bankFlags.nibIsDemand), never dressed as the NIB line.
  const nib = L.noninterestBearingDeposits ?? (company?.bankFlags?.nibIsDemand ? L.demandDeposits : null);
  const nibIsDemand = L.noninterestBearingDeposits == null && company?.bankFlags?.nibIsDemand;
  const nibShare = nib != null && L.deposits ? nib / L.deposits : null;
  const H = company?.history || [];
  const prevY = H.length >= 2 ? H[H.length - 2].lines : null;
  const avgOf = (k) => (L[k] != null && prevY?.[k] != null ? (L[k] + prevY[k]) / 2 : L[k] ?? null);
  const ibAvg = avgOf("interestBearingDeposits");
  const depCost = L.interestExpenseDeposits != null && ibAvg ? Math.abs(L.interestExpenseDeposits) / ibAvg : null;
  const franchiseCheck = nibShare == null
    ? none("Deposit franchise", "The deposit mix isn't cleanly tagged in the filings' structured data; the funding read above carries what is.", "net-interest-margin")
    : {
      title: nibIsDemand ? "Deposit franchise (demand)" : "Deposit franchise",
      concept: "net-interest-margin",
      value: pc(nibShare),
      formula: `${nibIsDemand ? "Demand" : "Noninterest-bearing"} deposits ${$(nib)} ÷ deposits ${$(L.deposits)}${depCost != null ? ` · pays ${pc(depCost, 2)} on the interest-bearing rest (avg of year-ends)` : ""}`,
      tone: nibShare >= 0.28 ? "good" : nibShare >= 0.18 ? "ok" : "warn",
      label: nibShare >= 0.28 ? "A true franchise" : nibShare >= 0.18 ? "Solid core deposits" : "Rate-sensitive funding",
      note: "The share of deposits the bank pays nothing for — checking accounts that stay through rate cycles. This is the deposit moat in one number: a high share means cheap, sticky raw material for lending; a low share means the funding reprices with every rate move. Buffett's Wells letter is built on exactly this economics.",
    };

  // Credit discipline through the cycle: net charge-offs against the loan book, the realized
  // truth behind the provisions. Withheld with the reason where the filer's recoveries live
  // only on dimensioned axes (Truist) — a gross figure dressed as net is a wrong number.
  const loansAvg = avgOf("loansHeldForInvestment");
  const ncoRate = L.netChargeOffs != null && loansAvg ? Math.abs(L.netChargeOffs) / loansAvg : null;
  const ncoSeries = H.map((h) => {
    const l = h?.lines || {};
    return l.netChargeOffs != null && l.loansHeldForInvestment ? Math.abs(l.netChargeOffs) / l.loansHeldForInvestment : null;
  }).filter((v) => v != null && Number.isFinite(v));
  const worstNco = ncoSeries.length >= 3 ? Math.max(...ncoSeries) : null;
  const allowShare = L.allowanceForCreditLosses != null && L.loansHeldForInvestment ? L.allowanceForCreditLosses / L.loansHeldForInvestment : null;
  const creditCheck = ncoRate == null
    ? none("Net charge-offs", "Not derivable from the filings' structured data — some filers carry recoveries only on segment axes, and a gross figure dressed as net would be a wrong number.", "combined-ratio")
    : {
      title: "Net charge-offs",
      concept: "combined-ratio",
      value: pc(ncoRate, 2),
      formula: `Charge-offs net of recoveries ${$(Math.abs(L.netChargeOffs))} ÷ loans ${$(loansAvg)} (avg of year-ends)${worstNco != null ? ` · worst year on record ${pc(worstNco, 2)}` : ""}${allowShare != null ? ` · allowance held at ${pc(allowShare, 2)} of loans` : ""}`,
      tone: ncoRate < 0.003 ? "good" : ncoRate < 0.008 ? "ok" : ncoRate < 0.015 ? "warn" : "bad",
      label: ncoRate < 0.003 ? "Disciplined book" : ncoRate < 0.008 ? "Normal credit cost" : ncoRate < 0.015 ? "Elevated losses" : "Heavy losses",
      note: "Loans actually written off, net of what was later recovered — the realized truth the provisions were guessing at. Graham's rule applies doubly here: the worst year in the record, not the average, is the read, because a loan book's sins are committed in the good years and confessed in the bad ones.",
    };

  // The 2023 lesson, directly tagged: the gap between what held-to-maturity securities cost and
  // what they are worth, against the bank's tangible equity. Silicon Valley Bank died of this
  // number; it is now on every bank page that files it.
  const te = tangibleEquity(L);
  const htmGap = L.htmAmortizedCost != null && L.htmFairValue != null ? L.htmAmortizedCost - L.htmFairValue : null;
  const htmShare = htmGap != null && te > 0 ? htmGap / te : null;
  const marksCheck = htmShare == null
    ? null
    : {
      title: "Held-to-maturity marks",
      concept: "net-debt",
      value: htmGap <= 0 ? "No loss" : pc(htmShare),
      formula: `HTM at cost ${$(L.htmAmortizedCost)} − fair value ${$(L.htmFairValue)} = ${$(htmGap)}${htmGap > 0 ? `, against tangible equity ${$(te)}` : ""}`,
      tone: htmShare <= 0.05 ? "good" : htmShare <= 0.15 ? "ok" : htmShare <= 0.3 ? "warn" : "bad",
      label: htmShare <= 0.05 ? "Marks are small" : htmShare <= 0.15 ? "Manageable" : htmShare <= 0.3 ? "A real dent if realized" : "Severe if realized",
      note: "Bonds held to maturity are carried at cost, so rate rises open a gap between the books and reality that only shows in this disclosure. The gap never hits earnings if the bank can hold on — which is precisely why the reader checks whether it could be forced to sell: the 2023 bank failures were this number meeting deposit flight.",
    };

  return {
    sections: [
      { heading: "Is it a good business?", checks: [roeCheck, rotceCheck, effCheck] },
      { heading: "Is it sound?", checks: [capCheck, fundCheck, provCheck] },
      ...(isMReit ? [] : [{ heading: "The franchise and the credit cycle", checks: [franchiseCheck, creditCheck, ...(marksCheck ? [marksCheck] : [])] }]),
    ],
  };
}

// The "is it a good business?" read for the brief: return-on-equity durability across
// the record, the bank equivalent of the ROIC read, with the verdict left to the filing.
export function financialQuality(company, subtype = "bank") {
  const isMReit = subtype === "mortgage-reit";
  const H = (company?.history || []).filter((h) => h?.lines?.netIncome != null && h?.lines?.stockholdersEquity);
  const roeSeries = H.map((h) => h.lines.netIncome / h.lines.stockholdersEquity).filter((v) => Number.isFinite(v));
  if (roeSeries.length < 3) return null;
  const med = median(roeSeries);
  const above = roeSeries.filter((v) => v >= 0.12).length;
  const n = roeSeries.length;
  const L = company.lines || {};
  const eff = efficiencyRatio(L);

  let s1;
  if (med >= 0.15) s1 = `Return on equity has run high across the record (median ${pc(med)}, above 12% in ${above} of ${n} years)`;
  else if (med >= 0.1) s1 = `Return on equity has hovered around the cost of equity (median ${pc(med)}, above 12% in ${above} of ${n} years)`;
  else s1 = `Return on equity has sat below the cost of equity (median ${pc(med)}, above 12% in only ${above} of ${n} years)`;
  s1 += ".";

  let s2 = "";
  // Skip the lean/heavy characterization for 20-F/IFRS filers, whose efficiency ratio is not
  // comparable to the US thresholds (see the scorecard note).
  if (eff != null && company?.market !== "ADR") s2 = ` It runs at a ${pc(eff)} efficiency ratio, ${eff < 0.6 ? "lean" : eff < 0.68 ? "about average" : "on the heavy side"}.`;

  const s3 = isMReit
    ? (med >= 0.12
      ? " A mortgage REIT that earns above its cost of equity through the cycle compounds book value; but it does so on heavy borrowing against a pool of mortgages, so whether the spread compensated for the leverage, or simply rode falling rates, is what the worst years in the record and the 10-K will tell you."
      : " A mortgage REIT lives on the spread between what its mortgages earn and what its borrowing costs, levered many times over; weigh the worst rate and credit years in the record, not the average, and read the 10-K.")
    : (med >= 0.12
      ? " A bank that earns above its cost of equity through the cycle compounds book value; whether this one did it by underwriting discipline or by reaching for risk is what the 10-K, and the worst years in the record, will tell you."
      : " The cycle and the loan book decide this one; weigh the recession years in the record, not the average, and read the 10-K.");

  return { text: s1 + s2 + s3 };
}
