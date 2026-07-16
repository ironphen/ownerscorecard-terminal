// notebook.mjs — pure validation for the Owner's Notebook API. No Supabase, no DOM, no
// service role: this module is imported by the /api/notebook routes AND by
// scripts/notebookTest.mjs, so every rule the API enforces is exercised in `npm test`
// without a worker or a database. The database enforces the same limits again (checks and
// cap triggers in supabase/migrations/20260716_notebook.sql) — defense in depth, same
// construction as follows.

export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NOTE_MAX_CHARS = 20000;
export const BECAUSE_MAX_CHARS = 500;
export const PAYLOAD_MAX_BYTES = 16384;
export const PAYLOAD_MAX_KEYS = 32;

// Normalized ticker, or null.
export function validTicker(raw) {
  const t = String(raw ?? "").trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

// A lowercased UUID, or null.
export function validId(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return UUID_RE.test(s) ? s : null;
}

// Note body: a non-empty string within the cap, trimmed of trailing whitespace only
// (leading structure — a dash list, an indented figure — is the reader's to keep).
export function validNoteBody(raw) {
  if (typeof raw !== "string") return null;
  const b = raw.replace(/\s+$/, "");
  if (!b.trim() || b.length > NOTE_MAX_CHARS) return null;
  return b;
}

// The optional because-line on a snapshot. Absent/empty → null (stored as NULL);
// present → trimmed and capped, or invalid.
export function validBecause(raw) {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false };
  const b = raw.trim();
  if (!b) return { ok: true, value: null };
  if (b.length > BECAUSE_MAX_CHARS) return { ok: false };
  return { ok: true, value: b };
}

// A snapshot payload: a plain JSON object (what S2's capture serializes — dial state,
// rendered readout text, record basis, the day's bond yield). Shape stays open on purpose;
// size and key count are bounded so the notebook can never become a blob store.
export function validPayload(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length === 0 || keys.length > PAYLOAD_MAX_KEYS) return null;
  let serialized;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return null;
  }
  if (serialized == null || serialized.length > PAYLOAD_MAX_BYTES) return null;
  return raw;
}

export const NOTE_KINDS = new Set(["note", "snapshot"]);
