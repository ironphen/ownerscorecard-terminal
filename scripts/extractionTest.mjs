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
