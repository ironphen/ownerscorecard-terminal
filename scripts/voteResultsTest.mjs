#!/usr/bin/env node
// voteResultsTest.mjs — case law for the say-on-pay extractor (fetchVoteResults.mjs).
//
// The traps frozen here were all found live on 2026-07-18:
//   - a director-election table sits BETWEEN the say-on-pay prose and its tally (GE), so number
//     capture must be tightly anchored, never window-scanned;
//   - the labeled form interleaves percentages with the counts (Coca-Cola/Exxon "Votes Cast For:
//     N 90.84 %");
//   - the row form puts a status word and a percentage before the counts (Microsoft "Approved
//     91.94 4,744,731,533 …");
//   - Microsoft never writes "Item 5.07" in the body at all (the index carries the item);
//   - the FREQUENCY vote ("1 year / 2 years / 3 years") also mentions executive compensation and
//     must never be read as the say-on-pay tally;
//   - stale results are worse than none: only the LATEST 5.07 filing is read (the old walk-back
//     served Microsoft's 2022 vote under a 2025 pipeline).
// Offline synthetic fixtures + live-pool pins when voteResults.json is present.
import { readFileSync } from "node:fs";
import { parseSayOnPay } from "./fetchVoteResults.mjs";

let failed = 0;
const t = (name, got, want) => {
  const ok = want == null ? got == null : got != null && got.for === want.for && got.against === want.against && got.abstain === want.abstain;
  if (!ok) { failed++; console.error(`✗ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
  else console.log(`ok ${name}`);
};

// Form A — header then numbers directly (Apple).
t("form A: header-adjacent numbers",
  parseSayOnPay("Item 5.07. Votes were cast as follows. 3. An advisory resolution to approve executive compensation was approved. For Against Abstained 8,304,055,118 781,645,634 50,707,052"),
  { for: 8304055118, against: 781645634, abstain: 50707052 });

// Form C — labeled counts with interleaved percentages (Coca-Cola/Exxon).
t("form C: labeled counts with percents",
  parseSayOnPay("Item 5.07 Advisory Vote to Approve Executive Compensation. Votes regarding this advisory proposal were as follows: Votes Cast For: 2,906,500,165 90.84 % Votes Cast Against: 293,071,998 9.16 % Abstentions: 14,455,974 Broker Non-Votes: 463,652,223"),
  { for: 2906500165, against: 293071998, abstain: 14455974 });

// Form E — row label, then status word + percentage, then the counts (Microsoft; no "Item 5.07").
t("form E: row with status and percent, no Item heading",
  parseSayOnPay("Submission of Matters to a Vote of Security Holders. The inspector certified the following vote tabulations: Advisory Vote to Approve Named Executive Officer Compensation Vote result % Votes For For Against Abstain Broker Non-Votes Approved 91.94 4,744,731,533 415,831,135 22,891,989 1,137,975,835"),
  { for: 4744731533, against: 415831135, abstain: 22891989 });

// The GE trap: a director table between the prose mention and the say-on-pay row. The prose match
// must NOT pick up the directors' numbers; the later row must be the one that parses.
t("director table between prose and tally never misattributes",
  parseSayOnPay("Item 5.07. Shareholders approved the advisory vote on the Company's named executives' compensation (\"Say on Pay\"). Election of Directors For Against Abstain Broker Non-Votes 1. A Director 764,954,244 19,029,987 1,020,512 107,761,682 2. B Director 771,414,168 11,812,237 1,778,338 107,761,682 Say on Pay 753,387,208 27,686,972 3,930,563 107,761,682"),
  { for: 753387208, against: 27686972, abstain: 3930563 });

// The frequency vote must never be read as the tally.
t("frequency vote refused",
  parseSayOnPay("Item 5.07. An advisory vote on the frequency of the advisory vote on executive compensation: 1 Year 2 Years 3 Years Abstain 5,000,000 200,000 900,000 50,000"),
  null);

// No say-on-pay proposal at all → null, never a guess.
t("no proposal → null",
  parseSayOnPay("Item 5.07. 1. Directors were elected. For Against Abstain 1,000,000 50,000 2,000. 2. The auditor was ratified. For Against Abstain 1,100,000 20,000 1,000."),
  null);

// ---- live-pool pins (when the data file exists): the filings' own printed percentages ----
try {
  const live = JSON.parse(readFileSync("src/data/voteResults.json", "utf8")).companies || {};
  const pct = (s) => (s.for / (s.for + s.against)) * 100;
  const pin = (tk, want, tol = 0.02) => {
    const c = live[tk];
    if (!c) return;
    const ok = Math.abs(pct(c.sayOnPay) - want) < tol;
    if (!ok) { failed++; console.error(`✗ ${tk} support ${pct(c.sayOnPay).toFixed(2)}% ≠ filing's printed ${want}%`); }
    else console.log(`ok ${tk} reproduces the filing's own printed support (${want}%)`);
  };
  // These filings PRINT their support percentage; our counts must reproduce it exactly.
  pin("KO", 90.84);
  pin("XOM", 92.9, 0.05);
  pin("MSFT", 91.94);
  if (live.AAPL) {
    const s = live.AAPL.sayOnPay;
    const ok = s.for === 8304055118 && s.against === 781645634 && s.abstain === 50707052 && live.AAPL.meetingDate === "2026-02-24";
    if (!ok) { failed++; console.error(`✗ AAPL 2026 tally drifted: ${JSON.stringify(s)}`); }
    else console.log("ok AAPL 2026 tally pinned to the filed counts");
  }
  // 2026-07-18 adjudication pins: Fox's real say-on-pay (its defeated STOCKHOLDER comp proposal
  // shipped as 4% before the proposal-boundary fix), BlackBerry's real one (a by-law proposal's
  // counts shipped before the numbered-list boundary fix), and AON's genuinely FAILED vote, which
  // ships as filed — a failed say-on-pay is the accountability record working, never an error.
  if (live.FOX) { const s = live.FOX.sayOnPay; if (!(s.for === 192375927 && s.against === 8152439)) { failed++; console.error(`✗ FOX say-on-pay drifted: ${JSON.stringify(s)}`); } else console.log("ok FOX ships its real say-on-pay, not the stockholder proposal"); }
  if (live.BB) { const s = live.BB.sayOnPay; if (!(s.for === 213472065 && s.against === 51847131)) { failed++; console.error(`✗ BB say-on-pay drifted: ${JSON.stringify(s)}`); } else console.log("ok BB ships its real say-on-pay, not the by-law proposal"); }
  if (live.AON) { const s = live.AON.sayOnPay; if (!(s.for === 69888299 && s.against === 110798636)) { failed++; console.error(`✗ AON failed vote drifted: ${JSON.stringify(s)}`); } else console.log("ok AON's genuinely failed vote ships as filed (38.7%)"); }

  // Post-fix adjudication pins (2026-07-18, second round): the corrected movers and the genuine
  // dramatic failures, all verified against the rendered 8-K rows. ATEN's and SCCD's OLD values
  // were the auditor-ratification rows — the cross-proposal bleed this parser's boundary rule
  // exists to prevent.
  const PIN = { TMO: [99928178, 214525673], WBD: [244543743, 1313562677], ATEN: [44551793, 15835380], SPG: [191490165, 83587104] };
  for (const [tk, [ef, ea]] of Object.entries(PIN)) {
    const c = live[tk];
    if (!c) continue;
    const s = c.sayOnPay;
    if (s.for !== ef || s.against !== ea) { failed++; console.error(`✗ ${tk} adjudicated tally drifted: ${JSON.stringify(s)}`); }
    else console.log(`ok ${tk} ships its adjudicated tally`);
  }

  // Staleness invariant: every shipped meeting is within ~500 days of the data's asOf.
  const asOf = JSON.parse(readFileSync("src/data/voteResults.json", "utf8")).asOf;
  let stale = 0;
  for (const [tk, c] of Object.entries(live)) {
    if (c.meetingDate && (new Date(asOf) - new Date(c.meetingDate)) / 864e5 > 500) { stale++; if (stale <= 5) console.error(`  stale meeting: ${tk} ${c.meetingDate}`); }
  }
  if (stale) { failed++; console.error(`✗ ${stale} shipped vote(s) from meetings >500 days old (stale walk-back class)`); }
  else console.log("ok no shipped vote is from a stale meeting");
} catch { /* data file absent: synthetic coverage stands alone */ }

if (failed) { console.error(`\n❌ voteResultsTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ voteResultsTest passed.");
