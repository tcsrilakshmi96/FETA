// At most one pop-up a visit (founder, 26 Nov 2026, from the return-visit
// walk-through: visit 3 opened with "How was tonight?" and then "Help shape
// Feta"; the first minute was answering questions). Every pop-up that opens
// on its own takes a slot when its screen opens (`popUpSlot(rank)`), before
// its own checks, then says `ready(open)` or `none()`. Once every slot has
// answered (or 6 s have passed) the most important ready one opens, never
// over another sheet; the rest wait for the next visit (each keeps its own
// "already asked" mark, so it asks again then). A visit is one tab session.
// Ranks: 0 How was <day>? · 1 How was <place>? · 2 Save your taste ·
// 3 Help shape Feta · 4 How's Feta so far?
const SHOWN = "feta.popupShown";
const MAX_WAIT = 6000;

type Slot = { rank: number; state: "pending" | "ready" | "none"; open?: () => void };
let slots: Slot[] = [];
let timer = 0;
let firstAt = 0;

export function shownThisVisit() {
  try {
    return !!sessionStorage.getItem(SHOWN);
  } catch {
    return false;
  }
}

function decide() {
  window.clearTimeout(timer);
  timer = 0;
  if (shownThisVisit()) {
    slots = [];
    return;
  }
  const ready = slots.filter((s) => s.state === "ready");
  const waiting = slots.some((s) => s.state === "pending");
  // Someone more important is still finding out whether it has something to ask.
  const best = ready.reduce<Slot | null>((a, b) => (!a || b.rank < a.rank ? b : a), null);
  const betterPending = slots.some((s) => s.state === "pending" && (!best || s.rank < best.rank));
  if (!best || (betterPending && Date.now() - firstAt < MAX_WAIT) || document.querySelector('[role="dialog"]')) {
    if (best || waiting) timer = window.setTimeout(decide, best && !betterPending ? 2000 : 500);
    return;
  }
  try {
    sessionStorage.setItem(SHOWN, "1");
  } catch {
    // Then the next one may ask; that's all.
  }
  slots = [];
  best.open!();
}

export function popUpSlot(rank: number) {
  const slot: Slot = { rank, state: "pending" };
  if (!shownThisVisit()) {
    if (!slots.length) firstAt = Date.now();
    slots.push(slot);
  }
  return {
    ready(open: () => void) {
      if (slot.state !== "pending") return;
      slot.state = "ready";
      slot.open = open;
      decide();
    },
    none() {
      if (slot.state === "pending") slot.state = "none";
      slots = slots.filter((s) => s !== slot || s.state === "ready");
      if (slots.length) decide();
    },
    // The screen went: this one no longer asks.
    cancel() {
      slots = slots.filter((s) => s !== slot);
      if (slots.length) decide();
    },
  };
}
