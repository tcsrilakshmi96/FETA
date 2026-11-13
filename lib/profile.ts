"use client";

// What someone wants from Feta, and their first name (optional, asked before
// sign-in so testers' feedback has a name). Kept on this phone and in their
// account (lib/db.ts). Home leads with what they chose; a category they
// didn't choose asks its own questions the first time it's opened.

export type Want = "food" | "do" | "style" | "trip";

export const WANTS: { id: Want; label: string; sub: string; image: string | null }[] = [
  { id: "food", label: "Places to eat and drink", sub: "Tonight, this weekend", image: "/swipes/italian.jpg" },
  { id: "do", label: "Things to do", sub: "Gigs, classes, comedy", image: "/swipes/crowd.jpg" },
  { id: "style", label: "What to wear", sub: "Looks for your plans", image: null },
  { id: "trip", label: "Plan a trip", sub: "Any city, day by day", image: "/swipes/local.jpg" },
];

const WANTS_KEY = "feta.wants";
const NAME_KEY = "feta.name";

export function loadWants(): Want[] {
  try {
    const saved = localStorage.getItem(WANTS_KEY);
    return saved ? (JSON.parse(saved) as Want[]) : ["food", "do"];
  } catch {
    return ["food", "do"];
  }
}

export function saveWants(wants: Want[]) {
  try {
    localStorage.setItem(WANTS_KEY, JSON.stringify(wants));
  } catch {
    // This visit still works without storage.
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string) {
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
    else localStorage.removeItem(NAME_KEY);
  } catch {
    // Optional anyway.
  }
}
