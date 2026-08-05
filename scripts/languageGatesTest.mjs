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
  RC_ILLUSTRATION, RC_NO_ASSURANCE, RC_BOTH_DIRECTIONS, RC_PARALLEL_LIST, RC_GRANT_VERB,
  ownerFlags, buffettRead,
  uninsuredDepositsRead,
  softwareRetentionRead, customerLadderRead, softwareKpiRead, softwareKpiAssemble,
  reserveEngineerRead, ogCriticalTopics,
  reitLeasingRead,
  utilityRegRead,
  mlrCostTrendRead,
  rateCaseRead,
} from "./fetchFilings.mjs";
import { mlrTrendTie } from "../src/lib/managedCare.mjs";

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

// ---------------- BUILD 8 — O&G reserve attribution + critical-estimates topics (O&G P1 +
// P2 bundled; docs/qualitative-desks-survey.md SECTION 3). Every filing sentence below is
// VERBATIM from the named FY2025 10-K as the pipeline flattens it (fetched and measured
// 2026-07-31). The lane's laws: firm dictionary >= 2 occurrences, dictionary miss =
// silence; VERB FIDELITY — the filer's own token, never normalized ("reviewed" is NEVER
// rendered as "audited"); a coverage percent chips ONLY from inside the sentence with its
// verbatim object phrase; the PV-token ban (no PV-10 / present-value figures); XOM renders
// internal-only from its own sentence. The 15/15 attribution sample reproduces. On topics,
// the doc's 13/15 measured 15/15 on the real filings: EGY's critical-estimates section
// continues past ARO/taxes into "Oil and Gas Accounting — Reserves Determination" and XOM's
// zone sat behind the extraction gap the survey itself flags — both name reserve estimation
// verbatim in their own sections, so both render (the stated Build 8 deviation, filings
// over stored expectation). ----

{
  // A firm's second occurrence rides a fragment too short to ever be a candidate sentence,
  // so the >=2 dictionary rung is satisfied without adding quote material.
  const attr = (fullText) => reserveEngineerRead({ fullText, fy: 2025 });
  const plus = (s, firm) => `${s} ${firm}.`;

  // DVN, the doc's named coverage exemplar: 91% welds with its verbatim object phrase.
  const dvn = "During 2025, we engaged DeGolyer and MacNaughton to audit 91% of our proved reserves.";
  {
    const r = attr(plus(dvn, "DeGolyer and MacNaughton"));
    ok("DVN: DeGolyer and MacNaughton ships with the filer's word 'audit' and coverage 91%",
      r?.firms?.length === 1 && r.firms[0].firm === "DeGolyer and MacNaughton" && r.firms[0].verb === "audit"
      && r.firms[0].coverage?.pct === "91%" && r.firms[0].coverage?.object === "of our proved reserves");
    ok("DVN: the coverage chip and its object are one contiguous run of the sentence's own characters",
      r.firms[0].sentence.includes(`${r.firms[0].coverage.pct} ${r.firms[0].coverage.object}`));
  }
  ok("dictionary rung: the same sentence with only ONE firm occurrence ships nothing",
    attr(dvn) === null);
  ok("in-sentence rung: a percent in the NEIGHBORING sentence never chips",
    (() => { const r = attr(plus("During 2025, we engaged DeGolyer and MacNaughton to audit our proved reserves. The audit covered 91% of our proved reserves.", "DeGolyer and MacNaughton")); return r?.firms?.[0] && !r.firms[0].coverage; })());

  // COP, the verb-fidelity headline: ConocoPhillips retains a REVIEW and renders "reviewed".
  const cop = "During 2025, our processes and controls used to assess over 90 percent of proved reserves as of December 31, 2025, were reviewed by D&M.";
  {
    const r = attr(plus(cop, "D&M"));
    ok("COP: renders 'reviewed' — the filer's own verb, never normalized to 'audited'",
      r?.firms?.[0]?.verb === "reviewed" && r.firms[0].coverage?.pct === "over 90 percent" && r.firms[0].coverage?.object === "of proved reserves");
    let died = false;
    try { weld(cop, [{ text: "audited", kind: "verbatim" }]); } catch { died = true; }
    ok("COP red-team: welding the normalized verb 'audited' onto the review sentence dies at write time", died);
  }

  // CVX: the 13% legacy-Hess audit — the acquisition frame rides INSIDE the quote.
  {
    const cvx = "Accordingly, the company continued to retain DeGolyer and MacNaughton, an independent petroleum engineering consulting firm, to complete an audit of the legacy Hess proved reserves at December 31, 2025 (representing approximately 13 percent of Chevron's total proved reserves).";
    const r = attr(plus(cvx, "DeGolyer and MacNaughton"));
    ok("CVX: 'approximately 13 percent' chips with its verbatim object, the legacy-Hess frame inside the quote",
      r?.firms?.[0]?.verb === "audit" && r.firms[0].coverage?.pct === "approximately 13 percent"
      && r.firms[0].coverage?.object === "of Chevron's total proved reserves" && /legacy Hess/.test(r.firms[0].sentence));
  }

  // CRK, the PV-token ban: '100% of our total PV 10 Value' is a share of VALUE, not of
  // reserves — the verb and quote ship, the percent never wears a coverage chip.
  {
    const crk = 'Netherland, Sewell & Associates, Inc. ("NSAI") audited 100% of our total PV 10 Value as of December 31, 2025.';
    const r = attr(plus(crk, "NSAI"));
    ok("CRK: ships 'audited' with NO coverage chip — the PV-token ban holds",
      r?.firms?.[0]?.verb === "audited" && r.firms[0].coverage === undefined);
  }

  // EOG: the engagement sentence chips 'not less than 75%'; the multi-year opinion sentence
  // (84%, 85% and 83%) can never chip — three percents have no deterministic object.
  ok("EOG: 'not less than 75%' chips from the engagement sentence with its object phrase",
    (() => { const r = attr(plus("Additionally, EOG engages DeGolyer and MacNaughton (D&M), independent petroleum consultants, to perform independent reserves evaluation of select EOG properties comprising not less than 75% of EOG's estimates of proved reserves.", "D&M")); return r?.firms?.[0]?.coverage?.pct === "not less than 75%" && r.firms[0].coverage.object === "of EOG's estimates of proved reserves"; })());
  ok("EOG: the three-percent opinions sentence alone ships nothing (no attribution verb binds the firm)",
    attr(plus("Opinions by D&M for the years ended December 31, 2025, 2024 and 2023 covered producing areas containing 84%, 85% and 83%, respectively, of proved reserves of EOG on a net-equivalent-barrel-of-oil basis.", "D&M")) === null);

  // The rest of the 15-name sample, pinned to the stored records' own outcomes.
  ok("OXY: 'reviewed' with 'approximately 39%' — the second review-class filer",
    (() => { const r = attr(plus("In 2025, Ryder Scott reviewed approximately 39% of the Company's proved oil and gas reserves.", "Ryder Scott")); return r?.firms?.[0]?.verb === "reviewed" && r.firms[0].coverage?.pct === "approximately 39%"; })());
  ok("FANG: 'audits' with 100% of our total proved reserves — the object trims the year list",
    (() => { const r = attr(plus("The purpose of Ryder Scott's audits was to provide additional assurance on the reasonableness of internally prepared reserve estimates and covered 100% of our total proved reserves for 2025, 2024 and 2023.", "Ryder Scott")); return r?.firms?.[0]?.verb === "audits" && r.firms[0].coverage?.object === "of our total proved reserves"; })());
  ok("EQT: the comma-listed object phrase survives whole ('of the total net natural gas, NGLs and oil proved reserves')",
    (() => { const r = attr(plus("In the course of its audit, NSAI conducted a detailed review of 100 % of the total net natural gas, NGLs and oil proved reserves attributable to the Company's interests as of December 31, 2025.", "NSAI")); return r?.firms?.[0]?.coverage?.pct === "100 %" && r.firms[0].coverage.object === "of the total net natural gas, NGLs and oil proved reserves"; })());
  ok("TPL: 'prepared' with 100% of our total PDP reserves",
    (() => { const r = attr(plus("The PDP reserve analysis prepared by Ryder Scott covered 100% of our total PDP reserves for 2025.", "Ryder Scott")); return r?.firms?.[0]?.verb === "prepared" && r.firms[0].coverage?.object === "of our total PDP reserves"; })());
  ok("SD: 'prepared' — the percent BEFORE the firm still chips with its object ('Approximately 97.9%')",
    (() => { const r = attr(plus('Preparation of Reserves Estimates Approximately 97.9% of the proved oil, natural gas and NGL reserves disclosed in this report have been independently prepared by Cawley, Gillespie & Associates ("CGA"), a leader of petroleum property analysis for industry and financial institutions.', "CGA")); return r?.firms?.[0]?.verb === "prepared" && r.firms[0].coverage?.pct === "Approximately 97.9%" && r.firms[0].coverage.object === "of the proved oil, natural gas and NGL reserves"; })());
  ok("MTDR: 'audited' — the verb NEAREST the firm wins over the staff's 'prepared' upstream",
    (() => { const r = attr(plus("These estimates were prepared by our engineering staff and audited by Netherland, Sewell & Associates, Inc., independent reservoir engineers.", "NSAI")); return r?.firms?.[0]?.verb === "audited"; })());

  // EGY, the two-firm filer: NSAI leads (more occurrences), GLJ ships its OWN sentence whose
  // "Prior to 2025" dating rides inside the quote — never stripped from its verb.
  {
    const egy = 'Our reserves information was evaluated by the independent petroleum engineering firm, Netherland, Sewell & Associates, Inc. ("NSAI"). Prior to 2025, reserves information for Canada was independently evaluated by GLJ Ltd. ("GLJ").';
    const r = attr(`${egy} NSAI. GLJ.`);
    ok("EGY: both firms ship, NSAI first, each with its own sentence",
      r?.firms?.length === 2 && r.firms[0].firm === "Netherland, Sewell & Associates" && r.firms[1].firm === "GLJ" && /Prior to 2025/.test(r.firms[1].sentence));
  }

  // The kills: risk-factor hypotheticals and exhibit-index debris never become the quote.
  ok("TPL risk factor ('…may prove to be incorrect') never ships",
    attr(plus('In estimating our PDP reserves, we and Ryder Scott Company, L.P. ("Ryder Scott"), an independent third-party petroleum engineering firm, must make various assumptions with respect to many matters that may prove to be incorrect, including future oil, gas, and NGL prices.', "Ryder Scott")) === null);
  ok("an exhibit-index row ('99.1* Audit Letter of …') never ships",
    attr(plus("99.1* Audit Letter of Netherland, Sewell & Associates, Inc. on Proved Reserves as of December 31, 2025.", "NSAI")) === null);

  // XOM, the internal-only class: no dictionary firm anywhere, and the filer's own sentence
  // under its Item 1202(a)(7) qualifications heading carries the read — with the glued
  // heading stripped from the front.
  const xomFx = "Qualifications of Reserves Technical Oversight Group and Internal Controls over Proved Reserves ExxonMobil has a dedicated Global Reserves and Resources group that provides technical oversight and is separate from the operating organization.";
  {
    const r = attr(xomFx);
    ok("XOM: internal-only renders from the filer's own sentence, heading stripped",
      r?.internal === true && r.sentence === "ExxonMobil has a dedicated Global Reserves and Resources group that provides technical oversight and is separate from the operating organization.");
  }
  ok("internal-only never fires while a dictionary firm is in the filing",
    (() => { const r = attr(`${xomFx} ${plus(dvn, "DeGolyer and MacNaughton")}`); return !!r && !r.internal && r.firms?.[0]?.firm === "DeGolyer and MacNaughton"; })());
  ok("dictionary miss with no qualifications heading = silence",
    attr("Our reserves were estimated by our internal engineering staff in accordance with SEC rules and reviewed by senior management before publication of this annual report.") === null);

  // --- the O&G critical-estimates topics (M5 windows over the full text) ---
  ok("EQT: the doc's pinned zone names reserve estimation, and reserves LEADS the topic list",
    (() => { const c = ogCriticalTopics("Critical Accounting Estimates The following critical accounting estimates, which were reviewed by the Audit Committee of our Board of Directors, relate to our more significant estimates and assumptions used in the preparation of the Consolidated Financial Statements. Our proved reserve estimates rely on several significant assumptions, including future rates of production and estimated ultimate recoveries of developed and undeveloped reserves. Capitalized costs of oil and natural gas properties are depleted using the unit-of-production method based upon production and estimates of proved reserves quantities."); return c?.topics?.[0] === "Oil & gas reserve estimates" && c.topics.includes("Depletion & DD&A"); })());
  ok("XOM: its own zone sentence names the judgment (the stated Build 8 deviation — the filing over the survey's 13/15)",
    (() => { const c = ogCriticalTopics("CRITICAL ACCOUNTING ESTIMATES The preparation of financial statements requires management to make estimates and judgments that affect the reported amounts of assets and liabilities in the consolidated financial statements. The estimation of proved reserves is controlled by the Corporation through long-standing approval guidelines."); return c?.topics?.includes("Oil & gas reserve estimates"); })());
  ok("EGY notes: a cross-reference ('see Item 1. Business Reserve Information') is never a topic",
    ogCriticalTopics('Critical Accounting Policies and Estimates Successful Efforts Method of Accounting for crude oil, natural gas and NGLs Activities. For a discussion of the reserve estimation process, including internal controls, see " Item 1. Business Reserve Information ."') === null);
  ok("a present-value table lead-in is never reserve-estimation evidence (the PV ban reaches the topic lane)",
    ogCriticalTopics("Critical Accounting Estimates are described below for the periods presented in this report. The following table presents estimated future net cash flows from proved reserves and the present value of such net cash flows discounted at a rate of ten percent per annum.") === null);
  ok("an ARO-only zone names asset retirement obligations and NOT reserves — the vocabulary does not over-fire",
    (() => { const c = ogCriticalTopics("CRITICAL ACCOUNTING ESTIMATES The preparation of Financial Statements in accordance with GAAP requires us to make estimates and assumptions that affect the reported amounts of assets and liabilities in the financial statements. Asset Retirement Obligations The Company has significant obligations to remove tangible equipment and restore land or seabed at the end of oil and gas production operations, and estimating the future plugging and abandonment costs requires management to make judgments inherent in the calculation of the future obligation."); return c?.topics?.length === 1 && c.topics[0] === "Asset retirement obligations"; })());

  // --- the taxonomy wall: "reserves" never collides with an insurer's loss reserves ---
  const bpIns = (sents, ogCrit = null) => buffettRead({ mdna: { sents }, business: { sents: [] }, risk: { sents: [] } }, true, ogCrit);
  const insZone = [
    "Critical accounting estimates are those we consider most important to the portrayal of our financial condition and results.",
    "Our reserve for losses and loss adjustment expenses involves significant judgment about the ultimate cost of claims incurred but not reported to us.",
  ];
  ok("an insurer's zone names Insurance reserves, never the O&G topic — the label enters ONLY via the O&G-scoped parameter",
    (() => { const j = bpIns(insZone)?.judgment; return j?.topics?.includes("Insurance reserves") && !j.topics.some((t) => /oil & gas/i.test(t)); })());
  ok("MTDR: the merged judgment now NAMES reserves — O&G topics lead, the generic MD&A topics follow",
    (() => {
      const j = bpIns(
        ["Critical accounting policies and estimates involving significant judgment are described below in this section of the report.", "Significant judgment is required in determining our provision for income taxes and our deferred tax positions for each of the years presented."],
        { topics: ["Oil & gas reserve estimates", "Depletion & DD&A"], quote: "x" }
      )?.judgment;
      return j?.topics?.[0] === "Oil & gas reserve estimates" && j.topics.includes("Income taxes");
    })());
}

// ---------------- BUILD 9 — REIT re-leasing spreads + occupancy (P1 + P2 bundled on the
// weld; docs/qualitative-desks-survey.md). Every sentence below is verbatim from the FY2025
// filings the lane was measured on (PLD BRX REXR O KIM BDN SPG, with AVB/HST silent), pinned
// as literals. The laws under test: compound-token anchors only — never bare "spread";
// SOFR/credit-spread sentences score zero; the period lives in the rendered quote; the
// occupancy as-of date equals the fiscal year end; comparison-clause figures never chip; the
// recapture dollar-pair tie verifies or withholds; multi-scope filers render per scope,
// never a blend; same-scope disagreement withholds both. ----------------

{
  const read = (textOrZones, fy = 2025, fye = "2025-12-31") =>
    reitLeasingRead({ mdnaText: Array.isArray(textOrZones) ? textOrZones.join(" ") : textOrZones, fy, fyeDate: fye });

  // --- Lane A: the landlord's own pricing line ---
  const brxSp = "During 2025, we achieved rent spreads on new leases of 38.7% and blended rent spreads on new and renewal leases of 21.7% excluding options or 16.4% including options.";
  ok("BRX: 38.7 / 21.7 / 16.4 chip in the filer's own class order, from one sentence",
    (() => { const r = read(brxSp); return r?.spreads?.length === 1 && r.spreads[0].figures.join("|") === "38.7%|21.7%|16.4%" && r.spreads[0].sentence === brxSp; })());

  const pld = "These factors contributed to occupancy in our operating portfolio of 95.6% at December 31, 2025, and rent change on leases that commenced during the year of 50.1% on a net effective basis, both metrics based on our ownership share.";
  ok("PLD: the mixed sentence splits by clause — 50.1% is the spread, 95.6% the occupancy, never crossed",
    (() => { const r = read(pld); return r?.spreads?.[0]?.figures.join("|") === "50.1%" && r?.occupancy?.[0]?.figures.join("|") === "95.6%"; })());

  // REXR: the verb-led highlights bullet carries no period of its own; the quote becomes the
  // contiguous span with its fiscal-year-dated sibling, so the period is in the quote.
  const rexrPrev = "Same Property Portfolio (2) average occupancy for the year ended December 31, 2025 was 96.4% and ending occupancy at year-end was 96.5%.";
  const rexrBullet = "Executed a total 478 new and renewal leases with a combined 10.4 million rentable square feet, with leasing spreads of 23.4% on a GAAP basis and 10.7% on a cash basis.";
  ok("REXR: both bases chip and the dated sibling rides inside the quote",
    (() => { const r = read(`${rexrPrev} ${rexrBullet}`); return r?.spreads?.[0]?.figures.join("|") === "23.4%|10.7%" && /year ended December 31, 2025/.test(r.spreads[0].sentence) && r.spreads[0].sentence.endsWith(rexrBullet); })());
  ok("REXR: the same bullet WITHOUT a dated sibling ships nothing — the period gate holds",
    (() => { const r = read(`We operate industrial properties across infill Southern California. ${rexrBullet}`); return !r?.spreads; })());
  ok("REXR: the land-lease footnote (94.0%/27.0%, no period in sentence) ships nothing",
    (() => { const r = read("For the renewal land lease transactions, the net effective and cash leasing spreads were 94.0% and 27.0%, respectively."); return !r?.spreads; })());

  // O: the internal dollar-pair tie — the sentence's own dollars compute to its stated rate.
  const oSp = "During the year ended December 31, 2025, the new annualized base rent on re-leased units was $301.99 million, as compared to the previous annual rent of $290.61 million on the same units, representing a rent recapture rate of 103.9% on the re-leased units.";
  ok("O: 103.9% chips and the pair ties — $301.99M ÷ $290.61M = 103.92% against the stated 103.9%",
    (() => { const r = read(oSp); return r?.spreads?.[0]?.figures.join("|") === "103.9%" && r.spreads[0].tie?.computed === "103.92%" && r.spreads[0].tie.a === "$301.99 million" && r.spreads[0].tie.b === "$290.61 million"; })());
  ok("O red-team: a doctored dollar breaks the tie and the row WITHHOLDS with its reason, no figure quoted",
    (() => { const r = read(oSp.replace("$301.99", "$311.99")); return !r?.spreads && r?.spreadsWithheld?.length === 1 && /disagrees/.test(r.spreadsWithheld[0].reason); })());
  ok("O: the quarterly recapture sentence (Q4's 104.9%) dies on the sub-annual gate",
    (() => { const r = read("During the three months ended December 31, 2025, the new annualized base rent on re-leased units was $88.30 million, as compared to the previous annual rent of $84.21 million on the same units, representing a rent recapture rate of 104.9% on the re-leased units."); return !r?.spreads; })());

  // The doc's zero-controls: KIM's and BDN's bare "spread" is credit language, and must score zero.
  ok("KIM: 'plus an applicable spread determined by the Company's credit ratings' scores zero",
    (() => { const r = read("The Credit Facility accrues interest at a rate of Adjusted Term SOFR, as defined in the terms of the Credit Facility, plus an applicable spread determined by the Company's credit ratings."); return !r?.spreads; })());
  ok("BDN: the tender-offer fixed spread (basis points) scores zero",
    (() => { const r = read("The purchase price offered per $1,000 principal amount of 2024 Notes pursuant to the Tender Offer was determined by reference to the fixed spread for the 2024 Notes of 0 basis points plus the yield based on the bid-side price of the 4.10% U.S. Treasury note due 2026."); return !r?.spreads; })());
  ok("a compound-anchored sentence that still says SOFR is rejected — the credit deny is not anchor-shadowed",
    (() => { const r = read("During 2025, rent spreads on our credit facility priced at SOFR plus 85 basis points improved by 12.0%."); return !r?.spreads; })());

  // --- Lane B: occupancy, dated to fiscal year end ---
  const brxOcc = "As of December 31, 2025, billed and leased occupancy were 91.6% and 95.1%, respectively, compared to 91.4% and 95.2%, respectively, as of December 31, 2024.";
  ok("BRX: 91.6/95.1 chip; the comparison clause's 91.4/95.2 never do",
    (() => { const r = read(brxOcc); return r?.occupancy?.length === 1 && r.occupancy[0].figures.join("|") === "91.6%|95.1%"; })());
  ok("the as-of gate: the same disclosure dated only to the PRIOR year end ships nothing",
    (() => { const r = read("As of December 31, 2024, billed and leased occupancy were 91.4% and 95.2%, respectively."); return !r?.occupancy; })());
  ok("the as-of gate: a mid-year date (June 30, 2025) is not the fiscal year end and ships nothing",
    (() => { const r = read("As of June 30, 2025, billed and leased occupancy were 91.2% and 94.8%, respectively."); return !r?.occupancy; })());

  // REXR, the multi-scope filer: each scope renders with its own words inside the quote.
  const rexr909 = "As of December 31, 2025, our consolidated properties were 90.9% leased to tenants in a variety of industries, with no single tenant accounting for more than 2.4% of our total annualized in-place base rent.";
  const rexrRates = "As of December 31, 2025, our consolidated portfolio, inclusive of space in repositioning as described in the subsequent paragraph, was approximately 90.2% occupied, while our stabilized consolidated portfolio exclusive of such space was approximately 96.0% occupied.";
  ok("REXR: three scopes, three rows, each with its own scope words — never a blend",
    (() => {
      const r = read([rexr909, rexrRates, rexrPrev]);
      return r?.occupancy?.length === 3
        && r.occupancy[0].figures.join("|") === "90.9%" && /consolidated properties/.test(r.occupancy[0].sentence)
        && r.occupancy[1].figures.join("|") === "90.2%|96.0%" && /stabilized consolidated portfolio/.test(r.occupancy[1].sentence)
        && r.occupancy[2].figures.join("|") === "96.4%|96.5%" && /Same Property Portfolio/.test(r.occupancy[2].sentence);
    })());
  ok("REXR: the dual-year 'respectively' sentence chips only the record year's figure (96.5, not 96.4-of-2024)",
    (() => { const r = read("As of December 31, 2025 and 2024, our Same Property Portfolio occupancy was approximately 96.5% and 96.4%, respectively."); return r?.occupancy?.[0]?.figures.join("|") === "96.5%"; })());
  ok("REXR: same-scope rows that AGREE collapse to one — the richer highlights form stands",
    (() => { const r = read([rexrPrev, "As of December 31, 2025 and 2024, our Same Property Portfolio occupancy was approximately 96.5% and 96.4%, respectively."]); return r?.occupancy?.length === 1 && r.occupancy[0].figures.join("|") === "96.4%|96.5%"; })());
  ok("anaphoric scope ('in these markets') is refused — the scope words are not in the sentence",
    (() => { const r = read("Excluding vacant space at these properties, our weighted average occupancy rate as of December 31, 2025, in these markets was 95.3%, 99.2% and 96.4%, respectively."); return !r?.occupancy; })());

  // BDN and KIM: where the same scope is stated twice and agrees, the prior-year-comparison
  // form is the row (both pinned sentences are the doc's own samples).
  const bdnCmp = "Occupancy at our Core Properties at December 31, 2025 was 88.3% compared to 87.8% at December 31, 2024.";
  ok("BDN: the comparison-bearing Core Properties sentence is the row, 88.3% only",
    (() => { const r = read(["As of December 31, 2025, the Core Properties were approximately 88.3% occupied.", bdnCmp]); return r?.occupancy?.length === 1 && r.occupancy[0].sentence === bdnCmp && r.occupancy[0].figures.join("|") === "88.3%"; })());
  ok("KIM: consolidated (96.6%, comparison form kept) and pro-rata (96.4%) are DIFFERENT scopes — both render",
    (() => {
      const r = read(["As of December 31, 2025, the Company's proportionate share of its portfolio occupancy was 96.4%.",
        "As of December 31, 2025, the Company's consolidated operating portfolio, comprised of 458 shopping center properties aggregating 79.5 million square feet of GLA, was 96.6% leased.",
        "Consolidated operating portfolio occupancy at December 31, 2025 was 96.6% as compared to 96.4% at December 31, 2024."]);
      return r?.occupancy?.length === 2 && r.occupancy[0].figures.join("|") === "96.4%" && r.occupancy[1].figures.join("|") === "96.6%" && /as compared to/.test(r.occupancy[1].sentence);
    })());
  ok("same-scope DISAGREEMENT withholds both — neither is quoted as the fact",
    (() => { const r = read(["As of December 31, 2025, the Core Properties were approximately 88.3% occupied.", "Occupancy at our Core Properties at December 31, 2025 was 89.3% compared to 87.8% at December 31, 2024."]); return !r?.occupancy && r?.occupancyWithheld?.length === 1; })());

  ok("SPG: the U.S.-abbreviation sentence stays whole and 96.4% chips; the 'from 96.5%' comparison never does",
    (() => { const r = read("Ending occupancy for our U.S. Malls and Premium Outlets decreased 0.1% to 96.4% as of December 31, 2025, from 96.5% as of December 31, 2024."); return r?.occupancy?.[0]?.figures.join("|") === "96.4%"; })());
  ok("O: 98.9% leased chips; the comparison's 98.7% never does",
    (() => { const r = read("As of December 31, 2025, our portfolio of 15,511 properties was 98.9% leased with 173 properties available for lease or sale, as compared to 98.7% leased with 205 properties available for lease as of December 31, 2024."); return r?.occupancy?.[0]?.figures.join("|") === "98.9%"; })());
  ok("a table lead-in ('The following table… as of December 31, 2025') is never an occupancy row",
    (() => { const r = read("The following table summarizes the geographic diversity of our Portfolio by state, ranked by ABR, as of December 31, 2025, including the Percent Leased of 92.1% for our largest state."); return !r?.occupancy; })());
  ok("forward-looking occupancy ('We expect…') never renders",
    (() => { const r = read("We expect occupancy of approximately 96.0% as of December 31, 2025 based on current leasing volumes."); return !r?.occupancy; })());
}

// ---------------- BUILD 10 — utilities disallowance ledger + securitization keyhole (U P1 +
// P3 bundled, both QUOTE-ONLY; docs/qualitative-desks-survey.md SECTION 3). Every filing
// sentence below is VERBATIM from the named FY2025 10-K as the lane's own splitter flattens
// it (fetched and measured 2026-07-31 on the doc's 14 utility filings; the 14 cross-sector
// non-utility controls — JPM FLG TRV UNH PLD O SPG MSFT DDOG XOM DVN WMT CAT AAL — scored
// zero on both lanes end-to-end). The laws under test: the actor + in-sentence dollar +
// past-tense verb triple; a REQUEST is never a disallowance; a commission DENYING a proposed
// disallowance is the company's win and dies; the SFAS-90 accounting-policy boilerplate and
// the colon-glued bullet list die; an anaphoric open ships only as the contiguous span with
// its own prior sentence; the appeal sentence is a court ACTION, dollar-bearing preferred;
// gravest dollars first, Jaccard dedupe keeping the gravest member, cap 3; the verb-class
// label fails closed to "filed". ----------------

{
  const dis = (mdnaText) => utilityRegRead({ mdnaText, fullText: "", fy: 2025 })?.disallowances;
  const sec = (mdnaText) => utilityRegRead({ mdnaText, fullText: "", fy: 2025 })?.securitizations;

  // --- WEC, the pinned pair (177.2 / 178.9): the impairment sentence and its anaphoric
  // detail sentence ship as ONE contiguous span; the November-2023 order sentence, a near-dup
  // of the gravest combined-disallowance sentence, dies to it in the Jaccard pass.
  const wecNov = "In November 2023, the ICC issued written rate orders that disallowed $ 177.2 million of previously incurred capital costs related to the construction and improvement of PGL's service centers and $ 1.7 million of capital costs related to NSG's construction of a gas infrastructure project.";
  const wecComb = "As part of its decisions, the ICC, among other things, disallowed $ 236.2 million of capital costs related to the construction and improvement of PGL's shops and facilities and $ 1.7 million of capital costs related to NSG's construction of a gas infrastructure project.";
  const wecImp = "As the ICC did not grant a rehearing on the disallowance of PGL's and NSG's capital costs, we recorded a $ 178.9 million non-cash impairment of our property, plant, and equipment during the fourth quarter of 2023.";
  const wecThis = "This amount included $ 177.2 million of previously incurred disallowed costs at PGL related to its shops and facilities, and the $ 1.7 million of capital costs disallowed at NSG.";
  const wecPet = "In June 2024, PGL and NSG filed a petition with the Illinois Appellate Court for review of the November 2023 and May 2024 orders.";
  const wecAppeal = "The appeal includes the ICC's $ 237.9 million combined disallowance of capital costs at PGL and NSG discussed above, along with the $ 116.0 million disallowance of capital investments needed to meet safety and reliability requirements of PGL's natural gas delivery system.";
  {
    const rows = dis([wecNov, wecComb, wecImp, wecThis, wecPet, wecAppeal].join(" "));
    ok("WEC: gravest first — the $ 236.2 million combined disallowance leads the ledger",
      rows?.length === 3 && rows[0].figures[0] === "$ 236.2 million" && rows[0].kind === "issued");
    ok("WEC: 177.2 and 178.9 ship together as one contiguous span (the anaphoric detail glued to its own prior)",
      rows?.some((r) => r.quote === `${wecImp} ${wecThis}` && r.figures.includes("$ 178.9 million") && r.figures.includes("$ 177.2 million")));
    // The November-2023 order and the combined-decision sentence are DIFFERENT facts
    // (measured jaccard 0.417, well under the 0.65 registrant-swap band) — both stand,
    // gravest dollars first, and the cap holds the ledger at three.
    ok("WEC: the November-2023 order sentence is its own fact and ranks below the span, gravest first",
      rows?.[2]?.quote === wecNov && rows[2].figures[0] === "$ 177.2 million");
    ok("WEC: the dollar-bearing appeal-scope sentence rides alongside the disallowance",
      rows?.[0].appeal === wecAppeal);
    ok("WEC: every rendered figure is the quote's own characters (the weld law re-checked)",
      rows?.every((r) => r.figures.every((f) => r.quote.includes(f))));
  }

  // --- SO, the doc's pin: 127 + rehearing 43. The appeal sentence is the COMPANY's court
  // action carrying its own dollar, quoted beside the order, never blended with it.
  const soDis = "In connection with Nicor Gas' 2023 general base rate case proceeding, the Illinois Commission disallowed $ 127 million of capital investments that have been completed or were planned to be completed through December 31, 2024.";
  const soReh = "On December 22, 2025, Nicor Gas filed a petition for rehearing with the Illinois Appellate Court specifically addressing $ 43 million of the base rate case disallowances.";
  ok("SO: the Illinois Commission's $ 127 million disallowance ships with the $ 43 million rehearing petition alongside",
    (() => { const r = dis(`${soDis} ${soReh}`); return r?.length === 1 && r[0].figures[0] === "$ 127 million" && r[0].kind === "issued" && r[0].appeal === soReh; })());

  // --- EIX, the doc's pin: 88. The note sentence opens anaphorically ("As a result of the
  // decision…") and ships only as the span with the CPUC-issued prior; the SFAS-90
  // accounting-policy boilerplate beside it can never be a row.
  const eixBoiler = "Accounting principles for rate-regulated enterprises also require recognition of an impairment loss if it becomes probable that the regulated utility will abandon a plant investment, or if it becomes probable that the cost of a recently completed plant will be disallowed, either directly or indirectly, for ratemaking purposes, and a reasonable estimate of the disallowance amount can be made.";
  const eixSept = "In September 2025, the CPUC issued a final decision in SCE's 2025 GRC proceeding.";
  const eixResult = "As a result of the decision, SCE recorded an $ 88 million impairment of utility property, plant and equipment that was disallowed by the CPUC, primarily related to the rooftop solar photovoltaic program.";
  ok("EIX: the $ 88 million impairment ships as the span with its CPUC-issued prior, verb-class issued",
    (() => { const r = dis([eixBoiler, eixSept, eixResult].join(" ")); return r?.length === 1 && r[0].quote === `${eixSept} ${eixResult}` && r[0].figures[0] === "$ 88 million" && r[0].kind === "issued"; })());
  ok("EIX: the SFAS-90 'will be disallowed… reasonable estimate' boilerplate is never a row on its own",
    dis(eixBoiler) === undefined);
  ok("EIX: the colon-glued bullet ('…primarily related to: $88 million impairment…') is flattened-list debris, refused",
    dis("Asset Impairment Charges of $106 million recorded in 2025 primarily related to: $88 million impairment of utility property, plant and equipment associated with historical capital expenditures disallowed in SCE's 2025 GRC final decision.") === undefined);

  // --- AEP, both lanes. Lane A: the WVPSC order span ships (glued heading stripped from the
  // prior); the company's remand TESTIMONY and the commission's DENIAL of an intervenor's
  // proposed disallowance both die — a request is never a disallowance, and neither is a win.
  const aepOrder = "APCo and WPCo Rate Matters (Applies to AEP and APCo) ENEC (Expanded Net Energy Cost) Filings In January 2024, the WVPSC issued an order resolving APCo's and WPCo's ( the Companies) 2021-2023 ENEC cases.";
  const aepInOrder = "In the order, the WVPSC: (a) disallowed $ 232 million in ENEC under-recovered costs as of February 28, 2023 ($ 136 million related to APCo) and (b) approved the recovery of $ 321 million of ENEC under-recovered costs as of February 28, 2023 ($ 174 million related to APCo) plus a 4 % debt carrying charge rate over a ten-year recovery period starting September 1, 2024.";
  ok("AEP: the WVPSC order span ships with the glued section heading stripped off the prior",
    (() => { const r = dis(`${aepOrder} ${aepInOrder}`); return r?.length === 1 && r[0].quote.startsWith("In January 2024, the WVPSC issued an order") && r[0].figures.includes("$ 232 million") && r[0].kind === "issued"; })());
  ok("AEP: the Companies' remand testimony 'supporting a reduction… of at least $ 179 million' is advocacy, never a disallowance",
    dis("In June 2025, the Companies submitted direct testimony on remand supporting a reduction to the WVPSC's previously-ordered disallowance of at least $ 179 million.") === undefined);
  ok("AEP: the WVPSC DENYING an intervenor-recommended disallowance is the company's win, never a ledger row",
    dis("The WVPSC denied an intervenor-recommended ENEC under-recovery disallowance of $ 19 million.") === undefined);

  // Lane B: KPCo's issuance ships as ISSUED with the heading stripped; APCo's proposed
  // Virginia securitization ships as a REQUEST (verb-class fails closed to filed) and is
  // refused by the disallowance lane outright.
  const aepKpco = "Kentucky Securitization Case In June 2025, KPCo issued $478 million of securitization bonds to recover $500 million of regulatory assets, including $311 million of plant retirement costs, $79 million of deferred storm costs related to 2020, 2021, 2022 and 2023 major storms, $56 million of under-recovered purchased power rider costs, $51 million of deferred purchased power expenses and $3 million of issuance-related expenses, including KPSC advisor expenses.";
  const aepVa = "In July 2025, APCo filed a request with the Virginia SCC to finance, through the issuance of proposed 20-year securitization bonds, approximately $1.4 billion of Virginia jurisdictional undepreciated property balances and a major storm operation and maintenance regulatory asset deferral balance.";
  ok("AEP: KPCo's $478/$500 million issuance ships as ISSUED, glued heading stripped",
    (() => { const r = sec(aepKpco); return r?.length === 1 && r[0].kind === "issued" && r[0].quote.startsWith("In June 2025, KPCo issued") && r[0].figures.includes("$478 million") && r[0].figures.includes("$500 million"); })());
  ok("AEP: the Virginia $1.4 billion renders as a request — filed, never an issuance",
    (() => { const r = sec(aepVa); return r?.length === 1 && r[0].kind === "filed" && r[0].figures[0] === "$1.4 billion"; })());
  ok("AEP: the same Virginia request is never a disallowance",
    dis(aepVa) === undefined);

  // --- ETR, the doc's pin: 2.57B / 1.657B in the LPSC settlement sentence, one quote, both
  // dollars the filer's own characters; the verb class stays 'filed' — authorization to
  // finance is not bonds issued, and the label fails closed.
  ok("ETR: the settlement sentence ships with $ 2.57 billion and $ 1.657 billion as verbatim figures, verb-class filed",
    (() => {
      const r = sec("The settlement agreement contains the following key terms: $ 2.57 billion of restoration costs from Hurricane Ida, Hurricane Laura, Hurricane Delta, Hurricane Zeta, and Winter Storm Uri were prudently incurred and eligible for recovery; carrying costs of $ 59.2 million were recoverable; and Entergy Louisiana was authorized to finance $ 1.657 billion utilizing the securitization process authorized by Act 55, as supplemented by Act 293.");
      return r?.length === 1 && r[0].kind === "filed" && r[0].figures.includes("$ 2.57 billion") && r[0].figures.includes("$ 1.657 billion") && r[0].figures.every((f) => r[0].quote.includes(f));
    })());

  // --- DUK: the storm-recovery-bonds issuance verb reads ISSUED.
  ok("DUK: 'issued $ 582 million and $ 461 million… of storm recovery bonds' is an issuance",
    (() => { const r = sec("In September 2025, Duke Energy Carolinas and Duke Energy Progress issued $ 582 million and $ 461 million, respectively, of storm recovery bonds."); return r?.length === 1 && r[0].kind === "issued"; })());

  // --- The controls' shapes (measured zero on all 14 non-utility filings; the lane is
  // rateRegulated-gated besides). JPM's securitization-trust sentence carries the anchor and
  // the dollars but no measured object token; the SEC is never a commission actor.
  ok("JPM-shape: a credit-card securitization trust sentence scores zero — the object token list is measured, not decorative",
    sec("As of December 31, 2025 and 2024, the Firm held undivided interests in Firm-sponsored credit card securitization trusts of $ 5.4 billion and $ 6.6 billion, respectively.") === undefined);
  ok("the Securities and Exchange Commission is never a rate commission actor",
    dis("In 2025, we recorded an impairment charge of $ 25 million following comments from the Securities and Exchange Commission on our accounting.") === undefined);
  ok("zero incidence is silence: a filer with no qualifying sentence returns nothing at all",
    utilityRegRead({ mdnaText: "Operating revenues increased in 2025 primarily due to rate base growth and favorable weather across our service territories.", fullText: "", fy: 2025 }) === null);
}

// ---------------- BUILD 11 — managed-care MLR cost-trend read (MC P2, the sector's pricing
// stand-in; docs/qualitative-desks-survey.md SECTION 3). Every filing sentence below is
// VERBATIM from the named FY2025 10-K as the lane's own splitter flattens it (fetched and
// measured 2026-07-31); every {mlr, mlrPrior} is the desk's OWN computed medical loss ratio
// from the filed claims and premiums lines — the figure the sentence is tiered against. The
// laws under test: no computed MLR = no lane at all; a LEVEL badge only when every stated
// level matches the computed record at the sentence's own declared precision; direction-only
// beneath it; a segment sentence never ships, however well its number ties; a stated figure
// beyond one unit at its own precision dies outright, never downgraded. ----------------

{
  const mc = (mdnaText, mlr, mlrPrior) => mlrCostTrendRead({ mdnaText, fy: 2025, mlr, mlrPrior });
  // The desk's own ratios, from the filed lines (claimsIncurred / premiumsEarned, $M):
  const MOH = { mlr: 39488 / 43052, prior: 34428 / 38627 };   // 91.722% / 89.129%
  const OSCR = { mlr: 10019.025 / 11469.893, prior: 7332.589 / 8971.259 }; // 87.351% / 81.734%
  const UNH = { mlr: 313995 / 352229, prior: 264185 / 308810 }; // 89.145% / 85.549%
  const CI = { mlr: 34349 / 40261, prior: 38648 / 45996 };    // 85.316% / 84.025%
  const HUM = { mlr: 110812 / 122825, prior: 100664 / 112104 }; // 90.219% / 89.795%

  // --- MOH, the doc's pinned badge (91.7/89.1): the ALL-CAPS heading glue is stripped, both
  // stated levels match the computed record at the filer's own one-decimal precision, and the
  // "260 basis points" is consistent with the computed 259.2 at its tens-of-bps precision.
  const mohBadge = "MEDICAL CARE RATIO The consolidated MCR increased to 91.7% in 2025, compared with 89.1% in 2024, or 260 basis points.";
  const mohClean = "The consolidated MCR increased to 91.7% in 2025, compared with 89.1% in 2024, or 260 basis points.";
  {
    const r = mc(mohBadge, MOH.mlr, MOH.prior);
    ok("MOH: the consolidated MCR sentence earns the LEVEL badge, heading glue stripped",
      !!r && r.tier === "level" && r.sentence === mohClean && r.stated.level === "91.7%" && r.stated.prior === "89.1%");
    ok("MOH: every stated figure is a literal substring of the shipped sentence (the weld law)",
      !!r && r.sentence.includes(r.stated.level) && r.sentence.includes(r.stated.prior));
    ok("MOH: the computed figures ride the record as the desk's own, at full precision",
      !!r && r.computed.pct === 91.722 && r.computed.priorPct === 89.129);
  }
  ok("MOH red-team: the same sentence against a shifted record dies outright — a level beyond one unit is never downgraded to direction-only",
    mc(mohBadge, 0.905, MOH.prior) === null);
  ok("no computed MLR = no lane: the same perfect sentence ships nothing (the ALHC/TRUP wall)",
    mc(mohBadge, null, null) === null);

  // --- MOH's segment rows, the subject-scope kill (M4: scope noun before the verb rejects):
  // the Medicaid MCR row dies before any figure is read, and the Medicare MCR row — whose
  // 89.1% ties the consolidated PRIOR by pure coincidence — dies the same way.
  ok("MOH: 'The Medicaid MCR increased…' is a segment figure and never ships",
    mc("The Medicaid MCR increased 150 basis points to 91.8% in 2025, compared to 90.3% in 2024.", MOH.mlr, MOH.prior) === null);
  ok("MOH: the Medicare MCR sentence dies though its 89.1% ties the consolidated prior — the coincidence class",
    mc("Form 10-K | 44 The Medicare MCR increased to 92.4% in 2025, from 89.1% in 2024, or 330 basis points.", MOH.mlr, MOH.prior) === null);
  ok("MOH: with the badge sentence present, the badge outranks every direction-only candidate",
    (() => { const r = mc(`The increase reflects a higher MCR in all of our segments, driven mainly by a challenging medical cost trend environment due to increased utilization in 2025. ${mohBadge}`, MOH.mlr, MOH.prior); return !!r && r.tier === "level"; })());

  // --- OSCR, the doc's pin (5.7 vs 5.6pt): a stated point-change with no level ships
  // DIRECTION-ONLY — the 5.7% is the difference of the filer's own rounded levels, consistent
  // with the desk's computed 5.616 within one unit at its own precision, and never a badge.
  const oscr57 = "MLR increased 5.7% year over year for the year ended December 31, 2025, primarily driven by an increase in average market morbidity that resulted in an increase in the net risk adjustment transfer accrual, as well as higher utilization that was not fully offset by risk adjustment.";
  {
    const r = mc(oscr57, OSCR.mlr, OSCR.prior);
    ok("OSCR: the 5.7% move ships direction-only beside the desk's computed 5.6pt",
      !!r && r.tier === "direction" && r.dir === "rose" && r.stated.delta === "5.7%" && r.computed.deltaPts === 5.616 && r.sentence === oscr57);
  }
  // The flattened MLR table row would BADGE — its 87.4/81.7 round exactly to the computed
  // record — so the table guard is load-bearing, not decorative.
  ok("OSCR: the flattened table row ($ (443,151) … 87.4 % 81.7 %…) is debris and never a badge",
    mc("$ (443,151) $ 25,432 Medical Loss Ratio (MLR) 87.4 % 81.7 % SG&A Expense Ratio 17.5 % 19.1 % Premium Premium revenue increased $2,498.6 million, or 28% , for the year ended December 31, 2025, compared to the same period in 2024.", OSCR.mlr, OSCR.prior) === null);
  ok("OSCR: the medical-expense dollar sentence ('increased $2,686.4 million, or 37%') is a line-item variance this lane cannot verify — dollars die whole",
    mc("Medical Expenses and MLR Medical expenses increased $2,686.4 million, or 37%, for the year ended December 31, 2025, compared to the year ended December 31, 2024, primarily due to increased membership and medical cost trend.", OSCR.mlr, OSCR.prior) === null);

  // --- UNH, the doc's pin: the well-short admission — the pricing-fell-short idiom, figure-
  // free, shipped on direction alone against the desk's rising record.
  const unhShort = "For 2025, our pricing trends and patient and member health status assumptions were well-short of the medical cost trends incurred, significantly impacting our earnings.";
  {
    const r = mc(unhShort, UNH.mlr, UNH.prior);
    ok("UNH: the 'well-short' sentence surfaces, direction-only, no figure",
      !!r && r.tier === "direction" && r.dir === "rose" && !r.stated && r.sentence === unhShort);
  }
  ok("UNH red-team: the same sentence against a FALLING computed record ships nothing — direction must agree",
    mc(unhShort, UNH.prior, UNH.mlr) === null);
  ok("UNH: the restructuring-impact sentence ('$2.5 billion impact … increased medical costs $623 million') never anchors — the cost line must be the subject",
    mc("The $2.5 billion impact of the restructuring and other actions was a reduction to premium revenue of $122 million and investment and other income of $397 million, and increased medical costs $623 million and operating costs $1.4 billion on a full year basis in 2025.", UNH.mlr, UNH.prior) === null);
  ok("UNH: the well-short admission outranks a later figure-free trend sentence — earliest wins within a tier",
    (() => { const r = mc(`${unhShort} Medical costs increased in 2025 primarily due to elevated medical cost trend and growth in people served.`, UNH.mlr, UNH.prior); return !!r && r.sentence === unhShort; })());

  // --- CI, the doc's twin kills. The 120 bps sentence sits in the Cigna Healthcare SEGMENT
  // zone (measured: the heading precedes it with no consolidated marker between), and its
  // loose tie to the desk's consolidated 129 bps cannot rescue it — a segment's ratio on the
  // segment's adjusted basis is not the consolidated record's.
  const ciZone = "Cigna Healthcare Segment 2025 versus 2024 Commentary regarding percentage changes (or bps) and dollar variances represents the driver's impact on the overall category. Pre-tax adjusted income from operations decreased 2%, primarily due to lower contributions from the Individual and Family Plans business. The medical care ratio increased 120 bps, primarily due to higher medical costs, driven by the Individual and Family Plans business.";
  ok("CI: the 120 bps segment coincidence dies in the segment zone",
    mc(ciZone, CI.mlr, CI.prior) === null);
  ok("CI: the Evernorth pharmacy-cost sentence is not the medical book and dies",
    mc("Pharmacy and other service costs increased 18%, primarily reflecting higher utilization of prescription drugs from customer growth in Evernorth Health Services in 2025.", CI.mlr, CI.prior) === null);
  ok("CI: the expense-line variance ('Medical costs and other benefit expenses decreased 11%…') contradicts the desk's rising ratio and dies outright",
    mc("Medical costs and other benefit expenses decreased 11%, primarily driven by the impact of the HCSC transaction (-18%), partially offset by higher medical costs within our ongoing U.S. Healthcare businesses (+7%) in 2025.", CI.mlr, CI.prior) === null);

  // --- HUM, measured live (the doc's own +0.4pt smallest-delta example): the one-sentence
  // ratio narration badges — 90.2/89.8 tie the computed 90.219/89.795 at one decimal, and the
  // "40 basis points" is the filer's own rounding of the computed 42.4 at tens-of-bps
  // precision.
  ok("HUM: the consolidated benefit ratio sentence earns the badge (90.2/89.8, '40 basis points' consistent at its own precision)",
    (() => {
      const r = mc("The consolidated benefit ratio increased 40 basis points from 89.8% in the 2024 period to 90.2% in the 2025 period primarily due to a shift in line of business mix resulting from growth in the state-based contracts and stand-alone PDP businesses that carry a higher benefit ratio, combined with a reduction in individual Medicare Advantage membership, and the year-over-year increase in the Medicare stand-alone PDP benefit ratio driven by the impact of the IRA.", HUM.mlr, HUM.prior);
      return !!r && r.tier === "level" && r.stated.level === "90.2%" && r.stated.prior === "89.8%";
    })());

  // --- CLOV-shape: the non-GAAP definitional apparatus never ships (definition, methodology,
  // present tense — nothing declarative about the year's trend).
  ok("CLOV: 'We calculate our BER by taking…' is a definition, not a trend sentence",
    mc("We calculate our BER by taking the total of Insurance net medical expenses incurred and quality improvements, and dividing that total by premiums earned on a net basis, in 2025.", 0.82908, 0.74826) === null);

  // --- The render-side tie (mlrTrendTie): the quote renders only while the recomputed record
  // still equals the one the sentence was tiered against — a healed line retires the quote.
  {
    const rec = mc(mohBadge, MOH.mlr, MOH.prior);
    const company = { fy: 2025, lines: { claimsIncurred: 39488, premiumsEarned: 43052 }, history: [{ fy: 2024, lines: { claimsIncurred: 34428, premiumsEarned: 38627 } }] };
    const tie = mlrTrendTie(company, rec);
    ok("render tie: the MOH badge renders with both stated figures and the desk's computed ratio named as its own",
      !!tie && tie.tier === "level" && tie.figs.join("|") === "91.7%|89.1%" && /desk's own computed medical loss ratio/.test(tie.check));
    ok("render tie: a healed claims line retires the quote rather than sit beside a number it no longer ties",
      mlrTrendTie({ ...company, lines: { claimsIncurred: 39900, premiumsEarned: 43052 } }, rec) === null);
    ok("render tie: a stale fiscal year retires the quote",
      mlrTrendTie({ ...company, fy: 2026 }, rec) === null);
  }
}

// ---------------- BUILD 12 — utilities rate cases, requested vs granted (U P2, the survey's
// largest and last build; docs/qualitative-desks-survey.md SECTION 3). Every filing sentence
// below is VERBATIM from the named FY2025 10-K as the lane's own splitter flattens it (fetched
// and measured 2026-08-01 on the doc's 14 utility filings, then reproduced end-to-end through
// scripts/fetchFilings.mjs with ONLY_TICKERS). The laws under test: EVERY CHIP a verbatim
// substring of its quote; ROE BOUNDS 8.0–13.0 as a chip gate, so an equity ratio or a
// fair-value return never wears the ROE label; the ACTION DATE (the quote's first year) inside
// {fy-1, fy, fy+1}, which is what retires a superseded case; ALWAYS A LIST and never a status
// field; the GLUED-HEADING case label, this build's new parsing, walked out of the heading by
// index and FAILING CLOSED to the commission named in the quote — and to nothing, which ships
// no row at all; the verb class failing closed to "requested"; advocacy, flattened tables and
// accounting variances refused. ----------------

{
  const rc = (mdnaText, fy = 2025) => rateCaseRead({ mdnaText, fullText: "", fy });
  const cases = (mdnaText, fy = 2025) => rc(mdnaText, fy)?.cases || [];
  const one = (mdnaText, fy = 2025) => cases(mdnaText, fy)[0] || null;
  const chip = (r, role) => (r?.figures || []).find((f) => f.role === role)?.text ?? null;

  // --- PNW, the doc's pinned FILED shape, exactly as it stands in the MD&A: the case heading
  // "Regulatory Overview 2025 Rate Case" is glued to the sentence, split off the quote, and its
  // trailing case name becomes the row's label.
  const pnw = "Regulatory Overview 2025 Rate Case On June 13, 2025, APS filed an application with the ACC seeking a net base rate increase of $579.5 million, which represents a 13.99% net increase.";
  const pnwSentence = "On June 13, 2025, APS filed an application with the ACC seeking a net base rate increase of $579.5 million, which represents a 13.99% net increase.";
  {
    const r = one(pnw);
    ok("PNW: the doc's pinned sentence ships with $579.5 million and 13.99%, glued heading stripped from the quote",
      !!r && r.quote === pnwSentence && chip(r, "amount") === "$579.5 million" && chip(r, "pct") === "13.99%");
    ok("PNW: the glued heading yields the case label '2025 Rate Case'",
      !!r && r.label === "2025 Rate Case" && r.heading === "Regulatory Overview 2025 Rate Case");
    ok("PNW: an application is a REQUEST — the verb class fails closed, never 'granted'",
      !!r && r.kind === "requested");
    ok("PNW: every chip is a literal substring of the shipped quote (the weld law, re-checked)",
      !!r && r.figures.every((f) => r.quote.includes(f.text)));
    ok("PNW: the record is ALWAYS A LIST and carries no status field",
      (() => { const rec = rc(pnw); return !!rec && Array.isArray(rec.cases) && !("status" in rec) && rec.cases.every((c) => !("status" in c)); })());
  }
  ok("PNW red-team: the same case narrated in a stale year dies on the action date",
    cases(pnw, 2028).length === 0);
  // The notes carry the identical sentence with the docket alias and the flattener's spacing.
  // Both are the filer's own characters; position decides, so the MD&A's plainer wording wins.
  const pnwNote = "Regulatory Matters ACC General Retail Rate Cases 2025 Rate Case On June 13, 2025, APS filed an application with the ACC (the \"2025 Rate Case\") seeking a net base rate increase of $ 579.5 million, which represents a 13.99 % net increase.";
  ok("PNW: the notes' copy chips the filer's own spacing — '$ 579.5 million' and '13.99 %', never a reconstruction",
    (() => { const r = one(pnwNote); return !!r && chip(r, "amount") === "$ 579.5 million" && chip(r, "pct") === "13.99 %" && r.quote.includes("$ 579.5 million"); })());
  ok("PNW: MD&A and notes together ship ONE row, the MD&A's wording (position breaks the rank tie)",
    (() => { const c = cases(`${pnw} ${pnwNote}`); return c.length === 1 && c[0].quote === pnwSentence; })());

  // --- AWK, the doc's pinned GRANTED shape: 105 / 9.84 / 2.2B. The granted sentence opens
  // anaphorically ("The general rate case order …") and carries neither a date nor a commission
  // of its own, so it ships only as the contiguous span with its own prior sentence — and the
  // label falls closed to the acronym that sentence names.
  const awkPrior = "On December 5, 2024, the Illinois Commerce Commission (the \"ICC\") issued a final order approving the adjustment of base rates requested in a rate case originally filed on January 25, 2024, by the Company's Illinois subsidiary.";
  const awkGrant = "The general rate case order approved an increase of $105 million in annualized water and wastewater system revenues, excluding previously recovered infrastructure surcharges of $5 million, based on an authorized return on equity of 9.84%, authorized rate base of $2.2 billion, and a capital structure with an equity component of 49.00% and a debt component of 51.00%.";
  {
    const r = one(`${awkPrior} ${awkGrant}`);
    ok("AWK: the doc's pin — $105 million, 9.84% ROE and $2.2 billion rate base, one span, three roles",
      !!r && chip(r, "amount") === "$105 million" && chip(r, "roe") === "9.84%" && chip(r, "rateBase") === "$2.2 billion");
    ok("AWK: the span is the anaphoric sentence glued to its own prior, and the label falls closed to 'ICC'",
      !!r && r.quote === `${awkPrior} ${awkGrant}` && r.label === "ICC" && r.kind === "granted");
    ok("AWK: the excluded $5 million surcharge is never chipped — the role windows do not cross another dollar",
      !!r && !r.figures.some((f) => f.text === "$5 million"));
    ok("AWK: the ROE bound holds — the 49.00% equity component and the 51.00% debt component are not returns on equity",
      !!r && !r.figures.some((f) => f.role === "roe" && f.text !== "9.84%"));
  }
  ok("AWK red-team: the granted sentence ALONE, with no date and no commission, ships nothing",
    cases(awkGrant).length === 0);

  // --- XEL, the doc's pin: BOTH FORMS. The requested one names its own commission; the granted
  // one is two sentences below its heading and never repeats the words "rate case", so it rides
  // the case block — the measured reason the block exists.
  const xelFiled = "Pending and Recently Concluded Regulatory Proceedings 2025 Colorado Electric Rate Case In November 2025, PSCo filed an electric rate case with the CPUC seeking an increase in revenue of $356 million (9.9%) ($526 million inclusive of rider roll-ins).";
  const xelBlock = "Wisconsin Electric and Natural Gas Rate Case In March 2025, NSP-Wisconsin filed a request with the PSCW for a multi-year electric and natural gas rate increase. Both the electric and natural gas rate requests were based on forward-looking 2026 and 2027 test years, with a 10.0% ROE and an equity ratio of 53.5%. In December 2025, the PSCW issued final written approval on NSP-Wisconsin's request, with a final rate increase of $126 million for the electric utility ($68 million in 2026, with an incremental $58 million in 2027) and $22 million for the natural gas utility ($18 million in 2026, with an incremental $4 million in 2027), based on a ROE of 9.8% and an equity ratio of 52.5%.";
  {
    const r = one(xelFiled);
    ok("XEL, form one — REQUESTED: $356 million with the filer's own parenthesised 9.9%",
      !!r && r.kind === "requested" && chip(r, "amount") === "$356 million" && chip(r, "pct") === "9.9%");
    ok("XEL: the parenthesised tranche '($526 million inclusive of rider roll-ins)' is never chipped",
      !!r && !r.figures.some((f) => f.text === "$526 million"));
    ok("XEL: the label walks the whole heading run, stopping at the section noun",
      !!r && r.label === "2025 Colorado Electric Rate Case");
  }
  {
    const c = cases(xelBlock);
    const g = c.find((x) => x.kind === "granted");
    ok("XEL, form two — GRANTED, reached only through the case block: $126 million at a 9.8% ROE",
      !!g && chip(g, "amount") === "$126 million" && chip(g, "roe") === "9.8%" && g.label === "Wisconsin Electric and Natural Gas Rate Case");
    ok("XEL: the block label absorbs its lowercase connective — 'Wisconsin Electric and Natural Gas Rate Case', not 'Natural Gas Rate Case'",
      !!g && g.heading.includes(g.label));
    ok("XEL: the 52.5% equity ratio inside the granted sentence is not a return on equity",
      !!g && !g.figures.some((f) => f.role === "roe" && f.text === "52.5%"));
  }
  // The stale-case kill, measured: this order is a 2023 act whose sentence carries 2024 inside
  // it, so a loosest-year test would keep it and a first-year test retires it.
  ok("XEL: the July 2023 MPUC order dies on the action date though '2022-2024' sits inside the sentence",
    cases("Minnesota Electric Rate Case In July 2023, the MPUC approved a three-year rate increase of approximately $332 million for 2022-2024, based on a ROE of 9.25% and an equity ratio of 52.5%.").length === 0);
  // The splitter's abbreviation guard: an effective date must not end a sentence.
  ok("XEL: 'effective Jan. 1, 2025' does not cut the quote — a truncated quote is a misquote",
    (() => { const r = one("Minnesota Electric Rate Case In December 2024, the MPUC approved interim rates of $192 million, effective Jan. 1, 2025."); return !!r && r.quote.endsWith("effective Jan. 1, 2025.") && r.kind === "granted"; })());

  // --- EIX, the doc's pin: reachable on the GRC token. The note window's own heading names the
  // proceeding and the sentence names it again as "2025 GRC".
  const eix = "66 Table of Contents Regulatory Proceedings 2025 General Rate Case In September 2025, the CPUC approved a final decision in SCE's 2025 GRC, authorized a base rate revenue requirement of $ 9.7 billion for 2025, an increase of $ 1.1 billion over the revenue requirement authorized for 2024.";
  {
    const r = one(eix);
    ok("EIX: the 2025 GRC decision ships as GRANTED, page furniture stripped, heading label parsed",
      !!r && r.kind === "granted" && r.label === "2025 General Rate Case" && r.quote.startsWith("In September 2025, the CPUC approved"));
    ok("EIX: the revenue requirement and the increase carry different roles — $ 9.7 billion is a level, $ 1.1 billion is the change",
      !!r && chip(r, "requirement") === "$ 9.7 billion" && chip(r, "amount") === "$ 1.1 billion");
  }
  // The GRC token's other job: EIX's MD&A narrates the case only by the acronym, and that
  // sentence carries no figure, so it is reached and then correctly ships nothing.
  ok("EIX: the GRC-only MD&A sentence carries no figure and ships nothing — reached, then refused",
    cases("The increase in SCE's core earnings in 2025 was primarily due to higher revenue from the 2025 GRC final decision and a benefit to interest expense related to cost recoveries authorized under the TKM and Woolsey Settlement Agreements.").length === 0);
  // The heading that carries the token but parses no case name confers nothing — measured on
  // EIX's memorandum-account recovery, which would otherwise render as a rate case.
  ok("EIX: 'GRC Wildfire Mitigation Memorandum Account Balances' is not a case name, so its recovery decision is not a rate case",
    cases("GRC Wildfire Mitigation Memorandum Account Balances In June 2025, the CPUC issued a final decision that authorized recovery of $291 million in operations and maintenance expenses and $99 million in capital expenditures.").length === 0);

  // --- SO: the label falls closed past the acronym to the commission's spelled-out title,
  // because Southern's house style never writes "ICC". Measured, and the reason the fallback has
  // two rungs rather than one.
  ok("SO: Nicor's January 2026 general base rate case ships, labelled 'Illinois Commission'",
    (() => { const r = one("On January 9, 2026, Nicor Gas filed a general base rate case with the Illinois Commission requesting a $221 million increase in annual base rate revenues."); return !!r && r.label === "Illinois Commission" && chip(r, "amount") === "$221 million" && r.kind === "requested"; })());
  ok("SO: a rate-case sentence naming no commission at all and carrying no heading ships nothing — the label fails closed to nothing",
    cases("In 2025 the company filed a general rate case seeking a $221 million increase in annual base rate revenues.").length === 0);

  // --- AEP: the request/grant pair for one case, and the advocacy kill.
  ok("AEP: the West Virginia request ships $ 251 million at a 10.8 % ROE, label from the page-numbered heading",
    (() => { const r = one("202 2024 West Virginia Base Rate Case In November 2024, APCo and WPCo (the Companies) filed a request with the WVPSC for a net $ 251 million annual increase in base rates based upon a proposed 10.8 % ROE and a proposed capital structure of 52 % debt and 48 % common equity."); return !!r && r.label === "2024 West Virginia Base Rate Case" && chip(r, "amount") === "$ 251 million" && chip(r, "roe") === "10.8 %"; })());
  ok("AEP: intervenor and staff TESTIMONY is advocacy about a case, never the case",
    cases("2025 ETT Base Rate Case In April and May 2025, respectively, intervenors and PUCT staff submitted testimony challenging components of the proposed rate increase including up to $ 37 million related to increased depreciation rates and $ 32 million related to the proposed ROE and capital structure.").length === 0);
  ok("AEP: a commission STAFF recommendation is not a decision",
    cases("Ohio Base Rate Case In October 2025, the PUCO staff filed its required report recommending a net annual decrease in distribution base rates ranging from $ 12 million to $ 28 million, based upon an ROE range of 9.33 % to 9.84 %.").length === 0);

  // --- DUK: the settlement its own commission has not yet approved stays a REQUEST, and an
  // accounting entry inside a rate-case block is not the case's money.
  ok("DUK: a filed settlement ships as REQUESTED — the verb class fails closed even at $ 40 million and a 9.99 % ROE",
    (() => { const r = one("South Carolina Rate Case On October 27, 2025, Duke Energy Progress filed a comprehensive settlement with the South Carolina Office of Regulatory Staff and other intervenors in the case resolving all revenue requirement issues in the base rate proceeding. The settlement included an annual net increase in electric rates of approximately $ 40 million including the flow back of PTC benefits to customers, an ROE of 9.99 % and an equity ratio of 52.4 %."); return !!r && r.kind === "requested" && chip(r, "amount") === "$ 40 million" && chip(r, "roe") === "9.99 %"; })());
  ok("DUK: a $ 29 million regulatory-liability entry sitting inside the rate-case block is not a rate change",
    cases("Indiana Rate Case An order for the rate case was issued by the IURC on January 29, 2025. In connection with this rate case, a $ 29 million increase in a regulatory liability associated with certain employee post-retirement benefits was recorded in December 2024.")
      .every((r) => !r.figures.some((f) => f.text === "$ 29 million")));

  // --- CNP / UTL: the two debris classes the sample carries.
  ok("CNP: the flattened regulatory-mechanism table is debris, not a proceeding",
    cases("CenterPoint Energy and CERC - Indiana North - Gas (IURC) CSIA $ 9 April 2025 August 2025 July 2025 Requested an increase of $94.9 million to rate base, which reflects an approximately $8.6 million annual increase in current revenues, of which 80% is included in the mechanism and 20% is deferred until the next rate case.").length === 0);
  ok("UTL: an income-statement variance that merely names rate cases as its cause is not a rate case",
    cases("Depreciation and Amortization expense increased $12.6 million in 2025 compared to 2024, reflecting higher depreciation rates from recent base rate cases, additional depreciation associated with higher levels of utility plant in service and higher amortization of other deferred costs.").length === 0);

  // --- The ROE bound, both directions, on a constructed pair whose only difference is the
  // stated return. The desk refused an allowed-ROE column outright because the same figure
  // carries equity ratios; here the bound keeps the label off anything outside 8.0–13.0.
  const roeShape = (v) => `Kentucky Base Rate Case In August 2025, KPCo filed a request with the KPSC for a $ 96 million net annual increase in base rates based upon a proposed ${v} ROE and a proposed capital structure of 53.9 % debt and 46.1 % common equity.`;
  ok("ROE bound: 10 % is inside 8.0–13.0 and ships as a return on equity",
    chip(one(roeShape("10 %")), "roe") === "10 %");
  ok("ROE bound: 53.7 % is an equity ratio wearing the words, never chipped — and the row's true dollar still stands",
    (() => { const r = one(roeShape("53.7 %")); return !!r && chip(r, "roe") === null && chip(r, "amount") === "$ 96 million"; })());
  ok("ROE bound: 4.39 % is a fair-value rate of return, below the band, never chipped",
    chip(one(roeShape("4.39 %")), "roe") === null);

  // --- The withholds, quoting the filer's own regime sentence. A regime quote carries no
  // dollar at all: this lane verified none, so it renders none.
  {
    const he = rc("The PBR Framework implemented a five-year multi-year rate period (MRP), during which there will be no general rate case applications.");
    ok("HE: the PBR regime sentence is the withhold, and the case list is still a list",
      !!he && Array.isArray(he.cases) && he.cases.length === 0 && he.withheld.quote === "The PBR Framework implemented a five-year multi-year rate period (MRP), during which there will be no general rate case applications.");
    ok("HE: the regime quote keeps its own opening words — the heading strip may not behead a real sentence",
      he.withheld.quote.startsWith("The PBR Framework implemented"));
  }
  ok("ATO: the formula-rate-mechanism sentence is the withhold, its glued section heading stripped",
    (() => { const r = rc("Annual Formula Rate Mechanisms As an instrument to reduce regulatory lag, formula rate mechanisms allow us to refresh our rates on an annual basis without filing a formal rate case."); return !!r && r.withheld?.quote === "As an instrument to reduce regulatory lag, formula rate mechanisms allow us to refresh our rates on an annual basis without filing a formal rate case."; })());
  ok("WMB: a FERC pipeline that settled its case without a disclosed figure withholds on its own settlement sentence",
    (() => { const r = rc("During the third quarter of 2025, Transco reached an agreement in principle with its customers and the other participants to settle all aspects of the rate case and has accrued a related liability for rate refunds."); return !!r && r.cases.length === 0 && /settle all aspects of the rate case/.test(r.withheld.quote); })());
  ok("the withhold never carries an unverified figure: ETR's '$19.2 million' formula-rate sentence is not a regime quote",
    rc("The electric formula rate plan decrease implemented was $19.2 million.") === null);
  ok("a real case outranks the regime sentence — the withhold is only ever an explanation of silence",
    (() => { const r = rc(`${pnw} The PBR Framework implemented a five-year multi-year rate period (MRP), during which there will be no general rate case applications.`); return !!r && r.cases.length === 1 && !r.withheld; })());

  // --- Controls. The lane is rateRegulated-gated besides, but the shapes must score zero on
  // their own: a bank's rate language, a REIT's, and a filer with nothing to say.
  ok("JPM-shape: 'the interest rate case' vocabulary of a bank scores zero — there is no commission and no case name",
    cases("The Firm's net interest income increased $2.4 billion in 2025, reflecting the impact of higher rates across the balance sheet.").length === 0);
  ok("PLD-shape: a landlord's rent change is not a rate case",
    cases("Net effective rent change on rollover was 52.9% for the year ended December 31, 2025, driven by market rent growth across our global portfolio.").length === 0);
  ok("zero incidence is silence: a utility with no case and no regime sentence returns nothing at all",
    rc("Operating revenues increased in 2025 primarily due to rate base growth and favorable weather across our service territories.") === null);
}


// ---------------- BUILD 12 REVIEW FIXES (2026-08-01) ----------------
// Found by the build's own adversarial verifier, which returned DO-NOT-SHIP on the first of these.
// CenterPoint's ONLY rate-case row came from an Item 1A risk factor: a no-assurance paragraph
// followed by "For instance," reciting a real docket whose award was a DECREASE — shipped beside
// the ask under identical labels. The window scoper cannot tell that sentence from the record
// (all three candidate head sets admit it), so the refusal is made on the frame instead.
{
  ok("the illustrative frame is refused — a risk factor's example is not the record",
    RC_ILLUSTRATION.test("For instance, in the PUCT proceeding the approved revenue requirement was $47 million lower than requested."));
  ok("its no-assurance prior is recognised as the frame it is",
    RC_NO_ASSURANCE.test("The Registrants can make no assurance that pending or future base rate proceedings will result in requested or favorable adjustments."));
  ok("a plain dated case sentence is NOT an illustration",
    !RC_ILLUSTRATION.test("In September 2025, the CPUC approved a revenue requirement of $ 9.7 billion for the 2025 General Rate Case."));

  // Two identically-labelled amounts meaning opposite things is the direction-inversion class the
  // survey files as wrong. Neither ships; the sentence goes silent.
  ok("an increase-and-decrease sentence cannot be chipped under one set of labels",
    RC_BOTH_DIRECTIONS.test("The commission approved an annual revenue requirement decrease of $47 million against the requested increase of $60 million."));
  ok("a single-direction sentence is untouched",
    !RC_BOTH_DIRECTIONS.test("The commission approved an annual revenue requirement increase of $105 million with a 9.84% return on equity."));

  // Build 7's parallel-structure law in this lane's clothes: a multi-year award list carries more
  // values than one row can label, and shipping one with the rest dropped is filler (Exelon).
  ok("a multi-year 'respectively' award list is refused rather than part-chipped",
    RC_PARALLEL_LIST.test("The MDSPC awarded electric revenue requirement increases of $41 million, $113 million, and $25 million in 2024, 2025, and 2026, respectively."));
  ok("a single-value sentence is not a parallel list",
    !RC_PARALLEL_LIST.test("The MDSPC awarded an electric revenue requirement increase of $41 million with an approved ROE of 9.50%."));

  // Failing closed must not mean asserting the other thing: the page renders the class as
  // "requested by the filer", so a sentence saying "approved" that merely fails the actor-first
  // test must go silent rather than ship a false status (Exelon's PECO sentence).
  ok("'awarded' is a grant verb (it was missing, and understated every DCPSC award)",
    RC_GRANT_VERB.test("The DCPSC awarded Pepco an electric revenue requirement increase of $99 million."));
  ok("a grant verb is present in the shape that must refuse rather than read as a request",
    RC_GRANT_VERB.test("PECO's approved annual electric revenue requirement increase of $ 354 million is partially offset by a one-time credit."));
}

// LANE — the stated-float weld (solvency-sight Build 1b). One flagship insurer states its float;
// the gates must carry exactly that sentence and refuse every look-alike.
{
  const { statedFloatRead } = await import("./fetchFilings.mjs");
  const BRK_SERIES = "Float was approximately $176 billion at December 31, 2025, $171 billion at December 31, 2024 and $169 billion at December 31, 2023.";
  const BRK_GROWTH = "On a consolidated basis, float has increased from approximately $138 billion at the end of 2020 to approximately $176 billion at the end of 2025.";
  const doc = `Insurance underwriting generated earnings. ${BRK_GROWTH} We discuss reserves elsewhere. ${BRK_SERIES} Other text follows.`;
  const r = statedFloatRead({ fullText: doc, fy: 2025 });
  ok("the Berkshire series sentence welds, verbatim", r?.quote === BRK_SERIES);
  ok("the growth sentence (opens on 2020) is passed over for the one that opens on the filing year",
    r?.quote !== BRK_GROWTH);
  ok("a wrong-year filing welds nothing (the fy gate)", statedFloatRead({ fullText: doc, fy: 2022 }) === null);
  ok("the cover page's 'public float' never welds",
    statedFloatRead({ fullText: "The aggregate public float of the registrant was $3.2 billion at June 30, 2025.", fy: 2025 }) === null);
  ok("'free float' never welds",
    statedFloatRead({ fullText: "The company's free float was $12 billion at December 31, 2025.", fy: 2025 }) === null);
  ok("float without a dollar figure welds nothing",
    statedFloatRead({ fullText: "Our float grew substantially during 2025 and remains a source of strength.", fy: 2025 }) === null);
  ok("a dollar figure without the word float welds nothing",
    statedFloatRead({ fullText: "Reserves were approximately $176 billion at December 31, 2025.", fy: 2025 }) === null);
}

console.log(`\nlanguageGatesTest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
