// Offline regression for the customer-concentration parser, the qualitative→quant weld that turns a
// filing's disclosed customer share into the dollars of revenue that ride on the biggest buyer(s). The
// integrity bar is precision: it must read the real figure where one is plainly stated, and return null
// (the number stands alone) on the things that wear concentration's clothes — a geographic split, a
// customer-type breakdown, a denial, an accounts-receivable share, or an ambiguous compound sentence.
// Every quote here is the shape of a real 10-K sentence. Run with `npm test`.
import { customerConcentration } from "../src/lib/business.mjs";

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
