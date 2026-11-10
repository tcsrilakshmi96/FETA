import { optionsFor, QUESTIONS, type Answers } from "@/lib/onboarding";
import type { Currency } from "@/lib/currency";

// The 6 taste cards (founder's list, 10 Nov 2026). Photos are free Unsplash
// images saved in public/swipes: dosa by Paul (5oF7d_hPJG4), chole bhature
// (Idh9dnG2v8w), street cart (yOIHawAsRqA), café (photo-1521017432531),
// bar (photo-1514933651103), microphone (photo-1516280440614), potter's
// hands (w46tRF64qNc).

export type Verdict = "yes" | "no" | "unsure";

export type SwipeCard = {
  id: string;
  label: string;
  image: string;
  // The plain profile line a "Yes, me" adds.
  line: string;
};

const NIGHT_OUT: SwipeCard = {
  id: "night_out",
  label: "A buzzing bar on a Friday night",
  image: "/swipes/night.jpg",
  line: "Lively bars on a night out",
};

// Shown instead of the bar when the user chose "No alcohol".
const NIGHT_OUT_SOBER: SwipeCard = {
  id: "night_out_sober",
  label: "Live music or an open-mic night",
  image: "/swipes/night-sober.jpg",
  line: "Live music and open mics",
};

export function swipeCards(answers: Answers): SwipeCard[] {
  return [
    {
      id: "local_breakfast",
      label: "A classic breakfast: dosa, chutney, filter coffee",
      image: "/swipes/breakfast.jpg",
      line: "Classic breakfasts done well",
    },
    {
      id: "spicy_regional",
      label: "Fiery, spicy regional food",
      image: "/swipes/spicy.jpg",
      line: "Fiery, spicy food",
    },
    {
      id: "street_food",
      label: "Hole-in-the-wall street food",
      image: "/swipes/street.jpg",
      line: "Small, no-frills places with one great dish",
    },
    {
      id: "quiet_cafe",
      label: "A quiet café with good light",
      image: "/swipes/cafe.jpg",
      line: "Quiet cafés and slow mornings",
    },
    answers.drinks === "no_alcohol" ? NIGHT_OUT_SOBER : NIGHT_OUT,
    {
      id: "hands_on",
      label: "A hands-on class, like pottery",
      image: "/swipes/hands-on.jpg",
      line: "Hands-on classes and doing things",
    },
  ];
}

export type Swipe = { cardId: string; verdict: Verdict };

export type ProfileLine = {
  id: string;
  text: string;
  source: "answers" | "swipes";
};

const DISTANCE_LINES: Record<string, string> = {
  walk_2km: "Walking distance over long rides",
  ride_5km: "Happy to take a short ride",
  city: "Will go anywhere in the city for the right place",
};

function spendLine(answers: Answers, currency: Currency): ProfileLine | null {
  if (!answers.spend) return null;
  if (answers.spend === "depends") return { id: "spend", text: "Spend depends on the day", source: "answers" };
  const spend = QUESTIONS.find((q) => q.id === "spend")!;
  const label = optionsFor(spend, answers.spendCurrency ?? currency).find((o) => o.id === answers.spend)?.label;
  if (!label) return null;
  return { id: "spend", text: `Usually ${label.replace(/^Under/, "under")} a head`, source: "answers" };
}

// "Here's what I picked up": up to 4 plain lines, no labels or types.
// Two from "Yes, me" swipes first, then distance and spend, then any other yeses.
export function pickedUpLines(answers: Answers, swipes: Swipe[], currency: Currency): ProfileLine[] {
  const cards = swipeCards(answers);
  const yesLines: ProfileLine[] = swipes
    .filter((s) => s.verdict === "yes")
    .map((s) => cards.find((c) => c.id === s.cardId))
    .filter((c): c is SwipeCard => !!c)
    .map((c) => ({ id: c.id, text: c.line, source: "swipes" }));
  const distance: ProfileLine | null = answers.distance
    ? { id: "distance", text: DISTANCE_LINES[answers.distance], source: "answers" }
    : null;
  return [
    ...yesLines.slice(0, 2),
    distance,
    spendLine(answers, currency),
    ...yesLines.slice(2),
  ]
    .filter((line): line is ProfileLine => !!line)
    .slice(0, 4);
}

// Kept on this phone until the database is connected.
const SWIPES_KEY = "feta.swipes";
const PROFILE_KEY = "feta.profileLines";

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing can block storage; this visit still works.
  }
}

function load<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const saveSwipes = (swipes: Swipe[]) => save(SWIPES_KEY, swipes);
export const loadSwipes = () => load<Swipe[]>(SWIPES_KEY, []);
export const saveProfileLines = (lines: ProfileLine[]) => save(PROFILE_KEY, lines);
