# The X pipeline

The filings-tweet drafter (a scheduled cloud routine, weekdays 12:00 UTC, after the wire's
11:00 UTC refresh) drafts tweets from the day's wire and opens a pull request against this
directory. Nothing posts automatically: the PR is the review desk, and the owner posts
approved drafts to @OwnerScorecard by hand.

- `tweet-queue.md` — dated sections of drafts, newest first, each `STATUS: PENDING REVIEW`
  until the owner edits it to POSTED or SKIPPED (by hand, when posting).
- `tweet-log.md` — one row per drafted ticker (`date | ticker | form`), the 30-day dedup
  ledger the drafter reads before choosing.

Rules the drafter runs under (also stated in the routine's own prompt):
- Figures verbatim from the wire's computed performance fields (`/wire-lite.json`), revenue
  only — operating-income swings cross zero and mislead in a one-line format.
- The company's own quoted sentence is optional and verbatim, never paraphrased.
- One `$TICKER` cashtag, no hashtags, no interpretation, no advice, no affiliation claims,
  never the word "archetype", ≤280 characters, always ending with the company-page link.
- At most three drafts per run; a filing with no clean revenue figure is skipped, not
  approximated.
