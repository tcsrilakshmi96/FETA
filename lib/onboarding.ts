import { usesMiles } from "@/lib/cities";
import { spendBounds, spendLabels, formatMoney, type Currency } from "@/lib/currency";

// The 6 onboarding questions. Each option has a stable id (what we store and
// filter on) and a label (what the user sees), so copy can change safely.

// parent: a more specific choice inside a broad one ("Pottery" inside
// "Classes and workshops"), shown once the broad one is chosen.
export type Option = { id: string; label: string; parent?: string };

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
  // The levels they ticked ("level_2", "level_3"): a range, or "depends".
  spend: string[];
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
  spend: [],
  spendCurrency: null,
  who: [],
  drinks: null,
  interests: [],
  avoid: [],
};

// Diets that need vegetarian food (one list for the screens and the search).
export const VEG_DIETS = ["vegetarian", "vegetarian_eggs", "jain", "vegan"];

export function isVegDiet(diet: string | null | undefined) {
  return VEG_DIETS.includes(diet ?? "");
}

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
    why: "Why we ask: so a pick never feels like a stretch. Tick all that are fine.",
    options: [
      { id: "level_1", label: "" },
      { id: "level_2", label: "" },
      { id: "level_3", label: "" },
      { id: "level_4", label: "" },
      { id: "level_5", label: "" },
      { id: "depends", label: "Depends on the day" },
    ],
    multi: true,
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
      { id: "markets", label: "Markets" },
      { id: "popups", label: "Pop-ups" },
      { id: "nightlife", label: "Nightlife" },
      // Try something new (founder, 21 Nov 2026: "never pottery, horse riding
      // or cooking class"): broad groups true in every city, each with
      // optional specifics. None chosen means any kind; a specific one is
      // searched for itself. ("workshops" and "outdoors" keep their ids so
      // earlier answers stay chosen.)
      { id: "workshops", label: "Classes and workshops" },
      { id: "class_pottery", label: "Pottery", parent: "workshops" },
      { id: "class_cooking", label: "Cooking class", parent: "workshops" },
      { id: "class_painting", label: "Painting", parent: "workshops" },
      { id: "class_dance", label: "Dance class", parent: "workshops" },
      { id: "class_candle", label: "Candle and perfume making", parent: "workshops" },
      { id: "tastings", label: "Tastings" },
      { id: "taste_wine", label: "Wine tasting", parent: "tastings" },
      { id: "taste_coffee", label: "Coffee tasting", parent: "tastings" },
      { id: "taste_chocolate", label: "Chocolate tasting", parent: "tastings" },
      { id: "taste_tea", label: "Tea tasting", parent: "tastings" },
      { id: "outdoors", label: "Hikes and trails" },
      { id: "hike_easy", label: "Easy walks", parent: "outdoors" },
      { id: "hike_day", label: "Day hikes", parent: "outdoors" },
      { id: "hike_sunrise", label: "Sunrise treks", parent: "outdoors" },
      { id: "adventures", label: "Outdoor adventures" },
      { id: "adv_riding", label: "Horse riding", parent: "adventures" },
      { id: "adv_surfing", label: "Surfing", parent: "adventures" },
      { id: "adv_kayaking", label: "Kayaking", parent: "adventures" },
      { id: "adv_climbing", label: "Climbing", parent: "adventures" },
      { id: "adv_cycling", label: "Cycling tours", parent: "adventures" },
      { id: "wellness", label: "Wellness" },
      { id: "well_yoga", label: "Yoga", parent: "wellness" },
      { id: "well_sound", label: "Sound baths", parent: "wellness" },
      { id: "well_spa", label: "Spa days", parent: "wellness" },
    ],
    multi: true,
  },
];

// Choosing or dropping a thing to do: a specific one also chooses its
// group; dropping a group drops its specifics.
export function toggleInterest(chosen: string[], id: string): string[] {
  const options = QUESTIONS.find((q) => q.id === "interests")!.options;
  if (chosen.includes(id)) return chosen.filter((x) => x !== id && options.find((o) => o.id === x)?.parent !== id);
  const parent = options.find((o) => o.id === id)?.parent;
  return [...new Set([...chosen, ...(parent ? [parent] : []), id])];
}

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
    return saved ? withSpendRange({ ...EMPTY_ANSWERS, ...JSON.parse(saved) }) : EMPTY_ANSWERS;
  } catch {
    return EMPTY_ANSWERS;
  }
}

// Spend per person is a range of the levels they ticked (founder, 17 Nov
// 2026): the top is the most they'll spend, the bottom the least. "Depends
// on the day", or nothing ticked, means no limit. An answer saved before
// was one level meaning "up to this much", so it becomes every level up to it.
export function withSpendRange<T extends { spend: unknown }>(a: T): T & { spend: string[] } {
  const old = typeof a.spend === "string" ? /^level_(\d)$/.exec(a.spend) : null;
  const spend = Array.isArray(a.spend) ? (a.spend as string[]) : old ? Array.from({ length: Number(old[1]) }, (_, i) => `level_${i + 1}`) : typeof a.spend === "string" ? [a.spend] : [];
  return { ...a, spend };
}

export function spendRange(a: Pick<Answers, "spend">): { low: number; high: number } | null {
  const levels = a.spend.map((s) => /^level_(\d)$/.exec(s)?.[1]).filter((n): n is string => !!n).map(Number);
  if (levels.length === 0 || a.spend.includes("depends")) return null;
  return { low: Math.min(...levels), high: Math.max(...levels) };
}

// Ticking a level adds it to the range; "Depends on the day" stands alone.
export function toggleSpend(spend: string[], id: string): string[] {
  if (id === "depends") return spend.includes("depends") ? [] : ["depends"];
  const levels = spend.filter((s) => s !== "depends");
  return levels.includes(id) ? levels.filter((s) => s !== id) : [...levels, id].sort();
}

// "₹500–3,000", "Under ₹1,500", "₹3,000+", or "Depends on the day".
export function spendText(a: Pick<Answers, "spend">, currency: Currency): string | null {
  if (a.spend.includes("depends")) return "Depends on the day";
  const r = spendRange(a);
  if (!r) return null;
  if (r.low === r.high) return spendLabels(currency)[r.low - 1];
  const b = spendBounds(currency);
  const from = r.low > 1 ? b[r.low - 2] : null;
  const to = r.high < 5 ? b[r.high - 1] : null;
  if (from === null && to === null) return "Any price";
  if (from === null) return `Under ${formatMoney(to!, currency)}`;
  if (to === null) return `${formatMoney(from, currency)}+`;
  return `${formatMoney(from, currency)}–${formatMoney(to, currency).replace(/^\D+/, "")}`;
}

export function saveAnswers(answers: Answers) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
  } catch {
    // Private browsing can block storage; answers still work for this visit.
  }
}
