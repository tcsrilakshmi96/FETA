import { optionsFor, QUESTIONS, type Answers } from "@/lib/onboarding";
import type { Currency } from "@/lib/currency";

// The 6 taste cards (founder's decision, 11 Nov 2026): 3 for food and
// drinks, 3 for experiences. First a cuisine grid (pick up to 4), then five
// "this or that" pairs, each with Both and Neither. The experience pairs ask
// how someone likes to spend time (move or make, play or unwind, a crowd or
// a circle); "What are you into?" already asks what. Each answer is a swipe
// row per side ("yes" chosen, "no" not chosen) or per cuisine, a plain
// profile line, and search words in lib/server/picks.ts.
//
// Photos are free Unsplash images in public/swipes (credits in
// public/swipes/CREDITS.md). South Asian food photos for South Asian
// cities, international ones elsewhere.

export type Verdict = "yes" | "no" | "unsure";

export type Side = {
  id: string;
  label: string;
  image: string;
};

export type PairCard = {
  type: "pair";
  id: string;
  a: Side;
  b: Side;
  // Plain profile lines for each answer ("neither" too: Feta won't push them).
  lines: { a: string; b: string; both: string; neither: string };
};

export type Cuisine = { id: string; label: string; image: string };

export type CuisineCard = { type: "cuisines"; id: "cuisines"; options: Cuisine[] };

export type SwipeCard = CuisineCard | PairCard;

export const MAX_CUISINES = 4;

const SOUTH_ASIA = ["IN", "LK", "NP", "BD", "PK", "BT", "MV"];

// Photos showing meat, fish or egg have a vegetarian version, shown to
// vegetarian, vegan and Jain users (testers: egg and fish photos broke trust).
const VEG_PHOTOS = ["bowl", "fine-dining", "indo-chinese", "japanese", "korean", "mexican", "middle-eastern", "thai", "world-street", "world-spicy"];
const VEG_DIETS = ["vegetarian", "vegetarian_eggs", "jain", "vegan"];
const photo = (name: string, veg: boolean) => `/swipes/${veg && VEG_PHOTOS.includes(name) ? `veg-${name}` : name}.jpg`;

export function cuisinesFor(country?: string, veg = false): Cuisine[] {
  const home = !country || SOUTH_ASIA.includes(country);
  const c = (id: string, label: string, image: string): Cuisine => ({ id, label, image: photo(image, veg) });
  const shared = [
    c("italian", "Italian", "italian"),
    c("japanese", "Japanese", "japanese"),
    c("korean", "Korean", "korean"),
    c("thai", "Thai & SE Asian", "thai"),
    c("middle_eastern", "Middle Eastern", "middle-eastern"),
    c("mexican", "Mexican", "mexican"),
    c("bakery", "Bakeries & desserts", "bakery"),
    c("healthy", "Bowls & salads", "bowl"),
  ];
  return home
    ? [
        c("south_indian", "South Indian", "breakfast"),
        c("north_indian", "North Indian", "spicy"),
        c("indo_chinese", "Indo-Chinese", "indo-chinese"),
        c("regional", "Regional Indian", "regional"),
        ...shared,
      ]
    : [c("local", "Local food", "local"), c("indian", "Indian", "spicy"), ...shared.slice(0, 5), c("indo_chinese", "Chinese", "indo-chinese"), ...shared.slice(5)];
}

export function swipeCards(answers: Answers, country?: string): SwipeCard[] {
  const home = !country || SOUTH_ASIA.includes(country);
  const sober = answers.drinks === "no_alcohol";
  const veg = VEG_DIETS.includes(answers.diet ?? "");
  return [
    { type: "cuisines", id: "cuisines", options: cuisinesFor(country, veg) },
    {
      // How adventurous with food (research, 13 Nov 2026: the trait with the
      // strongest evidence for where people enjoy eating). It only nudges the
      // ranking and how strictly "new to you" applies; it never filters.
      type: "pair",
      id: "novelty",
      a: { id: "familiar", label: "Your usual, done really well", image: photo(home ? "breakfast" : "italian", veg) },
      b: { id: "new_to_me", label: "Something you've never tried", image: photo("korean", veg) },
      lines: {
        a: "Likes their favourites, done really well",
        b: "Loves trying something new",
        both: "Likes a mix of old favourites and new finds",
        neither: "No strong pull to the familiar or the new",
      },
    },
    {
      type: "pair",
      id: "style",
      a: { id: "hole_in_wall", label: "A hole-in-the-wall with one great dish", image: home ? "/swipes/street.jpg" : photo("world-street", veg) },
      b: { id: "dressed_up", label: "A dressed-up dinner for an occasion", image: photo("fine-dining", veg) },
      lines: {
        a: "Would pick a hole-in-the-wall over a fancy dinner",
        b: "Likes a dressed-up dinner for an occasion",
        both: "Happy with a hole-in-the-wall or a dressed-up dinner",
        neither: "Not after hole-in-the-walls or fancy dinners",
      },
    },
    {
      type: "pair",
      id: "vibe",
      a: { id: "quiet_cafe", label: "A quiet café where you can talk", image: "/swipes/cafe.jpg" },
      b: sober
        ? { id: "buzzing_sober", label: "A lively café with live music", image: "/swipes/night-sober.jpg" }
        : { id: "buzzing", label: "A buzzing bar with music", image: "/swipes/night.jpg" },
      lines: {
        a: "Prefers quiet places where you can talk",
        b: sober ? "Likes lively places with music" : "Likes a buzzing bar with music",
        both: "Quiet or lively, depending on the day",
        neither: "Not big on cafés or loud bars",
      },
    },
    {
      // Energy (research, 13 Nov 2026: replaces dance vs make and badminton
      // vs book club, so a new card fits in 6).
      type: "pair",
      id: "energy",
      a: { id: "get_moving", label: "Get moving: a dance class, badminton, a hike", image: "/swipes/dance.jpg" },
      b: { id: "slow_down", label: "Slow down: pottery, a book club, a gallery", image: "/swipes/hands-on.jpg" },
      lines: {
        a: "Likes active plans: dancing, sport, getting outdoors",
        b: "Likes slow, hands-on plans: pottery, books, galleries",
        both: "Likes active plans and slow, hands-on ones",
        neither: "Not into classes, sport or workshops",
      },
    },
    {
      type: "pair",
      id: "crowd_circle",
      a: { id: "crowd", label: "In the crowd: a gig, a show, a big match", image: "/swipes/crowd.jpg" },
      b: { id: "circle", label: "In the circle: a run club, a trivia night, a meetup", image: "/swipes/run-club.jpg" },
      lines: {
        a: "Loves being in the crowd at gigs, shows and matches",
        b: "Would pick a run club or trivia night over a big gig",
        both: "Enjoys big shows and small community events",
        neither: "Not after big shows or community meetups",
      },
    },
  ];
}

// Sides from cards that were replaced, for people who swiped before (their
// lines and search words still count).
const LEGACY_SIDES: Side[] = [
  { id: "dance", label: "Move: a dance class or salsa night", image: "/swipes/dance.jpg" },
  { id: "make", label: "Make: pottery, painting, a workshop", image: "/swipes/hands-on.jpg" },
  { id: "play", label: "Play: a game of badminton or pickleball", image: "/swipes/badminton.jpg" },
  { id: "unwind", label: "Unwind: a book club or a reading café", image: "/swipes/reading.jpg" },
];

// A side chosen, by id, with its pair (for reasons and search words).
export function sideById(id: string, answers: Answers): Side | Cuisine | null {
  const legacy = LEGACY_SIDES.find((side) => side.id === id);
  if (legacy) return legacy;
  for (const card of swipeCards(answers)) {
    if (card.type === "cuisines") {
      // Either list: the home one, or the one used abroad.
      const c = [...card.options, ...cuisinesFor("abroad")].find((o) => `cuisine_${o.id}` === id);
      if (c) return c;
    } else if (card.a.id === id) return card.a;
    else if (card.b.id === id) return card.b;
  }
  return null;
}

// Swipe rows for one pair answer.
export function pairSwipes(card: PairCard, choice: "a" | "b" | "both" | "neither"): Swipe[] {
  return [
    { cardId: card.a.id, verdict: choice === "a" || choice === "both" ? "yes" : "no" },
    { cardId: card.b.id, verdict: choice === "b" || choice === "both" ? "yes" : "no" },
  ];
}

function pairChoice(card: PairCard, swipes: Swipe[]): "a" | "b" | "both" | "neither" | null {
  const a = swipes.find((s) => s.cardId === card.a.id)?.verdict;
  const b = swipes.find((s) => s.cardId === card.b.id)?.verdict;
  if (!a || !b) return null;
  return a === "yes" && b === "yes" ? "both" : a === "yes" ? "a" : b === "yes" ? "b" : "neither";
}

// Photos of what they chose, for "Here's what I picked up".
export function chosenImages(answers: Answers, swipes: Swipe[], country?: string): string[] {
  const yes = new Set(swipes.filter((s) => s.verdict === "yes").map((s) => s.cardId));
  const images: string[] = [];
  for (const card of swipeCards(answers, country)) {
    if (card.type === "cuisines") card.options.forEach((o) => yes.has(`cuisine_${o.id}`) && images.push(o.image));
    else [card.a, card.b].forEach((side) => yes.has(side.id) && images.push(side.image));
  }
  return images;
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
export function pickedUpLines(answers: Answers, swipes: Swipe[], currency: Currency, country?: string): ProfileLine[] {
  const yesLines: ProfileLine[] = [];
  for (const card of swipeCards(answers, country)) {
    if (card.type === "cuisines") {
      const chosen = card.options.filter((o) => swipes.some((s) => s.cardId === `cuisine_${o.id}` && s.verdict === "yes"));
      if (chosen.length) yesLines.push({ id: "cuisines", text: `Favourite food: ${chosen.map((o) => o.label).join(", ")}`, source: "swipes" });
      continue;
    }
    const choice = pairChoice(card, swipes);
    if (choice) yesLines.push({ id: card.id, text: card.lines[choice], source: "swipes" });
  }
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
