// Which picks this phone has shown before, so a return visit can mark what's
// new (founder, 26 Nov 2026, return-visit walk-through: "Home looks the same
// as last time"). Place IDs only, on this phone, for 14 days. What counts as
// seen is fixed at the start of each visit (lib/visit.ts), so a place stays
// "New" for the whole visit it first appears in. The first visit marks nothing.
import { VISIT } from "@/lib/visit";

const SEEN = "feta.seenPicks";
const BEFORE = `${VISIT}seenBefore`;
const KEEP = 14 * 86400 * 1000;

let before: Set<string> | null = null;

function readSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function seenBefore(): Set<string> {
  if (before) return before;
  try {
    const kept = sessionStorage.getItem(BEFORE);
    if (kept) before = new Set(JSON.parse(kept) as string[]);
    else {
      before = new Set(Object.keys(readSeen()));
      sessionStorage.setItem(BEFORE, JSON.stringify([...before]));
    }
  } catch {
    before = new Set();
  }
  return before;
}

export function isNew(placeId: string): boolean {
  if (typeof window === "undefined") return false;
  const b = seenBefore();
  return b.size > 0 && !b.has(placeId);
}

export function markSeen(placeIds: string[]) {
  if (typeof window === "undefined" || !placeIds.length) return;
  seenBefore();
  const now = new Date().getTime();
  const seen = readSeen();
  for (const id of placeIds) seen[id] ??= now;
  const kept = Object.entries(seen)
    .filter(([, t]) => now - t < KEEP)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 600);
  try {
    localStorage.setItem(SEEN, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Not kept; nothing is marked new next time.
  }
}
