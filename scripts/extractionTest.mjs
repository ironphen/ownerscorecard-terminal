// Offline regression test for section(), the routine that carves Item 1 (Business), MD&A and Risk out
// of a flattened 10-K. It runs no network: each case is a small synthetic filing that reproduces a
// real structural hazard — a table of contents, a running page header repeated mid-section, an early
// in-text cross-reference to the end heading — and asserts the extracted business section starts at the
// real heading and contains the opening, not the risk/competition text. These hazards (confirmed on
// Walmart, Coca-Cola, Bank of America) handed the hero a span that began mid-section. Run with `npm test`.
import { section } from "./fetchFilings.mjs";

// The real 10-K anchors, from SECTION_ANCHORS in fetchFilings.mjs.
const START = "item\\s*1[\\.\\s]+business";
const END = ["item\\s*1a[\\.\\s]+risk", "item\\s*1b[\\.\\s]", "item\\s*2[\\.\\s]+propert"];

const cases = [
  // The Walmart hazard: a TOC, an early in-text cross-reference to "Item 1A. Risk Factors" that
  // truncated the true section, and a running page header deep in the body. The "longest chunk" then
  // started at the running header, in the competition text. Must recover the opening AND the operations
  // line, and stop before the risk section.
  ["TOC + early cross-ref + running header",
    "Table of Contents Item 1 Business 3 Item 1A Risk Factors 15 "
    + "Item 1. Business Walmart Inc. helps people around the world save money and live better, in retail stores and through eCommerce. We operate retail stores, warehouse clubs, and eCommerce websites. "
    + "For a discussion of risks, see Item 1A. Risk Factors of this report. " + "Competition is intense. ".repeat(6)
    + "Walmart Inc. Item 1 Business 8 " + "Business above for additional discussion of the competitive landscape. ".repeat(3)
    + "Item 1A. Risk Factors The following risks could materially affect us. " + "More risk. ".repeat(4),
    (s) => s.includes("helps people") && s.includes("We operate retail stores") && !s.includes("More risk")],
  // A plain filing with no hazards must be unchanged: start at the heading, end at Risk Factors.
  ["plain (no hazards)",
    "Table of Contents Item 1 Business 3 Item 1A Risk Factors 9 "
    + "Item 1. Business Apple Inc. designs, manufactures and markets smartphones and personal computers. " + "The Company sells services. ".repeat(5)
    + "Item 1A. Risk Factors The following risks apply. " + "More risk. ".repeat(4),
    (s) => s.includes("Apple Inc. designs") && !s.includes("risks apply")],
  // A TOC with dotted leaders ("Item 1. Business ..... 3") must not be taken as the section start.
  ["dotted-leader TOC",
    "Table of Contents Item 1. Business ........... 3 Item 1A. Risk Factors ........ 15 "
    + "Item 1. Business Acme is a maker of industrial widgets and gadgets. " + "We sell widgets worldwide. ".repeat(5)
    + "Item 1A. Risk Factors Risks. " + "More risk here. ".repeat(3),
    (s) => s.includes("Acme is a maker") && !s.includes("More risk here")],
  // An opener that genuinely starts with a digit-letter ("3M Company") must be kept, not mistaken for a
  // page number and skipped.
  ["opener starts with 3M",
    "Item 1. Business 3M Company is a diversified global manufacturer of industrial and consumer products. " + "We operate in four segments. ".repeat(5)
    + "Item 1A. Risk Factors Risks. " + "More risk. ".repeat(3),
    (s) => s.includes("3M Company is a diversified")],
  // A running page header inside the section, with no early cross-reference, must not steal the start.
  ["running header, no cross-ref",
    "Item 1. Business Ford Motor Company is a global automotive company that designs and manufactures vehicles. " + "We sell cars. ".repeat(5)
    + "Ford Item 1 Business 7 page content here. " + "Item 1A. Risk Factors Risks. " + "More risk. ".repeat(3),
    (s) => s.includes("Ford Motor Company is a global") && !s.includes("More risk")],
  // Cross-references to the START heading itself, taken verbatim from the recorded extract.bizHead of the
  // real filings (Walmart, Coca-Cola, Bank of America, Alphabet, Chevron). Each sits inside a long risk
  // section that, under the old "longest chunk" rule, beat the true Item 1 — so risk/competition text led
  // the description. Each must now recover the real opening. The risk section here ends only at Item 2.
  ...(() => {
    const mk = (open, xref) =>
      "Table of Contents Item 1 Business 3 Item 1A Risk Factors 20 Item 2 Properties 40 "
      + "Item 1. Business " + open + " " + "We operate across many markets. ".repeat(4)
      + "Item 1A. Risk Factors " + "Various risks could affect us. ".repeat(10) + xref + " " + "More competition risk follows. ".repeat(10)
      + "Item 2. Properties We own facilities. ";
    return [
      ['xref: "Item 1. Business" above (Walmart)',
        mk("Walmart Inc. helps people save money in retail stores and through eCommerce.", 'as discussed in "Item 1. Business" above for additional discussion of the competitive landscape'),
        (s) => /helps people save money/.test(s) && !s.includes("competition risk")],
      ['xref: "Item 1. Business" of this report (Coca-Cola)',
        mk("The Coca-Cola Company is a total beverage company.", 'see "Item 1. Business" of this report.'),
        (s) => /Coca-Cola Company is a total beverage/.test(s)],
      ["xref: Item 1. Business beginning on page 2 (Bank of America)",
        mk("Bank of America Corporation is a bank holding company and a financial holding company.", "refer to Item 1. Business beginning on page 2 and MD&A beginning on page 26"),
        (s) => /Bank of America Corporation is a bank holding company/.test(s)],
      ["xref: Item 1 Business and Note 15 (Alphabet)",
        mk("Alphabet is a collection of businesses, the largest of which is Google.", "as described in Item 1 Business and Note 15 of the Notes to Consolidated Financial Statements"),
        (s) => /Alphabet is a collection of businesses/.test(s)],
      ["xref: Information required by Subpart 1200 (Chevron)",
        mk("Chevron Corporation manages investments in subsidiaries that engage in integrated energy operations.", "Item 1. Business . Information required by Subpart 1200 of Regulation S-K"),
        (s) => /Chevron Corporation manages investments/.test(s)],
    ];
  })(),
  // A real heading with a "General" sub-label (Humana) must NOT be mistaken for a cross-reference.
  ["real heading with General sub-label",
    "Table of Contents Item 1 Business 3 Item 1A Risk Factors 20 Item 1. Business General Headquartered in Louisville, Kentucky, Humana Inc. is a leading health and well-being company. We serve millions. Item 1A. Risk Factors Risks. More risk. ",
    (s) => /Humana Inc\. is a leading health/.test(s)],
];

let pass = 0, fail = 0;
for (const [name, text, check] of cases) {
  const got = section(text, START, END);
  const ok = check(got);
  console.log((ok ? "ok   " : "FAIL ") + name);
  if (!ok) console.log("      got: " + got.slice(0, 120).replace(/\s+/g, " "));
  ok ? pass++ : fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
