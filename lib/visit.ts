// What one visit is (founder, 26 Nov 2026): from opening Feta until it's
// closed or left for 30 minutes (an installed iPhone app can stay open for
// days). Everything that happens once a visit (one pop-up, what counts as
// "New", the visit count) keeps its mark in this tab's storage under
// "feta.visit."; coming back after 30 minutes away clears those marks and
// reloads at a calm moment (`FreshVersion`), so the new visit starts fresh.
export const VISIT = "feta.visit.";
export const AWAY = 30 * 60 * 1000;

export function endVisit() {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(VISIT))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // Nothing kept.
  }
}
