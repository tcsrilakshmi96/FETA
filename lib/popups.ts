import { VISIT } from "@/lib/visit";

// At most one pop-up a visit (founder, 26 Nov 2026, from the return-visit
// walk-through: visit 3 opened with "How was tonight?" and then "Help shape
// Feta"; the first minute was answering questions). Every pop-up that opens
// on its own takes a slot when its screen opens (`popUpSlot(rank)`), before
// its own checks, then says `ready(open)` or `none()`. Once every slot has
// answered (or 6 s have passed) the most important ready one opens, never
// over another sheet; the rest wait for the next visit (each keeps its own
// "already asked" mark, so it asks again then). What a visit is: lib/visit.ts.
// Ranks: 0 How was <day>? · 1 How was <place>? · 2 Save your taste ·
// 3 Help shape Feta · 4 How's Feta so far?
const SHOWN = `${VISIT}popupShown`;
const MAX_WAIT = 6000;

// open says whether it really opened (a lookup may fail, or they left the
// screen); if not, the visit's pop-up isn't used up. notBefore: ready, but
// waiting its moment (Save your taste lets people see their picks first).
type Opener = () => boolean | void | Promise<boolean | void>;
type Slot = {
  rank: number;
  state: "pending" | "ready" | "none";
  open?: Opener;
  notBefore?: number;
};
let slots: Slot[] = [];
let timer = 0;
let firstAt = 0;
let opening = false; // a pop-up is on its way (its lookup still running)

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
  if (opening) return; // decided again once it says whether it opened
  if (shownThisVisit()) {
    slots = [];
    return;
  }
  const now = Date.now();
  const due = (s: Slot) => s.state === "ready" && (s.notBefore ?? 0) <= now;
  const best = slots
    .filter(due)
    .reduce<Slot | null>((a, b) => (!a || b.rank < a.rank ? b : a), null);
  // Someone more important is still finding out whether it has something to
  // ask (for up to 6 s), or is ready and waiting its moment (always waited for).
  const betterWaiting = slots.some(
    (s) =>
      (!best || s.rank < best.rank) &&
      ((s.state === "pending" && now - firstAt < MAX_WAIT) ||
        (s.state === "ready" && !due(s))),
  );
  if (!best || betterWaiting || document.querySelector('[role="dialog"]')) {
    if (slots.some((s) => s.state !== "none"))
      timer = window.setTimeout(decide, best && !betterWaiting ? 2000 : 500);
    return;
  }
  try {
    sessionStorage.setItem(SHOWN, "1");
  } catch {
    // Then the next one may ask; that's all.
  }
  slots = slots.filter((s) => s !== best);
  opening = true;
  Promise.resolve()
    .then(best.open!)
    .catch(() => false)
    .then((opened) => {
      opening = false;
      if (opened !== false) {
        slots = [];
        return;
      }
      // Nothing opened after all: the visit's pop-up is still free.
      try {
        sessionStorage.removeItem(SHOWN);
      } catch {
        // Fine.
      }
      if (slots.length) decide();
    });
}

export function popUpSlot(rank: number) {
  const slot: Slot = { rank, state: "pending" };
  if (!shownThisVisit()) {
    if (!slots.length) firstAt = Date.now();
    slots.push(slot);
  }
  return {
    ready(open: Opener, notBefore?: number) {
      if (slot.state !== "pending") return;
      slot.state = "ready";
      slot.open = open;
      slot.notBefore = notBefore;
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
