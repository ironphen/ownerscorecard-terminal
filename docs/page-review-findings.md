# Page correctness review — adversarial findings

Computed-layer review of a 64-company stratified sample (every archetype and financial kind, plus the
special situations this sweep touched). Each page's computed reads were reviewed by a Munger-style skeptic
against the underlying SEC data, then **every finding was independently re-verified** against that data to drop
false positives. Only confirmed findings are listed.

**216 confirmed findings across 62/64 companies (72 high-severity).** Fully clean: JPM, CB.

## Systematic themes (root causes worth fixing once)

1. **Owner-earnings comparability** — maintenance-capex proxy flips from full capex to depreciation as capex pulls away from depreciation, so the owner-earnings margin series is not comparable year-over-year and can show a *rising* trend during a capex surge that is *depressing* ROIC (GOOGL, MCD, F). Defensible Buffett definition, but the presentation misleads — a doctrine call.
2. **Earnings-power base mismatch** — "Earnings power, through the cycle" normalizes on the latest **annual** revenue but sets it beside the **TTM** "latest reported" figure; not apples-to-apples (GOOGL, ADBE, MSCI, FICO, AAPL, UNP, MET, ...).
3. **"Is it a good business?" prose vs series** — median computed on an N-1 window but stated as "N of N years"; "consistently" applied to volatile series; central tendency misquoted (MSCI, ASML, ADBE, MCD, XOM, PMT, UNH, BLK).
4. **Current-ratio "structural strength" template** — the Costco/Amazon supplier-float framing misapplied to regulated utilities, levered REITs and a debt-financed buildout, giving false comfort (DUK, CRWV, AMC, AMT).
5. **Net-debt / leverage** — a blank total-debt year is treated as zero, printing a spurious *net-cash* position (8001, 8031, DOW); mortgage-REIT leverage excludes repo, showing 0.0x–2.5x where true leverage is ~8–9x (NLY, STWD).
6. **Normalized through-cycle window** — windfall/peak windows manufacture misleading "earning power" for a structurally changed business (MRNA COVID, BABA pre-de-rating, 9697/Capcom record year labeled "lean").
7. **Valuation reverse-DCF anchors** — "delivered X%/yr" growth dials and justified-multiple anchors computed on cherry-picked or wrong windows (O, BX, MET, BHF).
8. **Data corruption** — specific bad inputs: corrupted cost-of-revenue (CAT 100% gross), receivables collapse (DUK), share-count breaks (WFC), wrong revenue field (MET $2.4B vs $72.3B), float-row stitching (AFL), debt-line and column/period mislabels (AMT, PLD, PMT, VNET), sign errors (APLD depreciation). Some need data re-extraction; some are guardable in code.

## Findings by company (most-severe first)

### CRWV  (4 high, 7 total)
- **[high]** Will it survive? — Can it pay its interest?
  - The page states "No meaningful interest burden / Little or no interest expense reported / the business isn't leaning on lenders to operate," yet the same Will-it-survive block reports total debt $21.4B, net debt $18.2B, and debt incl. leases $34.9B — a debt-financed GPU buildout cannot have little/no interest and is by definition lender-dependent.
- **[high]** Is it a good business? — Owner-earnings margin
  - Labels a business 'Cash machine through the cycle' (OE margin 98%, range 12%–755%) when net income is negative every year (−$594M/−$863M/−$1.2B) and free cash flow is deeply negative (FY2025 FCF −$7.3B per the page's own bridge). FY2023 'owner earnings' of $1.7B is 7.4x the $229M of revenue — impossible as cash an owner could withdraw.
- **[high]** Current Position / Will it survive? — How long is cash tied up? (negative cash-conversion cycle)
  - Frames the −182d cycle as a Costco/Amazon-style 'quiet moat' where customers fund the operation, but the page's own inputs are DSO 225 (customers take ~7.5 months to pay — very slow, not cash-at-register) and the cycle is created by DPO 408 (vendor/capex financing); receivables $3.2B are 2x payables $1.6B, so more cash is tied in customers than owed to suppliers, and the business burns $7.3B FCF (no cash-generative float moat).
- **[high]** Current Position — current ratio interpretation
  - Recasts the sub-1 current ratio as 'likely structural strength... the edge, not the risk,' but the page itself reports current ratio 0.31x, quick 0.31x, cash 0.13x, working capital −$12.2B, and '$7.5B due this year vs $2.3B cash — cash alone won't cover the maturities — it leans on refinancing.' With a $7.3B annual burn that is genuine near-term strain.
- **[medium]** The business in brief (lens) / Is it a good business? — ROIC note
  - The lens calls it 'A software business... high margins on code once it is written' and the ROIC note warns 'asset-light businesses read artificially high,' but the filing classifies the company as sector=capital-intensive and the balance sheet is net PP&E $30.6B + lease assets $8.2B (~79% of $49.3B assets) with capex $10.3B (202% of revenue). It is capital-intensive, so the asset-light caveat steers the reader backwards.
- **[medium]** Vital signs strip (TTM, with 3-yr average)
  - Headlines 'Owner-earnings margin 3-yr avg 289%' for a company tagged unprofitable that loses money and burns cash every year. The 289% is merely the mean of the volatile 755.5%/98.5%/11.8% series (driven by prepayment/payables-inflated CFO), a meaningless and misleading figure to surface as a top-line vital sign.
- **[low]** Current Position — Deeper floors (Net current asset value)
  - The caption says 'Net current asset value (−$45.2B) — current assets less all debt,' but −$45.2B is current assets ($5.6B) minus TOTAL liabilities ($55.6B assets − $4.8B equity = $50.8B). 'All debt' ($24.9B, or $34.9B incl. leases) would give about −$19.3B to −$29.3B, not −$45.2B, so the stated definition does not match the figure shown.

### VNET  (4 high, 6 total)
- **[high]** Vital signs strip / 'Will it survive?' (interest coverage) vs 'The record' table (FY2019 column)
  - The page shows two operating incomes for the same FY2019: CN¥780M / 20.6% in the 'Operating margin' vital sign and the survival card ('Operating income CN¥780M ÷ interest expense CN¥599M = 1.3x'), versus CN¥182M / 4.8% in the record table's '19 column. The underlying opMargin history's 2019 slot is 5%, contradicting 20.6%. Presenting a 20.6% operating margin for a company the page classifies unprofitable/distress is materially misleading.
- **[high]** 'What it is' header & Owner-earnings bridge (TTM/FY2019) vs 'The record' table (FY2019 column)
  - FY2019 net income is shown as (CN¥133M) in the header/TTM column and owner-earnings bridge, but (CN¥181M) (EPS CN¥-2.53) in the record's '19 column. The netIncome history places -181M in the 2019 slot and -133M in the 2025 slot, so the figure labeled FY2019 in the header/bridge is actually a later year's number mislabeled as FY2019.
- **[high]** Current Position (header date)
  - The section is headed 'as of fiscal year-end, Dec 31, 2025' with current assets CN¥11.5B, current liabilities CN¥12.4B, cash CN¥5.9B, current ratio 0.92x, but these are the FY2019 figures (they match the record's Dec 2019 / TTM column and the filing), and the Owner's Scorecard directly below sources 'FY2019 20-F · SEC EDGAR'. A six-year date error on the section whose purpose is the near-term, as-of survival question.
- **[high]** Owner-earnings bridge & 'The business in brief' (capex) vs 'The record' table (FY2019 capex)
  - FY2019 capex is presented as ~CN¥7.7B in the bridge (maintenance CN¥2.1B + growth CN¥5.5B) and the prose claim 'capital spending has surged to 202% of sales' (7.7B ÷ 3.8B), but as CN¥1.2B in the record's '19 column — a ~CN¥6.5B discrepancy for the same year; both cannot describe FY2019.
- **[medium]** 'The record' table (FY2019 column) vs Current Position / underlying filing (balance-sheet scale)
  - The record's '19 column balance sheet and depreciation are roughly one-third the FY2019 filing shown elsewhere: total assets CN¥14.3B vs CN¥44.6B, cash+inv CN¥2.2B vs CN¥5.9B, total debt CN¥267M vs CN¥3.3B, depreciation CN¥772M vs CN¥2.1B. The ten-year 'durability' record is internally inconsistent with the company's own latest filing across these line items.
- **[medium]** 'Is it a good business?' (Owner-earnings margin) vs 'The record' table (FY2019 OE margin)
  - The 'Is it a good business?' card reports the latest owner-earnings margin as -5% / -5.5% (CN¥207M = operating cash CN¥1.9B - maintenance capex CN¥2.1B), while the record's '19 column reports +0.8% owner-earnings margin (Owner earn. CN¥31M) for the same year — two contradictory latest/FY2019 owner-earnings margins.

### BRK-B  (3 high, 7 total)
- **[high]** The record, 2016-2025 (Operating income / Operating margin rows) vs Will it survive? and Vital signs
  - Three irreconcilable operating-income figures for the latest period (record FY2025 -$71.2B / -28.8%, survival-test +$20.1B, TTM +$21.6B / 8.6%) with an opposite sign on the same fiscal year. The record's negative op-income series embeds GAAP unrealized investment marks, so it is not an operating-performance metric, yet it is labeled 'operating income/operating margin' beside a +8.6% current figure, making the record internally incoherent.
- **[high]** Will it survive? - Can it pay its interest? vs The record (Interest coverage row)
  - The '4.0x Adequate' verdict uses the +$20.1B operating-income basis (20.1/5.1 = 3.9x), while the record's Interest coverage row it explicitly tells the reader to check shows -14.1x for FY2025 and negative coverage in 8 of 10 years. The two reads cannot both be true; the 'Adequate' label is unsupported by the very series cited.
- **[high]** The business in brief - Situation (distress overlay) / classification
  - The 'Distress / turnaround ... cash-burning operations ... maturity wall' tag is contradicted by the data: owner earnings positive every year 2016-2025 (7.1%-16.2%), operating cash flow positive every year, equity $717.4B, cash & investments $52.6B. No cash burn or liquidity problem; the tag is driven by the artifactual negative operating-income line and also contradicts the page's own '4.0x Adequate' verdict and its 'Debt under-captured - leverage unknown.'
- **[medium]** What it is - Vital signs (Operating margin)
  - The headline vital sign pairs a current 8.6% against a 5-yr average of -27.4% (a ~36-point swing) on inconsistent bases: the -27.4% is the mean of the record's artifactual negative op-margins (2021-2025), which embed unrealized investment losses, while 8.6% is a TTM/operating-snapshot basis. It implies operating economics swung from deeply loss-making to healthy, which never happened operationally.
- **[medium]** What it is - Vital signs / Quality & stewardship (lens selection)
  - The company is SIC 6331 insurance and the page's own 'What moves the needle' text names underwriting that 'does not lose money over the cycle' as the enduring test, yet the computed layer shows no combined ratio or underwriting result (financialKind blank, so no insurer panel triggers). The one underwriting datum present - premiumsEarned $28.7B vs claimsIncurred $30.9B, a ~108% loss ratio - goes unshown.
- **[low]** Earnings power, through the cycle - Latest, reported
  - Period mismatch: 'Latest, reported $31.8B at a 12.7% margin this year' is the TTM (Mar 2026) owner-earnings figure, while the normalized $34.7B applies the median margin to the latest ANNUAL (FY2025) revenue $247.2B. FY2025 owner earnings are $32.5B at 13.1% (used in the bridge). Labeling the TTM figure 'this year' beside an FY2025-based normalization conflates two periods.
- **[low]** The record / Owner-earnings methodology (Owner earnings row)
  - Inconsistent maintenance-capex basis: 8 of 10 years use OE = CFO - depreciation, but FY2020 (26.8 = 39.8 - 13.0) and FY2021 (26.2 = 39.4 - 13.3) deduct full capex instead of depreciation. The stated rule is maintenance capex = depreciation where a growing business invests above it; 2020 and 2021 had capex above depreciation yet used full capex, understating OE by ~$2.4B and ~$2.5B versus the stated rule.

### 8001  (3 high, 7 total)
- **[high]** Durability & moat, 2022–2026 — "Worst year"
  - Page labels 2026 the "worst/hardest" year invoking recession resilience, but 2026 is the all-time peak: record net income ¥900.3B, record owner earnings ¥846.8B, record revenue ¥14.82T. "Worst" is selected purely on a 0.2% operating margin the page itself declares not meaningful for this equity-method business.
- **[high]** Will it survive? — Debt, net of cash
  - Expresses net debt as 126.7× operating profit (¥32.9B) while the same section repeatedly says the operating-line lens isn't meaningful and prescribes net-debt-vs-equity. That prescribed lens is ¥4.16T/¥6.59T = 0.63× (benign). The 126.7× figure is internally inconsistent and alarming.
- **[high]** The record — Net debt / (cash) row
  - FY2024 net debt is shown as a net CASH position (¥600.4B), but FY2024 total debt is blank/unavailable in the data. The (¥600.4B) equals exactly the negative of FY2024 cash, i.e. debt was defaulted to zero — contradicted by ¥4.62T of debt the very next year. A spurious net-cash read.
- **[medium]** Durability & moat — Reinvestment, incremental ROIC
  - Claims "the capital base barely grew" and the company "returns cash through dividends and buybacks rather than reinvesting," but the record shows equity +57% (¥4.20T→¥6.59T) and assets +38%, and the cash-use panel shows 44% retained (largest bucket) versus 34% returned to owners.
- **[medium]** Durability & moat — Share count
  - Says "little buyback," contradicted by the record's own buyback row rising ¥60.0B→¥61.8B→¥100.1B→¥158.2B→¥170.1B and the cash-use panel showing ¥550.1B cumulative (11% of operating cash, a growing program). Buybacks are material; flat share count reflects buybacks offsetting issuance, not their absence.
- **[medium]** Durability & moat — Operating margin
  - States "Margins held roughly steady across the record," but operating-margin data exists for only 2 of 5 years (opMargin row '— — — 0% 0%'). Describing a 2-data-point span as a record-spanning trend overstates coverage, and the page elsewhere declares the operating line not meaningful for this business.
- **[low]** Will it survive? vs The record — Interest coverage
  - The record table publishes a concrete interest coverage of 0.3× for FY2025 and FY2026, while the "Can it pay its interest?" survival check shows "—" and "Not the right lens here." The same metric is both published and disowned — internally inconsistent — and 0.3× reads as insolvent, an artifact of the de-minimis operating line.

### BHF  (3 high, 6 total)
- **[high]** What the price implies (valuation)
  - With normalized RoTE -3%, the page's own formula (RoTE - g)/(Ke - g) = (-0.03-0.03)/(0.10-0.03) = -0.86x, a NEGATIVE justified price/tangible-book. The reference value per share that a user's price is compared against is therefore nonsensical/negative, and contradicts the page's anchor that 'earning exactly its cost of equity is worth about one times tangible book.'
- **[high]** What the price implies (valuation)
  - The -3% normalized return on the $5.5B tangible book is not supported by the record. 10-yr avg ROE is +4.4%, median +1.5%, the page's own 5-yr avg ROE is +14% and headline ROE +6%, and 5-yr avg net income is +$1.04B (+19% on $5.5B). Reaching ~-3% requires deleting the single best year (2022, +70%) while keeping the symmetric bad years (2016 -20%, 2023 -22%) - an asymmetric, downward-biased normalization.
- **[high]** What the price implies (valuation, the dials)
  - The +3%/yr long-term growth dial is internally inconsistent with the firm's own normalized return (-3%) and delivered record. Sustainable growth = return x retention, so a negative return cannot fund positive book growth, and the page simultaneously shows tangible book/share delivered -13%/yr - directly contradicting +3% growth fed into the multiple. The valuation runs an impossible state (growth above return; growth positive while book contracts).
- **[medium]** What it is - Vital signs / The float and book value
  - Labeling net-investment-income-divided-by-loss-reserves as an investment 'yield' overstates and mislabels it. The $5.2B NII is earned on the insurer's entire invested asset base (a $242B life insurer), not the $32B loss reserves used as the denominator - which the page itself concedes 'excludes unearned premiums and funds held.' A realistic portfolio yield is ~4-5%, not 16.4%; presenting 16.4% (and a 15.1% 5-yr avg) as the investment 'yield' wrongly implies a lucrative portfolio at a firm with negative TTM ROE.
- **[medium]** What the price implies (valuation)
  - The -13%/yr 6-year tangible-book decline is not borne out by the per-share series. FY2019->FY2025 (a true six-year span) is only -3.4%/yr, FY2020->FY2025 (5 yr) is -9.2%/yr, and even FY2020->TTM treated as six years is -10.5%/yr; no genuine six-year per-share window reaches -13%/yr. With minimal intangibles tangible book tracks total book, so -13%/yr is overstated by roughly 2-3 points versus the series the page displays.
- **[low]** The record, 2016-2025 (Revenue row)
  - Four revenue cells diverge from the underlying filing data: 2016 page $4.4B vs filing $3.0B, 2021 $5.6B vs $5.0B, 2023 $5.5B vs $4.1B, 2024 $6.0B vs $4.7B - while net income, investment income and premiums all reconcile, so only the revenue basis differs (likely total revenue vs revenue ex net realized investment gains/losses). It is load-bearing: the headline +12.9% YoY (6.0->6.8) matches the record basis but would be ~+45% on the filing basis (4.7->6.8), so the page mixes a revenue definition that contradicts its stated source data.

### MET  (3 high, 5 total)
- **[high]** Where the money comes from (Revenue by product line, FY2025)
  - The six product lines sum to $2.436B (matching the underlying ASC 606 disaggregation field of $2.4B), yet the page header and record table report FY2025 revenue of $72.3B (premiums earned $49.8B + investment income $22.6B). The page states 'Revenue is led by Prepaid legal plans (26%) and Vision (23%)' as if these are MetLife's whole revenue, directly contradicting its own $72.3B header.
- **[high]** Management & pay (Stock-based compensation)
  - SBC of $168M is called '7% of revenue,' but $168M / $72.3B (the displayed revenue) = 0.23%. The 7% only results from dividing by the broken $2.4B revenue field ($168M / $2.4B = 7.0% exactly), so it is internally inconsistent with the $72.3B the page shows and overstates SBC's weight ~30x. The companion '3% of operating profit' ($168M/$6.1B = 2.8%) is correct.
- **[high]** What the price implies (reverse-DCF assumptions)
  - The valuation dial states 'Tangible book / share, delivered -18%/yr 6-yr record,' but every actual 6-year BVPS window computes between -4.9% and -8.1% (2019 $70.04 -> 2025 $42.18 = -8.1%/yr). A -18%/yr compound decline over six years would put BVPS near $21, versus the reported $42. The -18% appears nowhere as a 6-yr figure (the closest are a 3-yr -19% and a 4-yr -17%, neither a 6-yr window), so the valuation input is wrong and far more bearish than the record supports.
- **[medium]** Vital signs strip (What it is)
  - The vital-signs strip headlines 'Investment yield on float 130.5% (5-yr avg 124.1%).' This divides net investment income ($22.6B FY / $23.0B TTM) by loss-and-claim reserves only ($17.1B), producing a 'yield' above 100% — structurally impossible for a real investment yield (a life insurer's is ~4-5%; the invested base runs into the hundreds of billions of a $745B balance sheet). A >100% 'yield' as a headline vital sign is misleading; the float-understatement footnote sits in a separate later section and only says the float is 'somewhat larger,' which does not cure a 130.5% headline.
- **[low]** Is it a good business? (Investment income) vs Vital signs
  - The same 'yield on float' is printed as 130.5% (vital signs) and 131.7% ('Is it a good business?', stated twice), while FY2025 22.6/17.1 = 132.2% and TTM 23.0/17.6 = 130.7%. The 131.7% reconciles to none of these — not even the page's own stated basis ('$22.6B, 131.7% on the float,' which actually equals 132.2%). A minor internal inconsistency in a figure that is already economically questionable.

### PMT  (3 high, 5 total)
- **[high]** The record, 2011–2018 — Total assets row; and Vital signs vs 'Is it sound?'
  - Three different Dec-2018 asset figures appear on the same page — FY2018 column $7.8B, TTM 'Dec 2018' column $22.5B, and scorecard/filing $21.3B. The FY2018 annual column and the TTM 'Dec 2018' column both purport to be ~Dec 2018 yet differ ~3x ($7.8B vs $22.5B), and the page then prints two capital ratios off inconsistent bases: vital-signs 8.3% (1.9/22.5) and scorecard 8.8% (1.9/21.3). The asset base is internally contradictory.
- **[high]** Vital signs strip — Equity / assets
  - The headline equity/assets 8.3% is computed on the ~$22.5B TTM asset base, while the '5-yr avg 25.4%' is computed on the record-table balance sheet where assets were only ~$4.9B–$7.8B. The denominators differ ~3x, so juxtaposing 8.3% 'now' against a 25.4% average implies the capital cushion collapsed when the move is almost entirely an artifact of the asset definition tripling between the historical series and the TTM figure — apples-to-oranges, misleading on solvency.
- **[high]** Is it a good business? (prose verdict)
  - The prose 'median 10%, above 12% in only 2 of 8 years' both contradict the page's own ROE series (12,12,14,12,6,6,8,10): the median is 11%, not 10%, and the count above 12% is 1 year (strictly) or 4 years (at-or-above), never 2. ROE was also at/above the stated 10% cost of equity in 5 of 8 years, so 'has sat below the cost of equity' is overstated.
- **[medium]** The record, 2011–2018 — Net interest income row
  - The FY2018 annual column of the Net interest income row reads +$48M, but the filing reports FY2018 net interest income of -$19M. The row's own TTM cell correctly shows a negative ($17M). The positive $48M in the 2018 annual column is a sign-flip contradiction of the filing's negative NII for the same fiscal year.
- **[low]** Does AI threaten the moat?
  - The whole page analyzes FY2018 (latest FY2018; record ends 2018; scorecard labeled 'FY2018 10-K'), yet the AI-moat box cites and quotes the company's 'FY2025 10-K'. Embedding a FY2025 risk-factor citation in an otherwise FY2018 analysis is an internal period inconsistency that undercuts the page's own 'every line here is arithmetic on the company's filings' framing.

### MRNA  (3 high, 5 total)
- **[high]** Earnings power, through the cycle — Owner-earnings margin, the range
  - The displayed range '-98.5% - 72.2%' is internally inconsistent with the 23.8% normalized margin. 23.8% is the median ONLY of the 2020-2024 OE-margin window [248.6, 72.2, 23.8, -55.9, -98.5], whose actual max is +248.6% (FY2020), not 72.2%. The shown max of 72.2% (FY2021) belongs to the 2021-2024 window, whose median is -16.0%, not 23.8%. Range and median are thus computed off inconsistent windows, and the range materially understates the historical upside swing (+248.6% omitted).
- **[high]** Earnings power, through the cycle — Normalized owner earnings
  - The +$462M positive 'earning power' is misleading. The 23.8% through-cycle margin is the median of 2020-2024, a window dominated by the COVID windfall (FY2020 OE margin +248.6%, FY2021 +72.2% on $18.5-19.3B revenue). Applying it to today's $1.9B revenue manufactures positive earnings power for a business with a -158% FY2025 operating margin, a -106.2% FY2025 OE margin (-$2.1B), burning $1.5-2B of cash a year. Presenting +$462M as the firm's earning power implies profitability the post-COVID company does not have.
- **[high]** Earnings power, through the cycle — verdict
  - The verdict ('the latest owner earnings may understate the business; the reported figure is being set in a lean year') treats Moderna's collapse as a cyclical trough that mean-reverts up to +23.8%. The revenue path $803M -> $18.5B -> $19.3B -> $6.8B -> $3.2B -> $1.9B is a one-time COVID demand spike, not an oscillation; the ~$19B base is structurally gone, not a low point in a cycle. Calling the current cash-burning year 'lean' and earnings 'understated' is an unsupported through-cycle claim the revenue series does not bear out.
- **[medium]** Earnings power, through the cycle — Latest, reported
  - The normalization base is FY2025 ($1.9B revenue; TTM revenue is $2.2B), but the 'Latest, reported' comparator shown, ($1.6B) at -72.0%, is the TTM (Mar 2026) owner-earnings figure, not FY2025's, which is ($2.1B) at -106.2% per the owner-earnings bridge. Pairing a FY2025 normalization base against a TTM reported comparator is period-inconsistent and shows the reported burn as ~$0.5B less negative than the actual FY2025 figure.
- **[medium]** Earnings power, through the cycle — methodology/header
  - The window label contradicts the computation. The header and method cite '2016-2024' and 'the median owner-earnings margin of the 5 owner-earnings years on record (2016-2024).' But 2016-2024 spans nine years, all with OE values, and the 23.8% median arises only from the trailing five (2020-2024); the median of all nine 2016-2024 OE margins is -55.9%. Describing a trailing-5-year basis as 'across 2016-2024' and counting '5 owner-earnings years' for a 9-year span misstates what was actually averaged.

### CAT  (2 high, 6 total)
- **[high]** What it is — Vital signs strip
  - Gross margin shown as 97% TTM / 86% 5-yr avg is impossible for a machinery maker (SIC 3531); the underlying filing line itself reports the corrupted grossMargin(rev-cogs) 100% for FY2025.
- **[high]** The record, 2016–2025 — Gross margin row
  - Gross margin row jumps 30% (2021) to 99% (2022) then ~100%, while operating margin is flat (13.5% to 13.3%) and SG&A/R&D unchanged — an arithmetically impossible 69pt gross jump with no offsetting move; the 2022–2025 and TTM gross-margin values are corrupted.
- **[medium]** Is it a good business?
  - Page states 'median 17%' for ROIC, but the actual median of the series (2,8,21,20,11,16,17,28,26,20) is 18.5%; 17% is the arithmetic mean (16.9%), mislabeled as the median.
- **[medium]** Owner-earnings bridge (FY2025)
  - Prose says the business 'turned $8.9B of profit into $8.9B of owner earnings — more cash than the profit line showed,' yet both displayed figures are $8.9B and the bridge walks $8.9B -> $11.7B CFO -> $8.9B, ending where it started; 'more cash' contradicts the equal figures on the same panel.
- **[low]** Current Position — Deeper floors (Net current asset value)
  - The -$28.3B figure is current assets $48.6B minus total liabilities $76.8B (correct NCAV), but the label reads 'current assets less all debt'; current assets less all debt ($31.4B incl. leases) would be +$17.2B, so the label misdescribes the number and breaks reconciliation.
- **[low]** Earnings power, through the cycle
  - Panel header promises 'latest annual revenue, set beside the latest reported figure,' and normalized $8.0B uses FY2025 annual revenue $67.6B, but 'Latest, reported $9.5B at 13.4%' is the TTM column (13.4% x $70.8B TTM ≈ $9.5B), not the FY2025 annual reported owner earnings of $8.9B (13.2%); the comparison mixes annual-normalized vs TTM-reported and overstates the reported side.

### PLD  (2 high, 6 total)
- **[high]** The record, 2016-2025 -> Total debt (and dependent rows)
  - Total debt 2021 is shown as "$215M", collapsing two orders of magnitude between 2020 ($16.8B) and 2022 ($23.9B) and snapping back. This bad input corrupts the 2021 column: Net debt flips to a false ($341M) net-cash position, Debt/assets is left blank (only year missing; neighbors ~28-30%), and Interest coverage inflates to a decade-high 12.0x because near-zero debt understates the interest bill.
- **[high]** Is it a good business? (Owner's Scorecard) vs The record (FFO rows) vs What the price implies
  - The same metric (FFO) for the same FY2025 is reported two ways and never reconciled: Scorecard removes property-sale gains (NAREIT) -> FFO $5.3B, $5.56/sh, 71% payout; the Record row does not remove gains -> FFO $6.0B, $6.22/sh, 63% payout; the price section carries the gains-included $5.99/sh. A reader sees FFO/share as $5.56, $5.99, and $6.22 and payout as both 71% and 63% for the same period.
- **[medium]** What the price implies (footnote on FFO method)
  - The price-section footnote states the FFO it uses "removes property-sale gains, the NAREIT method," but the $5.99/share it feeds the valuation is the gains-included figure; the Scorecard, which actually removes the $636M of gains, yields a lower $5.56/share. The valuation is therefore built on a number that contradicts the methodology stated next to it.
- **[medium]** Is it sound? (Interest coverage) vs The record (Interest coverage row)
  - The identical line item "Interest coverage" for FY2025 shows 7.0x in the Scorecard and 4.3x in the Record, ~63% apart, with the Record row carrying no basis label. The Scorecard discloses an EBITDA basis; the Record is on an EBIT basis, so a reader scanning for the coverage figure gets two very different unreconciled answers.
- **[medium]** What the price implies (assumptions / dials)
  - The shipped default dials set FFO/share growth (8%) equal to the discount rate (8%), so the page's own justified-multiple formula 1/(discount rate - growth) = 1/(0.08-0.08) divides by zero / diverges to an infinite multiple. The worked example switches to 3% growth to stay valid; the Gordon perpetuity requires g < r, which the default violates.
- **[low]** What the price implies (FFO/share growth)
  - The dial is labeled "8%/yr 6-yr record," but the realized 6-year FFO/share growth is ~7.0%/yr ($4.14 in 2019 to $6.22 in 2025), or ~6.4%/yr using the $5.99 TTM endpoint. The ~8% figure is only defensible for the full 10-year record ($3.06->$6.22 = 8.2%/yr), not the 6-year window cited.

### AAPL  (2 high, 5 total)
- **[high]** Earnings power, through the cycle — verdict line
  - The verdict 'this year's margin sits close to its through-cycle average... not a peak or a trough' is contradicted by the page's own displayed 'Latest, reported' margin of 28.6%, which is +3.5pp above the stated 25.1% through-cycle average and exceeds the top of the page's own annual record max (28.3%, line 135) — the figure shown is the highest margin anywhere, a peak.
- **[high]** Earnings power, through the cycle — Normalized vs Latest reported
  - Period mismatch presented as like-for-like: normalized OE ($104.5B = 25.1% median margin x FY2025 annual revenue $416.2B) is set beside 'Latest, reported $129.2B at a 28.6% margin this year,' but $129.2B/28.6% are the TTM Mar 2026 values (lines 132/135), not FY2025. FY2025's actual reported OE is $98.8B at 23.7%, so a TTM figure is labeled 'this year' and current earnings power is overstated ~24% ($129.2B vs $104.5B).
- **[medium]** Earnings power, through the cycle — Owner-earnings margin range
  - The stated range '22.6% – 28.3% across the record' is the min/max of the FY2016–2025 annual OE margins, but the 'Latest, reported' margin highlighted in the same section (28.6%, TTM) falls OUTSIDE that range, so the range does not contain the current figure it is meant to contextualize.
- **[medium]** Current Position — Deeper floors — Net current asset value
  - Label misdescribes its own figure: -$120.5B = current assets ($144.1B) minus TOTAL LIABILITIES ($264.6B = $371.1B assets − $106.5B equity), the correct Graham net-net, but the gloss says 'current assets less all DEBT.' Debt incl. leases is only $95.2B (line 252), so 'current assets less all debt' computes to +$48.9B, not −$120.5B — misleading anyone recomputing as written.
- **[medium]** Is it a good business? (under The business in brief) — ROIC median
  - The headline 'median 42%' is arithmetically wrong: the 10-year ROIC series (line 147) is 24,21,32,37,42,64,73,71,76,87; its median is the average of the 5th and 6th ordered values (42 and 64) = 53%, not 42% — 42% is merely the FY2020 point value. The 'above 15% in 10 of 10 years' part is correct, but the median statistic understates central tendency by 11 points.

### MCD  (2 high, 5 total)
- **[high]** The record (Depreciation row) → Owner earnings / Owner-earnings bridge
  - Owner earnings is computed as CFO minus the depreciation line as maintenance capex (verifiable every year, e.g. FY2025 $10.6B CFO - $0.457B = $10.1B; FY2018 $7.0B - $0.215B = $6.8B). But the depreciation series collapses 6.5x from $1.4B (2017) to $215M (2018) and stays $0.2-0.46B while revenue, operating income and net PP&E ($28.2B) all rise — implying a ~62-year asset life on restaurant assets. The post-2018 figure is a mis-extracted partial line, and using it as maintenance capex inflates owner earnings, the page's central metric, and the owner-earnings margin used downstream.
- **[high]** Is it a good business? / The business in brief
  - The page states 'roughly 32% of revenue reaches owners as cash, consistently,' but the page's own owner-earnings-margin row shows 17.2% (2016) and 18.4% (2017) — barely half of 32% — then steps up to 30-38% from 2018 onward (a 1.73x jump), in lockstep with the depreciation-line discontinuity. The history is not 'consistent'; it steps up once, and the step is an artifact of the depreciation/maintenance-capex break.
- **[medium]** Earnings power, through the cycle
  - The line reads 'Latest, reported $10.1B at a 36.7% margin this year,' but the section explicitly works off the latest annual revenue ($26.9B, FY2025) and the $10.1B is the FY2025 owner-earnings figure; $10.1B / $26.9B = 37.5%, which equals the table's FY2025 OE margin. The 36.7% is the TTM (Mar 2026) OE-margin column, so a FY2025 dollar figure and FY2025 revenue base are mislabeled with a TTM margin — an internal period mismatch within one line.
- **[medium]** Earnings power, through the cycle
  - The section says 'this year's margin sits close to its through-cycle average … not a peak or a trough,' but the latest OE margin (37.5% FY2025, or 36.7% TTM) sits at the 94th-98th percentile of the stated 17.2%-37.9% range and is the second-highest of the ten annual readings; the section's own reported owner earnings of $10.1B are ~13% above its normalized $8.9B. Calling a near-record, top-of-range reading 'representative … not a peak' understates how elevated the latest figure is.
- **[low]** What it is (Revenue header)
  - The header reads 'Revenue · FY2025 $26.9B +3.7% YoY,' but the record table shows FY2024 $25.9B and FY2025 $26.9B, which is +3.86% (rounds to +3.9%), not +3.7%. The headline YoY and the table's own two figures do not reconcile — a minor but genuine internal inconsistency.

### APLD  (2 high, 5 total)
- **[high]** Current Position → Deeper floors (Debt incl. leases)
  - The 'Debt incl. leases $70M ($63M operating leases)' line sits in the Current Position block dated Feb 28, 2026 ('where it stands today'), but $70M − $63M leases = $7M, exactly the stale FY2025 totalDebt, while the same page's TTM/Feb-2026 column shows total debt $2.6B and net debt $864M — understating true leverage by ~37x in a distress-overlay survival section.
- **[high]** The record, 2021–2025 → Depreciation (TTM column)
  - Depreciation is shown as ($29M), i.e. negative, only in the TTM/Feb-2026 column, while every prior year is positive ($1K, $1M, $7M, $21M, $17M). Depreciation is a cost/add-back and cannot be negative; with net PP&E ~$1.3B and growing it should be +$29M. This is a sign error in the depreciation cell.
- **[medium]** Is it a good business?
  - States ROIC 'median −41%' for the record, but the four annual ROIC values (2022–2025: −41%, −111%, −21%, −3%) have a true median of −31% and a mean of −44%; −41% is neither — it is just the single 2022 value. The below-hurdle verdict still holds, but the cited median is arithmetically wrong.
- **[medium]** Earnings power, through the cycle
  - The 'Latest, reported (−$1.8B) at a −567.2% margin this year' headline falls outside the 'Owner-earnings margin, the range −92.0% – 93.2% across the record' shown immediately beside it, so the displayed latest value contradicts the range presented on the same panel.
- **[medium]** Current Position → Deeper floors (Net current asset value)
  - Net current asset value (−$1.3B) is labeled 'current assets less all debt,' but it reconciles to no debt figure the page shows: CA $2.4B − $70M debt = +$2.33B, and CA − Feb-2026 total debt $2.6B = −$0.2B. −$1.3B implies ~$3.7B of claims subtracted (≈ current liabilities + total debt), inconsistent with both the 'less all debt' label and the '$70M debt' line two rows below.

### WFC  (2 high, 5 total)
- **[high]** Is it a good business? (ROE) + Vital signs
  - The scorecard's 12% 'Adequate' ROE uses FY2019 net income $21.3B / equity $181.1B (=11.8%), but the same page's record table and history block both show FY2019 net income $19.7B and equity $187.1B (=10.5%), which the record itself displays as ROE 11%. The page thus carries two contradictory FY2019 net income figures, and the 12% headline sits at the exact threshold the prose says ROE cleared in 0 of 4 years.
- **[high]** The record — Shares out (diluted) / BVPS / TBVPS, and What the price implies
  - Diluted shares are shown falling 4.43B (FY2019) to 3.12B (TTM Sep 2020), a ~30% drop in three quarters while equity falls only ~5% (187.1B to 178.4B) — internally implausible. This bad input mechanically produces EPS $6.96, BVPS $57.22 and TBVPS $48.83, and then feeds the valuation section verbatim ('Tangible book $152.2B on 3118M shares').
- **[medium]** The record, 2016–2019 — Revenue
  - The record table's FY2019 revenue $86.8B contradicts every other FY2019 revenue figure on the page — the 'What it is' headline ($85.1B), the history block ($85.1B) and the underlying latest-year data ($85.1B). The record also shows TTM ($85.0B) below 2019 ($86.8B), whereas elsewhere 2019 is the revenue low.
- **[low]** What it is — Revenue
  - The page labels the revenue trend a '5-yr CAGR' of -1%, but only four years of revenue (2016–2019) exist in the data, so a 5-year CAGR is uncomputable (it needs a 2014 base). The -1% actually corresponds to the 3-year 2016->2019 CAGR (-1.2%).
- **[low]** Efficiency ratio (scorecard vs vital signs vs record)
  - The scorecard's 66% efficiency ratio is not reproducible from its own stated inputs: noninterest expense $54.8B / (NII $47.5B + fees $39.5B = $87.0B) = 63%, and over total revenue $85.1B = 64% — neither is 66%. The three 'current' reads (65% vital signs, 66% scorecard, 67% record) also disagree.

### AFL  (2 high, 5 total)
- **[high]** The record, 2016–2025 — Float (reserves) row
  - The Float (reserves) row reads $4.0–$5.2B for 2016–2022 then jumps to $83.7B in 2023 (a +1,720% one-year change), stitching two different liability items into one series; only the 2023–2025 values ($83.7/$70.4/$62.3B) are consistent with the filing, and FY2025 $62.3B exactly matches lossReserves $62.3B.
- **[high]** Vital signs strip — Investment yield on float (5-yr avg 35.2%)
  - The displayed 5-yr-average investment yield of 35.2% is facially impossible for a bond-heavy life insurer; it is a computational artifact of dividing ~$3.7–$4.1B investment income by the broken Float row, which yields ~79%/80% for 2021/2022 and dominates the average shown next to a current 6.8%.
- **[medium]** Revenue header and The record — Revenue row (FY2025)
  - Page reports FY2025 revenue $17.6B (≈ premiums $13.5B + investment income $4.1B, ignoring net realized losses) versus the filing's $17.2B, overstating revenue by ~$0.4B (+2.3%) and understating the decline: the page's −6.9% YoY (17.6 vs 18.9) overstates the true −9.0% (17.2 vs 18.9) from the filing.
- **[low]** Is it a good business? vs Vital signs — investment yield (6.5% vs 6.8%)
  - The same 'on the float' investment yield appears as two numbers on one page: 6.8% (TTM, 4.1/59.5=6.89) in the vital-signs strip and 6.5% (FY, 4.1/62.3=6.58) in the scorecard, on different undisclosed denominators, and 6.58% rounds to 6.6%, not the 6.5% shown.
- **[low]** Vital signs (ROE 15%) vs Is it a good business? (ROE 12%)
  - Two different return-on-equity figures sit under the same label on one page — 15% in the marquee strip (TTM, matching the record's TTM column) and 12% in the scorecard ($3.6B/$29.5B=12.2%, FY2025) — with no flag of the TTM-vs-FY basis difference.

### BX  (2 high, 5 total)
- **[high]** What the price implies (reverse-DCF) — owner-earnings growth
  - Page shows '−6%/yr (5 yr)' beside '+108%/yr (since FY2018)' as 'the owner-earnings growth the record actually delivered.' The two are mutually contradictory and both are cherry-picked-anchor artifacts: FY2018 OE was $27M (a near-zero trough between −$1.7B in 2017 and +$1.9B in 2019), so +108%/yr is pure base effect; and a true 5-yr window FY2021 $3.9B→TTM $4.4B is positive (~+2.4%/yr), FY2020→TTM is +18%/yr, so −6%/yr only arises by anchoring to the FY2022 ~$6.3B peak.
- **[high]** Does AI threaten the moat?
  - Page declares 'A competitive risk — new this year' and that the 10-K 'names artificial intelligence as a competitive threat,' but its sole supporting quote — 'concerns regarding impact of artificial intelligence-driven disruption weighed on equity capital markets' — is a market-sentiment observation, not a company-specific competitive/moat risk to Blackstone's fee franchise. The verdict rests entirely on mismatched evidence.
- **[medium]** The business in brief — 'Is it a good business?' (embedded computed figure)
  - The line states ROE 'has run near 24%' while asserting 'every number is arithmetic on those filings,' yet 24% is only the single earliest FY2018 data point. The record is 24/29/16/62/23/20/34/35% (mean ~30, 5-yr avg ~35), the vital-signs strip shows 36% / 35% 5-yr avg, and the scorecard shows 35% 'Exceptional' — so 'near 24%' is internally inconsistent and understates the franchise.
- **[medium]** What the price implies (reverse-DCF) — assumptions footnote
  - Footnote states net debt $11.0B, but total debt $12.6B − cash $2.6B = $10.0B (or $10.2B using TTM cash+investments $2.4B). The stated figure is ~$1B higher than the data supports, overstating net debt and understating per-share value; any lease-liability add-back is undisclosed and not in the data.
- **[low]** What it is — Revenue header
  - Header reads '$14.5B +9.2% YoY,' but the record line shown just below it ($13.2B FY2024 → $14.5B FY2025) computes to +9.8% for a reader. The headline visibly disagrees with the page's own displayed record; it reconciles only with unrounded inputs near the low edge of the rounding band.

### GOOGL  (2 high, 4 total)
- **[high]** The record — Owner earnings row (and downstream: Owner-earnings margin, vital-signs OE margin, Earnings-power normalization)
  - Owner-earnings formula changes mid-series: 2016-2020 OE = OpCash − Capex, but 2021-TTM OE = OpCash − Depreciation (capex ignored). Since capex ($91.4B FY2025) is ~4x depreciation ($21.1B), the switch nearly doubles recent OE — FY2025 shows $143.6B/35.6% vs a consistent OpCash−Capex of $73.3B/18.2%. This contradicts the page's own 'Situation' note that capex surged to 23% of sales.
- **[high]** The record — Owner-earnings margin row
  - The displayed rising trend to 35.6%/35.8% is an artifact of the definition break, not real owner economics. On a consistent OpCash−Capex basis margins are flat-to-falling into the high teens (28.6, 21.6, 16.7, 19.1, 23.5, then 26.0, 21.2, 22.6, 20.8, 18.2, TTM 15.3) — the opposite of the displayed climb, during a build-out the page itself flags as a risk.
- **[medium]** What it is — Vital signs (Owner-earnings margin vs ROIC)
  - In the same vital-signs strip the two capital-return measures contradict: ROIC falls (22% vs 27% 5-yr avg, the honest signal that capex is depressing returns) while Owner-earnings margin rises (36% vs 31%). The 36% is the inflated figure (subtracts only depreciation, not the capex pulling ROIC down), so it overstates cash economics and conflicts with the ROIC beside it.
- **[medium]** Earnings power, through the cycle
  - (1) Both figures inherit the inflated post-2021 definition; on a consistent OpCash−Capex basis the median through-cycle margin is ~21% (normalized ~$86B), not 28.1%/$113.2B, and 'latest reported' cash is ~$73B (FY) / ~$64.5B (TTM), not $151.2B. (2) Mismatched bases: 'normalized' applies the median margin to FY2025 annual revenue ($402.8B), while 'latest reported' $151.2B at 35.8% is the TTM figure on $422.5B, not the latest fiscal-year OE ($143.6B at 35.6%) — not apples-to-apples.

### STWD  (2 high, 4 total)
- **[high]** The record, 2016–2025 — Income statement — Revenue (TTM column)
  - TTM (Mar 2026) Revenue cell reads $260M after FY2025 $1.8B — an implied ~85% revenue collapse unsupported by the data; $260M is exactly FY2025 net interest income (BANK: netInterestIncome $260M), so the cell was populated with NII, not revenue. All other TTM cells (net income $351M, EPS $0.96, ROE 5%, assets $62.1B) are internally consistent, isolating $260M as the error.
- **[high]** Is it sound? — Leverage (debt / equity)
  - The card shows 2.5x (debt $17.0B / equity $6.8B) while its own prose says the REIT 'runs far more leverage than an operating company' and elsewhere 'levered many times over.' True balance-sheet leverage is ~9.3x assets/equity ($63.2B/$6.8B) and ~8.3x liabilities/equity; the $17.0B debt line omits most of the $56.4B of repo/securitized funding. 2.5x is actually lower than many operating companies, directly contradicting the page's narrative and understating leverage.
- **[medium]** Is it sound? — Credit cost (provision / NII)
  - (1) Arithmetic: with the page's own stated inputs $4M / $260M = 1.54%, which rounds to 2%, not the 1% displayed. (2) Sourcing: the scorecard header reads 'FY2025 10-K,' yet in The Record the FY2025 provision is blank ('—'); the $4M used matches only the TTM column, so a TTM figure is presented under an FY2025 header.
- **[medium]** Is it sound? — Capital (equity / assets)
  - The verdict 'Well capitalized' and the explanation ('how much loss the bank can absorb before depositors are at risk') are deposit-bank template language inapplicable to this mortgage REIT, which the filing shows has no deposits (deposits —). There are no depositors to protect, so the rationale attached to the metric is factually wrong for this entity.

### LCID  (2 high, 4 total)
- **[high]** Owner-earnings bridge (FY2025)
  - The 'gap is investment, not weakness / the business earns well more than this year's free cash flow shows' template is materially misleading here: owner earnings are -$3.4B (a ~-250% margin) and even at zero growth capex FCF stays -$3.4B; the $417M growth capex is only ~11% of the FCF shortfall. The real driver is the -$2.9B operating cash burn. The template implies hidden positive earnings power that does not exist.
- **[high]** Is it a good business?
  - Owner earnings were not 'thin' (small/barely-positive); they were deeply negative every single year (-$340M, -$1.0B, -$1.5B, -$2.4B, -$2.7B, -$2.3B, -$3.4B) with margins around -250%. Calling a persistent multi-billion-dollar cash drain 'thin' badly understates the result and misleads.
- **[medium]** Current Position - Deeper floors (Net current asset value)
  - Label 'Graham's net-net: current assets less all debt' misstates the definition (Graham's NCAV is current assets minus all liabilities, ~-$5.05B). The displayed -$2.7B matches neither the true definition (-$5.05B) nor the literal label (CA - debt ~ -$0.3B); it reconciles only to current assets - current liabilities - total debt, which double-counts the $707M current portion of debt already inside current liabilities.
- **[low]** Is it a good business?
  - The -54% ROIC median only reconciles to a five-point window that includes the TTM column ([-44,-45,-54,-113,-176]), yet the stat is framed as '4 years'. The four fiscal-year values FY2022-FY2025 (-44,-45,-54,-113) have a median of -49.5%, not -54%. Median over 5 points described with a 4-year denominator.

### DUK  (2 high, 3 total)
- **[high]** Current Position — narrative under the ratios
  - The page frames Duke's sub-1 current ratio as 'likely structural strength' because it 'collects from customers before it pays suppliers... the way Costco's and Amazon's are.' This is a retailer-float template misapplied to a regulated electric utility (SIC 4931; 'state regulators... decide what return Duke may earn'). Duke bills in arrears — receivables ran $2-3B for nearly the entire 2011-2025 history — so it does NOT collect before it pays. The sub-1 ratio is driven by $7.4B of debt due within a year against $2.1B cash on $89.8B total debt, i.e. refinancing exposure, which the page's very next line concedes ('cash alone won't cover the maturities — it leans on refinancing or operating cash'). The narrative reframes balance-sheet leverage as a virtue for a Graham/Buffett audience.
- **[high]** Current Position — Receivables (and Balance sheet: Receivables row in The record)
  - Receivables shown as $16M for FY2025/TTM, down from $1.9B (2024) and $3.0B (2023) — a 99% collapse implying ~0.2 days DSO on $31.7B of revenue, which is physically impossible for a utility billing customers monthly in arrears. It is displayed as fact in both the Current Position list and the record, and it propagates: operating working capital swings to -$5.2B in 2025 (from -$3.5B in 2024), with the ~$1.9B receivables drop accounting for essentially the entire ~$1.7B swing. It is also the only quantitative support for the 'collects before it pays' float story.
- **[low]** Current Position — Deeper floors: Debt incl. leases
  - 'Debt incl. leases' is shown as $89.1B with '$1.3B of it operating leases,' yet plain Total debt in the record is $89.8B (FY2025 and TTM). A figure labeled as INCLUDING leases cannot be $0.7B lower than total debt; adding ~$1.3B of leases to $89.8B should give roughly $91.1B. The two figures are mutually inconsistent.

### 8031  (2 high, 3 total)
- **[high]** Durability & moat, 2022–2026
  - Page states "Share count +14.9%/yr — the share count is rising, dilution works against you," but the same page's capital-allocation section says the diluted count FELL -12.8% (3285M to 2865M); shares implied by both Net income/EPS and Equity/BVPS fall (~-2.4%/yr). The +14.9% equals the BVPS CAGR (14.5%), a wrong-series/sign bug, and the dilution verdict is the literal opposite of the truth (¥1.18T of buybacks).
- **[high]** The record, 2022–2026 — Net debt / (cash) row
  - FY2024 net debt is shown as (¥898.2B) net cash, which equals exactly the negative of FY2024 Cash+investments (¥898.2B) — i.e. computed treating total debt as zero — yet the FY2024 Total debt cell is blank "—" (not extracted). FY2025 debt is ¥3.94T, so Mitsui plainly carried multi-trillion-yen debt; showing FY2024 as net cash materially understates leverage. When debt is unknown, net debt should be blank, not net cash.
- **[medium]** Durability & moat, 2022–2026 — Owner earnings growth
  - "Owner earnings -23%/yr — shrank about 23% a year" is a meaningless CAGR: the series 621.4, 819.5, 569.6, 671.4, (155.5) ends negative, so a compound rate is undefined and the -23% is an artifact of anchoring on a single collapsed final year driven by a one-off capex spike (346.1B->1.11T). The page's own Earnings-power section calls FY2026 "a lean year" that "may understate the business"; FY22->FY25 owner earnings were roughly flat (~+2.6%/yr), so the steep secular-decline claim contradicts the page's own normalized read.

### AMT  (2 high, 2 total)
- **[high]** Current Position — current-ratio interpretation
  - The page calls the sub-1 current ratio 'likely structural strength... funded by float, the way Costco's and Amazon's are... the edge, not the risk,' but its own numbers refute the float story: current liabilities $9.7B are 63% short-term debt maturities ($6.1B) and only 2.3% accounts payable ($221M). The negative-cash-conversion/supplier-float framing requires payables to dominate; here debt maturities do. The very next displayed line concedes 'cash alone won't cover the maturities — it leans on refinancing,' and recent quarters show 0.6x to 0.3x, contradicting the benign read on the survival question.
- **[high]** The record (FY2025) vs. Is it sound? — Total debt / Debt-to-assets
  - Two different FY2025 totals for the same line item: the ten-year record shows Total debt $37.2B for FY2025, while 'Is it sound?' shows $42.3B (a $5.1B gap). The underlying filing data states FY2025 totalDebt = $42.3B, so the record's $37.2B is wrong. It propagates: the record's FY2025 debt/assets of 59% ($37.2B/$63.2B) reads as deleveraging (below the 62% 5-yr avg), while the quality section's 67% ($42.3B/$63.2B) is labeled 'Heavy.' The wrong $37.2B also makes the debt path 36.5 to 37.2 to 45.0 TTM imply an implausible +$7.8B one-quarter jump that shrinks to +$2.7B if the correct $42.3B is used.

### 9697  (2 high, 2 total)
- **[high]** How is the cash used? -> Where do the earnings go?
  - The 101% payout card uses ¥17.8B as the denominator and labels it 'Owner Earnings', but the page's own record table, owner-earnings bridge, and 'Is it a good business?' card all define FY2026 Owner Earnings as ¥26.2B and explicitly label ¥17.8B as Free Cash Flow (OE ¥26.2B − ¥8.4B growth capex). Using FCF while calling it Owner Earnings contradicts the page itself and inflates payout; against true OE ¥26.2B the payout is ¥17.9B/¥26.2B = 68%, not 101%.
- **[high]** Earnings power, through the cycle (Normalized owner earnings)
  - The card labels Capcom 'a cyclical' having 'a lean year' with the reported figure 'set in a lean year', but FY2026 is a record-profit year: net income at an all-time high (¥32.6B->¥54.6B, rising every year), operating income at a high (¥65.8B->¥75.3B), operating margin flat (~39%), ROE stable (22/23/22/22/21%). The only thing that swings is the owner-earnings margin, and the FY2026 dip is driven by the −¥28.4B 'working capital & other' line, which the page's own bridge attributes to cash-timing / investment income booked through investing rather than operations. Calling a record year 'lean' and a smooth compounder 'a cyclical' mislabels a cash-timing artifact as business cyclicality and contradicts the page's own narrative.

### O  (1 high, 5 total)
- **[medium]** "Is it sound?" scorecard vs. "The record" — Interest coverage
  - The page shows two interest-coverage numbers on undisclosed different bases that give opposite impressions: the scorecard reads "4.8x / Strong" (EBITDA-based: (963M+2,500M)/730M=4.74x) while the record row collapses to 1.1-1.3x (EBIT-based: FY2025 963M/730M=1.32x, matching the record's recent 1.1-1.3x and TTM 1.1x). Same interest bill, ~4x apart, with no reconciliation shown — a reader cannot tell why the same metric reads 4.8x in one place and 1.1x in another.
- **[high]** What the price implies — dial note "FFO / share, delivered 5%/yr 6-yr record"
  - The 'delivered 5%/yr over a 6-yr record' claim is unsupported by the FFO/share history (1.97, 1.92, 2.05, 2.14, 1.95, 1.96, 3.98, 3.96, 3.63, 3.75). No 6-year window produces ~5%/yr — every 6-year window lands at 9.8%-12.8% (2019->2025=9.8%, 2018->2024=10.0%, 2017->2023=12.8%), while the post-merger 2022->2025 window is -2%/yr. The figure merely echoes the 5% growth dial rather than reporting any realized rate.
- **[medium]** What the price implies — justified-multiple explanation
  - The worked example states "at an 8% discount and 3% growth, a REIT is worth about 20x FFO" (1/(0.08-0.03)=20x, internally correct), but the live dial defaults to 5% growth, which gives 1/(0.08-0.05)=33x. The explanatory ~20x anchor does not correspond to the 5% growth dial set right beside it, so the reference number a reader is handed contradicts the assumption the page is actually running.
- **[medium]** "Is it a good business?" vs. valuation — FFO/share growth
  - The page reports two different growth rates for the same metric: "Is it a good business?" says funds from operations per share have been "roughly flat (3% a year)," while the valuation section says FFO/share "delivered 5%/yr." The same FFO/share series cannot be both 3%/yr and 5%/yr, and neither is well grounded (full-period 2016->2025 is ~7.4%/yr, distorted by the 2021->2022 merger doubling 1.96->3.98; organic post-merger 2022->2025 is ~-2%/yr).
- **[low]** The record — Interest coverage row
  - The record blanks interest coverage for FY2024 and FY2025 yet still publishes a TTM (Mar 2026) value of 1.1x. The TTM window is dominated by FY2025 quarters (TTM revenue 5.9B vs FY2025 5.7B), so if TTM coverage is computable the FY2025 inputs plainly exist — making the blanked recent fiscal years look unavailable when they are not.

### NLY  (1 high, 5 total)
- **[high]** Is it sound? — Leverage (debt / equity)
  - Page displays Leverage (debt/equity) 0.0x (Debt $430M / equity $16.1B = 0.027x) while its own prose says a mortgage REIT 'runs far more leverage than an operating company.' Real economic leverage is assets $135.6B / equity $16.1B = 8.4x; ~$119.5B of repo liabilities are excluded from totalDebt. The 0.0x read directly contradicts the explanation for the most-levered business model in finance.
- **[medium]** Is it a good business? — Return on equity vs Return on tangible equity
  - The identical displayed return earns two different verdicts: ROE 13% labeled 'Adequate', ROTE 13% labeled 'Strong'. ROE=2.0/16.1=12.42% and ROTE=2.0/(16.1-0-0.007)=12.43% are equal to within 0.01pp (intangibles only $7M on $16.1B), and both render as 13% — so the same number is graded two ways, signaling a threshold/labeling bug.
- **[medium]** What it is — Revenue · FY
  - The 'Revenue · FY' header shows $1.1B, but the filing carries revenue '—' (none); $1.1B is exactly the netInterestIncome line. Two proofs it isn't revenue: it equals NII exactly, and operatingIncome $6.8B cannot exceed revenue if $1.1B were the top line. NII is being mislabeled as Revenue.
- **[medium]** Vital signs / What it is / Owner's Scorecard headers
  - A null fiscal year leaks into user-facing labels: the page prints 'Vital signs · FYnull' and 'Revenue · FY' with a blank year, yet the AI section knows the period ('Its FY2025 10-K names artificial intelligence as a competitive threat'). The year exists (2025) but renders as literal 'FYnull'/blank in the strip headers — a visible display defect.
- **[low]** Is it a good business? — Return on equity
  - The shown basis does not reproduce the shown result: 'Net income $2.0B ÷ equity $16.1B' = 12.42%, which rounds to 12%, but the line displays 13%. The 13% comes from an unrounded NI (~$2.09B) used before rounding to '$2.0B' for display, so a reader doing the displayed division lands on 12% and the line is self-inconsistent.

### ABSI  (1 high, 5 total)
- **[high]** The business in brief / Situation (computed overlay)
  - The distress overlay text frames the company around 'real debt across the record' and a 'maturity wall' as the 'first questions', but total debt is only $4M, net cash is $127M, current ratio 6.6x, and the page's own 'Will it survive?' read concludes the company 'owes nothing, and can act from strength.' There is no debt distress or maturity wall; the real survival issue is cash burn/runway (1.3 yrs), not leverage.
- **[medium]** Is it a good business? (early verdict under 'What it is')
  - The page says owner earnings 'have been thin too', but owner earnings were deeply negative every year on record (-$13M, -$99M, -$98M, -$65M, -$73M, -$94M; -$99M TTM; OE margins -275% to -5365%). 'Thin' implies small/near-breakeven and materially understates six straight years of heavy cash burn.
- **[medium]** Current Position — Deeper floors / Net current asset value
  - The label reads 'Graham's net-net: current assets less all debt,' but the displayed $108M actually equals current assets $132M minus TOTAL liabilities (~$24M = assets $196M - equity $172M). Current assets less debt ($4M, or $8M incl. leases) is $128M/$124M, not $108M, so the (correct) number contradicts its own definition text and would mislead a reader checking the math.
- **[low]** Is it a good business? (early verdict) / lens
  - The capital-intensive 'heavy physical assets / price-taker territory / cyclicality the enemy / downturn on a fixed-cost base' lens is mismatched to ABSI (SIC 8731 AI antibody drug discovery), which runs trivial capex ($0.4M-$1M in the last three years) with ~67% of assets in cash/investments. Its fate is clinical/regulatory/financing-driven, not 'the cycle'; the framing mislabels a pre-commercial cash-burner as a cyclical asset-heavy operator.
- **[low]** Is it a good business? — Return on invested capital
  - The section states the latest/most-recent ROIC as -55% (NOPAT $95M / invested capital $173M = -54.9%), but the page's own record table shows FY2025 ROIC at -56% and TTM at -58%. The 'latest' figure shown does not match the latest column of the page's history table.

### FICO  (1 high, 4 total)
- **[high]** Earnings power, through the cycle
  - The normalized owner earnings ($569M = 28.6% through-cycle margin on FY2025 annual revenue of $2.0B) is set beside '$901M at a 39.9% margin this year,' but $901M @ 39.9% is the TTM (Mar 2026) figure, not FY2025. The record table and the Owner-earnings bridge both show FY2025 owner earnings = $770M at 38.7% ('turned $652M of profit into $770M'). So an annual-basis normalized number is compared to a TTM-basis reported number, 'this year' mislabels a TTM figure as annual, and it contradicts the page's own FY2025 number — inflating the flattery ratio from 1.35x ($770M/$569M) to 1.58x ($901M/$569M).
- **[medium]** Is it a good business?
  - The page says return on capital has a 'median 27%,' but the ten-year ROIC record (13,15,16,22,27,44,47,48,53,64 sorted) has a true median of (27+44)/2 = 35.5% (~36%). 27% is the 5th-of-10 value, not the median, understating central-tendency ROIC by ~8 points. (The 'above 15% in 8 of 10' part is correct.)
- **[medium]** Is it a good business?
  - Two defects. (1) 'roughly 26% of revenue reaches owners as cash' conflicts with the page's own figures: the OE-margin record (21.4,22.0,19.2,20.4,26.5,31.6,36.6,30.7,36.3,38.7) has median 28.6% — the exact through-cycle margin the Earnings-power section uses; 26%/27% is the lower-middle value, not the median. (2) 'consistently' is wrong: the series runs 19.2%-38.7%, roughly doubling from 2016 to 2025, and the Earnings-power section itself flags it as an uptrend ('paying on the reported figure is paying on a good year'). The margin is rising, not consistent.
- **[low]** Current Position — Deeper floors
  - Net current asset value is shown as -$3.2B labeled 'Graham's net-net: current assets less all debt.' The -$3.2B equals current assets ($901M) minus TOTAL liabilities ($4.1B = assets $2.0B - equity -$2.1B), so the number is the correct Graham net-net. But the label says 'all debt,' and using the page's own debt figures ($3.6B record / $3.7B incl. leases) gives -$2.7 to -$2.8B, which does not reconcile to -$3.2B. Only total liabilities reconciles, so the label does not describe what was subtracted.

### XOM  (1 high, 4 total)
- **[high]** Is it a good business?
  - Says 'roughly 6% of revenue reaches owners as cash, consistently,' but the OE-margin series swings -1.5% to 14.1% (stdev ~4.65 pts), with only 2 of 10 years near 6%. 'Consistently' is false and directly contradicts the page's own Situation note ('margins collapse repeatedly across the cycle') and Earnings-power text ('a wide swing: a cyclical, read it on the average').
- **[medium]** The record (Owner earnings / OE margin row, 2019)
  - OE is computed as operating cash minus capex, which holds exactly for all 9 other years, but 2019 shows $10.7B where 29.7-24.4=$5.3B (2.1% margin), not $10.7B/4.2%. The displayed $10.7B equals 2019 operating income, a data-mapping error; the OE and its margin agree with each other but conflict with the CFO/capex lines printed beside them.
- **[medium]** Earnings power, through the cycle
  - Inconsistent period mixing and an unsupported verdict: normalized OE is anchored to FY2025 revenue ($332.2B), but the 'latest, reported' figure beside it is the TTM ($18.8B/5.6%), not FY2025 ($23.6B/7.1%). FY2025's 7.1% margin is ABOVE the 6.6% through-cycle median, so 'this year's margin runs below its through-cycle average... set in a lean year' is false for the fiscal year that anchors the normalization; it is true only if 'this year' silently means TTM.
- **[low]** Current Position - Deeper floors (Net current asset value)
  - Label 'current assets less all debt' is wrong. The displayed -$105.6B requires netting ~$203B (essentially all liabilities; assets 464.4 - equity 254.4 = 210.0 total liabilities). Total debt is only $37.6B ($44.5B incl. leases), which would give a POSITIVE ~+$53-60B, not -$105.6B. The figure and fail-the-test verdict are correct; only the descriptor 'all debt' (should be 'all liabilities') is wrong.

### F  (1 high, 4 total)
- **[high]** The record, 2016–2025 (Owner earnings row, 2016 column)
  - Owner earnings is defined on the page (and in the bridge) as operating cash flow less capex. For 2016 that is $19.9B − $7.0B = $12.9B, but the row shows $17.7B — a $4.8B gap. The 11.7% OE margin equals 17.7/151.8 (12.9/151.8 would be 8.5%), confirming 17.7 was used. Every other year 2017–TTM ties exactly to CFO − capex, so only 2016 is internally inconsistent (and its $2.1B depreciation is an outlier vs $9.2B in 2017).
- **[medium]** Earnings power, through the cycle
  - Normalized $12.2B is the 6.5% through-cycle margin applied to FY2025 revenue ($187.3B), but 'Latest, reported $9.5B at 5.0%' is the TTM (Mar-2026) column — the record shows FY2025 owner earnings of $12.5B at a 6.7% margin. On a consistent FY2025 basis 6.7% is ABOVE the 6.5% normalized margin and OE $12.5B ≈ normalized $12.2B (roughly a normal year), so the 'below average / lean year / understates the business' verdict is an artifact of comparing a full-year revenue base against TTM owner earnings.
- **[medium]** Current Position — Deeper floors (Net current asset value)
  - The −$128.6B equals current assets $116.3B minus total liabilities $244.9B (= total assets $282.4B − equity $37.5B), i.e. current assets less ALL LIABILITIES — the correct Graham net-net. But the label says 'current assets less all debt,' and this same section lists debt as $2.7B; current assets less that $2.7B debt is +$113.6B, not −$128.6B. The label contradicts both the computation and the section's own debt figure.
- **[medium]** The record, 2016–2025 (Interest coverage row)
  - Implied interest expense (operating income ÷ coverage) cannot reconcile to one consistent definition on a stable book: ~$7.9B in 2023 (5.5/0.7) collapsing to ~$1.1B in 2024 (5.2/4.7) and ~$1.3B in 2025/TTM, versus ~$4.5–5.7B across 2018–2022. An ~86% one-year drop in interest expense (2023→2024) while operating income FELL (5.5→5.2), on a distress-tagged book with total assets rising $273B→$285B, is not credible, and the 2024 jump to 4.7× (second-best in ten years) implies the interest-expense inputs switch definition across years.

### UNP  (1 high, 3 total)
- **[high]** Earnings power, through the cycle
  - The 'Latest, reported $7.0B at a 28.5% margin this year' box uses the TTM (Mar 2026) column, while the normalization is explicitly applied to FY2025 annual revenue ($24.5B). FY2025's actual owner earnings are $6.8B at 27.8% (record table '25 column), and the Owner-earnings bridge immediately below states FY2025 owner earnings of $6.8B (28% of revenue). The same page thus reports 'the latest' owner earnings as both $7.0B and $6.8B, and calls it '28.5% margin this year' when FY2025's real margin is 27.8%. The two boxes coincide at $7.0B/28.5% only because TTM's 28.5% happens to equal the median (28.5%), propping up the 'representative of normal power' conclusion via a period mismatch.
- **[medium]** Current Position -> Deeper floors (Net current asset value)
  - The -$46.0B is current assets ($4.2B) minus total liabilities ($50.2B = assets $69.6B - equity $19.4B) -- the correct Graham net-net -- but the label says 'current assets less all debt.' Total debt incl. leases is $32.7B (shown on the adjacent line), so current assets less all debt = -$28.5B, not -$46.0B. The description misstates what is subtracted (all liabilities, not just debt) and is unreproducible from the figure it names.
- **[medium]** Is it a good business?
  - The displayed ROIC series is 13, 20, 16, 15, 14, 17, 17, 15, 16, 16. Values strictly above 15% number only 6 of 10 (2017, 2018, 2021, 2022, 2024, 2025); 2019 and 2023 are shown at exactly 15. 'Above 15% in 8 of 10 years' is reached only by treating 'above' as 'at least' (>=15). Against the very table the page invites the reader to check, the count is overstated.

### AMC  (1 high, 3 total)
- **[high]** Current Position — current-ratio interpretation
  - The page calls AMC's sub-1 current ratio 'likely structural strength... the edge, not the risk,' framing the negative working capital as virtuous self-funding float 'the way Costco's and Amazon's are.' This is materially misleading and gives false comfort.
- **[medium]** Current Position — Deeper floors, Net current asset value
  - The -$9.0B Net current asset value is glossed as 'current assets less all debt,' but that description does not match what was subtracted.
- **[low]** Earnings power, through the cycle — Latest, reported tile
  - The 'Latest, reported (-$124M) at a -2.5% margin this year' tile uses the TTM/Mar-2026 figure instead of the latest annual FY2025 figure, despite the section explicitly being an annual through-cycle read.

### WMT  (1 high, 3 total)
- **[high]** Where the money comes from — By geography
  - By geography shows United States 82% and International 19%, which sum to 101% — impossible for a two-way split. International ($130.4B / $706.4B) = 18.46%, which rounds to 18%, not 19%; the correct split is 82% + 18% = 100%. The 19% also contradicts the segment table directly above, which shows Walmart International (the same $130.4B) at 18%.
- **[medium]** Earnings power, through the cycle
  - Mixed basis. The normalized figure ($25.3B, 3.6% margin) is built on FY2026 ANNUAL revenue ($706.4B), but the paired 'Latest, reported $26.2B at 3.7% margin' is the TTM column (TTM rev $718.1B), not the FY2026 annual actual, which the record table shows as $27.4B at 3.9%. The like-for-like comparator to an annual-revenue normalization is $27.4B/3.9%, which sits ~0.3pp above the 3.6% norm; substituting the TTM 3.7% makes 'sits close to its through-cycle average' read tighter than the annual comparison supports.
- **[low]** What it is — Vital signs (Owner-earnings margin)
  - Owner-earnings margin is displayed as a whole-number '4%' when the TTM figure is 3.7% (per the record table's TTM column and the Earnings Power section). The whole-number rounding overstates it and uses coarser precision than the same panel's operating margin (shown 4.2% / 5-yr 4.1%); displaying '4% vs 3% 5-yr avg' reads as a ~1-point step-up when the true figures (3.7% vs a ~3.2% 5-yr avg) are essentially flat, and it clashes with the prose 'roughly 3% of revenue reaches owners as cash, consistently.'

### BLK  (1 high, 3 total)
- **[high]** Is it a good business? — Return on equity tile
  - The ROE tile labels a 10% return 'Below the cost of equity', but 5.6/55.9 = 10.0% sits ABOVE the only cost-of-capital anchor on the page (the reverse-DCF 'Discount rate 9%'), and the page's own narrative states the 4-yr avg ROE is 13% and that ROE 'has run near 13%' (record: 14/14/13/10/11). The verdict headlines the single trough year and contradicts the page's own figures.
- **[medium]** What the price implies (reverse-DCF) — Owner-earnings growth, delivered
  - 'Owner-earnings growth, delivered -0%/yr' rounds away a real multi-year decline. Owner earnings fell $4.5B (2022) -> $3.6B FY2025 / $3.7B TTM, a CAGR of about -7%/yr absolute and roughly -9%/yr per share (OE/sh 29.61 -> 22.36). Every record-endpoint window is clearly negative; only the 2022->2024 window (which drops the latest year) is positive. Showing it as ~0% flatters the track record that is the benchmark for the price-implied figure.
- **[low]** The record (section intro)
  - The intro says 'Here is the ten-year arithmetic, read for durability,' but the table immediately beneath is titled 'The record, 2022-2025' and displays only four fiscal years (2022, 2023, 2024, 2025) plus a TTM column. The 'ten-year' framing is contradicted by the adjacent subhead and the four-year data window actually shown.

### UNH  (1 high, 3 total)
- **[high]** Is it a good business? — Operating margin verdict
  - Operating margin 4.2% labeled "Healthy for a plan" is the decade-low in the record (2016-2024 ran 7.0/7.6/7.7/8.1/8.7/8.3/8.8/8.7/8.1; only FY2025 falls below 7%), roughly half the ~8% norm, and below the page's own 7.6% 5-yr avg, while net income collapsed from $22.4B (2023) to $12.1B. The unqualified positive verdict contradicts the deterioration the same page shows and its own note that 'a small miss on medical costs swings profit hard.' Materially misleading.
- **[medium]** Is it a good business? — Medical loss ratio verdict
  - MLR 89.1% labeled "Costs well-covered" is the worst level in the record, having climbed 82%->83%->86%->89% (2022-2025). For a health insurer a rising MLR is the squeeze — more of every premium dollar consumed by claims — so a reassuring label sits on the most adverse, worst-in-record point. The page's own text even says 'the recent Medicare Advantage squeeze shows up here first,' making the positive framing internally inconsistent.
- **[low]** Vital signs strip — Medical loss ratio 5-yr average
  - The strip labels MLR '5-yr avg 85.0%', but the record shows MLR only for 2022-2025 (82/83/86/89; 2016-2021 are dashes). Only four annual values exist and they average exactly 85.0%, so the '5-yr avg' figure is fed by 4 data points; even the trailing 5-year window (2021-2025) includes 2021 with no MLR. The window label does not match the data available.

### FAF  (1 high, 3 total)
- **[high]** The float — Investment income ("53.1% on the float")
  - The card divides $621M net investment income by the $1.2B loss/claim reserve to headline a 53.1% 'yield on the float,' but the income is earned on the whole portfolio (within $16.2B assets), not the reserve. The card's own explanation says the income is 'what the float AND capital earned,' contradicting a float-only denominator, and the card itself notes the true float is larger. The 53% pseudo-yield is economically nonsensical for a title insurer; also 621/1.2B = 51.7%, not 53.1% (53.1% only reconciles to an unrounded ~$1.169B float, not the $1.2B displayed).
- **[medium]** What the price implies / The assumptions — Normalized return on tangible equity
  - The '18% normalized' ROTE is essentially this year's near-peak return (NI $622M / $3.6B tangible book = 17.3%), not a through-cycle figure. The page's own 10-year record shows an 11% average ROE and the three prior years at 6%, 4%, 3% (NI $263M, $217M, $131M). Mid-cycle earning power is ~14% (avg NI ~$508M on $3.6B), ~12% ex-2021. For a demonstrably cyclical title insurer, labeling the peak as 'normalized' — and stating the model 'assumes the insurer keeps earning that return' — inflates the justified multiple to 2.14x vs ~1.5x at a defensible ~14%.
- **[low]** Is it a good business? — Combined ratio ("What this means")
  - The explanation says 'Premiums or claims weren't found in the filing data,' but claims incurred ($450M) ARE present in the filing data; only premiums earned is missing (shown as '—'). The 'Not enough data' verdict is correct, but the stated reason misidentifies the absent input — it should reference premiums only.

### ASML  (1 high, 3 total)
- **[high]** Is it a good business?
  - States ROIC 'median 28%, above 15% in 10 of 10 years', but the full 10-year ROIC series (15,19,23,21,28,74,96,69,71,84) has a true median of 48.5%. 28% is only the median of the 9-year 2016-2024 window (which excludes 2025), contradicting the same sentence's '10 of 10 years', and it sits directly under the vital-signs strip showing ROIC 84% / 5-yr avg 79% — materially understated and internally inconsistent on the key quality metric.
- **[low]** The record, 2016-2025 (Interest coverage row)
  - Interest coverage leaves both the 2024 and 2025 annual cells blank ('-') yet shows 74.0x in the TTM (Dec 2025) column. For this December fiscal-year company TTM equals FY2025 — every other row (revenue, op margin, ROIC) shows TTM identical to its FY2025 cell — so the FY2025 annual cell should also read 74.0x. Genuine annual-vs-TTM display inconsistency; immaterial to any verdict given the net-cash position.
- **[low]** Current Position (Deeper floors)
  - Net current asset value is shown as -€338M and labeled 'current assets less all debt', but a negative value can only come from current assets (€30.6B) minus ALL liabilities (≈€31.0B = assets 50.6 − equity 19.6), the correct Graham net-net. 'Current assets less all debt' (debt = €4.4B) would be +€26.2B — wrong sign and magnitude. The same panel uses 'debt' to mean €4.4B ('Debt incl. leases €4.4B'), so labeling €31B of liabilities 'all debt' is internally inconsistent. Number correct, label wrong.

### DOW  (1 high, 2 total)
- **[high]** The record, 2017–2025 — Balance sheet, Net debt / (cash) row
  - 2017 Net debt prints ($6.2B), exactly minus the $6.2B cash balance, which only holds if 2017 total debt were $0 — yet 2017 total debt is blank ("—"), as are 2017 receivables, inventory, payables, current assets/liabilities and total assets (incomplete standalone-registrant data). Reporting a precise $6.2B net-cash position from a missing debt figure is unsupported and overstates trough balance-sheet strength, the very thing the page tells the reader to weigh.
- **[medium]** Earnings power, through the cycle — Latest, reported
  - Normalized owner earnings ($2.5B) is computed on FY2025 full-year revenue ($40.0B = ‘the latest annual revenue’) but is set beside the TTM (Mar 2026) reported figure of ($232M) at −0.6%, which the section labels ‘this year.’ FY2025’s actual reported owner earnings/margin are ($1.4B) / −3.6% (record table 2025 column and the FY2025 bridge). The mixed periods understate how far below normal the reported year sits and are internally inconsistent.

### BABA  (1 high, 2 total)
- **[high]** Earnings power, through the cycle
  - The 41.5% 'through-cycle margin' is the median owner-earnings margin of 2017-2020 only — the four earliest, peak-margin years before Alibaba's structural de-rating (op margins 30/28/15/18% vs 13/8/12/12/14/5% after). Applying it to FY2026 revenue (a ~2x-larger base) yields normalized owner earnings of CN¥424.5B, then the page concludes the latest figure 'may understate the business; the reported figure is being set in a lean year' — the exact peak-year error the section's own Graham preamble warns against. CN¥424.5B exceeds the best operating cash flow the company ever produced (CN¥231.8B, FY2021) by 1.8x and the largest owner-earnings figure ever realized (CN¥155.9B) by 2.7x, so a figure labeled 'cash an owner could take out' is materially overstated and the directional 'understates' conclusion is misleading.
- **[medium]** Earnings power, through the cycle — 'Owner-earnings margin, the range'
  - The 30.6%-48.8% range is labeled 'across the record', but the record is the ten-year 2017-2026 table while owner-earnings margin is computed for only 4 of 10 years (2021-2026 show '—'). The band is the range of just the four earliest high-margin years, not the full record the reader sees above it, so 'across the record' overstates its coverage.

### BKD  (1 high, 1 total)
- **[high]** The record, 2016–2025 — 'Goodwill written down' (GW imp.) row
  - The TTM column reports a $371M goodwill write-down, but the Goodwill balance row is flat at $27M across 2022–2025–TTM (zero change in the latest period). A $371M impairment is arithmetically impossible against a $27M asset that did not move — it exceeds the entire goodwill balance by $344M — making this a fabricated, material figure displayed to the reader.

### MGM  (0 high, 5 total)
- **[medium]** Earnings power, through the cycle
  - The section sets a normalized figure on FY2025 against a reported figure on a different period. Normalized $1.5B is the 8.3% through-cycle margin applied to FY2025 revenue ($17.5B), but 'Latest, reported' $1.6B at 8.8% is the TTM (Mar 2026) figure, not FY2025 — the record's FY2025 reported owner earnings is $1.5B at 8.3%. Comparing FY2025-normalized to TTM-reported manufactures the apparent $0.1B gap; an all-FY2025 comparison would show $1.5B vs $1.5B (8.3% vs 8.3%), i.e. no gap.
- **[medium]** Earnings power, through the cycle
  - The owner-earnings margin labeled 'this year' is shown as 8.8%, but the record's FY2025 owner-earnings margin is 8.3% (2025: OE $1.5B, OE mgn 8.3%). 8.8% is the TTM (Mar 2026) margin, so labeling it 'this year' contradicts the page's own FY2025 record figure.
- **[low]** Owner-earnings bridge (FY2025)
  - The bridge does not foot to its own displayed result. Displayed Cash from operations $2.5B minus Capital expenditure $1.1B equals $1.4B, and the itemized walk (NI $206M + D&A $1.0B + SBC $90M + WC $1.2B = $2.496B CFO, less $1.1B capex) sums to $1.396B = $1.4B, while the result line displays $1.5B. ('8% of revenue' is correct: 1.396/17.5 = 8.0%.)
- **[low]** The business in brief — Is it a good business?
  - 'Consistently' is in tension with the same owner-earnings-margin series the page displays, which includes a -34.2% trough (2020) and a 4.6% year (2018): 7.2%, 11.2%, 4.6%, 8.3%, -34.2%, 9.1%, 7.6%, 10.9%, 8.9%, 8.3%. The page itself flags the business as cyclical ('margins collapse repeatedly across the cycle') and tells readers to 'weigh the worst year against the median,' so describing ~8% owner earnings as reaching owners 'consistently' overstates the stability of cash conversion.
- **[low]** The record, 2016–2025 — Depreciation
  - 2022 depreciation of $3.5B is ~3-4x its neighbors ($1.2B in 2021, $814M in 2023) and far above the $0.8B-$1.3B band across the rest of the decade (latest-year depreciation $1.0B). It is internally offset by an unusually large negative 'Working capital & other' of -$3.3B the same year, indicating a one-off/impairment charge tagged into the depreciation line rather than recurring depreciation. Shown in the record under 'Depreciation' with no flag, the $3.5B misrepresents 2022 depreciation.

### SHEL  (0 high, 5 total)
- **[medium]** The record, 2016–2025 — "Working capital & other" / "Depreciation" rows (FY2025 vs TTM columns)
  - For an annual filer FY2025 IS the TTM (Dec 2025): every other row is identical across the two columns (rev 266.9/266.9, op inc 34.1/34.1, NI 17.8/17.8, op cash 42.9/42.9), yet Depreciation shows blank in the 2025 column but $24.1B in TTM, and WC&other shows $25.0B vs $935M. The annual column folds depreciation into WC&other (OCF 42.9 − NI 17.8 = 25.1 ≈ 25.0) while TTM breaks it out (42.9 − 17.8 − 24.1 = 0.935 = $935M), leaving a ~$24B discrepancy on the same line for the same period side by side, with depreciation present in one column and blank in the other.
- **[medium]** How is the cash used? (capital allocation)
  - Both "Where do the earnings go?" and "Investing or harvesting?" read "— Not enough data … the filing data didn't include the inputs," yet the record table directly above displays Dividends paid ($8.6B) and Buybacks ($13.9B) for 2025 plus operating cash flow ($42.9B). The payout check (div + buyback $22.5B ≈ 52% of CFO) is fully computable from data the page is already showing, and the brief names capital allocation as the decisive swing factor — so the page claims it lacks inputs it visibly has.
- **[medium]** What it is — Revenue header
  - The headline "8% 5-yr CAGR" is anchored on FY2020 ($180.5B), the single lowest-revenue year of the decade (the −12.8% op-margin / −$21.7B net-income COVID trough). 266.9/180.5 over 5 yrs = 8.1% is arithmetically correct but measures recovery off the bottom, not growth: FY2025 fell −6.1% YoY and sits well below the 2018 ($388.4B) and 2022 ($381.3B) peaks. Presenting a trough-anchored +8% as headline growth for a cyclical contradicts the page's own brief two sections later ('Cyclical … a single year misleads; look at normalized, through-cycle earnings').
- **[low]** Is it a good business? — Return on invested capital
  - The headline "9%" is explicitly labelled the 10-yr median (and the brief says 'median 9%'), but the median of the ten displayed ROIC values [-8,3,6,7,9,10,10,10,11,20] is 9.5%, which rounds to 10%, not 9%. The page understates its own stated median by rounding the wrong way, under a 'Solid through the cycle' badge that already reads generously against a return the brief admits 'sat near the cost of capital.'
- **[low]** Current Position — Deeper floors — Net current asset value
  - The −$87.9B figure is the correct Graham net-net (current assets $107.2B − total liabilities ~$195–196B = total assets $370.4B − equity $174.4B), but the one-line label says 'current assets less all debt.' Debt is not liabilities: CA less all debt would be $107.2B − $67.0B = +$40.2B (or +$11.2B against debt incl. leases $96.0B) — both positive, nowhere near −$87.9B. The math is right; the description mislabels the subtrahend as 'debt' when it is total liabilities.

### MSCI  (0 high, 4 total)
- **[medium]** The record, 2016–2025 — Gross margin row (and 'What it is' vital signs)
  - The gross-margin row is genuinely discontinuous (78–83% for 2016–2020, blank 2021–2025, then 91% TTM), and the vital-signs strip headlines 'Gross margin 91%' with no 5-yr average — the only vital sign missing one (Operating margin, ROIC, OE-margin all show 5-yr avgs). The 91% headline sits 8 points above the last comparable year (83% in 2020) with the break unflagged, which reads as margin expansion when it is a cost-of-revenue basis change.
- **[medium]** Earnings power, through the cycle
  - The section says it applies the through-cycle margin to 'the latest annual revenue' ($3.1B) and sets it 'beside the latest reported figure', but the 'Latest, reported $1.6B at a 48.2% margin this year' uses the TTM (Mar 2026) OE margin of 48.2%, not the FY2025 annual margin of 49.9%. $1.6B/48.2% implies a ~$3.32B (TTM) base, not the $3.1B annual base. The same page's bridge labels FY2025 OE '50% of revenue', so 'this year's' margin is stated as both 48.2% and ~49.9%.
- **[low]** Is it a good business?
  - 'median 37%, above 15% in 10 of 10 years' is internally inconsistent: the displayed 10-year ROIC series (21,24,37,47,48,35,40,35,40,45 for 2016–2025) has a median of 38.5%, not 37%. 37% is the median of only the 9-year 2016–2024 window, yet the same line counts '10 of 10 years' — mixing a 9-year median with a 10-year count.
- **[low]** Current Position — Deeper floors (Net current asset value)
  - The −$6.9B equals current assets ($1.4B) minus total liabilities ($8.3B = total assets $5.5B minus equity −$2.8B), which is Graham's true net-net subtracting all liabilities. But the label reads 'current assets less all debt'. All debt is only $6.4–6.6B, which would give ~−$5.0 to −$5.2B. The word 'debt' understates what is actually subtracted (all liabilities) by roughly $1.9B.

### KO  (0 high, 4 total)
- **[medium]** Is it a good business?
  - The page presents 'customers and suppliers fund the business through negative working capital' as a structural feature, but the 'Operating working capital' line is POSITIVE in all ten annual years (3.8, 4.0, 4.0, 3.5, 2.9, 2.3, 2.4, 2.2, 2.8, 1.8) — a use of cash. Negative WC (-$6.0B) appears only in the single TTM quarter, driven by an anomalous AP jump from $5.6B to $14.4B (+157%). The through-cycle record contradicts the structural claim.
- **[medium]** Is it a good business?
  - 'above 15% in 6 of 10 years' matches no reading of the displayed ROIC series (15, 9, 19, 19, 13, 15, 17, 17, 14, 17): strictly above 15% is 5 years (19,19,17,17,17); at-or-above 15% is 7 years. Neither equals 6.
- **[medium]** Current Position - Deeper floors
  - 'Debt incl. leases $38.2B' is ~$5.4B BELOW the page's own 'Total debt' line of $43.6B (TTM) / $43.9B (FY2025). A figure that includes leases must be >= bare total debt, since leases add to debt. The smaller number is labeled 'incl. leases' and the larger labeled plain 'total debt' — backwards — and as a downside floor it understates the obligation.
- **[low]** Is it a good business?
  - 'median 15%' for ROIC does not match the page's own displayed series (15, 9, 19, 19, 13, 15, 17, 17, 14, 17): sorted, the two middle values are 15 and 17, so the median is 16. Even allowing for integer-rounding, the unrounded median is bounded in [15.5, 16.5) and always rounds to 16, never 15. The vital-signs strip independently shows ROIC 5-yr average 16%.

### COST  (0 high, 4 total)
- **[medium]** Earnings power, through the cycle
  - Period mismatch on the headline comparison: normalized owner earnings ($10.0B) is built on FY2025 ANNUAL revenue ($275.2B), but the 'Latest, reported' figure set beside it is $12.4B 'at a 4.2% margin this year' — that $12.4B/4.2% is the TTM column (ending May 2026), not FY2025. The FY2025-consistent reported figure from the record is $10.9B at a 4.0% margin, so 'this year' margin is mislabeled (4.0%, not 4.2%) and the premium-over-normal is overstated (shows ~$2.4B vs the FY2025-consistent ~$0.9B). The 'above through-cycle' verdict still holds, so this is a labeling/period error, not a wrong conclusion.
- **[medium]** Current Position — Deeper floors (Net current asset value)
  - The -$7.7B is correct as the Graham net-net (current assets $45.2B less ALL liabilities $52.9B = -$7.7B), but the label says 'current assets less all debt,' which misdescribes it. Total debt is $5.7B ($8.3B including leases), so current assets less debt would be roughly +$37-39B, not -$7.7B.
- **[medium]** Where the money comes from (footnote)
  - The breakdown is a product-LINE revenue disaggregation (Food and Sundries, Non-Foods, Other, Fresh Food, Membership) — the page's own header even reads 'Revenue by product line, FY2025' — yet the caption calls it 'the segment footnote' and asserts 'the profit bar shows each segment's share of segment operating profit.' No profit data is shown (only revenue %/$), and Costco does not disclose operating profit by these merchandise categories (its operating segments are geographic). The caption mislabels the data and promises a profit breakdown the page does not contain.
- **[low]** Is it a good business?
  - The page's own ROIC series for 2016-2025 is 17,21,24,27,30,37,34,34,36,37, whose median is 32%, not the stated 30%. The 'above 15% in 10 of 10 years' is correct, but the median is off by 2 points versus the record row.

### ADBE  (0 high, 3 total)
- **[medium]** Current Position - Deeper floors - Net current asset value
  - The -$9.3B figure is correct as Graham's net-net (current assets $9.1B minus TOTAL liabilities $18.4B), but the label reads 'current assets less all debt.' Debt is shown on the same page as $7.1B incl. leases ($6.6B total debt); taken literally, $9.1B less all debt = +$2.0B, the opposite sign and magnitude. The word 'debt' should be 'liabilities.'
- **[low]** Earnings power, through the cycle
  - The section states it applies the through-cycle margin to 'the latest ANNUAL revenue' (normalized $9.4B = 39.4% x $23.8B FY2025), but the 'Latest, reported $10.3B at 40.8% margin this year' comparator is the TTM (May-2026) column built on $25.2B TTM revenue, not FY2025 (whose reported owner earnings were $9.9B at 41.4%). Normalized (annual base) is set beside reported (TTM base), and 'this year's margin' 40.8% is the TTM margin, not the fiscal-year 41.4%.
- **[low]** Is it a good business?
  - The narrative says owner earnings is 'roughly 37% of revenue... consistently,' but this is below every owner-earnings read the page itself computes: vital signs 41% TTM / 40% 5-yr avg, record 10-yr mean 39.0% / median 39.4%, normalized through-cycle 39.4%, and last-5-yr avg 39.9%. 37% matches no central tendency (only the 2022-2023 trough dips to ~36%); the figure should read ~39-40% to be internally consistent.

### SCHW  (0 high, 3 total)
- **[medium]** Owner's Scorecard - 'Is it sound?' - Credit cost (provision / NII) card
  - The card displays 'Provision for credit losses ($5M) ÷ net interest income $11.8B' under a scorecard headed 'FY2025 10-K', but in 'The record' the Credit-loss provision row (($5M) $0 ($6M) ($5M) — — — — — — ($5M)) shows the FY2025 cell as a dash and places ($5M) only in the TTM column, while $11.8B is FY2025 NII (TTM NII is $12.2B). The card thus shows a provision the table reports as missing for FY2025 and mixes a TTM provision with FY2025 NII — internally inconsistent.
- **[low]** Owner's Scorecard - 'Is it sound?' - Credit cost card
  - The card renders the credit-cost ratio as '-0%'. -$5M / $11.8B = -0.04%, which rounds to zero magnitude but retains a negative sign, producing a sign-on-zero display artifact ('-0%') that should render as 0% or ~0%.
- **[low]** The price - 'What the price implies'
  - The final analytical section is headed 'What the price implies / price / tangible book' and states the method ('A bank is worth a multiple of its tangible book value...'), but computes and displays nothing — no P/TBV multiple, no price, no implied value — even though the page already carries tangible book per share ($16.85 TTM). The page ends with this empty stub.

### 7203  (0 high, 3 total)
- **[medium]** Will it survive? — Debt, net of cash / Net cash
  - The ¥15.93T net-cash headline is built from "ST investments ¥4.72T," an input that does not exist in the pack's filing data block (which lists only cash ¥12,659.6B and totalDebt ¥1,446.8B). From the given data, net cash = cash − debt = ¥11.21T, so the ¥4.72T is unsourced and overstates the headline by ~30%. It is also internally inconsistent with the page's own ROIC card, which subtracts only cash (¥12.66T) — invested capital ¥28.71T = 1.45 + 39.92 − 12.66 — implying liquid resources of ¥12.66T, not ¥17.38T.
- **[low]** Will it survive? — Net cash verdict
  - The card declares the company "owes nothing" and "can act from strength when others can't," but the same filing data shows total liabilities of ¥65.6T (totalAssets ¥105,522.3B − equity ¥39,918.9B) against a ¥1.45T "debt" line — implausibly small for a ¥105.5T-asset automaker with a captive-finance arm, as is the ¥44.8B interest expense behind the 84.1x coverage read. The page caveats that gross debt isn't netted against cash but never flags that the debt line itself excludes financing borrowings, so the unqualified "owes nothing / act from strength" overreaches against the visible ¥65.6T of obligations.
- **[low]** How is the cash used? — Where do the earnings go?
  - The card labels FY2026 "Reinvests most of it" purely because payout was 38%, treating the ~62% not returned as reinvestment. But owner earnings (¥3.32T) is already net of capex, and FY2026 capex ¥2.15T < depreciation ¥2.39T (0.90x), so net investment in productive assets was negative; the ~¥2.04T not paid out was retained on the balance sheet, not reinvested. This contradicts the adjacent "0.90× Maintaining" card and the page's own multi-year taxonomy, which separates Reinvested (43%) from Retained-debt/cash (23%).

### HCA  (0 high, 2 total)
- **[medium]** Current Position → Deeper floors → Net current asset value
  - The line labels '($29.6B) — Graham's net-net: current assets less all debt,' but (a) Graham's net-net (NCAV) subtracts ALL liabilities, not just debt — total liabilities = total assets − equity = $61.5B − (−$6.3B) = $67.8B, so a true net-net is $16.1B − $67.8B = −$51.7B, understating the deficit by ~$22B; and (b) the −$29.6B figure does not reconcile to its own stated 'all debt' formula — it only ties out using NET debt (CA $16.1B − net debt $46.6B ≈ −$30.5B, or FY CA $15.8B − net debt $45.5B = −$29.7B), whereas 'all debt' ($46.5–48.0B) gives −$30.4 to −$31.9B. Both the definition and the label are wrong.
- **[low]** Current Position → Deeper floors → Deferred revenue
  - Characterizing a deferred-revenue line as 'float, and a sign customers pre-pay' attributes an insurance-like, favorable quality the business model does not support. The pack itself establishes HCA is a general hospital (SIC 8062) whose revenue is dominated by Medicare/Medicaid third-party payers; patients and government payers do not hand over billions in advance of care, so the Buffett 'float / customers pre-pay' gloss overstates business quality. (The $5.0B figure's composition cannot be verified from the pack, but the misleading interpretive gloss stands on the established business facts.)

### BAC  (0 high, 2 total)
- **[medium]** Is it a good business? — Efficiency ratio box (Scorecard)
  - The Scorecard labels the 62% efficiency ratio "Efficient," but the box's own explanation states "below about 60% marks a genuinely efficient operation" (62% is above that line), and the page's own narrative read calls the same 62% ratio "about average." The badge contradicts both the threshold the box defines and the page's own prose.
- **[low]** Is it a good business? (business-in-brief read)
  - The narrative states "median 9%" for the 10-year ROE series, but the displayed ROE figures (2016-2025: 7,7,11,10,7,12,10,9,9,10) have a median of 9.5%, not 9%. The stated statistic does not match the median of the page's own figures, and rounds the wrong way (9.5% conventionally rounds to 10%).

### ELV  (0 high, 2 total)
- **[low]** Management & pay — Stock-based compensation
  - SBC of $276M against $199.1B revenue is 0.14%, which the page displays as a flat '0% of revenue.' In a section whose stated thesis is that SBC is a real expense that should not be ignored ('compensation is an expense, real whether or not the headline earnings admit it'), labeling it literally '0% of revenue' contradicts the prose; it should read '<1%' or '0.1%'. The companion '4% of operating profit' (276/7,200 = 3.8%) is correct, so the defect is cosmetic, not material.
- **[low]** Current Position — Quick ratio
  - Elevance is a health insurer (SIC 6324, managedCare) with no inventory, so the quick ratio equals the current ratio: both display 1.48× ($67.0B / $45.3B). The explanation 'stricter — drops inventory, which may not sell' is inapt boilerplate — nothing is dropped and it is not stricter (it is the identical figure). The numbers are correct; only the framing misleads.

### DRI  (0 high, 2 total)
- **[medium]** Earnings power, through the cycle
  - Period mismatch in one comparison: the normalized $1.1B is built on FY2025 annual revenue ($12.1B x 9.0% median margin), but the 'Latest, reported $1.2B at a 9.3% margin this year' is the TTM/Feb-2026 column (OE $1.2B, 9.3% margin, on $12.8B revenue), not the reported fiscal year. FY2025 (the year the normalized figure is anchored to, and the 'reported year' the prose says to weigh against) actually ran owner earnings $1.1B at an 8.8% margin. So 'this year's margin' = 9.3% misdescribes the just-reported fiscal year, and the block pairs an annual-revenue-normalized number against a different-period (TTM) reported number.
- **[low]** Current Position (as of the latest quarter, Feb 22, 2026)
  - Section is dated to the latest quarter and every balance-sheet line matches the TTM/Feb-2026 column (receivables $108M, inventory $345M, current assets $1.0B, current liabilities $2.6B, payables $451M) except cash, shown as $240M which is the FY2025 prior-period figure rather than the TTM $263M from the same column. With the consistent current-quarter cash of $263M the cash ratio is 0.10x rather than the displayed 0.09x (the rounding genuinely crosses the boundary: 240/2651=0.0905 vs 263/2651=0.0992).

### TSM  (0 high, 2 total)
- **[medium]** The record, 2015–2024 — Total debt row
  - The 2024 fiscal-year column shows Total debt of NT$31.8B, but the filing reports FY2024 totalDebt = NT$146.7B, which the adjacent TTM column correctly shows. Since TSM's FY2024 ended Dec 31, 2024, the 2024 and TTM columns cover the same period; 8 other rows (revenue, op income, net income, op cash, cash+inv, total assets, equity, interest coverage) have identical 2024 and TTM values, so this lone divergence is a data error. The NT$31.8B is in fact the operating-lease component (Current Position: 'NT$31.8B of it operating leases'; 178.6 − 31.8 ≈ 146.7 filing debt), so the lease figure was substituted for total debt. This contradicts the filing and hides the real ~33x YoY jump (NT$4.4B→NT$146.7B), displaying only ~7x.
- **[medium]** The record, 2015–2024 — Net debt / (cash) row
  - The 2024 column net cash of (NT$2.16T) is computed from the wrong debt figure: cash/investments NT$2.19T minus the erroneous NT$31.8B = NT$2.16T. Using the filing's FY2024 totalDebt of NT$146.7B gives (NT$2.04T), which is exactly the TTM column for the same Dec-2024 period. The 2024 column thus overstates net cash by ~NT$115B and is internally inconsistent with the TTM column. TSM is deeply net-cash either way so the leverage verdict is unaffected, but the displayed figure is wrong and disagrees with the filing.

### NKE  (0 high, 1 total)
- **[medium]** Earnings power, through the cycle
  - The normalization base and the reported comparator are different periods. Normalized owner earnings $4.6B is built on FY2025 ANNUAL revenue ($46.3B) and the median of the 9 annual OE margins (median = 10.0%; 10.0% x $46.3B = $4.6B). But the 'Latest, reported $1.0B at a 2.3% margin' is the TTM Feb 2026 figure (record TTM column: owner earnings $1.0B, OE margin 2.3%), not FY2025. The page's own Owner-earnings bridge, explicitly labeled FY2025, computes FY2025 owner earnings of $3.3B at 7.1% margin. So a FY2025-revenue normalization is set beside a TTM reported number, contradicting the bridge and roughly tripling the apparent earnings-power gap (4.6 vs 1.0 instead of the period-consistent 4.6 vs 3.3), materially overstating how depressed the reported figure is.

### CMG  (0 high, 1 total)
- **[medium]** Current Position — Deeper floors — Net current asset value
  - Net current asset value (-$5.3B) is glossed 'Graham's net-net: current assets less all debt,' but the figure equals current assets ($1.1B) minus TOTAL liabilities ($6.4B = total assets $8.8B - equity $2.4B). The page's own next line defines debt as $5.2B (incl. leases); a reader reconciling 'less all debt' gets $1.1B - $5.2B = -$4.1B, not -$5.3B. The gloss should read 'less all liabilities,' so it misstates what was actually deducted.

### HD  (0 high, 1 total)
- **[medium]** Current Position — Deeper floors (Net current asset value)
  - The 'Net current asset value (-$56.9B)' gloss reads 'current assets less all debt,' but the displayed figure is current assets minus TOTAL LIABILITIES (current assets $37.2B - total liabilities $94.0B = -$56.8B, the correct Graham net-net). The same 'Deeper floors' block defines 'Debt incl. leases' as $60.1B one line down, so taken literally 'current assets less all debt' = $37.2B - $60.1B = -$22.9B, which contradicts the -$56.9B shown. The word 'debt' should read 'all liabilities'; as written it is internally inconsistent with the block's own definition of debt.

### TGT  (0 high, 1 total)
- **[medium]** Where the money comes from — caption under the product-line breakdown
  - The caption says the data is 'From the segment footnote' and that 'the profit bar shows each segment's share of segment operating profit, before unallocated corporate costs.' But the section header (line 45) reads 'Revenue by product line', the breakdown (lines 46-59) is by merchandise category (Food and Beverage, Household essentials, Hardlines, Apparel, Home, Beauty, Other), and each line shows only a revenue share and dollar amount with NO profit figure anywhere. The caption references a 'profit bar' and per-segment operating-profit disclosure that does not appear on the page and that Target (a single-reportable-segment variety retailer, SIC 5331) does not provide.

### AMZN  (0 high, 1 total)
- **[medium]** Earnings power, through the cycle
  - Base mismatch within one side-by-side comparison. The 'Latest, reported $78.1B at a 10.5% margin this year' is the TTM (Mar 2026) column ($78.1B owner earnings / 10.5% OE margin on $742.8B revenue), not the FY2025 fiscal year it is labeled 'this year.' FY2025's actual reported figure is $73.8B at 10.3% (record table 10th column). Yet the normalized $54.2B is explicitly built on FY2025 ANNUAL revenue ($716.9B), and the section header frames the method as 'applied to the latest annual revenue, set beside the latest reported figure.' So an annual-revenue-based normalized number is set beside a TTM reported number, and the FY2025 margin is shown as 10.5% when it was 10.3% (~6% overstatement of the reported year, $78.1B vs $73.8B).

### PGR  (0 high, 1 total)
- **[low]** The record, 2016–2025 — Revenue row (2022 column)
  - 2022 revenue displays $50.5B, but the underlying filing series gives FY2022 revenue of $49.6B. It is the only one of the ten years that disagrees with the filing, contradicting the table's own header 'realized figures from each filing, no estimates'.

### TRV  (0 high, 1 total)
- **[medium]** The record (2016-2025) — Balance sheet, 'Cash & investments' row
  - The row labeled 'Cash & investments' shows only $6.6B (TTM $7.3B), but for a P&C insurer with $143.7B total assets and $110.8B liabilities (incl. $65.7B loss reserves), the actual invested portfolio is ~$80B+. The label omits the entire investment portfolio and is internally inconsistent with the same page's 'Investment income $4.0B': $4.0B/$6.6B implies an absurd ~61% book yield, whereas $4.0B/~$80B is the sensible ~5%. The row is cash + short-term only, mislabeled as 'Cash & investments', materially understating invested assets and creating a self-contradiction a reader cannot reconcile.

### ICE  (0 high, 1 total)
- **[medium]** Current Position — Deeper floors — Net current asset value
  - The Net current asset value line displays (-$22.6B) but labels it 'current assets less all debt.' The figure is actually current assets ($127.1B) minus TOTAL liabilities ($179.2B assets - $29.5B equity = $149.7B) = -$22.6B — the true Graham net-net (current assets less all LIABILITIES). The page itself states 'Debt incl. leases $21.0B' two lines below, and uses 'debt' narrowly elsewhere in the same section ('Debt due within a year $1.8B'). Taking the label literally, $127.1B less all debt $21.0B = +$106.1B, the wrong sign and ~$129B off. The word 'debt' should read 'liabilities'; as written, the description is irreconcilable with the displayed number.

### HUM  (0 high, 1 total)
- **[low]** Current Position — Deeper floors, Net current asset value
  - The displayed $1.4B is labeled "Graham's net-net: current assets less all debt," but applying that stated formula to the page's own debt figure does not produce $1.4B: current assets $38.1B less Debt incl. leases $14.5B (shown two lines down) is $23.6B. The only way to reach $1.4B is current assets $38.1B minus TOTAL liabilities $36.7B (latest-quarter assets $55.3B − equity $18.6B). So the word "debt" is used to mean two different things on the same panel ($14.5B in one line, all $36.7B of liabilities in the net-net line). The headline term "net-net" is correct and the number is correct, but the explanatory clause mislabels liabilities as debt.

### NVO  (0 high, 1 total)
- **[medium]** Is it a good business?
  - The parenthetical '(median 55%, above 15% in 6 of 6 years)' computes its median and its count over different windows. ROIC has values in only 6 of 7 years (2019 is '—'), so 'above 15% in 6 of 6 years' references 2020-2025 = [70,55,62,69,44,34], whose true median is 58.5%. The stated 55% is the median of the different 5-year window 2021-2025 = [55,62,69,44,34] (the same window the vital-signs '5-yr avg ROIC 53%' = mean 52.8% uses). So the stated median is inconsistent with the 6-year count and understates the 6-year median by 3.5 points; no median convention yields 55 from the 6 values.
