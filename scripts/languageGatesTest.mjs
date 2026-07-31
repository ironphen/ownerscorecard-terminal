// The qualitative desks' pinned quote suite (Build 1 of the 2026-07-30 survey,
// docs/qualitative-desks-survey.md). Every sentence below is VERBATIM from a live filing via
// language.json on the day the defect was measured — pinned as literals so the suite never
// drifts with the data. Two halves, and both matter equally: the known-bad set must DIE under
// the narrowed gates (each was rendering a false claim on a real company's page), and the
// known-good set must SURVIVE them (a hygiene pass that kills a true material weakness is a
// worse defect than the ones it fixes). Bank of Marin appears on both sides deliberately: its
// cybersecurity-program boilerplate must stop wearing the Litigation flag while its GENUINE
// deposit-restatement banner and its genuine admission keep rendering — the proof the pass is
// a scalpel, not a mower.
import {
  FLAG_THEMES,
  MW_DECLARED, MW_ABSENT, MW_OTHER_ENTITY, RESTATED, RESTATED_CONTRACT, INTEGRITY_FUTURE,
  ADMIT, NOT_ADMIT, BLAME_OTHERS,
  businessDescription, extractSections, htmlToText,
  reserveDevelopmentRead,
  ownerFlags, buffettRead,
  uninsuredDepositsRead,
  softwareRetentionRead, customerLadderRead, softwareKpiRead, softwareKpiAssemble,
} from "./fetchFilings.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); cond ? pass++ : fail++; };

const theme = (lens) => FLAG_THEMES.find((t) => t.lens.startsWith(lens));
const firesMW = (s) => !INTEGRITY_FUTURE.test(s) && MW_DECLARED.test(s) && !MW_ABSENT.test(s) && !MW_OTHER_ENTITY.test(s);
const firesRS = (s) => !INTEGRITY_FUTURE.test(s) && RESTATED.test(s) && !RESTATED_CONTRACT.test(s);
const isAdmission = (s) => /\b(we|our|management)\b/i.test(s) && ADMIT.test(s) && !NOT_ADMIT.test(s) && !BLAME_OTHERS.test(s);

// ---------------- KNOWN BAD — every one was live on a page; each must now die ----------------

ok("GL: a premium-growth boast ('defined in the following section') no longer wears the Litigation flag",
  !theme("Litigation").test("Total first-year collected premium (defined in the following section) increased 5% to $704 million for 2025, compared to $674 million in 2024."));

ok("BMRC: cybersecurity-program boilerplate ('reFINEs…effECtiveness') no longer wears Litigation",
  !theme("Litigation").test("Key components of the information security program include: A risk assessment process that identifies and prioritizes material cybersecurity risks; refines and evaluates the effectiveness of controls to mitigate the risks; and reports results to executive management."));

ok("PLD: the FFO-definition sentence no longer wears Litigation",
  !theme("Litigation").test("Our FFO measures begin with NAREIT's definition, with certain adjustments to calculate FFO, as modified by Prologis, and Core FFO, both as defined below, to reflect our business and execution of our management strategy."));

ok("UTL: the gross-margin-definition sentence no longer wears Litigation",
  !theme("Litigation").test("The Company's GAAP (as defined below) Electric Gross Margin was $82.7 million in 2025."));

ok("MOH: a remediated-in-the-past weakness is not a live cockroach banner",
  !firesMW("We have identified material weaknesses in our internal control over financial reporting in the past, which have subsequently been remediated."));

ok("TRUP: same, with the wider cured-verb gap",
  !firesMW("We have in the past identified material weaknesses or significant deficiencies in our internal control over financial reporting, which have been remediated."));

ok("FPI/SKYH: the bare 'in the past' form dies",
  !firesMW("We have identified material weaknesses in the past."));

ok("ESRT: 'in prior periods' dies",
  !firesMW("In prior periods, we identified a material weakness in our internal control over financial reporting related to information technology general controls."));

ok("AES: an investee's (Fluence's) cured weakness is not the registrant's banner",
  !firesMW("In recent years, Fluence has reported a material weakness in its internal control over revenue recognition that was remediated as of December 31, 2024."));

ok("BXP: amending and restating a revolver is not an accounting restatement",
  !firesRS("Loss From Early Extinguishment of Debt On March 28, 2025, BPLP amended and restated its revolving credit agreement (See Note 7 to the Consolidated Financial Statements) ."));

ok("RLI: declining business below one's own standards is a virtue, not an admission",
  !isAdmission("We maintained underwriting discipline by selectively retaining high-quality accounts and forgoing opportunities that did not meet our underwriting standards."));

ok("depreciation boilerplate ('over estimated useful lives') is not an admission",
  !isAdmission("We depreciate these assets over estimated useful lives of three to seven years."));

ok("a bank regulator's countercyclical capital buffer is not business cyclicality",
  !theme("Cyclicality").test("The rules include a countercyclical capital buffer that could require us to hold additional capital during periods of excessive credit growth."));

ok("a lender's sentence about its borrowers' covenants is not the company's own debt terms",
  !theme("Debt terms").test("Many of our borrowers may be unable to comply with the financial covenants in their loan agreements, and defaults by borrowers under these agreements could increase."));

// ---------------- KNOWN GOOD — every one is true and must keep rendering ----------------

ok("LINE: a genuinely declared material weakness still fires",
  firesMW("We identified a material weakness in our internal control over financial reporting as of December 31, 2025."));

ok("BMRC: its GENUINE restatement still fires",
  firesRS("As a result, we determined that there were material errors in the financial statements that required a restatement of our financial statements for the years ended December 31, 2023 and 2024 and for the quarterly periods then ended."));

ok("BMRC: its genuine misclassification admission survives the ADMIT narrowing",
  isAdmission("In February 2026, we determined that certain reciprocal network deposits were misclassified as non-interest bearing deposits when they should have been classified as interest bearing deposits."));

ok("JPM: the real legal-proceedings range still wears Litigation",
  theme("Litigation").test("The Firm estimates the aggregate range of reasonably possible losses, in excess of reserves established, for its legal proceedings is from $ 0 to approximately $ 1.2 billion at December 31, 2025."));

ok("AAON: genuine HVAC cyclicality still fires",
  theme("Cyclicality").test("In the HVAC business, a decline in economic activity as a result of these cyclical or other factors typically results in a decline in new construction and replacement purchases which could impact our revenue."));

ok("AAL: the company's own covenants still wear Debt terms",
  theme("Debt terms").test("Our debt agreements contain customary terms and conditions as well as various affirmative, negative and financial covenants that, among other things, may restrict our ability and that of our subsidiaries to pay dividends."));

ok("a genuine EU antitrust fine still wears Litigation (the word-boundary did not over-narrow)",
  theme("Litigation").test("The European Commission imposed a fine of EUR 2.42 billion, which we have appealed to the General Court."));

ok("a genuine EPA action still wears Regulation",
  theme("Regulation").test("The EPA has issued regulations that could require us to install additional emissions controls at our facilities."));

ok("software 'preparation' prose no longer wears Regulation via the EPA acronym",
  !theme("Regulation").test("The preparation of financial statements requires management to make estimates that could materially impact reported amounts."));

// ---------------- BUILD 2 — the section seeder and the hero ranker (Everspin, the owner's
// live report 2026-07-31: the page led with a design-win DEFINITION because an MD&A
// cross-reference `see "Part I, Item 1. Business"` seeded a 19,061-word capture that beat the
// real Item 1, and even with the right pool the customer-benefit frame outscored the is-a). ----

{
  // The Everspin candidate pool, pinned: the is-a must beat both the definition and the benefit frame.
  // Filing order: the is-a opens Item 1; the benefit frame and the definition come later.
  const pool = [
    "We are a pioneer in the successful commercialization of Magnetoresistive Random Access Memory (MRAM) technology.",
    "Everspin enables our customers to design products incorporating our technology with the assurance that it will be available for many years to come.",
    "We consider a design win to occur when an OEM or contract manufacturer notifies us that it has qualified one of our products as a component in a product or system for production.",
  ];
  const lede = businessDescription(pool, "Everspin Technologies Inc.", "MRAM");
  ok("MRAM: the is-a description beats the design-win definition and the customer-benefit frame",
    /pioneer in the successful commercialization/.test(String(lede)));
  ok("a 'we define X as' sentence can never be a hero lede",
    businessDescription(["We define Adjusted net income as net income adjusted for stock-based compensation expense."], "Anyco Inc.", "ANY") === null);
}

{
  // The "Part I," cross-reference form: a cited heading must not seed the section while the
  // real heading (prose after it, no citation before it) must. Synthetic fixture, minimal.
  const fx = [
    "Table of Contents Page PART I Item 1. Business 4 Item 1A. Risk Factors 10",
    "PART I Item 1. Business General " + "We are a maker of widgets for industrial customers worldwide. ".repeat(60),
    "Item 1A. Risk Factors " + "Our business could be harmed by many things. ".repeat(30),
    "Item 7. Management's Discussion and Analysis " + "Revenue rose on widget demand. ".repeat(120),
    'For an overview of our business, see "Part I, Item 1. Business." Key Metrics We monitor a variety of key financial metrics. ' + "More MD&A prose follows here at length. ".repeat(80),
  ].join(" ");
  const secs = extractSections(fx, "10-K");
  ok("a cited 'Part I, Item 1. Business' cross-reference does not seed the business section",
    /maker of widgets/.test(secs.business) && !/Key Metrics/.test(secs.business));
}

ok("letter-spanned headings glue back together in htmlToText",
  htmlToText("<p><span>B</span><span>USINESS</span> overview of the company</p>") === "BUSINESS overview of the company");

ok("a pointer-stub MD&A withholds instead of shipping candor on 250 words",
  extractSections("Item 7. Management's Discussion and Analysis The information required by this item is incorporated by reference to Exhibit 13 of this report. Item 7A. Quantitative and Qualitative Disclosures", "10-K").mdna === "");

// ---------------- BUILD 3 — the weld assertion and the widened subject-scope kill ----------------
const { weld, jaccardDedupe, noteWindow } = await import("../src/lib/quoteWeld.mjs");
const { pickConsolidated, splitSentences } = await import("../src/lib/drivers.mjs");

{
  const q = "Net income increased $63.2 million, or 28.7%, to $282.4 million for the year ended December 31, 2025.";
  ok("weld: a verbatim chip passes", !!weld(q, [{ text: "28.7%", kind: "verbatim" }]));
  let died = false; try { weld(q, [{ text: "27.8%", kind: "verbatim" }]); } catch { died = true; }
  ok("weld: a transposed-digit chip dies at write time", died);
  died = false; try { weld(q, [{ text: "28.7%", kind: "computed" }]); } catch { died = true; }
  ok("weld: a computed chip without a named source dies", died);
  ok("weld: a computed chip with its source passes", !!weld(q, [{ text: "+28.7%", kind: "computed", source: "lines.netIncome" }]));
}

{
  // The three live wrong rows, each pinned as its own kill class (the sentences verbatim from
  // drivers.json 2026-07-31). Frost's from-scope, Healthpeak's glued heading, Lamar's non-GAAP
  // base — every one previously shipped as a consolidated "Revenue" chip.
  const changes = { revenue: { pct: 8.3, delta: null } };
  const kill = (sent) => pickConsolidated([sent], { fy: 2025, changes }).length === 0;
  ok("CFR: 'Net revenues from interchange…' can no longer anchor consolidated revenue",
    kill("Net revenues from interchange and card transaction fees for 2025 increased $1.8 million, or 8.3%, compared to 2024 primarily due to an increase in volume."));
  ok("HR: a glued 'Revenues' heading over a rental-income sentence is not the subject",
    kill("Revenues Rental income increased $94.7 million, or 8.3%, primarily due to acquisitions completed during the year."));
  ok("LAMR: an acquisition-adjusted base can never verify a GAAP chip",
    kill("Net revenues for the year ended December 31, 2025, as compared to acquisition-adjusted net revenues for the comparable period in 2024, increased $45.6 million or 8.3% primarily due to higher occupancy."));
  ok("a clean consolidated sentence still ships",
    pickConsolidated(["Net revenues increased $1.8 million, or 8.3%, in 2025 compared to 2024, primarily due to higher volumes."], { fy: 2025, changes }).length === 1);

  // The full-pool regeneration diff tuned the kills (154 first-cut losses read one by one):
  // three over-fire classes exempted, two bonus righteous kills discovered and held.
  const ships = (sent, key, pct) => pickConsolidated([sent], { fy: 2025, changes: { [key]: { pct, delta: null } } }).length === 1;
  ok("ALLE: a glued heading whose text re-matches the SAME anchor is benign duplication and ships",
    ships("Net Revenues Net revenues for the year ended December 31, 2025, increased by 8.3%, or $295.1 million, primarily due to higher volumes.", "revenue", 8.3));
  ok("ALRM: 'attributable to common stockholders' is the parent line, not component scope",
    ships("Net income attributable to common stockholders increased 8.3% to $132.6 million in 2025 from $124.1 million in 2024, primarily due to higher revenue.", "netIncome", 8.3));
  ok("AGCO: 'for 2025' is temporal, not scope",
    ships("Net sales for 2025 were $10,082.0 million, or 8.3% lower than 2024, primarily due to lower sales volumes.", "revenue", -8.3));
  ok("ABBV: a PRODUCT's revenue ('for Venclexta') can never ship as consolidated",
    !ships("Net revenues for Venclexta increased 8.3% in 2025 primarily driven by increased demand.", "revenue", 8.3));
  ok("AIOT: 'Revenues from services' is a component, killed",
    !ships("Revenues from services increased by $82.9 million, or 8.3%, in 2025, primarily driven by growth.", "revenue", 8.3));
  // Second full-pool diff (65 losses, read one by one): the long-glued-heading benign class and
  // the table-debris class, each pinned from the filer that taught it.
  ok("HEI: a glued heading LONGER than the anchor is still benign when the core keyword repeats",
    ships("Net Income Attributable to HEICO Net income attributable to HEICO increased by 8.3% to a record $690.4 million in fiscal 2025, primarily due to higher sales.", "netIncome", 8.3));
  ok("CBOE: 'Operating Income As a result of the items above, operating income…' ships",
    ships("Operating Income As a result of the items above, operating income for the year ended December 31, 2025 was $1.2 billion, up 8.3%, primarily reflecting higher revenue.", "operatingIncome", 8.3));
  ok("APD: 'the table below' is debris, never a driver",
    !ships("Sales The table below summarizes the major factors that impacted consolidated sales for the periods presented: Volume increased 8.3%, primarily due to demand.", "revenue", 8.3));
  ok("GEN: a flattened table header (two adjacent years) is debris",
    !ships("Net revenues Fiscal Year % Change (In millions, except for percentages) 2026 2025 Net revenues increased 8.3% primarily due to growth.", "revenue", 8.3));
}

ok("jaccardDedupe: a combined-registrant near-duplicate collapses to the first occurrence",
  jaccardDedupe([
    "We recorded a regulatory asset of $177.2 million related to the storm costs at Wisconsin Electric.",
    "We recorded a regulatory asset of $178.9 million related to the storm costs at Wisconsin Gas.",
    "Rate base grew nine percent on the year across the utility segment.",
  ]).length === 2);

ok("noteWindow: the LAST heading occurrence wins (TOC echoes don't)",
  /real disclosure/.test(noteWindow("Reinsurance ... 12 (toc row) filler filler. Later in the notes: Reinsurance The real disclosure sits here with retention of $100 million.", /reinsurance/i)));

{
  const { customerConcentration } = await import("../src/lib/business.mjs");
  ok("WMB: a subset-scoped concentration ('customers of this business') never welds to consolidated revenue",
    customerConcentration("The three largest customers of this business in 2025 accounted for approximately 20 percent of its total operating revenues.") === null);
  ok("a whole-company concentration still welds",
    customerConcentration("Our largest customer accounted for approximately 20 percent of our total revenues in 2025.")?.pct === 0.2);
}

// ---------------- BUILD 4 — reserve development in management's own words (insurers +
// managed care as ONE lane). Every sentence below is VERBATIM from the named FY2025 10-K as
// the pipeline flattens it (fetched and measured 2026-07-31); every stored figure is the
// filer's own lines.reserveDevelopmentPriorYear, signed as filed (negative = favorable). The
// welds must weld, Berkley must withhold with the stated conflict, Trupanion must stay silent,
// Alignment must downgrade to the cause quote — the full four-rung gate, pinned. ----

{
  const dev = (mdnaText, stored, kind = "insurer", fy = 2025) =>
    reserveDevelopmentRead({ mdnaText, fullText: "", fy, stored, kind });

  // TRV: the note sentence carries three dollars; only the filed $939M ties, and the chip is
  // the filer's own characters (spaces included — the weld law is substring identity).
  const trv = "In 2025 , estimated claims and claim adjustment expenses incurred included $ 939 million of net favorable development for claims arising in prior years, including $ 1.04 billion of net favorable prior year reserve development and $ 43 million of accretion of discount that impacted the Company's results of operations.";
  {
    const r = dev(trv, -939e6);
    ok("TRV: welds $939M exactly, from a three-dollar sentence", !!r && r.check === "dollar" && r.narrated === "$ 939 million" && r.gapPct === 0);
    ok("TRV: the welded chip is a literal substring of the shipped sentence", !!r && r.sentence.includes(r.narrated));
  }
  ok("TRV red-team: the same sentence against a different filed figure does not weld",
    dev(trv, -839e6) === null);

  ok("CINF: welds $196M from the loss-reserves-note sentence",
    (() => { const r = dev("We experienced $ 196 million of favorable development on prior accident years including $ 130 million of favorable development in commercial lines, $ 4 million of favorable development in personal lines and $ 19 million of favorable development in excess and surplus lines during 2025.", -196e6); return !!r && r.check === "dollar" && r.narrated === "$ 196 million" && r.gapPct === 0; })());

  // MKL, both pinned behaviors: the segment near-miss alone welds inside the 6% band (the
  // survey's 0.9% case), and when the consolidated exact-tie sentence is present it wins.
  const mklSeg = "The 2025 combined ratio included $484.0 million of favorable development on prior accident years loss reserves compared to $454.9 million in 2024.";
  const mklCons = "Our underwriting results included $488.3 million, $455.3 million, and $38.6 million of net favorable development on prior years loss reserves in 2025, 2024, and 2023, respectively, which represented 3.1%, 3.1%, and 0.3%, respectively, of beginning of year net reserves.";
  ok("MKL: $484.0M narrated vs $488.3M tagged welds at 0.9%, inside the 6% tie",
    (() => { const r = dev(mklSeg, -488.3e6); return !!r && r.narrated === "$484.0 million" && r.gapPct === 0.9; })());
  ok("MKL: the exact consolidated tie beats the near-miss (smallest gap wins)",
    (() => { const r = dev(`${mklSeg} ${mklCons}`, -488.3e6); return !!r && r.narrated === "$488.3 million" && r.gapPct === 0; })());

  ok("RLI: welds $99M against the tagged $98.978M",
    (() => { const r = dev("Results for each period benefited from favorable development on prior years' loss reserves, which provided additional pretax earnings of $99 million in 2025, compared to $95 million in 2024.", -98.978e6); return !!r && r.narrated === "$99 million" && r.gapPct === 0; })());

  ok("UVE: welds as ADVERSE — the sentence's direction and the positive filed sign agree",
    (() => { const r = dev("During the year ended December 31, 2025, there was $ 25.8 million adverse prior years' reserve development, net.", 25.83e6); return !!r && r.tone === "adverse" && r.narrated === "$ 25.8 million"; })());

  // WRB, the tone-sign conflict: every anchored current-year sentence narrates favorable while
  // the filed line is signed adverse. The record is a stated withhold that quotes neither.
  {
    const wrb = [
      "Favorable prior year reserve development (net of premium offsets) was $3 million in 2025 and $4 million in 2024 (refer to Note 13 of our consolidated financial statements for more detail).",
      "Favorable prior year reserve development was $47 million in 2025 and $12 million in 2024.",
    ].join(" ");
    const r = dev(wrb, 34.446e6);
    ok("WRB: tone-sign conflict returns a stated withhold, not a quote and not silence",
      !!r && r.conflict === true && r.narrativeTone === "favorable" && r.filedTone === "adverse" && !r.sentence);
  }

  // TRUP, twice dead: no filed number means the lane never runs; and even handed a number, its
  // sentence dates the development "for the year ended December 31, 2024" — the wrong year.
  const trup = "As of December 31, 2025, we had a favorable development on veterinary invoice reserves of $2.5 million for the year ended December 31, 2024.";
  ok("TRUP: no filed development line, no lane", dev(trup, null, "managedCare") === null);
  ok("TRUP: the wrong-year sentence cannot weld even against a matching figure",
    dev(trup, -2.5e6, "managedCare") === null);

  // AFG, the segment pattern: the Q4 segment adverse sliver must neither weld nor manufacture
  // a conflict against the favorable consolidated year, and the workers'-comp line dollar
  // ($108M vs $81M filed) fails the tie — the lane stays silent.
  {
    const afg = [
      "Aggregate Aggregate underwriting results for AFG's property and casualty insurance segment include adverse prior year reserve development of $3 million in the fourth quarter of 2025 and $2 million in the fourth quarter of 2024 related to business outside of the Specialty group that AFG no longer writes.",
      "AFG recorded favorable prior year reserve development of $108 million in 2025, $128 million in 2024 and $116 million in 2023, related to its workers' compensation coverage due to lower than anticipated medical severity.",
    ].join(" ");
    ok("AFG: segment-scoped and non-tying sentences produce silence, not a weld or a false conflict",
      dev(afg, -81e6) === null);
  }

  ok("UNH: the 140/700/840 sentence welds on the current year's $140 million only",
    (() => { const r = dev("Medical costs in 2025, 2024 and 2023 included favorable medical cost development related to prior years of $140 million, $700 million and $840 million, respectively.", -140e6, "managedCare"); return !!r && r.narrated === "$140 million" && r.gapPct === 0; })());

  ok("OSCR: welds to the dollar ($239.5M narrated, $239.525M tagged)",
    (() => { const r = dev("Healthcare costs in the years ended December 31, 2025 and 2024 included favorable healthcare claim development related to prior years, net of reinsurance of $239.5 million and $164.7 million, respectively.", -239.525e6, "managedCare"); return !!r && r.narrated === "$239.5 million" && r.gapPct <= 0.1; })());

  ok("HUM: '$1.0 billion' vs $1,029M tagged welds at 2.8%, inside the 6% tie",
    (() => { const r = dev("Consolidated benefits expense included $1.0 billion of favorable prior-period medical claims reserve development in the 2025 period and $701 million of favorable prior-period medical claims reserve development in the 2024 period.", -1029e6, "managedCare"); return !!r && r.narrated === "$1.0 billion" && r.gapPct === 2.8; })());

  // ALHC, the pinned downgrade: the note's dollar sentence is tabulated in bare thousands
  // ("$ 20,243", on its own stated ex-PAD basis) and can never weld or ship; the dollar-free
  // cause sentence ships on direction alone.
  {
    const alhc = [
      "We recognized a favorable prior year development, excluding provision for adverse deviation, of $ 20,243 , $ 7,052 , and $ 10,996 for the years ended December 31, 2025, 2024, and 2023, respectively.",
      "The favorable prior year development incurred in 2025, 2024 and 2023 was primarily due to better-than-expected claims recoveries and actual claims expense being less than expected.",
    ].join(" ");
    const r = dev(alhc, -25.389e6, "managedCare");
    ok("ALHC: downgrades to the cause quote — direction-only, the unverifiable-dollar sentence refused",
      !!r && r.check === "direction" && /better-than-expected claims recoveries/.test(r.sentence) && !/20,243/.test(r.sentence));
  }

  // MOH rides the same downgrade (measured live 2026-07-31): its "$98 million" sentence dates
  // the SUBJECT years with "for the years ended … 2024, 2023 and 2022", which the wrong-year
  // rung cannot distinguish from Trupanion's form, so it fails closed and the dollar-free
  // cause sentence ships instead — conservative on purpose.
  ok("MOH: ships the cause quote on direction",
    (() => { const r = dev("The favorable prior year development recognized in 2025 was primarily attributable to lower than expected utilization of medical services by our members.", -98e6, "managedCare"); return !!r && r.check === "direction"; })());

  // Insurers ship weld-or-nothing: the same dollar-free agreeing sentence that ships for a
  // health plan stays silent on a carrier (the survey sanctioned the downgrade for managed
  // care only — Kinsale's loss-ratio narration must not become a quote lane by the side door).
  ok("KNSL-class: a dollar-free agreeing sentence ships nothing for an insurer",
    dev("The decrease in the loss ratio for the year ended December 31, 2025 was due primarily to higher relative net favorable development of loss reserves from prior accident years.", -62.8e6, "insurer") === null);

  // The M5 note-window path: the sentence sits in the statement notes, past the MD&A, behind
  // a TOC echo of the same heading — reachable with no MD&A text at all.
  {
    const fx = "Table of Contents Liability for Unpaid Losses 12 Item 8. " +
      "Filler prose about the business, none of it development. ".repeat(20) +
      "Liability for Unpaid Losses and Loss Adjustment Expenses The following summarizes activity. During the year ended December 31, 2025, there was $ 25.8 million adverse prior years' reserve development, net. " +
      "More filler after the note. ".repeat(10);
    const r = reserveDevelopmentRead({ mdnaText: "", fullText: fx, fy: 2025, stored: 25.83e6, kind: "insurer" });
    ok("note window: a development sentence in the statement notes welds without any MD&A",
      !!r && r.check === "dollar" && r.narrated === "$ 25.8 million");
  }
}

// ---------------- BUILD 5 — insurer premium anchors + bank credit-cycle drivers (Banks P2 +
// Insurers P3 merged; docs/qualitative-desks-survey.md SECTION 3). Every filing sentence below
// is VERBATIM from the named FY2025 10-K as the drivers pipeline flattens it (fetched and
// measured 2026-07-31); every {pct, delta} is computed from the fundamentals history the
// caller supplies. Four gates + subject-scope kill unchanged; the one new deny is the
// deltaGuard: a narrated CHANGE dollar that contradicts the computed delta kills a sentence
// even when its percentage ties by coincidence — the division-masquerade Chubb and Travelers
// both measured live. ----

{
  const pick = (sents, key, pct, delta) => pickConsolidated(sents, { fy: 2025, changes: { [key]: { pct, delta } } });

  // CFR (canary): the GAAP NII sentence ties +8.20% computed vs 8.1% narrated; the cause rides
  // the continuation sentence, and the sentence itself runs 48 letters — the splitter's floor
  // was measured against exactly this shape.
  const cfrNii = "Net interest income for 2025 increased $130.3 million, or 8.1%, compared to 2024.";
  const cfrCont = "The increase was primarily related to decreases in the average costs of interest-bearing deposit accounts and repurchase agreements combined with an increase in the average volume of loans, and increases in the average yield on and volume of taxable securities, and, to a lesser extent, tax-exempt securities, among other things.";
  ok("CFR: net interest income welds (+8.20% computed, 8.1% narrated), cause from the continuation",
    (() => { const r = pick([cfrNii, cfrCont], "netInterestIncome", 8.1974, 131537000); return r.length === 1 && r[0].line === "netInterestIncome" && r[0].check === "pct"; })());
  ok("CFR: the taxable-equivalent basis never anchors the GAAP line (its +7.9% ties +8.2% GAAP by coincidence)",
    pick(["Taxable-equivalent net interest income for 2025 increased $134.0 million, or 7.9%, compared to 2024.", cfrCont], "netInterestIncome", 8.1974, 131537000).length === 0);
  ok("CFR: the 48-letter bank driver sentence survives the sentence pool",
    splitSentences(cfrNii + " " + cfrCont).length === 2);

  // FLG (canary): provision ties TO THE DOLLAR (-908M), behind a glued "Comparison to Prior
  // Year" heading, cause from the continuation. The stored tag-chain figure is the arbiter:
  // against a different filed delta the same sentence must NOT weld (nothing ties, no row).
  const flg = "Comparison to Prior Year For the year ended December 31, 2025, the provision for credit losses decreased $908 million compared to the corresponding period for 2024.";
  const flgCont = "This decrease is primarily due to the normalization of credit trends, collateral values and borrower financials, which has resulted in a stabilized ACL and lower net charge-offs in our multi-family and CRE portfolios.";
  ok("FLG: the provision welds on the dollar (-908M exactly)",
    (() => { const r = pick([flg, flgCont], "provisionForCreditLosses", -83.1502, -908000000); return r.length === 1 && r[0].check === "dollar"; })());
  ok("FLG red-team: the stored XBRL figure decides — against a non-tying filed delta, no row",
    pick([flg, flgCont], "provisionForCreditLosses", -75.0, -820000000).length === 0);
  ok("FLG: the parenthesized-percent table tail no longer glues the narration to the table",
    splitSentences("Provision for credit losses $ 184 $ 1,092 $ 833 $ (908) (83) % " + flg).some((s) => /^Comparison to Prior Year For the year ended/.test(s)));
  ok("FLG: the rate-sensitivity hypothetical ('estimated change in net interest income…') never anchors",
    pick(["At December 31, 2025, the estimated change in net interest income over the next twelve months for a 100 basis point reduction in short term interest rates is an increase of 1.51% percent."], "netInterestIncome", -20.0279, -431000000).length === 0);

  // PLMR (canary): +57.2% exact, glued "Net Earned Premiums" heading benign (core reappears),
  // narrated $291.9M ties the computed $291.948M delta; and it was reachable only because the
  // numbered page footer ("51 Table of Contents") is stripped before sentence splitting.
  const plmr = "Net Earned Premiums Net earned premiums increased $291.9 million, or 57.2%, to $802.6 million for the year ended December 31, 2025 from $510.7 million for the year ended December 31, 2024 due primarily to the earning of increased gross written premiums offset by the earning of ceded written premiums under reinsurance agreements.";
  ok("PLMR: net earned premiums welds at 57.2% exact",
    (() => { const r = pick([plmr], "premiumsEarned", 57.1676, 291948000); return r.length === 1 && r[0].pct === 57.2 && r[0].check === "pct"; })());
  ok("PLMR: the numbered page footer no longer buries the sentence behind it",
    splitSentences("Ceded premiums as a share of gross premiums decreased against the prior period on business mix. 51 Table of Contents " + plmr).some((s) => /^Net Earned Premiums Net earned premiums increased/.test(s)));
  const plmrW = "Net Written Premiums Net written premiums increased $319.2 million, or 49.5%, to $964.0 million for the year ended December 31, 2025 from $644.9 million for the year ended December 31, 2024.";
  const plmrWCont = "The increase was primarily due to an increase in gross written premiums, primarily in our Casualty and Crop lines, partially offset by increased ceded written premiums.";
  ok("PLMR: net written premiums welds (+49.5%, delta ties $319.2M vs $319.171M), cause from the continuation",
    (() => { const r = pick([plmrW, plmrWCont], "premiumsWrittenNet", 49.4954, 319171000); return r.length === 1 && r[0].check === "pct"; })());

  // KNSL (canary): 16.7% exact, cause in-sentence.
  ok("KNSL: net earned premiums welds at 16.7% exact",
    (() => { const r = pick(["Net earned premiums were $1.6 billion for the year ended December 31, 2025 compared to $1.4 billion for the year ended December 31, 2024, an increase of $225.4 million, or 16.7% due primarily to continued earning of premium from prior-period growth in gross written premiums and higher net retention levels."], "premiumsEarned", 16.6884, 225372000); return r.length === 1 && r[0].pct === 16.7; })());

  // CB (canary, THE TRAP): a division's premiums — "$81 million, or 6.4 percent" — tie the
  // consolidated +6.36% within tolerance by coincidence, with no scope word in the sentence.
  // The narrated $81M against the computed $3,168M delta is the tell; the deltaGuard kills it.
  ok("CB: the division-premium sentence dies — its narrated $81M contradicts the consolidated $3.17B delta",
    pick(["Net premiums earned increased $81 million, or 6.4 percent, in 2025, reflecting the changes in net premiums written described above."], "premiumsEarned", 6.3556, 3168000000).length === 0);

  // TRV (canary): the old benign-by-luck "Revenues Earned Premiums" revenue row fell to the
  // insurer anchors — which then refuse it too: the sentence is the Business Insurance
  // segment's ($22.41B earned, "$1.07 billion or 5% higher"), its 5% ties the consolidated
  // +4.70% by coincidence, and its narrated delta contradicts the consolidated $1.97B.
  const trvSeg = "Revenues Earned Premiums Earned premiums in 2025 were $22.41 billion, $1.07 billion or 5% higher than in 2024, primarily reflecting the increase in net written premiums over the preceding twelve months.";
  ok("TRV: the segment's glued-heading premium sentence dies on the delta guard",
    pick([trvSeg], "premiumsEarned", 4.7042, 1973000000).length === 0);
  ok("TRV: the same glued heading is still not consolidated REVENUE either (Build 3's rung holds)",
    pick([trvSeg], "revenue", 5.18, 2405000000).length === 0);
  // The mirrored consolidated shape (synthetic: TRV's own consolidated figures in the same
  // glued-heading form) ships — the allowance is live, the guard kills only contradictions.
  ok("a consolidated glued-heading premium sentence with a TYING delta ships",
    (() => { const r = pick(["Revenues Earned Premiums Earned premiums in 2025 were $43.91 billion, $1.97 billion or 5% higher than in 2024, primarily reflecting the increase in net written premiums over the preceding twelve months."], "premiumsEarned", 4.7042, 1973000000); return r.length === 1 && r[0].check === "pct"; })());

  // Three trap classes measured live on the Build 5 pool run (each shipped before its kill,
  // none had ever shipped in the baseline — the kills cost nothing and buy the doctrine):

  // (1) The FTE class: banks write the taxable-equivalent qualifier AFTER the line item, where
  // no head anchor can refuse it, and the FTE change ties the GAAP series within tolerance by
  // coincidence — the Lamar non-GAAP-basis class in postfix form.
  ok("AVBH: 'on a taxable equivalent basis' after the anchor never verifies the GAAP chip",
    pick(["Net interest income on a taxable equivalent basis for the year ended December 31, 2025, was $87.3 million, an increase of $12.1 million, or 16% over $75.2 million for the year ended December 31, 2024.", "The increase in net interest income was primarily due to loan growth."], "netInterestIncome", 16.1, 12100000).length === 0);
  ok("TFC: the bare '- TE' acronym form dies too",
    pick(["Net interest income - TE for the year ended December 31, 2025 was up $316 million, or 2.2%, compared to the year ended December 31, 2024 primarily due to loan and deposit growth, fixed-rate asset repricing, and the balance sheet."], "netInterestIncome", 2.4, 316000000).length === 0);

  // (2) The gross-for-net class: the survey regex's optional "Gross" head shipped W. R.
  // Berkley's gross-written +6.3% under the "Net premiums written" chip (net computed +6.2%,
  // a coincidence tie). A gross narration can never anchor a net line.
  ok("WRB: a gross-premiums sentence never wears the net-premiums chip",
    pick(["Gross premiums written were $15,105 million in 2025, an increase of 6% from $14,211 million in 2024.", "The increase was due to the growth in the Insurance segment of $803 million and in the Reinsurance & Monoline Excess segment."], "premiumsWrittenNet", 6.2, 894000000).length === 0);

  // (3) The adjacent-dollar table run: Root's flattened table row glued to the NEXT
  // paragraph's gross-premium cause sentence and pct-tied the consolidated +30.9%.
  ok("ROOT: three adjacent dollar cells are a table, never a driver",
    pick(["Net premiums earned $ 1,401.7 $ 1,070.9 $ 330.8 30.9 % Gross premiums written increased due to growth in new writings as a result of continued growth in our partnership channel."], "premiumsEarned", 30.9, 330800000).length === 0);

  // And the survivor beside them: a plain net-written narration on a real filer still ships.
  ok("LMND: net written premium welds (+83.9% computed, 84% narrated, $348.4M delta tie)",
    (() => { const r = pick(["Net written premium increased $348.4 million, or 84%, to $763.5 million for the year ended December 31, 2025 compared to the year ended December 31, 2024 due to factors noted above."], "premiumsWrittenNet", 83.9, 348400000); return r.length === 1 && r[0].check === "pct"; })());
}

// ---------------- AUDIT-FIX ITEMS 6-9 (2026-07-31): the structural render gates ----------------
{
  // Item 9: the lens skip-set — a bank/REIT/utility pool never receives a concentration flag.
  const ccPool = [{ s: "Our largest customer accounted for 14% of total revenues in 2025, and our top five customers represented 38% of revenues.", section: "Business" }];
  ok("item 9: a genuine concentration sentence flags for an operator",
    ownerFlags(ccPool).some((f) => f.lens === "Customer concentration"));
  ok("item 9: the same sentence never flags when the lens is retired for the archetype",
    !ownerFlags(ccPool, new Set(["Customer concentration"])).some((f) => f.lens === "Customer concentration"));
  // Item 9: geography wears concentration's clothes and dies at the lens.
  ok("item 9: a geographic revenue split never wears the concentration flag",
    !theme("Customer concentration").test("Customers outside the United States accounted for 54% of our total revenues for the year ended December 31, 2025."));

  // Item 8: rev-rec allocation mechanics are not pricing pressure.
  const bp = (mdnaSents) => buffettRead({ mdna: { sents: mdnaSents }, business: { sents: [] }, risk: { sents: [] } }, false);
  ok("item 8: a standalone-selling-price sentence never ships as pricing pressure",
    bp(["Significant judgment is required in determining standalone selling prices where price competition and discounting practices affect the range of observable prices for our products."])?.pricing?.pressure == null);
  // Item 8: an operating-expense variance is not an input-cost stance, however hard its bare
  // "partially" leans on OFFSET_NEG.
  ok("item 8: an R&D-variance sentence never ships as a cost squeeze",
    bp(["Research and development expenses increased $28.4 million due to higher personnel costs, partially offset by an increase in capitalized software development costs."])?.pricing?.costInflation == null);
  // The genuine squeeze beside it still ships.
  ok("item 8: a real unrecovered input-cost squeeze still ships",
    bp(["Raw material costs increased $42 million during 2025, and our price increases were not able to fully offset these higher input costs."])?.pricing?.costInflation != null);
}

// ---------------- BUILD 6 — uninsured deposits, rung (a) + quote-only (Banks P3 as
// CONDITIONED; docs/qualitative-desks-survey.md SECTION 1 item 3 + SECTION 3). Every filing
// sentence below is VERBATIM from the named FY2025 10-K as the pipeline flattens it (fetched
// and measured 2026-07-31); every deposits denominator is the stored XBRL Deposits line for
// that fiscal year. The lane ships three shapes only: a WELD (stated $ over Deposits within
// 1.5pt of the stated %), a QUOTE-ONLY single-figure disclosure (no computed figure — that IS
// rung (b), and rung (b) waits), or a stated WITHHOLD (netted basis, or a failed check).
// Measured on the survey's 11 filings end-to-end: FLG welds at 20.45%; JPM/PNC/WAL/BMRC ship
// quote-only (with FLG, exactly the survey's five clean-prose names); CUBI/VLY/EWBC/GCBC
// withhold as netted-basis; ZION and CFR are silence. ----

{
  const read = (mdnaText, deposits, fullText = "") => uninsuredDepositsRead({ mdnaText, fullText, fy: 2025, deposits });

  // FLG (the exemplar): $13.5B over stored Deposits of exactly $66.0B computes 20.45%,
  // inside 1.5 points of the sentence's own "20 percent". The basis words — "uninsured or
  // not collateralized by securities or letters of credit" — ride INSIDE the quote.
  const flg = "The majority of our customer deposits are covered by FDIC deposit insurance with $13.5 billion of deposits that are uninsured or not collateralized by securities or letters of credit, representing 20 percent of our overall deposit base.";
  ok("FLG: the exemplar welds (20.45% computed vs '20 percent' stated, gap 0.45pt, Deposits 66.0B exact)",
    (() => { const r = read(flg, 66.0e9); return !!r && r.check === "pct" && r.computedPct === 20.45 && r.gapPct === 0.45 && r.statedDollar === "$13.5 billion" && r.statedPct === "20 percent" && r.sentence === flg; })());
  ok("FLG red-team: the stored XBRL line decides — against a different Deposits figure the same sentence is a stated withhold, never a quote",
    (() => { const r = read(flg, 55.0e9); return !!r && r.withheld === true && r.reason === "check" && r.gapPct > 1.5; })());
  ok("FLG: the liquidity-EXCESS sentence never ships — its $13.6 billion is the excess, not the level",
    read("As of December 31, 2025, total bank liquidity exceeds the balance of our uninsured deposits by $13.6 billion.", 66.0e9) === null);

  // The quote-only rung: single-figure disclosures ship the filer's words alone. Computing
  // the missing percent is rung (b) — killed until a measured basis-divergence study.
  const jpm = "At December 31, 2025 and 2024, Firmwide estimated uninsured deposits were $1,558.6 billion and $1,414.0 billion, respectively, primarily reflecting wholesale operating deposits.";
  ok("JPM: a single-figure disclosure ships quote-only, NO computed percent beside it",
    (() => { const r = read(jpm, 2559.32e9); return !!r && r.check === "quote" && r.computedPct === undefined && r.sentence === jpm; })());
  const pnc = "The aggregate amount of uninsured deposits, based on the regulatory instructions in the Consolidated Reports of Condition and Income - FFIEC 031, was estimated to be $209.3 billion and $194.9 billion at December 31, 2025 and 2024, respectively.";
  ok("PNC: ships quote-only with its FFIEC basis INSIDE the quote — basis words are never paraphrased outside it",
    (() => { const r = read(pnc, 440.866e9); return !!r && r.check === "quote" && /FFIEC 031/.test(r.sentence); })());
  ok("BMRC: the percent-only disclosure ships quote-only ('31% of uninsured and/or uncollateralized deposits')",
    (() => { const r = read("We maintain a well-diversified deposit base, with an estimated 31% of uninsured and/or uncollateralized deposits as of December 31, 2025.", 3.415542e9); return !!r && r.check === "quote" && r.computedPct === undefined; })());

  // WAL: the ship sits directly behind a bare digit-% table tail with no sentence boundary
  // at all — the lane's splitter opens one, and the clean sentence emerges.
  const wal = "At December 31, 2025 and 2024, the Company had total uninsured deposits of $22.9 billion and $17.6 billion, respectively.";
  ok("WAL: the % table tail opens a boundary and the glued ship emerges clean",
    (() => { const r = read("Total deposits $ 73,817 2.08 % $ 65,719 2.43 % $ 53,563 2.13 % " + wal, 77.159e9); return !!r && r.check === "quote" && r.sentence === wal; })());
  ok("WAL: the CDARS/ICS mitigation sentence never ships — its dollars are program limits, not the level",
    read("To mitigate the uninsured deposit risk, the Company participates in the CDARS and ICS programs, which allow an individual customer to invest up to $50 million and $285 million, respectively, through one participating financial institution or, a combined total of $335 million per individual customer, with the entire amount being covered by FDIC insurance.", 77.159e9) === null);
  ok("WAL: the special-assessment boilerplate's own 'adjusted to exclude…' never marks the filer netted-basis",
    (() => { const sa = "Throughout the initial eight-quarter collection period, the special assessment was collected at a quarterly rate of 3.36 basis points, multiplied by an institution's estimated uninsured deposits as of December 31, 2022, adjusted to exclude the first $5 billion of estimated uninsured deposits."; const r = read(sa + " " + wal, 77.159e9); return !!r && r.check === "quote" && r.sentence === wal; })());

  // The netted-basis gate: a filer whose disclosure nets collateralized/affiliate/intercompany
  // deposits produces ZERO welds and ZERO quotes — a stated withhold with the filer's own
  // basis words. CUBI's clean-looking "$8.6 billion" sentence sits right beside the netted
  // series; the basis verdict outranks it.
  ok("CUBI: netted-basis withhold, stated with the filer's own words ('less collateralized and affiliate deposits')",
    (() => { const cubi = "The total amount of estimated uninsured deposits was $8.6 billion and $7.3 billion at December 31, 2025 and 2024, respectively. We maintain a strong liquidity position, with $10.6 billion of liquidity immediately available consisting of cash on hand and available borrowing capacity from the FHLB and the FRB, which covered approximately 124% of uninsured deposits and approximately 161% of uninsured deposits less collateralized and affiliate deposits at December 31, 2025."; const r = read(cubi, 20.778704e9); return !!r && r.withheld === true && r.reason === "netted basis" && /less collateralized and affiliate/.test(r.basis); })());
  // VLY is the pinned PROOF the basis gate must outrank the arithmetic: its netted numerator
  // over gross XBRL Deposits TIES its own stated percent ($14.6B/$52.18B = 27.98% vs "28
  // percent", gap 0.02pt) — the wrong denominator is invisible to the check, so the basis
  // itself is the gate (survey Section 1 item 3, verbatim reasoning).
  ok("VLY: the arithmetic ties at 0.02pt and the netted basis STILL withholds — no gate downstream of the basis can see the miss",
    (() => { const vly = "Total estimated uninsured deposits, excluding collateralized government deposits and intercompany deposits (i.e., deposits eliminated in consolidation), totaled approximately $14.6 billion, or 28 percent of total deposits, at December 31, 2025 as compared to $12.6 billion, or 25 percent of total deposits, at December 31, 2024."; const r = read(vly, 52.183093e9); return !!r && r.withheld === true && r.reason === "netted basis"; })());
  ok("EWBC: 'an adjustment to exclude collateralized and affiliate deposits' marks the filer netted — zero welds",
    (() => { const r = read("Management believes that presenting uninsured domestic deposits with an adjustment to exclude collateralized and affiliate deposits provides a more accurate view of the deposits at risk, given that collateralized deposits are secured, and affiliate deposits are not customer-facing and are eliminated in consolidation.", 67.082701e9); return !!r && r.withheld === true && r.reason === "netted basis"; })());
  ok("GCBC: the netted verdict reads the FULL text — the exclusion table sits past the thin extracted MD&A",
    (() => { const r = read("", 2.639835e9, "The following table estimates uninsured deposits after certain exclusions : (Dollars in thousands) At June 30, 2025 Uninsured deposits, per regulatory requirements $ 1,437,328 Less: Affiliate deposits (59,018 ) Collateralized deposits (1,049,268 ) Uninsured deposits, after exclusions $ 329,042"); return !!r && r.withheld === true && r.reason === "netted basis"; })());

  // The remaining measured kills: each was a live near-miss on the sample.
  ok("ZION: the page-header-glued two-figure sentence is a table capture, not clean prose — refused",
    read("ZIONS BANCORPORATION, NATIONAL ASSOCIATION AND SUBSIDIARIES At December 31, 2025, the total estimated amount of uninsured deposits was $34.4 billion, or 45% of total deposits, compared with $34.4 billion, or 45%, at December 31, 2024.", 75.644e9) === null);
  ok("ZION: a liquidity-coverage sentence never wears the level ('sources of liquidity exceeded…')",
    read("At December 31, 2025, our sources of liquidity exceeded the estimated amount of uninsured deposits of $34.4 billion without the need to sell any investment securities.", 75.644e9) === null);
  ok("BMRC: its own coverage sentence never ships — the $2.148 billion and 209% are the coverage, not the level",
    read("Such uninsured deposits were fully covered by the Bank's available funding sources, including unrestricted cash, unencumbered available-for-sale securities, and a total available borrowing capacity of $2.148 billion, or 63% of total deposits, and 209% of estimated uninsured and/or uncollateralized deposits as of December 31, 2025.", 3.415542e9) === null);
  ok("CFR: the Item 1A sentence dies on the reliance idiom ('…and we rely on these deposits for liquidity') — risk-factor scope survives the measured MD&A section bleed",
    read("As of December 31, 2025, approximately 52% of our deposits were uninsured and we rely on these deposits for liquidity.", 42.917864e9) === null);
  ok("the FDIC special-assessment boilerplate is never a candidate (anchored 'December 31, 2022' / 'special assessment')",
    read("The assessment base for the special assessments is equal to an insured depository institution's estimated uninsured deposits, reported as of December 31, 2022, adjusted to exclude the first $5 billion in estimated uninsured deposits from the insured depository institution.", 66.0e9) === null);
  ok("EWBC-class: a time-deposit SUBSET never wears the level ('Uninsured time deposits totaled $15.2 billion')",
    read("Uninsured time deposits totaled $15.2 billion as of December 31, 2025.", 67.082701e9) === null);
  ok("a dollar with no unit word is refused — a '(in thousands)' numeral has no knowable scale in prose",
    read("Total estimated uninsured deposits were $ 1,437,328 at June 30, 2025.", 2.639835e9) === null);
  ok("a prior-year-only sentence never ships in the current filing",
    read("At December 31, 2024, the Company had total uninsured deposits of $17.6 billion.", 77.159e9) === null);
  ok("a stated dollar above the whole Deposits line fails closed — a mis-scoped figure cannot ship",
    read("At December 31, 2025, the Company had total uninsured deposits of $122.9 billion.", 77.159e9) === null);
}

// ---------------- BUILD 7 — software NRR + the customer ladder (SW P1 + P2, both pure M3
// substring lanes; docs/qualitative-desks-survey.md SECTION 3), plus the SW P3 discontinuity
// tripwire riding the records. Every filing sentence below is VERBATIM from the named
// FY2025/FY2026 10-K as the pipeline flattens it (fetched and measured 2026-07-31). The lane
// never computes, totals, normalizes, or restates a number: every shipped figure is a
// substring of its own quoted sentence, welded at write time. ----

{
  const nrrOf = (mdnaText, fy) => softwareRetentionRead(mdnaText, fy).retention;
  const ladOf = (mdnaText, fy, businessText = "") => customerLadderRead({ mdnaText, businessText, fy });

  // --- lane 1: the seven NRR names, figures verbatim-in-sentence ---
  const mdbNrr = "As of January 31, 2026, our net ARR expansion rate was approximately 121%.";
  {
    const r = nrrOf(mdbNrr, 2026);
    ok("MDB: net ARR expansion rate ships 'approximately 121%'", r.length === 1 && r[0].figure === "approximately 121%" && r[0].label === "net ARR expansion rate");
    ok("MDB: the shipped figure is a literal substring of the shipped sentence", r[0].sentence.includes(r[0].figure));
  }
  ok("MDB: 'Historically … has been over 120%' never ships — no period binding, comparative figure",
    nrrOf("Historically, our net ARR expansion rate has been over 120%.", 2026).length === 0);

  ok("PD: 98% binds to 'the fiscal year ended January 31, 2026'",
    (() => { const r = nrrOf("Our dollar-based net retention rate was 98% for the fiscal year ended January 31, 2026.", 2026); return r.length === 1 && r[0].figure === "98%"; })());

  const ddogNrr = "As of December 31, 2025, our trailing 12-month dollar-based net retention rate was about 120%.";
  const ddogStaleBand = "As of December 31, 2024, our trailing 12-month dollar-based net retention rate was high-110%'s.";
  {
    const r = softwareRetentionRead(ddogNrr + " " + ddogStaleBand, 2025);
    ok("DDOG: 'about 120%' ships with the qualifier inside the chip", r.retention.length === 1 && r.retention[0].figure === "about 120%");
    ok("DDOG: the 2024-dated band sentence in the CURRENT filing is neither a figure nor a band record (period binding)",
      r.bands.length === 0);
  }
  ok("DDOG prior filing: the current-bound band is recorded as a BAND, never as a figure",
    (() => { const r = softwareRetentionRead(ddogStaleBand, 2024); return r.retention.length === 0 && r.bands.length === 1 && r.bands[0].band === "high-110%'s"; })());

  const netNrr = "Our dollar-based net retention rates were 120%, 111%, and 115% for the three months ended December 31, 2025, 2024, and 2023, respectively.";
  {
    const r = nrrOf(netNrr, 2025);
    ok("NET: the three-period sentence ships 120% — parallel structure pairs value to year, basis words stay inside the quote",
      r.length === 1 && r[0].figure === "120%" && /three months ended/.test(r[0].sentence));
  }
  ok("NET: the revenue-driver sentence (40% beside 120%, both years the same) dies on monotonicity",
    nrrOf("The increase in revenue was primarily due to the addition of new paying customers, which increased by 40% during the year ended December 31, 2025, as well as expansion within our existing paying customers, which was reflected by our dollar-based net retention rate of 120% for the three months ended December 31, 2025.", 2025).length === 0);
  ok("parallel red-team: three values against two years ships nothing",
    nrrOf("Our dollar-based net retention rates were 120%, 111%, and 115% for the three months ended December 31, 2025 and 2024, respectively.", 2025).length === 0);
  ok("monotonicity red-team: a shuffled year list ships nothing",
    nrrOf("Our dollar-based net retention rates were 120%, 111%, and 115% for the three months ended December 31, 2025, 2023, and 2024, respectively.", 2025).length === 0);

  ok("ESTC: 'approximately 112%' ships",
    (() => { const r = nrrOf("Our Net Expansion Rate was approximately 112% as of April 30, 2026.", 2026); return r.length === 1 && r[0].figure === "approximately 112%"; })());
  ok("ESTC: the hypothetical 100% decoy dies ('if each customer … would be 100%')",
    nrrOf("For instance, if each customer had a one-year subscription and renewed its subscription for the same amount, the Net Expansion Rate would be 100%.", 2026).length === 0);

  const frogNrr = "As of December 31, 2025 and 2024, our net dollar retention rate was 119% and 116%, respectively.";
  ok("FROG: 119% ships from the two-period sentence", (() => { const r = nrrOf(frogNrr, 2025); return r.length === 1 && r[0].figure === "119%"; })());
  ok("FROG: the forward-looking sentence never anchors ('We expect our net dollar retention rate to remain relatively stable…')",
    nrrOf("We expect our net dollar retention rate to remain relatively stable, with minor fluctuations around current levels.", 2025).length === 0);

  // AMPL, the two-variant case: TTM and ending are DIFFERENT metrics under near-identical
  // labels — they ship as two rows and each corroborates only against its own kind.
  const amplTtm = "As of December 31, 2025 and 2024, our dollar-based net retention rate (TTM) across paying customers was 104% and 97%, respectively.";
  const amplEnd = "Additionally, our ending dollar-based net retention rate for paying customers as of December 31, 2025 and 2024, was 105% and 100%, respectively.";
  const amplUnlabeled = "As of December 31, 2025 and 2024, our TTM was 104% and 97%, respectively, for paying customers.";
  {
    const r = nrrOf([amplTtm, amplEnd, amplUnlabeled].join(" "), 2025);
    ok("AMPL: the two label variants ship as two rows (104% TTM, 105% ending)",
      r.length === 2 && r[0].figure === "104%" && r[1].figure === "105%" && r[0].label !== r[1].label);
    ok("AMPL: the unlabeled 'our TTM was' sentence is never a row", !r.some((x) => x.sentence === amplUnlabeled));
  }

  // --- cross-filing prior-year corroboration (assembly) ---
  const kpi = (mdnaText, fy, businessText = "") => softwareKpiRead({ mdnaText, businessText, fy });
  {
    const cur = kpi(netNrr, 2025);
    const pri = kpi("Our dollar-based net retention rates for the three months ended December 31, 2024, 2023, and 2022 were 111%, 115%, and 122%, respectively.", 2024);
    const asm = softwareKpiAssemble(cur, pri);
    ok("NET: the prior filing's 111%/115% corroborate the current sentence's 2024/2023 figures",
      asm.nrr?.length === 1 && asm.nrr[0].corroborated === true && !asm.withheld);
  }
  {
    const cur = kpi(frogNrr, 2025);
    const priGood = kpi("As of December 31, 2024 and 2023, our net dollar retention rate was 116% and 119%, respectively.", 2024);
    ok("FROG: 116% for 2024 corroborates across filings", softwareKpiAssemble(cur, priGood).nrr?.[0]?.corroborated === true);
    const priBad = kpi("As of December 31, 2024 and 2023, our net dollar retention rate was 112% and 119%, respectively.", 2024);
    const asm = softwareKpiAssemble(cur, priBad);
    ok("corroboration red-team: a conflicting prior-year figure is a stated withhold — no figure ships, both sentences named",
      !asm.nrr && asm.withheld?.length === 1 && asm.withheld[0].year === 2024 && !!asm.withheld[0].current && !!asm.withheld[0].prior);
  }
  {
    const cur = kpi([amplTtm, amplEnd].join(" "), 2025);
    const pri = kpi([
      "As of December 31, 2024 and 2023, our dollar-based net retention rate (TTM) across paying customers was 97% and 101%, respectively.",
      "Additionally, our ending dollar-based net retention rate for paying customers as of December 31, 2024 and 2023, was 100% and 98%, respectively.",
    ].join(" "), 2024);
    const asm = softwareKpiAssemble(cur, pri);
    ok("AMPL: each variant corroborates against its own kind (TTM 97, ending 100), never across",
      asm.nrr?.length === 2 && asm.nrr.every((x) => x.corroborated === true));
  }

  // --- lane 2: the customer ladder, nine names ---
  ok("MDB: 2,799 at $100,000 from the three-period 'respectively' run",
    (() => { const r = ladOf("The number of customers with $100,000 or greater in ARR was 2,799, 2,396 and 2,052 as of January 31, 2026, 2025 and 2024, respectively.", 2026); return r.ladder.length === 1 && r.ladder[0].count === "2,799" && r.ladder[0].threshold === "$100,000"; })());
  ok("MDB: the total ships 'over 65,200' — the qualifier is part of the figure and rides the chip",
    (() => { const r = ladOf("As of January 31, 2026, we had over 65,200 customers across a wide range of industries and in over 100 countries, compared to over 54,500 customers and over 47,800 customers as of January 31, 2025 and 2024, respectively.", 2026); return r.ladder.length === 1 && r.ladder[0].count === "over 65,200" && !r.ladder[0].threshold && r.refused.length === 0; })());

  ok("PD: 15,351 ships from the compared-to sentence (the count WITH its prior year)",
    (() => { const r = ladOf("As of January 31, 2026, we had 15,351 paying customers spanning organizations of a broad range of sizes and industries, compared to 15,114 as of January 31, 2025.", 2026); return r.ladder.length === 1 && r.ladder[0].count === "15,351"; })());
  ok("PD: the undated 'Of these customers, 861…' cohort sentence never ships (no period binding)",
    ladOf('Of these customers, 861 customers contribute annual recurring revenue ("ARR") in excess of $100.0 thousand, and 79 customers contribute ARR in excess of $1.0 million.', 2026).ladder.length === 0);

  ok("DDOG: 4,310 at $100,000 — the 90%-of-ARR share stays inside the quote",
    (() => { const r = ladOf("As of December 31, 2025, we had approximately 4,310 customers with annual run-rate revenue, or ARR, of $100,000 or more, representing 90% of our ARR, up from 3,610 as of December 31, 2024, representing 88% of our ARR.", 2025); return r.ladder.length === 1 && r.ladder[0].count === "approximately 4,310" && r.ladder[0].threshold === "$100,000" && /90% of our ARR/.test(r.ladder[0].sentence); })());
  ok("DDOG: 603 at $1.0 million ('up from 462' pairs the years)",
    (() => { const r = ladOf("As of December 31, 2025, we had approximately 603 customers with annual run-rate revenue, or ARR, of $1.0 million or more, up from 462 as of December 31, 2024.", 2025); return r.ladder.length === 1 && r.ladder[0].count === "approximately 603" && r.ladder[0].threshold === "$1.0 million"; })());
  ok("DDOG: '1,000 out-of-the-box integrations … our customers' is not a customer count",
    ladOf("", 2025, "We have over 1,000 out-of-the-box integrations with technologies to provide significant value to our customers without the need for professional services.").ladder.length === 0);
  ok("DDOG: a bare comparative WITHOUT a metric in reach ('in over 160 countries') is not a loud failure",
    (() => { const r = ladOf("", 2025, "As of December 31, 2025, we had approximately 32,700 customers in over 160 countries."); return r.refused.length === 0 && r.ladder.length === 1 && r.ladder[0].count === "approximately 32,700"; })());

  // NET, the pinned loud failure: page glue ate the threshold's dollar form. The glue-strip
  // removes only the literal "Table of contents" run, so the orphaned page number stays and
  // the closed set refuses the phrase LOUDLY — "greater than 82" can never ship.
  {
    const r = ladOf("We view the number of customers with Annualized Revenue greater than 82 Table of contents $100,000 as indicative of our penetration within large enterprise accounts.", 2025);
    ok("NET: 'greater than 82 Table of contents' fails the closed threshold set loudly — recorded, nothing ships",
      r.ladder.length === 0 && r.refused.length === 1 && r.refused[0].token === "greater than 82" && r.refused[0].reason === "threshold set");
  }
  ok("NET: the clean cohort sentence beside the decoy ships 4,298 at $100,000",
    (() => { const r = ladOf("The number of paying customers with Annualized Revenue greater than $100,000 was 4,298, 3,497, and 2,756 for the three months ended December 31, 2025, 2024, and 2023, respectively.", 2025); return r.ladder.length === 1 && r.ladder[0].count === "4,298" && r.ladder[0].threshold === "$100,000"; })());
  ok("NET: the paying-customer total ships 332,466 from the number-of run",
    (() => { const r = ladOf("The number of paying customers was 332,466, 237,714, and 189,791 for the three months ended December 31, 2025, 2024, and 2023, respectively.", 2025); return r.ladder.length === 1 && r.ladder[0].count === "332,466" && !r.ladder[0].threshold; })());

  ok("ESTC: 'over 1,720' at $100,000 — the was-run counts are counts, never loud-failed thresholds",
    (() => { const r = ladOf('The number of customers who represented greater than $100,000 in annual contract value ("ACV") was over 1,720 and over 1,510 as of April 30, 2026 and 2025, respectively.', 2026); return r.refused.length === 0 && r.ladder.length === 1 && r.ladder[0].count === "over 1,720"; })());
  ok("ESTC: 'over 240' at $1.0 million",
    (() => { const r = ladOf("In addition, we had over 240 customers who represented greater than $1.0 million in ACV as of April 30, 2026.", 2026); return r.ladder.length === 1 && r.ladder[0].count === "over 240" && r.ladder[0].threshold === "$1.0 million"; })());
  ok("ESTC: the total ships 'approximately 24,000' from the three-period comparison",
    (() => { const r = ladOf("", 2026, "As of April 30, 2026, we had approximately 24,000 customers compared to approximately 21,500 and approximately 21,000 customers as of April 30, 2025 and 2024, respectively."); return r.ladder.length === 1 && r.ladder[0].count === "approximately 24,000"; })());

  ok("FROG: 1,168 at $100,000 ('1,168 of our customers', date-glued run stays clean)",
    (() => { const r = ladOf("As of December 31, 2025, 1,168 of our customers had ARR of $100,000 or more, increasing from 1,018 customers as of December 31, 2024.", 2025); return r.ladder.length === 1 && r.ladder[0].count === "1,168"; })());
  ok("FROG: 74 at $1.0 million",
    (() => { const r = ladOf("We had 74 customers with ARR of at least $1.0 million as of December 31, 2025, increasing from 52 customers as of December 31, 2024.", 2025); return r.ladder.length === 1 && r.ladder[0].count === "74"; })());

  ok("AMPL: the single-year two-cohort sentence ships TWO rows (698 at $100,000, 56 at $1.0 million) by interleaved pairing",
    (() => { const r = ladOf('As of December 31, 2025, we had 698 paying customers that each represented greater than $100,000 in annual recurring revenue ("ARR") and 56 customers that each represented greater than $1.0 million in ARR, demonstrating the mission critical nature of our platform to help customers succeed in the new digital age.', 2025); return r.ladder.length === 2 && r.ladder[0].count === "698" && r.ladder[0].threshold === "$100,000" && r.ladder[1].count === "56" && r.ladder[1].threshold === "$1.0 million"; })());
  ok("AMPL: the flattened metric-table row ('…(TTM) 104 % 97 % Paying Customers with ARR of $100,000 or greater 698 591 18 %') is refused — the destroyed header makes number-to-year mapping impossible",
    ladOf("54 As of December 31, 2025 2024 YoY Growth (dollar values in millions) Annual Recurring Revenue (ARR) $ 366 $ 312 17 % Dollar-Based Net Retention Rate (TTM) 104 % 97 % Paying Customers with ARR of $100,000 or greater 698 591 18 %", 2025).ladder.length === 0);
  ok("AMPL: a prior-year-only cohort sentence in the current filing never ships ('…for the years ended December 31, 2024')",
    ladOf("In comparison, we had 591 customers that each represented greater than $100,000 in ARR and 42 customers that each represented greater than $1.0 million in ARR for the years ended December 31, 2024.", 2025).ladder.length === 0);

  const iotCore = "As of January 31, 2026, we had more than 12,000 customers who each represented $25,000 or more in ARR, or Core Customers, and approximately 85% of our ARR came from Core Customers.";
  const iotCorePri = "As of February 1, 2025, we had more than 20,000 customers, each representing $10,000 or more in ARR, or Core Customers, and approximately 93% of our ARR came from Core Customers.";
  ok("IOT: 'more than 12,000' Core Customers at $25,000, cohort label captured",
    (() => { const r = ladOf(iotCore, 2026); return r.ladder.length === 1 && r.ladder[0].count === "more than 12,000" && r.ladder[0].threshold === "$25,000" && r.ladder[0].cohort === "Core Customers"; })());
  ok("IOT: 3,194 at $100,000 from the ascending from/to sentence — the CURRENT year's count, not the prior",
    (() => { const r = ladOf("The number of our customers representing over $100,000 in ARR has increased over time from 2,484 as of February 1, 2025 to 3,194 customers as of January 31, 2026.", 2026); return r.ladder.length === 1 && r.ladder[0].count === "3,194"; })());
  ok("IOT: 'Under our prior definition…' never ships — a superseded basis is not a rung",
    ladOf("", 2026, "Under our prior definition, as of January 31, 2026, we had over 23,000 customers with over $10,000 in ARR, and approximately 94% of our total ARR came from customers with over $10,000 in ARR.").ladder.length === 0);

  ok("NOW: 603 at $5 million from the comma-run ('We had 603, 502, and 420 customers…')",
    (() => { const r = ladOf("We had 603, 502, and 420 customers with ACV greater than $5 million as of December 31, 2025, 2024 and 2023, respectively.", 2025); return r.ladder.length === 1 && r.ladder[0].count === "603" && r.ladder[0].threshold === "$5 million"; })());
  ok("NOW: the total ships 'approximately 8,700' whole, never split at its comma",
    (() => { const r = ladOf("As of December 31, 2025, we had approximately 8,700 customers across a wide variety of industries.", 2025); return r.ladder.length === 1 && r.ladder[0].count === "approximately 8,700"; })());

  // --- the discontinuity tripwire: compares only already-gated records ---
  {
    const cur = kpi(iotCore, 2026);
    const pri = kpi(iotCorePri, 2025);
    const asm = softwareKpiAssemble(cur, pri);
    ok("IOT fires REDEFINED: the same named cohort moved $10,000 → $25,000, both sentences ship side by side",
      asm.tripwire?.length === 1 && asm.tripwire[0].flag === "REDEFINED" && asm.tripwire[0].label === "Core Customers"
      && asm.tripwire[0].current === iotCore && asm.tripwire[0].prior === iotCorePri);
  }
  {
    const cur = kpi(ddogNrr + " " + ddogStaleBand, 2025);
    const pri = kpi(ddogStaleBand, 2024);
    const asm = softwareKpiAssemble(cur, pri);
    ok("DDOG fires DEGRADED: a numeric figure beside the prior filing's qualitative band, both sentences ship",
      asm.tripwire?.length === 1 && asm.tripwire[0].flag === "DEGRADED"
      && asm.tripwire[0].current === ddogNrr && asm.tripwire[0].prior === ddogStaleBand);
  }
  {
    const cur = kpi("Our dollar-based net retention rate was 98% for the fiscal year ended January 31, 2026.", 2026);
    const pri = kpi("Our dollar-based net retention rate was 106% for the fiscal year ended January 31, 2025.", 2025);
    const asm = softwareKpiAssemble(cur, pri);
    ok("PD does not fire: numeric both years, no cohort renamed", !asm.tripwire);
  }
}

console.log(`\nlanguageGatesTest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
