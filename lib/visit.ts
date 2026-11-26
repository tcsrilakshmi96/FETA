// What one visit is (founder, 26 Nov 2026): from opening Feta until it's
// closed or left for 30 minutes (an installed iPhone app can stay open for
// days). Everything that happens once a visit (one pop-up, what counts as
// "New", the visit count) keeps its mark in this tab's storage under
// "feta.visit."; coming back after 30 minutes away clears those marks and
// reloads at a calm moment (`FreshVersion`), so the new visit starts fresh.
// When it was hidden is kept in this tab's storage too, so a page the
// browser threw away in the background and reloads itself counts as well
// (tech audit, 26 Nov 2026).
export const VISIT = "feta.visit.";
export const AWAY = 30 * 60 * 1000;
const HIDDEN = "feta.hiddenAt";
// Marks from before 26 Nov 2026, cleared with the rest.
const OLD = ["feta.popupShown", "feta.seenBefore", "feta.visits", "feta.formOpened.later"];

export function endVisit() {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(VISIT) || k === HIDDEN || OLD.includes(k))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // Nothing kept.
  }
}

export function markHidden() {
  try {
    sessionStorage.setItem(HIDDEN, String(new Date().getTime()));
  } catch {
    // Then this return isn't noticed; that's all.
  }
}

// Back after 30 minutes away: this visit is over. Read by anything that
// would start work on coming back (the picks store), so nothing is spent on
// a page that's about to reload. A short hide just forgets the time.
export function awayLongEnough(): boolean {
  try {
    const t = Number(sessionStorage.getItem(HIDDEN));
    if (!t) return false;
    if (new Date().getTime() - t >= AWAY) return true;
    if (document.visibilityState === "visible") sessionStorage.removeItem(HIDDEN);
    return false;
  } catch {
    return false;
  }
}

// A fresh page (opened, or reloaded by the browser itself) after 30 minutes
// away starts a new visit before anything reads its marks.
if (typeof window !== "undefined" && awayLongEnough()) endVisit();
