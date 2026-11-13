import { usesMiles } from "@/lib/cities";
import { spendLabels, type Currency } from "@/lib/currency";

// The 6 onboarding questions. Each option has a stable id (what we store and
// filter on) and a label (what the user sees), so copy can change safely.

export type Option = { id: string; label: string };

export type Question = {
  id: keyof Omit<Answers, "halal" | "spendCurrency" | "avoid">;
  title: string;
  why: string;
  options: Option[];
  multi?: boolean;
  max?: number;
  halal?: boolean;
};

export type Answers = {
  diet: string | null;
  halal: boolean;
  distance: string | null;
  spend: string | null;
  // Currency the spend level was chosen in, so it can be matched elsewhere.
  spendCurrency: Currency | null;
  who: string[];
  drinks: string | null;
  interests: string[];
  // Foods they skip though they eat meat ("beef", "pork"; testers, 13 Nov 2026).
  avoid: string[];
};

export const EMPTY_ANSWERS: Answers = {
  diet: null,
  halal: false,
  distance: null,
  spend: null,
  spendCurrency: null,
  who: [],
  drinks: null,
  interests: [],
  avoid: [],
};

export const AVOID_OPTIONS: Option[] = [
  { id: "beef", label: "No beef" },
  { id: "pork", label: "No pork" },
];

export const QUESTIONS: Question[] = [
  {
    id: "diet",
    title: "What do you eat?",
    why: "Why we ask: so we never send you somewhere you can’t eat.",
    options: [
      { id: "everything", label: "Everything" },
      { id: "vegetarian", label: "Vegetarian" },
      { id: "vegetarian_eggs", label: "Vegetarian + eggs" },
      { id: "jain", label: "Jain" },
      { id: "vegan", label: "Vegan" },
      { id: "pescatarian", label: "Pescatarian" },
    ],
    halal: true,
  },
  {
    id: "distance",
    title: "How far will you go?",
    why: "Why we ask: picks should be worth the trip. We ask where you are once, just before your picks.",
    options: [
      { id: "walk_2km", label: "Walking distance · 2 km" },
      { id: "ride_5km", label: "Short ride · 5 km" },
      { id: "city", label: "Anywhere in the city" },
    ],
  },
  {
    // Labels are filled in with the local currency; see optionsFor.
    id: "spend",
    title: "Spend per person?",
    why: "Why we ask: so a pick never feels like a stretch.",
    options: [
      { id: "level_1", label: "" },
      { id: "level_2", label: "" },
      { id: "level_3", label: "" },
      { id: "level_4", label: "" },
      { id: "level_5", label: "" },
      { id: "depends", label: "Depends on the day" },
    ],
  },
  {
    id: "who",
    title: "Who do you usually go out with?",
    why: "Why we ask: a date and a team dinner need different rooms.",
    options: [
      { id: "solo", label: "Solo" },
      { id: "partner", label: "Partner or date" },
      { id: "friends", label: "Friends" },
      { id: "family", label: "Family" },
      { id: "family_kids", label: "Family with kids" },
      { id: "work", label: "Work" },
    ],
    multi: true,
  },
  {
    id: "drinks",
    title: "Drinks?",
    why: "Why we ask: so bars show up only if you want them.",
    options: [
      { id: "love_bars", label: "Yes, I love a good bar" },
      { id: "sometimes", label: "Sometimes" },
      { id: "no_alcohol", label: "No alcohol" },
    ],
  },
  {
    id: "interests",
    title: "What are you into?",
    why: "Why we ask: this shapes the things to do Feta finds for you.",
    // The setup shows all of these (14 Nov 2026: karaoke and the rest added
    // after testers found their favourites missing).
    options: [
      { id: "karaoke", label: "Karaoke" },
      { id: "live_music", label: "Live music" },
      { id: "comedy", label: "Stand-up comedy" },
      { id: "rooftops", label: "Rooftops" },
      { id: "board_games", label: "Board games" },
      { id: "dancing", label: "Dancing" },
      { id: "art_culture", label: "Art and galleries" },
      { id: "games_sports", label: "Sports to play" },
      { id: "hidden_bars", label: "Hidden bars" },
      { id: "outdoors", label: "Outdoors" },
      { id: "workshops", label: "Workshops" },
      { id: "markets", label: "Markets" },
      { id: "nightlife", label: "Nightlife" },
    ],
    multi: true,
  },
];

// Distances in miles for the US and UK (the limits stay 2 and 5 km).
const MILES: Record<string, string> = { walk_2km: "Walking distance · about 1 mile", ride_5km: "Short ride · 3 miles" };

export function optionsFor(q: Question, currency: Currency, country?: string): Option[] {
  if (q.id === "distance" && usesMiles(country)) return q.options.map((o) => (MILES[o.id] ? { ...o, label: MILES[o.id] } : o));
  if (q.id !== "spend") return q.options;
  const labels = spendLabels(currency);
  return q.options.map((option, i) => (i < labels.length ? { ...option, label: labels[i] } : option));
}

// Kept on this phone until the database is connected.
const STORAGE_KEY = "feta.answers";

export function loadAnswers(): Answers {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...EMPTY_ANSWERS, ...JSON.parse(saved) } : EMPTY_ANSWERS;
  } catch {
    return EMPTY_ANSWERS;
  }
}

export function saveAnswers(answers: Answers) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
  } catch {
    // Private browsing can block storage; answers still work for this visit.
  }
}
