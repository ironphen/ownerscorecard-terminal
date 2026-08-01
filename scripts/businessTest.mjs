// Offline regression for the customer-concentration parser, the qualitative→quant weld that turns a
// filing's disclosed customer share into the dollars of revenue that ride on the biggest buyer(s). The
// integrity bar is precision: it must read the real figure where one is plainly stated, and return null
// (the number stands alone) on the things that wear concentration's clothes — a geographic split, a
// customer-type breakdown, a denial, an accounts-receivable share, or an ambiguous compound sentence.
// Every quote here is the shape of a real 10-K sentence. Run with `npm test`.
// Also guards weakLede's newest patterns (segment-subject, product-line catalog, aspiration with a
// modal) and the truncation-artifact guard — every case below is a real stored lede/brief shape, and
// every "must NOT flag" case is a real description that sat adjacent to a flagged one in the audit.
import { customerConcentration, weakLede, truncationArtifact } from "../src/lib/business.mjs";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); cond ? pass++ : fail++; };
const pctOf = (r) => (r == null ? null : Math.round(r.pct * 100));

// ---- reads the figure where it is plainly stated ----
check("single largest customer, named",
  pctOf(customerConcentration("Our largest customer, Walmart, Inc. and its affiliates, accounted for approximately 29% of consolidated net sales for fiscal 2025.")) === 29);
check("single largest customer → not flagged multi",
  customerConcentration("Our largest customer accounted for 18.1% of our revenue.")?.multi === false);
check("top-N aggregate is multi",
  (() => { const r = customerConcentration("Our ten largest customers accounted for, in the aggregate, 72% of our net sales for the year ended December 31, 2025."); return r?.multi === true && Math.round(r.pct*100) === 72; })());
check("per-customer list in one year → the largest (23%, not 12%)",
  pctOf(customerConcentration("During the year ended December 31, 2025, three customers accounted for 23%, 19%, and 12% of our total revenue, respectively.")) === 23);
check("multi-year series → the latest period (77%, not 97%)",
  pctOf(customerConcentration("Revenues from the Company's five largest customers accounted for approximately 77%, 93%, and 97% of its net revenues in fiscal 2025, 2024, and 2023, respectively.")) === 77);
check("the revenue figure, not the non-revenue one in the same sentence (12%, not 22% of NIW)",
  pctOf(customerConcentration("In 2025, our largest customer accounted for approximately 22% of our total NIW and 12% of total revenues.")) === 12);

// ---- returns null on what only looks like concentration ----
check("geographic split is not concentration",
  customerConcentration("60.3% of our revenue was derived from sales to customers outside of the United States.") === null);
check("customer-type breakdown is not concentration",
  customerConcentration("Revenues derived from commercial and residential customers accounted for approximately 90% of total water and electric revenues.") === null);
check("a denial is not a concentration",
  customerConcentration("Although we did not have any customer that represented 10% or more of our net revenue, we derive 35.1% of our net revenue from our top ten customers.") === null);
check("accounts-receivable share is not a revenue share",
  customerConcentration("As of December 31, 2025, two customers, BioCare and CuraScript, represented an aggregate of approximately 87% of our consolidated accounts receivable.") === null);
check("an income variance that mentions customers and a percent is not concentration",
  customerConcentration("Income from operations in 2024 decreased by $189 million or 28 percent when compared to 2023 on a revenue decrease of $314 million.") === null);
check("autopay share is not concentration",
  customerConcentration("More than 80% of our residential customers pay us these fees through automatic payment methods.") === null);
check("a compound single-and-top-N sentence is ambiguous → null",
  customerConcentration("Coal sales to our largest customer accounted for approximately 14% of our total revenues, and coal sales to our 10 largest customers accounted for approximately 77% of our total revenues.") === null);
check("no percentage at all → null",
  customerConcentration("Our largest customer is a significant relationship that we depend on.") === null);
check("a stray small/large number that isn't a revenue share → null",
  customerConcentration("Our largest customer has been with us since 1998 and operates 3 facilities.") === null);

// ---- floors and edges ----
check("a 'more than X%' floor still reads the figure",
  pctOf(customerConcentration("During 2025, one customer comprised greater than 10.0% of our revenue.")) === 10);
check("empty / non-string input → null", customerConcentration("") === null && customerConcentration(null) === null);

// ---- weakLede: one segment standing in for the whole (AZZ's hero) ----
check("segment-subject lede is weak",
  weakLede("AZZ Precoat Metals segment provides aesthetic and corrosion protective coatings and related value-added services for steel and aluminum coil."));
check("segment-subject with alias is weak",
  weakLede('The AZZ Infrastructure Solutions segment ("AIS") represents our 40% non-controlling interest in the AIS Investment Holdings LLC.'));
check("'operates in one business segment, the manufacture of pumps' (whole company) is NOT weak",
  !weakLede("Gorman-Rupp Company operates in one business segment, the manufacture and sale of pumps and pump systems."));
check("'we operate in two segments' (company-subject structure line) is NOT newly flagged by the segment pattern",
  !weakLede("We operate as a single segment designed to serve customers worldwide through stores and digital channels."));

// ---- weakLede: the company's product catalog, not the company (Apple's watch list) ----
check("product-line spec list is weak",
  weakLede("The Company's line of smartwatches, based on its watchOS operating system, includes Apple Watch Series 11, Apple Watch SE 3 and Apple Watch Ultra 3."));
check("'lines of business include' (the whole company) is NOT weak",
  !weakLede("The Company's lines of business include retail and commercial banking, and wealth management services."));

// ---- weakLede: aspiration with a modal (RF's 'We will continue to evaluate...') ----
check("'We will continue to evaluate...' is weak",
  weakLede("We will continue to evaluate the impact of any changes in laws and any new regulations promulgated."));

// ---- truncation artifacts: broken text is dropped, not rendered ----
check("orphaned intro from a 'J.P.' split is truncated",
  truncationArtifact("Morgan and Chase brands, the Firm serves millions of customers, predominantly in the U.S., and many of the world's most prominent clients globally."));
check("dangling 'by U.S.' is truncated",
  truncationArtifact("Banking and other financial services statutes, regulations and policies are continually under review by U.S."));
check("dangling 'provider of U.S.' is truncated",
  truncationArtifact("Venture Global is a long-term, low-cost provider of U.S."));
check("subject-severed parenthetical is truncated",
  truncationArtifact('(the "Company") is a leading designer, marketer and licensor of a broad range of quality casual footwear.'));
check("lowercase start is truncated", truncationArtifact("ing services to banks, merchants, and billers."));
check("'in both the U.S. and U.K.' (whole) is NOT truncated",
  !truncationArtifact("We provide waste management services in both the U.S. and U.K."));
check("'Medtronic plc, headquartered in Galway, Ireland, is...' is NOT truncated",
  !truncationArtifact("Medtronic plc, headquartered in Galway, Ireland, is the leading global healthcare technology company."));
check("a serial-verb subject ('Hormel develops, processes, and distributes...') is NOT truncated",
  !truncationArtifact("Hormel Foods Corporation develops, processes, and distributes a wide array of food products in a variety of markets."));
check("a compound-list subject ('Sleek cans, standard cans and bottles are sold...') is NOT truncated",
  !truncationArtifact("Sleek cans, standard cans and bottles are sold primarily for off-premise retailers, which include grocery stores."));
check("a participial opener ('Underpinned by..., we have...') is NOT truncated",
  !truncationArtifact("Underpinned by the brokerage services, we have successfully expanded our product offerings to wealth management."));
check("a scene-setting opener ('Under the X brands, the company sells...') is NOT truncated",
  !truncationArtifact("Under the Good Health brands, the company sells snacks across North America."));
check("a stranded relative preposition ('...the world we live in.') is NOT truncated",
  !truncationArtifact("MillerKnoll is a collective of dynamic brands that comes together to design the world we live in."));

// ---- weakLede: the GLUED HEADING, title-cased so ALLCAPS_HEADING cannot see it ----
// The extractor joins the registrant's name to the section heading beneath it and then to the
// first sentence under that, opening a company page on the wrong subject entirely. Texas Pacific
// Land, a land-and-royalty business, opened on the price of oil. Measured pool-wide: 26 of 2,890
// stored ledes carry one of these headings and every one of the 26 is MD&A prose, forward-looking
// boilerplate or heading glue — none is a description, so the fallback is always the better read.
check("TPL: the registrant name glued to 'market Conditions' is not a description",
  weakLede("Texas Pacific Land market Conditions Average West Texas Intermediate oil prices for the year ended December 31, 2025 were down approximately 15% compared to average WTI oil prices during the prior year."));
check("LNC: the same glue in another filer's clothes dies too",
  weakLede("Lincoln National market conditions greatly influence the ultimate capital required due to its effect on the valuation of our reserves."));
check("an MD&A results-of-operations sentence is not a description",
  weakLede("Our results of operations are affected by levels of interest rates, the expansion or retraction of the capital markets, and general economic conditions."));
// The guard is a closed vocabulary of section headings precisely so it cannot convict a real
// description that happens to carry a proper noun or a market reference.
check("a genuine description mentioning its markets survives",
  !weakLede("The company designs and manufactures analog semiconductors for the industrial and automotive markets, selling through a direct sales force in 30 countries."));
check("a genuine description naming a region survives",
  !weakLede("Cheniere Energy is an energy infrastructure company that provides liquefied natural gas to integrated energy companies, utilities and energy trading companies worldwide."));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
