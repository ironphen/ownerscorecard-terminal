// Offline regression test for Graham's net-net test (lib/lenses.mjs) — the machinery behind the
// Net-Net Ledger at /tests/net-nets. Two parts. Part A unit-tests netNetPick against synthetic
// balance sheets, the pure verdict logic: a net-net's cushion is computed from one coherent
// balance sheet and can never exceed 100%, an incoherent sheet is withheld (not clamped), and the
// per-share figure keeps its cents (it is the number the reader sets a price against). Part B
// runs netNetRows over the real universe and asserts the invariants that must hold no matter how
// the data refreshes: every member carries a figure and its as-filed components, every list is
// sorted, no impossible cushions, and the population stays within a sane band.
//
// The coined-archetype picks and the Confluence this file once guarded were retired 2026-07 with
// the machinery itself (a flatteringly-named category the publication awards is a verdict by
// arrangement); the defensive checklist's arithmetic is guarded by scripts/grahamTest.mjs, and
// the five-of-six workbook floor now lives in /tests/defensive.astro's own strata code.
import fundamentals from "../src/data/fundamentals.json" with { type: "json" };
import adr from "../src/data/fundamentals.adr.json" with { type: "json" };
import { netNetPick, netNetRows, GRAHAM_TESTS } from "../src/lib/lenses.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL " + name); } };

// ---- Part A: synthetic netNetPick logic ----
const co = (lines, currency = "USD") => ({ lines, currency, ticker: "T" });

// Coherent sheet, cushion in (0,1], decimals kept, incoherent withheld.
{
  const m = netNetPick(co({ currentAssets: 100, totalAssets: 200, stockholdersEquity: 150, sharesDiluted: 10 }));
  ok("net-net lands", !!m);
  ok("net-net cushion 25%", /cushion 25%/.test(m.figure));
  ok("net-net per-share keeps cents", /\$5\.00\/share/.test(m.figure));
  ok("net-net data components add up", m.data && m.data.ca - m.data.totLiab === m.data.ncav);
}
ok("net-net incoherent (CA>TA) withheld", netNetPick(co({ currentAssets: 300, totalAssets: 200, stockholdersEquity: 150, sharesDiluted: 10 })) === null);
ok("net-net negative NCAV withheld", netNetPick(co({ currentAssets: 40, totalAssets: 200, stockholdersEquity: 150, sharesDiluted: 10 })) === null);
ok("net-net thin cushion withheld", netNetPick(co({ currentAssets: 60, totalAssets: 200, stockholdersEquity: 150, sharesDiluted: 10 })) === null); // ncav 10 → cushion 5%
ok("net-net equity above assets withheld", netNetPick(co({ currentAssets: 100, totalAssets: 200, stockholdersEquity: 250, sharesDiluted: 10 })) === null);
ok("net-net missing lines withheld", netNetPick(co({ currentAssets: 100 })) === null);
ok("net-net no share count falls back to total", /total/.test(netNetPick(co({ currentAssets: 100, totalAssets: 200, stockholdersEquity: 150 })).figure));

// The published copy both test pages render: present and non-verdict in shape.
ok("graham test copy present", !!GRAHAM_TESTS.defensive?.principle && !!GRAHAM_TESTS["net-nets"]?.test);

// ---- Part B: real-universe invariants ----
const cos = [...(fundamentals.companies || []), ...(adr.companies || [])];
const rows = netNetRows(cos);

ok("net-nets non-empty", rows.length > 0);
ok("net-nets every member has a figure", rows.every((r) => typeof r.figure === "string" && r.figure.length > 0));
ok("net-nets every member carries components", rows.every((r) => r.data && r.data.ca != null && r.data.totLiab != null && r.data.ncav != null));
ok("net-nets sorted desc", rows.every((r, i) => i === 0 || rows[i - 1].sort >= r.sort));
ok("net-nets no duplicate tickers", new Set(rows.map((r) => r.ticker)).size === rows.length);
// Population band — wide enough to survive a data refresh, tight enough to catch a broken predicate.
ok(`net-nets population 300–1200 (got ${rows.length})`, rows.length >= 300 && rows.length <= 1200);
// Cushions can never exceed 100% of assets.
ok("net-net cushions <= 100%", rows.every((r) => { const m = r.figure.match(/cushion (\d+)% of assets/); return m && +m[1] <= 100; }));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
