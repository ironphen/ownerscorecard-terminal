// priceMemory.mjs — the price memory: the reader's own typed price, remembered on their
// device and returned, dated, on the next visit.
//
// The rule stays "the reader brings the price" (docs/price-doctrine.md): no feed, no license,
// no quote of ours. The ?px= URL param has always been the reader-supplied prefill channel;
// localStorage is the same channel with persistence — their number, on their own device, never
// sent anywhere. Precedence on load: an explicit ?px= in the URL wins (a shared link means what
// it says); otherwise the saved price fills the input and wears its date in a quiet line under
// the price row — staleness stated, never worn as currency. The line hides the moment the
// reader edits; clearing the input forgets the saved price. Storage failures (private mode)
// no-op silently, exactly like setURL.
//
// Shared by all four valuation modes (owner-earnings, negative, bank/insurer, REIT): one
// mechanism, wired with wirePriceMemory(ticker, input, note) after the ?px= prefill and
// before the first update().

const key = (ticker) => "osc-px-" + ticker;

// The local calendar date as YYYY-MM-DD — the day the reader typed the price, in their own
// time zone (a UTC date would post-date an evening entry in the Americas).
export const localISO = (t = new Date()) =>
  t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");

// The dated line. Today's entry says so plainly; an older one names its day (and its year,
// once the year has turned — "Jul 9" must never dress a year-old number as this July's).
export function memoryLine(d, today = localISO()) {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (d === today) return "Using the price you entered today.";
  const [y, m, day] = d.split("-").map(Number);
  const when = new Date(y, m - 1, day).toLocaleDateString("en-US",
    String(y) === today.slice(0, 4) ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return "Using your price from " + when + " — type today’s to update.";
}

// The saved {p, d} for a ticker, or null: missing, malformed, non-positive and storage-throwing
// reads all come back null, so the caller never branches on failure.
export function readSaved(ticker) {
  if (!ticker) return null;
  try {
    const v = JSON.parse(localStorage.getItem(key(ticker)) || "null");
    return v && typeof v.p === "number" && isFinite(v.p) && v.p > 0 &&
      typeof v.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.d) ? v : null;
  } catch (e) { return null; }
}

// One edit, one rule: a valid price > 0 is saved with today's date; a cleared input forgets
// the key; a half-typed fragment changes nothing (a stray keystroke must not erase the memory).
export function saveOnEdit(ticker, value) {
  if (!ticker) return;
  try {
    const p = parseFloat(value);
    if (p > 0) localStorage.setItem(key(ticker), JSON.stringify({ p, d: localISO() }));
    else if (String(value ?? "").trim() === "") localStorage.removeItem(key(ticker));
  } catch (e) {}
}

// Wire one mode's price input. Call after the ?px= prefill attempt and before the first
// update(): if the URL brought a price the memory only listens; otherwise the saved price
// fills the input (the caller's update() then runs on it) and the dated line shows.
export function wirePriceMemory(ticker, input, note) {
  if (!input) return;
  input.addEventListener("input", () => {
    if (note) note.hidden = true; // the reader has taken over; the dated claim no longer holds
    saveOnEdit(ticker, input.value);
  });
  if (input.value) return; // ?px= already filled it: the URL channel keeps precedence
  const saved = readSaved(ticker);
  if (!saved) return;
  input.value = String(saved.p);
  if (note) {
    const line = memoryLine(saved.d);
    if (line) { note.textContent = line; note.hidden = false; }
  }
}
