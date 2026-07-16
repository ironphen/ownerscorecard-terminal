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

// fields: { mode, price, dials: {label: value}, toggles?: {label: bool}, lede, base?, extra?,
//           bond?: {name, yield, asOf}, vintage?: {fy, periodEnd, form} }
// Returns the payload object, or null when the capture has no priced appraisal to record.
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

// One line that names a snapshot in a list: the reader's price and the headline dial values.
export function snapshotSummary(payload) {
  if (!payload || typeof payload !== "object") return "";
  const bits = [];
  if (payload.price != null) bits.push(`at ${payload.price}`);
  const d = payload.dials ?? {};
  if (d.required != null) bits.push(`${d.required}% required`);
  if (d.coe != null) bits.push(`${d.coe}% cost of equity`);
  if (d.growth != null) bits.push(`${d.growth}% growth`);
  if (d.matureMargin != null) bits.push(`${d.matureMargin}% mature margin`);
  return bits.join(", ");
}
