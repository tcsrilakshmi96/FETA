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

// Plain words for the answers, for profile lines.
function listOf(words: string[]) {
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function labelsFor(questionId: string, ids: string[]) {
  const q = QUESTIONS.find((x) => x.id === questionId);
  return ids.map((id) => q?.options.find((o) => o.id === id)?.label.toLowerCase()).filter(Boolean) as string[];
}

const DRINK_LINES: Record<string, string> = {
  love_bars: "Enjoys a good bar",
  sometimes: "Drinks now and then",
  no_alcohol: "Doesn't drink alcohol",
};

const DIET_LINES: Record<string, string> = {
  vegetarian: "Eats vegetarian",
  vegetarian_eggs: "Eats vegetarian, and eggs",
  jain: "Eats Jain food",
  vegan: "Eats vegan",
  pescatarian: "Eats fish but not meat",
};

// Everything Feta picked up from the answers and swipes, as plain lines
// (no labels or types). "Here's what I picked up" shows the first few;
// all of them are saved to the profile, where they can be removed.
export function pickedUpLines(answers: Answers, swipes: Swipe[], currency: Currency): ProfileLine[] {
  const cards = swipeCards(answers);
  const yesLines: ProfileLine[] = swipes
    .filter((s) => s.verdict === "yes")
    .map((s) => cards.find((c) => c.id === s.cardId))
    .filter((c): c is SwipeCard => !!c)
    .map((c) => ({ id: c.id, text: c.line, source: "swipes" }));
  const who = labelsFor("who", answers.who);
  const into = labelsFor("interests", answers.interests);
  const line = (id: string, text: string | undefined | null): ProfileLine | null =>
    text ? { id, text, source: "answers" } : null;
  return [
    ...yesLines.slice(0, 2),
    line("distance", answers.distance ? DISTANCE_LINES[answers.distance] : null),
    spendLine(answers, currency),
    line("who", who.length ? `Usually out ${who.includes("solo") && who.length === 1 ? "solo" : `with ${listOf(who.filter((w) => w !== "solo").map((w) => w.replace("partner or date", "a partner or date").replace(/^work$/, "colleagues")))}`}` : null),
    line("interests", into.length ? `Into ${listOf(into)}` : null),
    ...yesLines.slice(2),
    line("drinks", answers.drinks ? DRINK_LINES[answers.drinks] : null),
    line("diet", answers.diet && answers.diet !== "everything" ? `${DIET_LINES[answers.diet]}${answers.halal ? ", halal only" : ""}` : answers.halal ? "Halal only" : null),
  ].filter((l): l is ProfileLine => !!l);
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
