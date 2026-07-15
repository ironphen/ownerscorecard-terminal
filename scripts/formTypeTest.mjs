// Offline test for the form-type router (scripts/formType.mjs): the most recent annual report decides
// the pipeline (10-K → US, 20-F/40-F → ADR), and the ADR country label resolves from EDGAR's fields.
// No network. Run with `npm test`.
import { routeFromSubmissions, countryFromSubmissions } from "./formType.mjs";

// Build a submissions-shaped fixture from [form, filingDate, reportDate?] tuples (+ optional country
// fields). reportDate defaults to filingDate when omitted (the router falls back to it).
const sub = (filings, extra = {}) => ({
  ...extra,
  filings: { recent: {
    form: filings.map((f) => f[0]),
    filingDate: filings.map((f) => f[1]),
    reportDate: filings.map((f) => f[2] ?? f[1]),
  } },
});

let pass = 0, fail = 0;
const check = (name, cond, got) => { const ok = !!cond; console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : " -> " + JSON.stringify(got))); ok ? pass++ : fail++; };

// ---- route from the most recent annual form ----
check("10-K → US", routeFromSubmissions(sub([["10-K", "2025-10-31"], ["10-Q", "2025-07-01"]])).route === "US");
check("20-F → ADR", routeFromSubmissions(sub([["20-F", "2026-04-16"], ["6-K", "2026-01-01"]])).route === "ADR");
check("40-F → ADR", routeFromSubmissions(sub([["40-F", "2026-03-05"]])).route === "ADR");
// A filer that transitioned: the MOST RECENT annual wins, not the first in the list.
check("transition 20-F(old)→10-K(new) = US", routeFromSubmissions(sub([["10-K", "2025-03-01"], ["20-F", "2019-04-01"]])).route === "US", "should follow the current form");
check("transition 10-K(old)→20-F(new) = ADR", routeFromSubmissions(sub([["10-K", "2018-03-01"], ["20-F", "2026-04-01"]])).route === "ADR");
check("list order does not matter, date does", routeFromSubmissions(sub([["20-F", "2019-04-01"], ["10-K", "2025-03-01"]])).route === "US");
// Ranking is by report PERIOD, not filing date: a late amendment of a superseded OLD annual must not
// outrank a newer current annual. 20-F/A filed 2026 amends FY2024; the 10-K covers FY2025 → route US.
check("late 20-F/A of an old period does NOT outrank a newer 10-K (report-period ranking)",
  routeFromSubmissions(sub([["20-F/A", "2026-05-01", "2024-12-31"], ["10-K", "2025-02-15", "2025-12-31"]])).route === "US",
  routeFromSubmissions(sub([["20-F/A", "2026-05-01", "2024-12-31"], ["10-K", "2025-02-15", "2025-12-31"]])));
// Same period: the original outranks its own amendment (form stays the real one, route unchanged).
check("same period: original 40-F outranks its 40-F/A", routeFromSubmissions(sub([["40-F/A", "2026-04-30", "2025-12-31"], ["40-F", "2026-03-01", "2025-12-31"]])).form === "40-F");
// Amendments stay in family; a late-filing notice is not an annual report.
check("10-K/A amendment → US", routeFromSubmissions(sub([["10-K/A", "2025-11-15"]])).route === "US");
check("NT 10-K (late notice) is not an annual → null", routeFromSubmissions(sub([["NT 10-K", "2025-10-31"], ["8-K", "2025-09-01"]])).route === null);
check("no annual report → null (unrouted, country decides)", routeFromSubmissions(sub([["8-K", "2025-01-01"], ["S-1", "2024-01-01"]])).route === null);
check("empty filings → null", routeFromSubmissions(sub([])).route === null);

// ---- country label for the ADR pool ----
check("spelled-out description wins (Ireland)", countryFromSubmissions({ stateOfIncorporationDescription: "Ireland" }) === "Ireland");
check("province collapses to country (Ontario, Canada → Canada)", countryFromSubmissions({ stateOfIncorporationDescription: "Ontario, Canada" }) === "Canada");
check("the readable business-country description is used (Israel)", countryFromSubmissions({ addresses: { business: { stateOrCountryDescription: "Israel" } } }) === "Israel");
check("an unmapped EDGAR code → null (the screener country labels it, not a guessed map)", countryFromSubmissions({ addresses: { business: { stateOrCountry: "G7" } } }) === null);
check("Canadian province code → Canada (A6, the one code family we resolve)", countryFromSubmissions({ addresses: { business: { stateOrCountry: "A6" } } }) === "Canada");
check("US state code is not a country → null", countryFromSubmissions({ stateOfIncorporationDescription: "CA", addresses: { business: { stateOrCountry: "CA" } } }) === null);
check("nothing usable → null", countryFromSubmissions({}) === null);
// The route call carries the country through.
check("route result carries country", routeFromSubmissions(sub([["40-F", "2026-03-05"]], { stateOfIncorporationDescription: "Ontario, Canada" })).country === "Canada");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
