#!/usr/bin/env node
// coverSharesTest.mjs — case law for the cover-text share fallback (the STZ/dual-class hole).
//
// Thirteen real filers carry no share fact anywhere in the companyfacts API (class-dimension
// tagging is stripped), so the fetcher's last resort reads the filing covers themselves,
// corroborated across the latest 10-K and 10-Q. Every passage below is VERBATIM from a real
// cover, extracted and verified against the filings (workflow wf_a54d3249-ba8, 2026-07-16).
// The rules under test: sum the common classes; preferred never counts; a cover that states no
// common exists returns null (CHS is a member cooperative — its blank is the truth, not a hole);
// prose that merely mentions "outstanding" (debt, market value) never parses to a number.
import { parseCoverShares } from "./fetchFundamentals.mjs";

let failed = 0;
const t = (name, html, want) => {
  const got = parseCoverShares(html);
  if (got !== want) { failed++; console.error(`✗ ${name}: got ${got}, want ${want}`); }
  else console.log(`ok ${name}`);
};

// --- real covers, verbatim ---
t("chs-coop-no-common (10-K)",
  "Indicate the number of shares outstanding of each of the Registrant's classes of common stock, as of the latest practicable date: The Registrant has no common stock outstanding.",
  null);
t("imkta-dual-class (10-K)",
  "As of November 24, 2025, the registrant had 14,548,611 shares of Class A Common Stock outstanding and 4,445,765 shares of Class B Common Stock outstanding.",
  18994376);
t("imkta-dual-class-parvalue (10-Q)",
  "As of May 5, 2026, the registrant had 14,548,836 shares of Class A Common Stock, $0.05 par value per share, outstanding and 4,445,540 shares of Class B Common Stock, $0.05 par value per share, outstanding.",
  18994376);
t("plnt-inverted-order (10-K)",
  "The number of outstanding shares of the registrant's Class A common stock, par value $0.0001 per share, and Class B common stock, par value $0.0001 per share, as of February 20, 2026, was 79,697,889 shares and 316,128 shares, respectively.",
  80014017);
t("plnt-there-were (10-Q)",
  "As of May 4, 2026 there were 79,126,649 shares of the Registrant's Class A Common Stock, par value $0.0001 per share, outstanding and 316,128 shares of the Registrant's Class B Common Stock, par value $0.0001 per share, outstanding.",
  79442777);

t("dgica-boilerplate-dual (10-K)",
  "Indicate the number of shares outstanding of each of the registrant's classes of common stock, as of the latest practicable date: 31,426,189 shares of Class A common stock and 5,576,775 shares of Class B common stock outstanding on March 2, 2026.",
  37002964);
t("fph-upc-as-of-phrasing (10-K)",
  "The aggregate market value of common shares held by non-affiliates of the registrant as of June 30, 2025, based on the closing sale price per share as reported by the New York Stock Exchange on such date, was approximately $325.4 million. As of February 27, 2026, 71,330,106 Class A common shares and 76,096,410 Class B common shares were outstanding.",
  147426516);
t("grdn-issued-and-outstanding (10-K)",
  "As of March 2, 2026, there were issued and outstanding 36,253,744 shares of the Registrant's Class A common stock and 27,066,890 shares of the Registrant's Class B common stock.",
  63320634);
t("hlne-there-were (10-K)",
  "As of May 19, 2026, there were 43,697,364 shares of the registrant's Class A common stock and 11,836,450 shares of the registrant's Class B common stock outstanding.",
  55533814);

t("stz-cover-table (10-K)",
  "The number of shares outstanding with respect to each of the classes of common stock of Constellation Brands, Inc., as of April 17, 2026, is set forth below: Class Number of Shares Outstanding Class A Common Stock, par value $.01 per share 172,172,544 Class 1 Common Stock, par value $.01 per share 25,923",
  172172544);
t("wttr-two-numbers-one-shares (10-K)",
  "There were 105,140,543 and 16,221,101 shares of the registrant's Class A and Class B common stock, respectively, outstanding as of February 16, 2026.",
  121361644);
t("bam-tiny-class-b-below-floor (10-K)",
  "As of February 23, 2026, the registrant had 1,638,147,590 Class A Limited Voting Shares and 21,280 Class B Limited Voting Shares outstanding.",
  // The 21,280-share Class B sits below the 1e5 plausibility floor and is omitted — a 0.0013%
  // understatement, immaterial and accepted; the floor is what keeps date fragments and par
  // values out of the sum, and the corroboration band absorbs the difference.
  1638147590);

// --- synthetic guards ---
t("single-class",
  "The number of shares of the registrant common stock outstanding as of April 10, 2026 was 84,512,331.",
  84512331);
t("boilerplate-dual",
  "Indicate the number of shares outstanding of each of the issuer&#8217;s classes of common stock, as of the latest practicable date: Class A Common Stock, 162,318,004 shares; Class B Common Stock, 23,205,885 shares outstanding as of March 31, 2026.",
  185523889);
t("preferred-only-refuses",
  "Number of shares outstanding of each of the issuer classes: 8% Cumulative Preferred Stock, 12,000,000 shares.",
  null);
t("debt-prose-refuses",
  "Total debt outstanding as of February 28, 2026, amounted to $10,568.5 million, a decrease from the prior year.",
  null);
t("market-value-not-a-count",
  "The number of outstanding shares of the registrant's common stock as of June 30, 2025 was 55,123,400. The aggregate market value of shares held by non-affiliates was $9,100,000,000.",
  55123400);

if (failed) { console.error(`\n❌ coverSharesTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ coverSharesTest passed.");
