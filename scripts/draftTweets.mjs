#!/usr/bin/env node
// draftTweets.mjs — the filings-tweet drafter, run inside the wire workflow right after the
// wire refresh, so the day's drafts land in the same commit as the wire itself. Deterministic
// by design: every draft is a fixed template over figures the wire already computed from the
// filing's own XBRL, plus (optionally) the company's verbatim MD&A sentence — there is nothing
// here a model would add except risk. Nothing posts anywhere: drafts append to
// marketing/tweet-queue.md as PENDING REVIEW, the owner posts to X by hand, and
// marketing/tweet-log.md is the 30-day dedup ledger. See marketing/README.md for the rules.
import fs from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "src", "data");
const mkDir = path.join(process.cwd(), "marketing");
const queuePath = path.join(mkDir, "tweet-queue.md");
const logPath = path.join(mkDir, "tweet-log.md");

const wire = JSON.parse(fs.readFileSync(path.join(dataDir, "wire.json"), "utf8"));
const fundamentals = JSON.parse(fs.readFileSync(path.join(dataDir, "fundamentals.json"), "utf8"));

const today = (wire.asOf || new Date().toISOString()).slice(0, 10);
const queue = fs.existsSync(queuePath) ? fs.readFileSync(queuePath, "utf8") : "# Tweet queue\n";
const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "# Tweet log\n\ndate | ticker | form\n---- | ------ | ----\n";

// Idempotent per day: a workflow re-run must not queue the same drafts twice.
if (queue.includes(`## ${today} `)) {
  console.log(`draftTweets: ${today} already queued; nothing to do.`);
  process.exit(0);
}

// The 30-day dedup ledger: one tweet per company per month, however often it files.
const cutoff = new Date(new Date(today).getTime() - 30 * 86400000).toISOString().slice(0, 10);
const recent = new Set(
  log.split("\n")
    .map((l) => l.split("|").map((s) => s.trim()))
    .filter((p) => p.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(p[0]) && p[0] >= cutoff)
    .map((p) => p[1].toUpperCase())
);

// Prominence: the same idea the search index uses — revenue magnitude — so "recognizable"
// is a figure, not a vibe.
const revByTicker = new Map(
  (fundamentals.companies || []).map((c) => [String(c.ticker || "").toUpperCase(), c.ttm?.lines?.revenue ?? c.lines?.revenue ?? 0])
);

// Candidates: periodic filings whose XBRL carried the year-over-year revenue comparison.
// One item per accession (a preferred-share ticker duplicates its common's filing under the
// same accession number — the exact dedup, no ticker heuristics).
const seenAccn = new Set();
const candidates = [];
for (const it of wire.items || []) {
  if (it.form !== "10-K" && it.form !== "10-Q") continue;
  const rev = it.performance?.rev?.yoy;
  if (rev == null) continue;
  const tk = String(it.ticker || "").toUpperCase();
  if (!tk || recent.has(tk)) continue;
  if (it.accn && seenAccn.has(it.accn)) continue;
  if (it.accn) seenAccn.add(it.accn);
  candidates.push({ tk, name: it.name || tk, form: it.form, date: it.date, rev, quote: it.performance?.driver || null, size: revByTicker.get(tk) || 0 });
}
candidates.sort((a, b) => b.size - a.size || (b.quote ? 1 : 0) - (a.quote ? 1 : 0) || a.tk.localeCompare(b.tk));

const chosen = candidates.slice(0, 3);
if (!chosen.length) {
  console.log("draftTweets: no qualifying fresh filings today; nothing queued.");
  process.exit(0);
}

// The draft: the filing fact with the verbatim figure, the company's own sentence when it
// fits, the traced-to-the-filing link. One cashtag, no hashtags, no interpretation.
const draft = (c) => {
  const dir = c.rev < 0 ? "down" : "up";
  const line1 = `${c.name} $${c.tk} filed its ${c.form}: revenue ${dir} ${Math.abs(c.rev).toFixed(1)}% year over year.`;
  const line3 = `Every figure traced to the filing → https://ownerscorecard.com/c/${c.tk}`;
  const withQuote = c.quote ? `${line1}\n“${c.quote}”\n${line3}` : null;
  return withQuote && withQuote.length <= 280 ? withQuote : `${line1}\n${line3}`;
};

const section = [
  `## ${today} — STATUS: PENDING REVIEW`,
  "",
  ...chosen.flatMap((c) => [
    `source: ${c.tk} ${c.form} filed ${c.date}, revenue ${c.rev > 0 ? "+" : ""}${c.rev}% YoY`,
    "```",
    draft(c),
    "```",
    "",
  ]),
].join("\n");

// Newest section first, directly under the file header.
const headerEnd = queue.indexOf("\n## ");
const newQueue = headerEnd === -1
  ? queue.trimEnd() + "\n\n" + section + "\n"
  : queue.slice(0, headerEnd + 1) + "\n" + section + "\n" + queue.slice(headerEnd + 1);
fs.writeFileSync(queuePath, newQueue);
fs.writeFileSync(logPath, log.trimEnd() + "\n" + chosen.map((c) => `${today} | ${c.tk} | ${c.form}`).join("\n") + "\n");
console.log(`draftTweets: queued ${chosen.length} draft(s): ${chosen.map((c) => c.tk).join(", ")}`);
