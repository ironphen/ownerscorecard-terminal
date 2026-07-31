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

console.log(`\nlanguageGatesTest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
