// At most one pop-up a visit (founder, 26 Nov 2026, from the return-visit
// walk-through: visit 3 opened with "How was tonight?" and then "Help shape
// Feta"; the first minute was answering questions). Every pop-up that opens
// on its own asks here with its rank; within a short moment the most
// important one opens, never over another sheet, and the rest wait for the
// next visit (each keeps its own "already asked" mark, so it asks again
// then). A visit is one tab session, as the testers' form counts them.
// Ranks: 0 How was <day>? · 1 How was <place>? · 2 Save your taste ·
// 3 Help shape Feta · 4 How's Feta so far?
const SHOWN = "feta.popupShown";
const SETTLE = 1500;

type Ask = { rank: number; open: () => void };
let waiting: Ask[] = [];
let timer = 0;

function shownThisVisit() {
  try {
    return !!sessionStorage.getItem(SHOWN);
  } catch {
    return false;
  }
}

function decide() {
  timer = 0;
  if (!waiting.length) return;
  if (document.querySelector('[role="dialog"]')) {
    timer = window.setTimeout(decide, 2000);
    return;
  }
  const best = waiting.reduce((a, b) => (b.rank < a.rank ? b : a));
  waiting = [];
  try {
    sessionStorage.setItem(SHOWN, "1");
  } catch {
    // Then the next one may ask; that's all.
  }
  best.open();
}

export function askToOpen(rank: number, open: () => void): () => void {
  if (shownThisVisit()) return () => {};
  const ask = { rank, open };
  waiting.push(ask);
  if (!timer) timer = window.setTimeout(decide, SETTLE);
  return () => {
    waiting = waiting.filter((x) => x !== ask);
  };
}
