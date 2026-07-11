// Offline regression for the price memory (lib/priceMemory.mjs): the reader's own typed
// price, remembered on their device and returned dated on the next visit.
//
// The rules under test, each a doctrine point (docs/price-doctrine.md):
// 1. Precedence — an explicit ?px= in the URL wins over the saved price (a shared link means
//    what it says); the memory fills the input only when the URL brought nothing.
// 2. The dated line — the honesty device: an older price names its day ("Using your price
//    from Jul 7 — type today's to update"), today's says so plainly, a prior year names its
//    year, and the line hides the moment the reader edits.
// 3. Save/forget — a valid price > 0 saves {p, d}; a cleared input forgets the key; a
//    half-typed fragment ("0", "-") changes nothing, so a stray keystroke never erases the
//    memory. No ticker, no key.
// 4. Silence on failure — a throwing localStorage (private mode) and malformed stored JSON
//    both no-op, exactly like setURL.
import { wirePriceMemory, memoryLine, localISO, readSaved, saveOnEdit } from "../src/lib/priceMemory.mjs";

let pass = 0, fail = 0;
const check = (name, cond) => { console.log((cond ? "ok   " : "FAIL ") + name); cond ? pass++ : fail++; };

// A browser in four lines: a Map-backed localStorage, an input that fires its listeners, a note.
const storage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
};
const setLS = (ls) => Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });
const mkInput = (value = "") => ({ value, handlers: [], addEventListener(t, f) { this.handlers.push(f); }, type(v) { this.value = v; this.handlers.forEach((f) => f()); } });
const mkNote = () => ({ hidden: true, textContent: "" });
const today = localISO();

// SAVE: a valid edit writes {p, d: today} under osc-px-<TICKER>.
{
  const ls = storage(); setLS(ls);
  const input = mkInput(), note = mkNote();
  wirePriceMemory("AAPL", input, note);
  input.type("211.40");
  const raw = ls.getItem("osc-px-AAPL");
  const v = raw && JSON.parse(raw);
  check("a valid edit saves {p, d} under osc-px-<TICKER>", v && v.p === 211.4 && v.d === today);
  check("the saved date is the local calendar day", /^\d{4}-\d{2}-\d{2}$/.test(v.d));
  // Clearing the input forgets the key.
  input.type("");
  check("clearing the input removes the key", ls.getItem("osc-px-AAPL") === null);
  // A non-positive or half-typed value neither saves nor erases.
  input.type("100"); input.type("0");
  check("a zero edit neither saves zero nor erases the memory", JSON.parse(ls.getItem("osc-px-AAPL")).p === 100);
  saveOnEdit("AAPL", "-");
  check("a stray fragment changes nothing", JSON.parse(ls.getItem("osc-px-AAPL")).p === 100);
}

// RESTORE: no ?px= (empty input) → the saved price fills the input and the line wears its date.
{
  const ls = storage(); setLS(ls);
  ls.setItem("osc-px-KO", JSON.stringify({ p: 62.5, d: "2026-07-07" }));
  const input = mkInput(), note = mkNote();
  wirePriceMemory("KO", input, note);
  check("the saved price fills an empty input", input.value === "62.5");
  check("the dated line shows and names the day", note.hidden === false && note.textContent === "Using your price from Jul 7 — type today’s to update.");
  // The line hides the moment the reader edits (and the edit re-saves under today's date).
  input.type("63.10");
  check("the line hides on the reader's first edit", note.hidden === true);
  check("the edit re-saves under today's date", JSON.parse(ls.getItem("osc-px-KO")).d === today);
}

// RESTORE, same day: the line says today plainly.
{
  const ls = storage(); setLS(ls);
  ls.setItem("osc-px-O", JSON.stringify({ p: 55, d: today }));
  const input = mkInput(), note = mkNote();
  wirePriceMemory("O", input, note);
  check("a same-day save reads as entered today", note.textContent === "Using the price you entered today.");
}

// PRECEDENCE: ?px= already filled the input → the memory only listens, never overwrites.
{
  const ls = storage(); setLS(ls);
  ls.setItem("osc-px-JPM", JSON.stringify({ p: 210, d: "2026-07-01" }));
  const input = mkInput("300"), note = mkNote(); // the ?px= prefill, as the script blocks apply it
  wirePriceMemory("JPM", input, note);
  check("?px= wins: the saved price never overwrites the URL's", input.value === "300");
  check("…and no dated line shows for the URL's price", note.hidden === true);
  check("…and the URL prefill alone saves nothing", JSON.parse(ls.getItem("osc-px-JPM")).p === 210);
  input.type("305"); // the reader takes over from the link's number
  check("a real edit after a ?px= prefill saves the new price", JSON.parse(ls.getItem("osc-px-JPM")).p === 305);
}

// NEITHER: no URL price, nothing saved → input stays empty, no line, and nothing was written.
{
  const ls = storage(); setLS(ls);
  const input = mkInput(), note = mkNote();
  wirePriceMemory("GME", input, note);
  check("with nothing saved the input stays empty and the line stays hidden", input.value === "" && note.hidden === true);
  check("…and nothing was written", ls.map.size === 0);
}

// SILENCE: a throwing localStorage (private mode) must no-op on save and restore alike.
{
  setLS({ getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } });
  const input = mkInput(), note = mkNote();
  let threw = false;
  try { wirePriceMemory("MET", input, note); input.type("80.25"); } catch (e) { threw = true; }
  check("private mode no-ops silently on restore and save", !threw && input.value === "80.25" && note.hidden === true);
}

// MALFORMED and non-positive stored values never restore.
{
  const ls = storage(); setLS(ls);
  ls.setItem("osc-px-F", "not json");
  ls.setItem("osc-px-BLK", JSON.stringify({ p: -5, d: "2026-07-01" }));
  ls.setItem("osc-px-TJX", JSON.stringify({ p: 100, d: "yesterday" }));
  check("malformed JSON reads as nothing saved", readSaved("F") === null);
  check("a non-positive saved price reads as nothing saved", readSaved("BLK") === null);
  check("a malformed saved date reads as nothing saved", readSaved("TJX") === null);
  const input = mkInput();
  let threw = false;
  try { wirePriceMemory("F", input, mkNote()); } catch (e) { threw = true; }
  check("…and wiring over it neither fills nor throws", !threw && input.value === "");
}

// NO TICKER: a page without one neither saves nor restores (no osc-px-undefined key).
{
  const ls = storage(); setLS(ls);
  const input = mkInput(), note = mkNote();
  wirePriceMemory(undefined, input, note);
  input.type("50");
  check("no ticker, no key", ls.map.size === 0);
}

// The dated line's copy, straight: prior-year saves name the year.
{
  check("a prior-year save names its year", memoryLine("2025-12-31", "2026-07-10") === "Using your price from Dec 31, 2025 — type today’s to update.");
  check("a same-year save names only the day", memoryLine("2026-07-07", "2026-07-10") === "Using your price from Jul 7 — type today’s to update.");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
