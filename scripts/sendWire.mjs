// The wire mailer: reads enabled wire_subscriptions (service role), joins each reader's follows,
// filters the freshly-refreshed wire items to their scope and window, and sends one plain email
// per reader through Resend. Doctrine holds in email exactly as on the page: the filings a
// reader's OWN companies made, listed flat and chronological — never "notable filings," never a
// ranking, never commentary on what the market did.
//
// Runs from .github/workflows/send-wire.yml after the daily wire refresh. Daily subscribers get
// each weekday's items; weekly subscribers get the trailing seven days, on Mondays. A reader with
// no matching items gets no email at all: silence over filler.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, WIRE_FROM (sender address on the
// verified domain). Exits 0 without sending when any are absent, so the workflow can run before
// the provider exists.
import { readFileSync } from "node:fs";
// Pinned fetch, not the global: newer node builds bundle an undici (6.26+) whose socket teardown
// asserts the process to death mid-parse (nodejs/undici#5360). See fetchWire.mjs for the full story.
import { fetch } from "undici";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const RESEND_KEY = (process.env.RESEND_API_KEY || "").trim();
const FROM = (process.env.WIRE_FROM || "Owner Scorecard <wire@ownerscorecard.com>").trim();
const SITE = "https://ownerscorecard.com";

if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_KEY) {
  console.log("sendWire: secrets not configured; nothing sent.");
  process.exit(0);
}

const wire = JSON.parse(readFileSync(new URL("../src/data/wire.json", import.meta.url), "utf8"));
const items = wire.items || [];

const today = new Date();
const dayUTC = today.getUTCDay(); // 0 Sun .. 6 Sat
const isMonday = dayUTC === 1;
const cutoff = (days) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};
// Daily window reaches back over the weekend on Mondays so Friday-evening filings aren't lost.
// WIRE_WINDOW_DAYS is the manual verification knob (workflow_dispatch only): widen the window
// and send now regardless of the subscriber's frequency, so a live test doesn't depend on what
// happened to be filed this morning. Scheduled runs never set it.
const OVERRIDE_DAYS = parseInt(process.env.WIRE_WINDOW_DAYS || "", 10) || 0;
const dailySince = cutoff(OVERRIDE_DAYS || (isMonday ? 3 : 1));
const weeklySince = cutoff(OVERRIDE_DAYS || 7);

// Never mail a stale wire as if it were today's. This mailer fires at a fixed 14:10 UTC with no
// knowledge of whether the morning wire refresh actually landed; if the wire runs fail, wire.json's
// asOf stops advancing and readers would quietly get old filings under a fresh subject line — a
// correctness failure no internal audit sees. Two calendar days mirrors checkFreshness's daily-leg
// threshold; Monday tolerates three, because a healthy Friday-evening run stamps Friday OR
// Saturday depending on whether it crosses UTC midnight, and Friday's stamp is already three days
// old by Monday. An unparseable stamp counts as stale, never as current. The manual verification
// knob deliberately reaches back, so it bypasses. Exit non-zero so the scheduled run goes red and
// emails the owner instead.
const asOfMs = Date.parse(wire.asOf || "");
const asOfAge = Number.isFinite(asOfMs) ? Math.floor((Date.parse(today.toISOString().slice(0, 10)) - asOfMs) / 86400000) : Infinity;
const maxStaleDays = isMonday ? 3 : 2;
if (!OVERRIDE_DAYS && asOfAge > maxStaleDays) {
  console.error(`sendWire: wire.json is ${asOfAge} days stale (asOf ${wire.asOf}); refusing to mail an old wire as today's.`);
  process.exit(1);
}

async function sb(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`supabase ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const [subs, profiles, follows] = await Promise.all([
  sb("wire_subscriptions?enabled=eq.true&select=user_id,scope,frequency"),
  sb("profiles?select=id,email"),
  sb("follows?select=user_id,ticker"),
]);

const emailOf = new Map(profiles.map((p) => [p.id, p.email]));
const followsOf = new Map();
for (const f of follows) {
  if (!followsOf.has(f.user_id)) followsOf.set(f.user_id, new Set());
  followsOf.get(f.user_id).add(String(f.ticker).toUpperCase());
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The performance line under a periodic item: numbers only, up/down and a percentage, exactly
// as the wire page prints it (the verbatim MD&A clause stays on the page). Every percentage
// was computed from two dollar figures in the filing's own XBRL; nothing else is said.
const upDown = (l) => `${l.yoy < 0 ? "down" : "up"} ${Math.abs(l.yoy).toFixed(1)}%`;
function perfLine(p) {
  if (!p) return null;
  const phrase = p.basis === "fy" ? "for the fiscal year" : p.basis === "ytd" ? "year to date" : "year over year";
  const parts = [];
  if (p.rev) parts.push(`Revenue ${upDown(p.rev)} ${phrase}`);
  if (p.oi) parts.push(p.rev ? `operating income ${upDown(p.oi)}` : `Operating income ${upDown(p.oi)} ${phrase}`);
  return parts.length ? parts.join("; ") : null;
}

let sent = 0, skipped = 0;
for (const sub of subs) {
  const email = emailOf.get(sub.user_id);
  if (!email) { skipped++; continue; }

  const weekly = sub.frequency !== "daily";
  if (weekly && !isMonday && !OVERRIDE_DAYS) { skipped++; continue; }
  const since = weekly ? weeklySince : dailySince;

  const mine = items.filter((it) => {
    if (!it.date || it.date < since) return false;
    if (sub.scope === "all") return true;
    const set = followsOf.get(sub.user_id);
    return !!set && set.has(String(it.ticker).toUpperCase());
  }).sort((a, b) => (a.date < b.date ? 1 : -1) || String(a.ticker).localeCompare(String(b.ticker)));

  if (!mine.length) { skipped++; continue; } // silence over filler

  const subject = weekly
    ? `The wire, week of ${weeklySince}: ${mine.length} filing${mine.length === 1 ? "" : "s"}`
    : `The wire: ${mine.length} filing${mine.length === 1 ? "" : "s"} from companies you follow`;

  const lines = mine.map((it) => {
    const perf = perfLine(it.performance);
    return `${it.date}  ${it.ticker}  ${it.form}  ${it.label || ""}\n  ${it.url || `${SITE}/c/${it.ticker}`}${perf ? `\n    ${perf}` : ""}`;
  });
  const text = [
    weekly ? "New filings this week from the companies you follow." : "New filings from the companies you follow.",
    "",
    ...lines,
    "",
    `The full wire: ${SITE}/wire`,
    `Manage or turn off this email: ${SITE}/account`,
  ].join("\n");

  const rows = mine.map((it) => {
    const perf = perfLine(it.performance);
    return `<tr><td style="padding:4px 10px 4px 0;color:#5b616c;font-size:13px;white-space:nowrap">${esc(it.date)}</td>` +
    `<td style="padding:4px 10px 4px 0;font-weight:600"><a href="${esc(`${SITE}/c/${String(it.ticker).toUpperCase()}`)}" style="color:#1b3b6f;text-decoration:none">${esc(it.ticker)}</a></td>` +
    `<td style="padding:4px 10px 4px 0;font-size:13px">${esc(it.form)}</td>` +
    `<td style="padding:4px 0;font-size:13.5px">${it.url ? `<a href="${esc(it.url)}" style="color:#18191d">${esc(it.label || "the filing")}</a>` : esc(it.label || "")}</td></tr>` +
    (perf ? `<tr><td></td><td colspan="3" style="padding:0 0 6px;font-size:12.5px;color:#1b3b6f">${esc(perf)}</td></tr>` : "");
  }).join("");
  const html =
    `<div style="font-family:Georgia,serif;color:#18191d;max-width:640px">` +
    `<p style="font-size:15px">${weekly ? "New filings this week from the companies you follow." : "New filings from the companies you follow."}</p>` +
    `<table style="border-collapse:collapse">${rows}</table>` +
    `<p style="font-size:12.5px;color:#5b616c;margin-top:18px">The full wire: <a href="${SITE}/wire" style="color:#1b3b6f">${SITE.replace("https://", "")}/wire</a><br>` +
    `Manage or turn off this email at <a href="${SITE}/account" style="color:#1b3b6f">your account</a>. What they disclosed, not what the market did; no other mail, ever.</p></div>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [email], subject, text, html }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    console.error(`sendWire: send to user ${sub.user_id} failed: ${r.status} ${await r.text()}`);
    process.exitCode = 1;
  } else {
    await r.body?.cancel().catch(() => {}); // discharge the unread success body
    sent++;
  }
}

console.log(`sendWire: sent ${sent}, skipped ${skipped} (no items in window, weekly off-day, or no email).`);
