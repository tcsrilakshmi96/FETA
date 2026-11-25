// One pop-up at a time on Home (walk-through, 25 Nov 2026: "How was
// tonight?" and "Help shape Feta" opened on top of each other). A pop-up
// opens through this: it waits while another is on screen or has just been
// asked to open, then opens. Returns a cancel for when the screen goes.
let lastOpened = 0;
const busy = () => !!document.querySelector('[role="dialog"]') || Date.now() - lastOpened < 1500;

export function whenNoPopUp(open: () => void, every = 2000): () => void {
  let stopped = false;
  let t = 0;
  const tryIt = () => {
    if (stopped) return;
    if (busy()) {
      t = window.setTimeout(tryIt, every);
      return;
    }
    lastOpened = Date.now();
    open();
  };
  tryIt();
  return () => {
    stopped = true;
    clearTimeout(t);
  };
}
