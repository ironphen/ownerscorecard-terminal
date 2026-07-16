// notebookCapture.mjs — builds the snapshot payload the notebook freezes: the reader's own
// declarations (price, dials, toggles) plus exactly what the page showed them for it (the
// rendered sentences), stamped with the day's bond yield and the record vintage it was read
// against. Pure — no DOM, no network — so scripts/notebookTest.mjs exercises it and the
// output is guaranteed to pass the API's validPayload gate.
//
// Doctrine: capture is reader-initiated, never automatic, and captures only what the reader
// themselves set or saw. The payload never contains a suggestion; it is a dated record of a
// belief the reader declared.

const TEXT_CAPS = { lede: 700, base: 300, extra: 300 };

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const clip = (v, cap) => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > cap ? s.slice(0, cap - 1) + "…" : s;
};

// fields: { mode, price, date?, dials: {label: value}, toggles?: {label: bool}, lede, base?,
//           extra?, readout?: {label: shortText}, record?: {label: numberOrShortText},
//           sharesEntered?, bondField?, bond?: {name, yield, asOf},
//           vintage?: {fy, periodEnd, form} }
// Returns the payload object, or null when the capture has no priced appraisal to record.
// A snapshot is a frozen copy of the computed figures, never a pointer re-derived later
// (design doc §3.2) — everything here is copied at capture time.
export function buildSnapshotPayload(fields) {
  const mode = ["main", "reit", "bank", "neg"].includes(fields?.mode) ? fields.mode : null;
  const price = num(fields?.price);
  if (!mode || price == null || price <= 0) return null;

  const dials = {};
  for (const [k, v] of Object.entries(fields?.dials ?? {})) {
    const n = num(v);
    if (n != null && /^[a-zA-Z][\w]{0,23}$/.test(k) && Object.keys(dials).length < 8) dials[k] = n;
  }
  if (Object.keys(dials).length === 0) return null;

  const payload = { v: 1, mode, price, dials };

  // The client's local calendar date: an evening capture in the Americas must not
  // post-date itself when the server clock is already tomorrow (§3.2).
  const date = typeof fields?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fields.date) ? fields.date : null;
  if (date) payload.date = date;

  const sharesEntered = num(fields?.sharesEntered);
  if (sharesEntered != null && sharesEntered > 0) payload.sharesEntered = sharesEntered;
  const bondField = num(fields?.bondField);
  if (bondField != null && bondField > 0) payload.bondField = bondField;

  // The rendered numerics as the page showed them ("what you save is exactly what you read").
  const readout = {};
  for (const [k, v] of Object.entries(fields?.readout ?? {})) {
    const s = clip(v, 90);
    if (s && s !== "—" && /^[a-zA-Z][\w]{0,23}$/.test(k) && Object.keys(readout).length < 8) readout[k] = s;
  }
  if (Object.keys(readout).length) payload.readout = readout;

  // The filed basis the appraisal ran against: an appraisal without its record is unanchored.
  const record = {};
  for (const [k, v] of Object.entries(fields?.record ?? {})) {
    if (!/^[a-zA-Z][\w]{0,23}$/.test(k) || Object.keys(record).length >= 8) continue;
    const n = num(v);
    if (n != null) { record[k] = n; continue; }
    const s = clip(v, 40);
    if (s) record[k] = s;
  }
  if (Object.keys(record).length) payload.record = record;

  const toggles = {};
  for (const [k, v] of Object.entries(fields?.toggles ?? {})) {
    if (typeof v === "boolean" && /^[a-zA-Z][\w]{0,23}$/.test(k) && Object.keys(toggles).length < 8) toggles[k] = v;
  }
  if (Object.keys(toggles).length) payload.toggles = toggles;

  const lede = clip(fields?.lede, TEXT_CAPS.lede);
  if (lede) payload.lede = lede;
  const base = clip(fields?.base, TEXT_CAPS.base);
  if (base) payload.base = base;
  const extra = clip(fields?.extra, TEXT_CAPS.extra);
  if (extra) payload.extra = extra;

  const by = num(fields?.bond?.yield);
  if (by != null) {
    payload.bond = { yield: by };
    const bn = clip(fields?.bond?.name, 40);
    if (bn) payload.bond.name = bn;
    const ba = clip(fields?.bond?.asOf, 40);
    if (ba) payload.bond.asOf = ba;
  }

  const fy = num(fields?.vintage?.fy);
  const pe = clip(fields?.vintage?.periodEnd, 20);
  const form = clip(fields?.vintage?.form, 12);
  if (fy != null || pe || form) {
    payload.vintage = {};
    if (fy != null) payload.vintage.fy = fy;
    if (pe) payload.vintage.periodEnd = pe;
    if (form) payload.vintage.form = form;
  }

  return payload;
}

// One line that names a snapshot in a list, §3.6 register:
// "Jun 3, 2026 — $211.40 · 9% / 10yr / 2.5% · implied +14%/yr". The date comes from the row.
export function snapshotSummary(payload) {
  if (!payload || typeof payload !== "object") return "";
  const bits = [];
  const sym = typeof payload.record?.sym === "string" ? payload.record.sym : "";
  if (payload.price != null) bits.push(`${sym}${payload.price}`);
  const d = payload.dials ?? {};
  const dialBits = [];
  if (d.required != null) dialBits.push(`${d.required}%`);
  if (d.coe != null) dialBits.push(`${d.coe}% coe`);
  if (d.years != null) dialBits.push(`${d.years}yr`);
  if (d.terminal != null) dialBits.push(`${d.terminal}%`);
  if (d.growth != null) dialBits.push(`${d.growth}% growth`);
  if (d.matureMargin != null) dialBits.push(`${d.matureMargin}% margin`);
  if (dialBits.length) bits.push(dialBits.join(" / "));
  if (payload.readout?.implied) bits.push(`implied ${payload.readout.implied}`);
  return bits.join(" · ");
}
