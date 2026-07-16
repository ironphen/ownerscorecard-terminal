#!/usr/bin/env node
// notebookTest.mjs — the Owner's Notebook privacy tripwire and validation case law.
//
// The notebook's promise is structural, not editorial: the publication can never read,
// aggregate, or mine a reader's notebook. This test makes the promise fail the build if it
// is ever weakened:
//   1. No service-role path may appear anywhere in the notebook code (routes or lib).
//   2. Every notebook route must gate on same-origin + the caller's own session, and must
//      never be prerendered.
//   3. The migration must enable RLS on both tables, and notebook_snapshots must have NO
//      update policy — append-only is enforced at the database, not promised in copy.
//   4. The validators the routes run are exercised as pure functions.
import { readFileSync, readdirSync } from "node:fs";
import {
  validTicker, validId, validNoteBody, validBecause, validPayload,
  NOTE_KINDS, NOTE_MAX_CHARS, BECAUSE_MAX_CHARS, PAYLOAD_MAX_BYTES, PAYLOAD_MAX_KEYS,
} from "../src/lib/notebook.mjs";
import { buildSnapshotPayload, snapshotSummary } from "../src/lib/notebookCapture.mjs";

let failed = 0;
const t = (name, ok) => {
  if (!ok) { failed++; console.error(`✗ ${name}`); }
  else console.log(`ok ${name}`);
};

// --- 1+2: the route tripwires ---
const ROUTE_DIR = "src/pages/api/notebook";
const routeFiles = readdirSync(ROUTE_DIR).filter((f) => f.endsWith(".js"));
t("notebook routes exist (index, update, delete, snapshot)",
  ["index.js", "update.js", "delete.js", "snapshot.js"].every((f) => routeFiles.includes(f)));

// Code forms only (env keys, identifiers, client construction) — prose may state the
// promise ("never uses the service role") without tripping the wire that enforces it.
const SERVICE_ROLE_CODE = /service_role|SERVICE_ROLE|serviceRole|SERVICE_KEY|serviceKey|createClient\(/;

for (const f of routeFiles) {
  const src = readFileSync(`${ROUTE_DIR}/${f}`, "utf8");
  t(`${f}: never touches the service role`, !SERVICE_ROLE_CODE.test(src));
  t(`${f}: prerender = false`, /export const prerender = false/.test(src));
  t(`${f}: gates on same-origin`, /assertSameOrigin\(/.test(src));
  t(`${f}: gates on the caller's own session`, /getUser\(/.test(src));
}

const libSrc = readFileSync("src/lib/notebook.mjs", "utf8");
t("notebook.mjs is pure (no supabase import, no service role)",
  !/from ["']@supabase/.test(libSrc) && !SERVICE_ROLE_CODE.test(libSrc));

// --- 3: the migration tripwires ---
const mig = readFileSync("supabase/migrations/20260716_notebook.sql", "utf8");
t("migration: RLS enabled on notebook_notes",
  /alter table public\.notebook_notes enable row level security/.test(mig));
t("migration: RLS enabled on notebook_snapshots",
  /alter table public\.notebook_snapshots enable row level security/.test(mig));
t("migration: notes are editable (exactly one update policy, owner-scoped)",
  (mig.match(/on public\.notebook_notes for update/g) || []).length === 1);
t("migration: snapshots are APPEND-ONLY (no update policy exists)",
  !/on public\.notebook_snapshots for update/.test(mig));
t("migration: every policy statement is owner-scoped (auth.uid())",
  mig.split(/create policy/).slice(1)
    .every((chunk) => /auth\.uid\(\) = user_id/.test(chunk.slice(0, chunk.indexOf(";") + 1))));
t("migration: both caps live in the database",
  /notebook_notes_cap/.test(mig) && /notebook_snapshots_cap/.test(mig));

// --- 4: validator case law ---
t("ticker: normalizes and accepts", validTicker(" brk.b ") === "BRK.B");
t("ticker: rejects injection shapes", validTicker("A;DROP") === null && validTicker("") === null && validTicker("TOOLONGTICKER") === null);
t("id: accepts a uuid", validId("A1B2C3D4-0000-4000-8000-1234567890AB") === "a1b2c3d4-0000-4000-8000-1234567890ab");
t("id: rejects non-uuids", validId("1") === null && validId("robert'); drop") === null);

t("note body: keeps leading structure, trims trailing", validNoteBody("  - margin held\n") === "  - margin held");
t("note body: rejects empty/whitespace", validNoteBody("   ") === null && validNoteBody(7) === null);
t("note body: rejects past the cap", validNoteBody("x".repeat(NOTE_MAX_CHARS + 1)) === null);
t("note body: accepts at the cap", validNoteBody("x".repeat(NOTE_MAX_CHARS)) !== null);

t("because: absent → null", validBecause(undefined).ok && validBecause(undefined).value === null);
t("because: empty → null", validBecause("  ").ok && validBecause("  ").value === null);
t("because: trims and keeps", validBecause(" the margin looked durable ").value === "the margin looked durable");
t("because: rejects past the cap", validBecause("x".repeat(BECAUSE_MAX_CHARS + 1)).ok === false);
t("because: rejects non-strings", validBecause({}).ok === false);

t("payload: accepts a plain appraisal object", validPayload({ mode: "main", price: 210, r: 4.5 }) !== null);
t("payload: rejects arrays and scalars", validPayload([1]) === null && validPayload("x") === null && validPayload(null) === null);
t("payload: rejects an empty object", validPayload({}) === null);
t("payload: rejects too many keys", validPayload(Object.fromEntries(Array.from({ length: PAYLOAD_MAX_KEYS + 1 }, (_, i) => [`k${i}`, 1]))) === null);
t("payload: rejects oversized blobs", validPayload({ blob: "x".repeat(PAYLOAD_MAX_BYTES) }) === null);
t("kinds: exactly note and snapshot", NOTE_KINDS.size === 2 && NOTE_KINDS.has("note") && NOTE_KINDS.has("snapshot"));

// --- 5: the capture builder — its output must always clear the API's own gate ---
const mainFields = {
  mode: "main", price: "210.55",
  dials: { required: "4.5", years: "10", terminal: "2.5" },
  toggles: { normalized: false, sbcExpensed: true, steadyState: false, balanceSheet: false },
  lede: "At $210.55, the market is pricing Apple to grow owner earnings about 8.2%/yr…  ",
  base: "Base in use: $98.4B, latest-year owner earnings.",
  bond: { yield: "4.58", name: "10-year Treasury", asOf: "Jul 14, 2026" },
  vintage: { fy: "2025", periodEnd: "2025-09-27", form: "10-K" },
};
const built = buildSnapshotPayload(mainFields);
t("capture: builds a full main-mode payload", built != null && built.mode === "main" && built.price === 210.55);
t("capture: numbers are numbers", built.dials.required === 4.5 && built.bond.yield === 4.58 && built.vintage.fy === 2025);
t("capture: output clears the API's validPayload gate", validPayload(built) !== null);
t("capture: no price → no snapshot", buildSnapshotPayload({ ...mainFields, price: "" }) === null);
t("capture: zero/negative price → no snapshot", buildSnapshotPayload({ ...mainFields, price: "0" }) === null);
t("capture: no dials → no snapshot", buildSnapshotPayload({ ...mainFields, dials: {} }) === null);
t("capture: unknown mode → no snapshot", buildSnapshotPayload({ ...mainFields, mode: "screener" }) === null);
t("capture: long lede is clipped, not rejected",
  (() => { const p = buildSnapshotPayload({ ...mainFields, lede: "x".repeat(5000) }); return p && p.lede.length <= 700 && validPayload(p) !== null; })());
t("capture: hostile dial keys are dropped",
  (() => { const p = buildSnapshotPayload({ ...mainFields, dials: { required: "9", "__proto__x; drop": "1" } }); return p && Object.keys(p.dials).length === 1; })());
const richFields = {
  ...mainFields,
  date: "2026-07-16",
  sharesEntered: "",
  bondField: "4.6",
  readout: { implied: "+8.2%/yr", oeYield: "3.1%", gate: "—", spread: null },
  record: { sym: "$", shares: "14840000000", netDebt: "48000000000", deliveredG: "0.086" },
};
const rich = buildSnapshotPayload(richFields);
t("capture: local calendar date rides along", rich.date === "2026-07-16");
t("capture: bad date is dropped", buildSnapshotPayload({ ...richFields, date: "yesterday" }).date === undefined);
t("capture: empty shares field never becomes a claim", rich.sharesEntered === undefined);
t("capture: bond in the field is a number", rich.bondField === 4.6);
t("capture: readout keeps figures, drops em-dash and null", rich.readout.implied === "+8.2%/yr" && rich.readout.gate === undefined && rich.readout.spread === undefined);
t("capture: record carries the filed basis as numbers", rich.record.shares === 14840000000 && rich.record.sym === "$");
t("capture: rich payload still clears the API gate", validPayload(rich) !== null);
t("capture: summary reads like the design's one-liner",
  (() => { const s = snapshotSummary(rich); return s.startsWith("$210.55") && s.includes("4.5% / 10yr / 2.5%") && s.includes("implied +8.2%/yr"); })());
t("capture: summary of garbage is empty", snapshotSummary(null) === "" && snapshotSummary("x") === "");

if (failed) { console.error(`\n❌ notebookTest: ${failed} failure(s).`); process.exit(1); }
console.log("\n✅ notebookTest passed.");
