import "server-only";

import { distanceKm, formatDistance, type City } from "@/lib/cities";
import { spendBounds } from "@/lib/currency";
import { optionsFor, QUESTIONS, type Answers } from "@/lib/onboarding";
import { track } from "@/lib/server/costs";
import { FAKE } from "@/lib/server/fake-places";
import { photoRef } from "@/lib/server/photo-ref";
import { bestPhoto, type Place } from "@/lib/server/places";
import { sideById } from "@/lib/swipes";

export type Category = "food_drinks" | "experiences";
export type When = "tonight" | "weekend";
export type Kind = "EAT" | "DRINK" | "DO" | "EVENT";
export type Verdict = "Worth a detour" | "Good if you're nearby" | "Skip unless";

// What Feta knows about the user, read from the database.
export type Taste = {
  answers: Answers;
  lines: string[]; // profile lines still in use (never trip-only ones)
  yes: string[]; // swipe card ids the user said "Yes, me" to
  no: string[];
  openLate?: boolean; // the "Open later" tweak
  saved?: string[]; // Feta's reasons for places they saved lately
  skipped?: string[]; // why they skipped places lately ("Too pricey")
  // Places they've been and rated (My places, check-in): counts, and their
  // own words about ones they loved or didn't.
  places?: { loved: number; regulars: number; notForThem: number; lovedNotes: string[]; dislikedNotes: string[] };
  // Places they love (place IDs, newest first), and, for the picks only, what
  // those places are like, read live from Google for this search (never
  // stored, never sent to Venice).
  lovedIds?: string[];
  lovedPlaces?: string[];
  lovedTypes?: string[];
};

// ---------- Tweaks ----------

export const TWEAKS = ["quieter", "cheaper", "fancier", "closer", "outdoors", "open_later", "groups", "kids"] as const;
export type Tweak = (typeof TWEAKS)[number];

export const TWEAK_LABELS: Record<Tweak, string> = {
  quieter: "Somewhere quieter",
  cheaper: "Cheaper",
  fancier: "Fancier: dressier, more polished places",
  closer: "Closer",
  outdoors: "Outdoors",
  open_later: "Open later",
  groups: "Better for groups",
  kids: "Good with kids",
};

// Cheaper, Fancier (testers, 13 Nov 2026: "show fancier places"), Closer and
// Open later change the hard filters for this search;
// the rest steer the search words and Gemini's choice.
export function applyTweaks(taste: Taste, tweaks: Tweak[]): Taste {
  const answers = { ...taste.answers };
  if (tweaks.includes("cheaper")) {
    const level = /^level_(\d)$/.exec(answers.spend ?? "");
    answers.spend = level ? `level_${Math.max(1, Number(level[1]) - 1)}` : "level_2";
  }
  if (tweaks.includes("fancier")) {
    const level = /^level_(\d)$/.exec(answers.spend ?? "");
    answers.spend = level ? `level_${Math.min(5, Number(level[1]) + 1)}` : "level_4";
  }
  if (tweaks.includes("closer")) {
    answers.distance = answers.distance === "city" ? "ride_5km" : answers.distance === "ride_5km" ? "walk_2km" : "closer_1km";
  }
  return { ...taste, answers, openLate: tweaks.includes("open_later") };
}

const TWEAK_PHRASES: Partial<Record<Tweak, string>> = {
  quieter: "quiet cafe",
  fancier: "upscale restaurant",
  outdoors: "outdoor seating restaurant",
  groups: "restaurant good for groups",
  kids: "family friendly restaurant",
};

// An event found on the web. Its details come from the event's own listing
// (not Google Maps), so they can be kept with the set.
export type EventInfo = {
  title: string;
  venueName: string;
  date: string;
  time: string;
  priceText: string;
  url: string;
  site: string;
  searchHtml: string; // Google's Search Suggestions chip, shown unaltered
  venuePlaceId?: string;
  distanceKm?: number;
};

// Saved per set: place IDs and Feta's own words only (plus event listings).
// For an event, placeId is "event:<its page address>".
export type StoredPick = {
  placeId: string;
  kind: Kind;
  verdict: Verdict;
  skipUnless?: string;
  because: string;
  event?: EventInfo;
  fetaNote?: string; // the founder's own words, for a Feta pick
  spare?: boolean; // backup for "Show me more", not shown at first
};

// Picks shown at first per category; the rest of the ranked places are
// kept as backup for "Show me more" (founder's decision, 12 Nov 2026).
export const SHOW = 8;
// Very popular places allowed among the 8 shown ("New to you" rule).
const MAX_POPULAR = 2;
// Places of one cuisine allowed among the 8 shown, so favourites are mixed.
const MAX_SAME_CUISINE = 2;

// A specific cuisine from Google's main type ("indian_restaurant"), not a
// general one ("restaurant", "cafe", "bar").
function cuisineOf(c: Candidate) {
  const t = c.place.primaryType ?? "";
  if (!/_restaurant$/.test(t) || /^(fine_dining|fast_food|family|casual|breakfast|brunch|buffet)/.test(t)) return null;
  // Pizza counts as Italian, sushi and ramen as Japanese, and so on, so the
  // cap can't be dodged by a sub-type (testers: 7 of 8 were Italian).
  for (const [group, re] of CUISINE_GROUPS) if (re.test(t)) return group;
  return t;
}

const CUISINE_GROUPS: [string, RegExp][] = [
  ["italian", /^(italian|pizza)_/],
  ["japanese", /^(japanese|sushi|ramen)_/],
  ["middle_eastern", /^(middle_eastern|lebanese|turkish|mediterranean|afghani)_/],
];

// Google place types for each favourite cuisine on the taste cards, so one
// Nearby Search can look for all of them together.
export const CUISINE_PLACE_TYPES: Record<string, string[]> = {
  south_indian: ["indian_restaurant"],
  north_indian: ["indian_restaurant"],
  regional: ["indian_restaurant"],
  indian: ["indian_restaurant"],
  indo_chinese: ["chinese_restaurant"],
  italian: ["italian_restaurant", "pizza_restaurant"],
  japanese: ["japanese_restaurant", "sushi_restaurant", "ramen_restaurant"],
  korean: ["korean_restaurant"],
  thai: ["thai_restaurant"],
  middle_eastern: ["middle_eastern_restaurant", "lebanese_restaurant", "turkish_restaurant", "mediterranean_restaurant"],
  mexican: ["mexican_restaurant"],
  bakery: ["bakery", "dessert_shop"],
  healthy: ["vegan_restaurant", "vegetarian_restaurant"],
};

// The place types their taste asks for: favourite cuisines, plus bars or
// cafés from the this-or-that cards. Empty if they eat anything.
export function tastePlaceTypes(taste: Taste) {
  const types = new Set<string>();
  for (const y of taste.yes) if (y.startsWith("cuisine_")) for (const t of CUISINE_PLACE_TYPES[y.slice(8)] ?? []) types.add(t);
  if (types.size === 0) return [];
  if (needsDietCheck(taste.answers)) types.add("vegetarian_restaurant");
  if (taste.yes.includes("buzzing") && taste.answers.drinks !== "no_alcohol") ["bar", "pub"].forEach((t) => types.add(t));
  if (taste.yes.includes("quiet_cafe") || taste.yes.includes("buzzing_sober")) ["cafe", "coffee_shop"].forEach((t) => types.add(t));
  return [...types];
}

// Sent to the phone for one card.
export type Pick = StoredPick & {
  name: string;
  area: string;
  distanceKm: number;
  chips: string[];
  googleLine: string; // empty for events, which show the Search chip instead
  rating?: number; // Google's stars and how many reviews, shown with the Google Maps credit
  ratingCount?: number;
  checkedAt?: number; // set on the phone when the picks arrive
  mapsUri: string;
  directionsUri: string;
  book: { label: string; url: string } | null; // India: District / BookMyShow; events: the ticket page
  website?: string | null; // the venue's own site
  naverUri?: string; // South Korea: "Open in Naver Map" leads, Google Maps second
  country?: string; // for km or miles on the phone
  // uri is empty until the phone asks for it with ref (only once on screen).
  photo: { uri: string; ref?: string; credit: string; creditUri?: string } | null;
  // For Plan my evening: where it is and when it next closes (live, not stored).
  lat?: number;
  lng?: number;
  closesAt?: string;
  // Weekly hours in the place's local time: [day 0–6, open minutes, close minutes].
  hours?: [number, number, number][];
};

// ---------- What to search for ----------

const VEG_DIETS = ["vegetarian", "vegetarian_eggs", "jain", "vegan"];

// Places that serve some veg food but are mainly about meat or fish (a
// steakhouse, a biryani or kebab house) are not picks for vegetarians
// (founder's decision, 12 Nov 2026, "Option B"); Gemini also flags ones
// these words miss. Never "pure veg": that can't be confirmed.
const NON_VEG_TYPES = ["steak_house", "seafood_restaurant", "barbecue_restaurant", "fish_and_chips_restaurant", "chicken_restaurant", "chicken_wings_restaurant"];
const NON_VEG_WORDS = /\b(biryani|biriyani|kebabs?|kababs?|chicken|mutton|meat|meats|seafood|fish|steaks?|steakhouse|bbq|barbe?que|butcher|shawarma|grill house|non[- ]?veg)\b/i;

export function mainlyNonVeg(place: Place) {
  return NON_VEG_TYPES.includes(place.primaryType ?? "") || NON_VEG_WORDS.test(place.displayName?.text ?? "");
}

// "No beef" / "No pork" (they eat meat otherwise): places that are mainly
// about it are dropped by type and name; Gemini is told too. Never a promise.
const AVOID_WORDS: Record<string, RegExp> = {
  beef: /\b(beef|steaks?|steakhouse|brisket)\b/i,
  pork: /\b(pork|bacon|pig|lechon|tonkatsu|carnitas|char siu|charcuterie)\b/i,
};

export function mainlyAvoided(place: Place, avoid: string[] = []) {
  return avoid.some((a) => (a === "beef" && place.primaryType === "steak_house") || AVOID_WORDS[a]?.test(place.displayName?.text ?? ""));
}

export function needsDietCheck(answers: Answers) {
  return VEG_DIETS.includes(answers.diet ?? "");
}

// Experiences search phrases from the user's interests and swipes. Each new
// set for the same slot rotates to the next phrase, so "Show me more" feels
// different. (Food & drinks searches everything nearby instead.)
export function searchPhrases(category: Category, taste: Taste, tweaks: Tweak[] = []): string[] {
  const { answers, yes } = taste;
  const drinks = answers.drinks !== "no_alcohol";
  const phrases: string[] = [];
  if (category === "food_drinks") {
    phrases.push("everything nearby");
  } else {
    const map: Record<string, string> = {
      karaoke: "karaoke bar",
      rooftops: "rooftop bar",
      board_games: "board game cafe",
      dancing: "dance club or salsa night",
      hidden_bars: "speakeasy bar",
      live_music: "live music venue",
      comedy: "comedy club",
      art_culture: "art gallery",
      outdoors: "park",
      workshops: "workshop studio",
      nightlife: "nightclub",
      markets: "market",
      games_sports: "board game cafe",
    };
    for (const id of answers.interests) {
      if (["nightlife", "rooftops", "hidden_bars"].includes(id) && !drinks) continue;
      if (map[id]) phrases.push(map[id]);
    }
    // How they like to spend time (the experience cards) comes first.
    const doing = yes.map((id) => DOING_SIDE_PHRASES[id]).filter(Boolean);
    phrases.unshift(...doing);
    if (yes.includes("night_out_sober")) phrases.push("live music venue");
    if (phrases.length === 0) phrases.push("art gallery", "park", "museum");
    if (tweaks.includes("outdoors")) phrases.unshift("park");
    if (tweaks.includes("kids")) phrases.unshift("things to do with kids");
    if (tweaks.includes("groups")) phrases.unshift("group activity");
    if (tweaks.includes("quieter")) phrases.unshift("museum");
  }
  return [...new Set(phrases)];
}

// Search words for each taste card answer (lib/swipes.ts). Old card ids
// (before 11 Nov 2026) still count for people who swiped then.
const CUISINE_PHRASES: Record<string, string> = {
  south_indian: "south indian restaurant",
  north_indian: "north indian restaurant",
  indo_chinese: "chinese restaurant",
  regional: "regional indian thali restaurant",
  local: "local cuisine restaurant",
  indian: "indian restaurant",
  italian: "italian restaurant",
  japanese: "japanese restaurant",
  korean: "korean restaurant",
  thai: "thai restaurant",
  middle_eastern: "middle eastern restaurant",
  mexican: "mexican restaurant",
  bakery: "bakery and desserts",
  healthy: "healthy bowls and salads",
};
const FOOD_SIDE_PHRASES: Record<string, string> = {
  hole_in_wall: "small local favourite, one famous dish",
  dressed_up: "fine dining restaurant",
  quiet_cafe: "quiet cafe",
  buzzing: "lively bar with music",
  buzzing_sober: "cafe with live music",
  street_food: "street food",
  spicy_regional: "spicy regional food",
  local_breakfast: "local favourite restaurant",
  night_out: "cocktail bar",
  night_out_sober: "dessert cafe",
};
const DOING_SIDE_PHRASES: Record<string, string> = {
  dance: "dance class",
  make: "pottery workshop",
  play: "badminton court",
  unwind: "book cafe",
  crowd: "live music venue",
  circle: "community meetup",
  hands_on: "pottery workshop",
  get_moving: "dance class or sports",
  slow_down: "pottery workshop or book cafe",
};

// How adventurous they are with food (research, 13 Nov 2026): the novelty
// card, or, when they didn't choose a side, what they do: keep going back
// to regulars, or keep loving places once. Only nudges the ranking.
export type NoveltyLean = "familiar" | "new" | "mix";

export function noveltyLean(taste: Taste): NoveltyLean {
  const familiar = taste.yes.includes("familiar");
  const fresh = taste.yes.includes("new_to_me");
  if (familiar !== fresh) return familiar ? "familiar" : "new";
  const p = taste.places;
  if (p && p.regulars >= 3 && p.regulars * 2 >= p.loved) return "familiar";
  if (p && p.loved >= 5 && p.regulars <= 1) return "new";
  return "mix";
}

// Very popular places allowed among the 8: fewer for someone who loves
// finding new things, more for someone who likes their usual done well.
export function popularCap(taste: Taste) {
  const lean = noveltyLean(taste);
  return lean === "new" ? 1 : lean === "familiar" ? 3 : MAX_POPULAR;
}

// Food & drinks search words from the user's tweaks, cuisines and taste
// cards, searched alongside everything popular nearby. Empty means popular only.
// withoutCuisines: the cuisines are searched by place type instead (all at
// once), so only "Local food" stays a phrase.
export function foodPhrases(taste: Taste, tweaks: Tweak[] = [], city?: City, withoutCuisines = false): string[] {
  const veg = needsDietCheck(taste.answers) ? "vegetarian " : "";
  const sober = taste.answers.drinks === "no_alcohol";
  const fromTweaks = tweaks.map((t) => TWEAK_PHRASES[t]).filter(Boolean) as string[];
  const fromSwipes: string[] = [];
  for (const id of taste.yes) {
    // "Local food" means this country's food: "traditional Germany food" in Berlin.
    const cuisine = id === "cuisine_local" && city ? `traditional ${city.countryName} food` : id.startsWith("cuisine_") && !withoutCuisines ? CUISINE_PHRASES[id.slice(8)] : null;
    if (cuisine) fromSwipes.push(`${veg}${cuisine}`);
  }
  for (const id of taste.yes) {
    const phrase = FOOD_SIDE_PHRASES[id];
    if (!phrase || (sober && ["buzzing", "night_out"].includes(id))) continue;
    fromSwipes.push(["quiet_cafe", "buzzing", "buzzing_sober", "night_out", "night_out_sober"].includes(id) ? phrase : `${veg}${phrase}`);
  }
  return [...new Set([...fromTweaks, ...fromSwipes])];
}

// ---------- Hard filters, enforced in code ----------

const DISTANCE_KM: Record<string, number> = { closer_1km: 1, walk_2km: 2, ride_5km: 5, city: 15 };

export function distanceLimitKm(answers: Answers) {
  return DISTANCE_KM[answers.distance ?? ""] ?? 5;
}

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

// Spend answers that still see places with no price on Google.
const UNKNOWN_PRICE_OK = new Set(["", "level_1", "level_2", "level_3", "depends"]);

// Highest Google price level (1–4) each spend level allows.
const MAX_PRICE_LEVEL: Record<string, number> = { level_1: 1, level_2: 1, level_3: 2, level_4: 3, level_5: 4 };

const ALCOHOL_TYPES = ["bar", "pub", "night_club", "wine_bar", "cocktail_bar", "bar_and_grill", "liquor_store", "brewery"];

// Everything Food & drinks searches for: all of it, near you.
export const FOOD_DRINK_TYPES = [
  "restaurant", "cafe", "coffee_shop", "bakery", "tea_house", "juice_shop",
  "dessert_shop", "ice_cream_shop", "bar", "pub", "wine_bar", "cocktail_bar",
];

// Experiences never show a place that is mainly for eating or drinking
// (nightclubs still count as an experience).
function isMainlyFoodOrDrink(place: Place) {
  const t = place.primaryType ?? "";
  return t.endsWith("_restaurant") || FOOD_DRINK_TYPES.includes(t) || ["food_court", "meal_takeaway"].includes(t);
}

export const POPULAR_REVIEWS = 3000;

// Shops, not places to go out to.
const NEVER_PICKS = [
  "liquor_store", "convenience_store", "grocery_store", "supermarket", "gas_station", "store", "department_store", "shopping_mall",
  // Hotels are not a night out (their restaurants count when Google lists the restaurant itself).
  "hotel", "lodging", "resort_hotel", "motel", "guest_house", "bed_and_breakfast", "hostel", "inn", "extended_stay_hotel", "budget_japanese_inn", "japanese_inn",
];

// Words that don't tell two places apart ("Café Savoy" vs "Café Imperial").
const GENERIC = new Set(["the", "cafe", "café", "restaurant", "bar", "pub", "kitchen", "house", "coffee", "bakery", "bistro", "brasserie", "trattoria", "osteria", "pizzeria", "la", "le", "les", "el", "il", "da", "de", "di", "der", "die", "das", "new", "old", "little", "royal", "grand", "sri", "shree", "hotel"]);

// "Dishoom Covent Garden" and "Dishoom Carnaby" are one chain: a set shows
// one branch at most.
export function brandOf(name: string) {
  const words = name.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.find((w) => !GENERIC.has(w) && w.length > 2) ?? words.join(" ");
}

// fetaNote: set when this is one of the founder's own places ("Feta pick").
export type Candidate = { place: Place; km: number; far: boolean; fetaNote?: string };

// How many places each hard filter removed, to explain an empty result.
export type DropCounts = Record<"seen" | "far" | "price" | "diet" | "alcohol" | "hours" | "other", number>;

export function emptyDrops(): DropCounts {
  return { seen: 0, far: 0, price: 0, diet: 0, alcohol: 0, hours: 0, other: 0 };
}

// Returns places that pass every hard filter. Unknown price passes only for
// spend levels 1–3 (up to ₹1,500 in India): small places with no price on
// Google are usually cheap (founder's decision). Unknown diet info fails for
// vegetarian diets; unknown hours fail.
export function applyHardFilters(
  places: Place[],
  opts: { taste: Taste; category: Category; when: When; origin: { lat: number; lng: number }; exclude: Set<string>; city: City },
  drops: DropCounts = emptyDrops(),
): Candidate[] {
  const { answers } = opts.taste;
  const limit = distanceLimitKm(answers);
  const maxPrice = MAX_PRICE_LEVEL[answers.spend ?? ""] ?? 4;
  const maxSpend = spendUpperBound(answers, opts.city);
  const out: Candidate[] = [];
  for (const place of places) {
    drops.seen++;
    const drop = (why: keyof DropCounts) => {
      drops[why]++;
    };
    if (
      opts.exclude.has(place.id) ||
      !place.location ||
      (place.businessStatus && place.businessStatus !== "OPERATIONAL") ||
      (opts.category === "experiences" && isMainlyFoodOrDrink(place)) ||
      NEVER_PICKS.includes(place.primaryType ?? "")
    ) {
      drop("other");
      continue;
    }
    const km = distanceKm(opts.origin, { lat: place.location.latitude, lng: place.location.longitude });
    // Up to twice the limit is kept aside for the "worth a short ride" case.
    if (km > limit * 2 || (limit >= 15 && km > limit)) {
      drop("far");
      continue;
    }
    // Google's actual price range (per person) beats its rough price label.
    const level = PRICE_LEVELS[place.priceLevel ?? ""];
    const range = place.priceRange?.startPrice?.currencyCode === opts.city.currency ? Number(place.priceRange.startPrice.units) : NaN;
    const overBudget = Number.isFinite(range)
      ? maxSpend !== null && range > maxSpend
      : level !== undefined
        ? level > maxPrice
        : !UNKNOWN_PRICE_OK.has(answers.spend ?? "");
    if (overBudget) {
      drop("price");
      continue;
    }
    // Diet applies to food and drinks only (Google has no diet data for, say, a park).
    if (opts.category === "food_drinks" && needsDietCheck(answers) && (place.servesVegetarianFood !== true || mainlyNonVeg(place))) {
      drop("diet");
      continue;
    }
    if (opts.category === "food_drinks" && mainlyAvoided(place, answers.avoid)) {
      drop("diet");
      continue;
    }
    if (answers.drinks === "no_alcohol" && place.types?.some((t) => ALCOHOL_TYPES.includes(t))) {
      drop("alcohol");
      continue;
    }
    if (
      (opts.when === "tonight" && !openTonight(place, opts.city)) ||
      (opts.when === "weekend" && !opensOnWeekend(place)) ||
      (opts.taste.openLate && opts.when === "tonight" && !opensLate(place, opts.city))
    ) {
      drop("hours");
      continue;
    }
    out.push({ place, km, far: km > limit });
  }
  return out;
}

export function unknownPriceOk(answers: Answers) {
  return UNKNOWN_PRICE_OK.has(answers.spend ?? "");
}

export function spendUpperBound(answers: Answers, city: City): number | null {
  const match = /^level_(\d)$/.exec(answers.spend ?? "");
  if (!match) return null;
  // Levels travel: "₹500–1,500" at home means the same kind of place, at
  // local prices, in Lisbon.
  const level = Number(match[1]);
  return level <= 4 ? spendBounds(city.currency)[level - 1] : null;
}

// "Tonight" (founder's decision, 11 Nov 2026), in the city's own time:
// from 5 pm to 3 am it means open now; earlier in the day it means open
// for at least an hour between 7 and 10 pm today, so a lunch café that
// shuts at 5 isn't a pick and 4 am in New York still finds tonight's places.
const EVENING = [19 * 60, 22 * 60];

function cityNow(city: City) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: city.timeZone })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour) % 24;
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday), minutes: hour * 60 + Number(parts.minute) };
}

export function tonightMeansNow(city: City) {
  const { minutes } = cityNow(city);
  return minutes >= 17 * 60 || minutes < 3 * 60;
}

// Today's opening period that covers at least an hour of the evening.
function eveningHours(place: Place, city: City): [number, number] | null {
  const { day } = cityNow(city);
  const found = (weeklyHours(place) ?? [])
    // A place open around the clock has one period with no close.
    .filter(([d, open, close]) => (d === day || close >= 7 * 24 * 60) && Math.min(close, EVENING[1]) - Math.max(open, EVENING[0]) >= 60)
    .sort((a, b) => b[2] - a[2])[0];
  return found ? [found[1], found[2]] : null;
}

function openTonight(place: Place, city: City) {
  return tonightMeansNow(city) ? place.currentOpeningHours?.openNow === true : eveningHours(place, city) !== null;
}

// "Open later": still open at 11 pm tonight.
function opensLate(place: Place, city: City) {
  if (!tonightMeansNow(city)) return (eveningHours(place, city)?.[1] ?? 0) >= 23 * 60;
  const close = place.currentOpeningHours?.nextCloseTime;
  if (!close) return false;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: city.timeZone }).format(new Date(close)));
  const hoursAway = (new Date(close).getTime() - Date.now()) / 3600000;
  return hour >= 23 || hour < 5 || hoursAway >= 6;
}

function opensOnWeekend(place: Place) {
  const days = place.regularOpeningHours?.periods?.map((p) => p.open.day) ?? [];
  return days.includes(6) || days.includes(0);
}

// From the place's main type only: many Indian eateries also carry "cafe".
const DRINK_PRIMARY = [...ALCOHOL_TYPES, "coffee_shop", "tea_house", "juice_shop"];

export function kindOf(place: Place, category: Category): Kind {
  if (category === "experiences") return "DO";
  return DRINK_PRIMARY.includes(place.primaryType ?? "") ? "DRINK" : "EAT";
}

// A plain explanation of an empty result, from the filter that removed most.
export function whyNothing(drops: DropCounts, answers: Answers, when: When, country?: string): string {
  const tail = when === "tonight" ? "Try This weekend, a different area, or Show me more." : "Try a different area, or Show me more.";
  if (drops.seen === 0) return `Google Maps didn't find anything like this near you. ${tail}`;
  const [top] = (["far", "price", "diet", "hours", "alcohol"] as const)
    .map((k) => [k, drops[k]] as const)
    .sort((a, b) => b[1] - a[1]);
  const limit = distanceLimitKm(answers);
  const reasons: Record<string, string> = {
    far: `The places that fit you are more than ${formatDistance(limit * 2, country)} away.`,
    price: "The places near you are above your usual spend.",
    diet: needsDietCheck(answers) ? "Nothing near you is confirmed by Google to serve vegetarian food." : "The places near you are mostly about food you skip.",
    hours: when === "tonight" ? "The places that fit you nearby are closed right now." : "The places that fit you nearby aren't open at the weekend.",
    alcohol: "The places near you are mostly bars, and you said no alcohol.",
  };
  // Nothing failed a filter: they were shops, hotels, the other category,
  // or places already saved, skipped or been to (testers saw "already saved
  // or skipped" when they had saved nothing).
  return `${top[1] > 0 ? reasons[top[0]] : "None of the places near you fit this right now."} ${tail}`;
}

// ---------- Gemini chooses and explains ----------

function label(questionId: string, optionId: string | null, city: City) {
  const q = QUESTIONS.find((x) => x.id === questionId);
  if (!q || !optionId) return null;
  return optionsFor(q, city.currency, city.country).find((o) => o.id === optionId)?.label ?? null;
}

// A short taste summary built only from Feta's own data.
function likes(taste: Taste, which: "yes" | "no") {
  const ids = which === "yes" ? taste.yes : taste.no;
  return ids
    .filter((id) => !id.startsWith("cuisine_") || which === "yes")
    .map((id) => sideById(id, taste.answers)?.label.replace(/^[A-Za-z ]+: /, ""))
    .filter(Boolean)
    .join("; ");
}

// Words that belong to each this-or-that side. A reason that leans on a side
// the person turned down ("cosy" for someone who chose buzzing) is replaced.
const SIDE_WORDS: Record<string, RegExp> = {
  quiet_cafe: /\b(quiet|cosy|cozy|calm|peaceful|intimate|tranquil)\b/i,
  buzzing: /\b(buzzing|lively|loud|energetic|vibrant|party)\b/i,
  buzzing_sober: /\b(buzzing|lively|loud|energetic|vibrant)\b/i,
  dressed_up: /\b(fancy|fine[- ]dining|upscale|elegant|dressed[- ]up|special occasion)\b/i,
  hole_in_wall: /\b(no-frills|hole[- ]in[- ]the[- ]wall|humble|unpretentious)\b/i,
  dance: /\b(dance|dancing|salsa)\b/i,
  make: /\b(pottery|workshop|craft|hands-on)\b/i,
  play: /\b(sport|sports|badminton|pickleball|game of)\b/i,
  unwind: /\b(book club|reading|books)\b/i,
  crowd: /\b(gig|concert|crowd|big match|stadium)\b/i,
  circle: /\b(run club|trivia|meetup|community)\b/i,
  get_moving: /\b(dance|dancing|salsa|sport|sports|badminton|pickleball|hike|hiking|active)\b/i,
  slow_down: /\b(pottery|book club|books|reading|gallery|galleries|slow)\b/i,
  familiar: /\b(your usual|favourites? done|classic|comfort food|old favourite)\b/i,
  new_to_me: /\b(something new|never tried|new to you|adventurous|unusual)\b/i,
};

// A card's phrase only fits some kinds of place: "hole-in-the-wall" isn't a
// patisserie, a "buzzing bar" isn't a biryani house (testers saw both).
const SIDE_PLACES: Record<string, RegExp> = {
  hole_in_wall: /restaurant|food|meal|diner|street/,
  dressed_up: /restaurant|fine_dining|wine_bar|cocktail_bar/,
  buzzing: /bar|pub|night_club|brewery|lounge/,
  quiet_cafe: /cafe|coffee|tea_house|bakery|book_store/,
  buzzing_sober: /cafe|coffee|tea_house|live_music|performing_arts/,
};

// The price says more than the type: "dressed-up" only for fine dining or a
// pricier place (a cheap Mughlai restaurant got it, testers 13 Nov 2026),
// "hole-in-the-wall" never for an expensive one.
const SIDE_PRICE: Record<string, (level: number | undefined, type: string) => boolean> = {
  dressed_up: (level, type) => type === "fine_dining_restaurant" || (level ?? 0) >= 3,
  hole_in_wall: (level) => (level ?? 1) <= 2,
};

export function reasonFits(because: string, taste: Taste, place?: Place) {
  const rejected = taste.no.some((id) => SIDE_WORDS[id]?.test(because) && !taste.yes.some((y) => SIDE_WORDS[y]?.test(because)));
  if (rejected) return false;
  const type = place?.primaryType ?? "";
  const level = PRICE_LEVELS[place?.priceLevel ?? ""];
  // A side they chose, mentioned for a place it doesn't describe.
  return (
    !place ||
    !type ||
    !taste.yes.some((id) => SIDE_WORDS[id]?.test(because) && ((SIDE_PLACES[id] && !SIDE_PLACES[id].test(type)) || (SIDE_PRICE[id] && !SIDE_PRICE[id](level, type))))
  );
}

export function tasteSummary(taste: Taste, city: City) {
  const a = taste.answers;
  const multi = (id: string, values: string[]) => values.map((v) => label(id, v, city)).filter(Boolean).join(", ");
  return [
    a.diet && `Eats: ${label("diet", a.diet, city)}${a.halal ? ", halal only" : ""}`,
    a.avoid?.length && `Doesn't eat: ${a.avoid.join(", ")} (avoid places mainly about it)`,
    a.distance && `Distance: ${label("distance", a.distance, city)}`,
    a.spend && `Spend per person: ${label("spend", a.spend, city)}`,
    a.who.length > 0 && `Usually goes out with: ${multi("who", a.who)}`,
    a.drinks && `Drinks: ${label("drinks", a.drinks, city)}`,
    a.interests.length > 0 && `Into: ${multi("interests", a.interests)}`,
    // The this-or-that choices as plain likes and dislikes, so a reason
    // never cites the side they turned down.
    likes(taste, "yes") && `Chose: ${likes(taste, "yes")}`,
    likes(taste, "no") && `Said no to: ${likes(taste, "no")} (never use these as a reason)`,
    taste.lines.length > 0 && `What they like: ${taste.lines.join("; ")}`,
    taste.saved?.length && `Places they saved lately, and why: ${taste.saved.join(" | ")}`,
    taste.skipped?.length && `Why they skipped places lately: ${taste.skipped.join(", ")}`,
    taste.lovedPlaces?.length &&
      `Places they love (find new places like these in spirit, price and vibe; never these themselves): ${taste.lovedPlaces.join("; ")}`,
    taste.places?.lovedNotes.length && `What they love about places they keep going to, in their words: ${taste.places.lovedNotes.join(" | ")}`,
    taste.places?.dislikedNotes.length && `Why places weren't for them, in their words: ${taste.places.dislikedNotes.join(" | ")}`,
    taste.places && taste.places.loved + taste.places.notForThem > 0 &&
      `They've rated ${taste.places.loved + taste.places.notForThem + 0} places they've been (${taste.places.loved} loved, ${taste.places.regulars} regulars, ${taste.places.notForThem} not for them).`,
  ]
    .filter(Boolean)
    .join("\n");
}

function describe(c: Candidate, i: number, category: Category) {
  const p = c.place;
  return [
    `${i}. ${p.displayName?.text ?? "Unknown"}`,
    `kind ${kindOf(p, category)}`,
    p.primaryType && `type ${p.primaryType.replace(/_/g, " ")}`,
    `${c.km.toFixed(1)} km${c.far ? " (beyond their usual distance)" : ""}`,
    p.priceLevel && `price ${p.priceLevel.replace("PRICE_LEVEL_", "").toLowerCase()}`,
    p.rating && `rating ${p.rating} from ${p.userRatingCount ?? 0} reviews`,
    (p.userRatingCount ?? 0) >= POPULAR_REVIEWS && "VERY POPULAR",
    c.fetaNote !== undefined && `FETA PICK, the founder's own favourite${c.fetaNote ? `: "${c.fetaNote}"` : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

type Ranked = { index: number; verdict: Verdict; skipUnless?: string; because: string };

export async function chooseWithGemini(opts: {
  candidates: Candidate[];
  taste: Taste;
  city: City;
  category: Category;
  when: When;
  tweaks?: Tweak[];
  note?: string;
}): Promise<Ranked[]> {
  const { candidates, category, when, city } = opts;
  const asked = [...(opts.tweaks ?? []).map((t) => TWEAK_LABELS[t]), ...(opts.note ? [`"${opts.note}"`] : [])];
  const prompt = `You are Feta, a friend with great taste who picks places for one person in ${city.name}, ${city.countryName}.

About them:
${tasteSummary(opts.taste, city)}

They want ${category === "food_drinks" ? "somewhere to eat or drink" : "something to do"} ${when === "tonight" ? "tonight" : "this weekend"}.${asked.length ? `\nRight now they asked for: ${asked.join(", ")}. Weigh this heavily, and mention it in "because" where it fits.` : ""}
Every place below already fits their diet, budget, distance, drinks and opening hours, so choose on taste and fit.

Places:
${candidates.map((c, i) => describe(c, i, category)).join("\n")}

${category === "food_drinks" && needsDietCheck(opts.taste.answers) ? `They are vegetarian. Rank places known for good vegetarian food first. Never rank a place that is mainly about meat or fish (a biryani house, a kebab or grill place, a steakhouse, a seafood place, a fried-chicken chain). A place with real vegetarian choices (most burger, pizza and café places) is fine. List every mainly meat or fish place's number in "nonVeg".\n\n` : ""}${
    category === "food_drinks"
      ? {
          new: "They love trying new things: favour places and cuisines that would be new to them, and lesser-known finds over the obvious.\n\n",
          familiar: "They like their usual done really well: favour excellent, well-loved versions of their favourite cuisines over novelty.\n\n",
          mix: "",
        }[noveltyLean(opts.taste)]
      : ""
  }Places marked FETA PICK are the founder's own favourites: rank one of them highly when it fits, and its "because" may mention why it's a favourite.

Rank the best ${SHOW + 6} for them (fewer if fewer genuinely suit them), best first. Rules:
- Prefer finds over the obvious: at most ${popularCap(opts.taste)} places marked VERY POPULAR in the top ${SHOW}, and not first.
- Mix their favourites: at most ${MAX_SAME_CUISINE} places of the same cuisine in the top ${SHOW}, and if they named several cuisines, cover as many of them as the places allow.
- "because": one line, at most 110 characters, starting "Because you", tied to something they chose or liked above (never something under "Said no to") that genuinely fits THIS place and ${when === "tonight" ? "an evening out tonight" : "the weekend"} (never cite breakfast for dinner, or a bar for someone who doesn't drink). Never say a place is safe for a diet or allergy.
- "verdict" must be honest, like a friend who doesn't oversell:
  - "Good if you're nearby" is the normal verdict for a solid fit. Use it for most places.
  - "Worth a detour" is rare: only for an exceptional match to what they told you. At most one place in a set.
  - "Skip unless" when it only fits part of what they like, with "skipUnless" finishing the sentence in at most 7 words (e.g. "you want somewhere loud"). Use it whenever a place is a compromise.
- No hype words.`;

  if (FAKE) throw new Error("Test mode: no Gemini ranking");
  track("gemini_rank");
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              nonVeg: { type: "ARRAY", items: { type: "INTEGER" } },
              ranked: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    index: { type: "INTEGER" },
                    verdict: { type: "STRING", enum: ["Worth a detour", "Good if you're nearby", "Skip unless"] },
                    skipUnless: { type: "STRING" },
                    because: { type: "STRING" },
                  },
                  required: ["index", "verdict", "because"],
                },
              },
            },
            required: ["ranked"],
          },
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text: string = data.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text ?? "{}";
  const parsed = JSON.parse(text) as { ranked?: Ranked[]; nonVeg?: number[] };
  // Places Gemini says are mainly meat or fish are dropped for vegetarians.
  const nonVeg = new Set(needsDietCheck(opts.taste.answers) && category === "food_drinks" ? (parsed.nonVeg ?? []) : []);
  const out = (parsed.ranked ?? []).filter(
    (r, i, all) => Number.isInteger(r.index) && r.index >= 0 && r.index < candidates.length && !nonVeg.has(r.index) && all.findIndex((x) => x.index === r.index) === i,
  ) as Ranked[] & { nonVeg?: string[] };
  out.nonVeg = [...nonVeg].filter((i) => candidates[i]).map((i) => candidates[i].place.id);
  return out;
}

// Orders places in Gemini's ranking, with at most MAX_POPULAR very popular
// places among the first SHOW. A small city never gets weak filler: only
// places Gemini rated a real fit count (a "Skip unless" fills in only to
// reach 2). A bigger city fills up with the next best places that passed
// the hard filters (their verdict then says honestly what the compromise
// is). Without a ranking (Gemini down), it uses the filtered places in order.
export function takePicks(ranked: Ranked[], candidates: Candidate[], count = SHOW, small = false, maxPopular = MAX_POPULAR): { candidate: Candidate; ranked: Ranked | null }[] {
  const chosen: { candidate: Candidate; ranked: Ranked | null }[] = [];
  const isPopular = (c: Candidate) => (c.place.userRatingCount ?? 0) >= POPULAR_REVIEWS;
  const brand = (c: Candidate) => brandOf(c.place.displayName?.text ?? c.place.id);
  const add = (candidate: Candidate, r: Ranked | null, allowExtraPopular: boolean, upTo = count, anyCuisine = false) => {
    if (!candidate || chosen.length >= upTo || chosen.some((c) => c.candidate === candidate || brand(c.candidate) === brand(candidate))) return;
    if (!allowExtraPopular && isPopular(candidate) && chosen.length < SHOW && chosen.filter((c) => isPopular(c.candidate)).length >= maxPopular) return;
    // A mix: at most 2 of the same cuisine (Google's type, e.g. indian_restaurant) among the first 8.
    const kind = cuisineOf(candidate);
    if (!anyCuisine && kind && chosen.length < SHOW && chosen.filter((c) => cuisineOf(c.candidate) === kind).length >= MAX_SAME_CUISINE) return;
    chosen.push({ candidate, ranked: r });
  };
  const rankedOf = (c: Candidate) => ranked.find((r) => candidates[r.index] === c) ?? null;
  // At most one "Worth a detour" per set.
  let detours = 0;
  ranked = ranked.map((r) => (r.verdict === "Worth a detour" && detours++ > 0 ? { ...r, verdict: "Good if you're nearby" as const } : r));
  if (ranked.length > 0) {
    const good = ranked.filter((r) => r.verdict !== "Skip unless");
    for (const r of good) add(candidates[r.index], r, false);
    for (const r of good) add(candidates[r.index], r, true);
    for (const r of ranked) add(candidates[r.index], r, true, small ? Math.min(2, count) : count);
    if (small) return chosen;
  }
  for (const c of candidates) add(c, rankedOf(c), false);
  for (const c of candidates) add(c, rankedOf(c), true);
  // Only if there is nothing else: a third of the same cuisine.
  for (const c of candidates) add(c, rankedOf(c), true, count, true);
  return chosen;
}

// ---------- Building a card ----------

export function areaName(place: Place, city: City) {
  const parts = place.addressComponents ?? [];
  // Skip number-only names (block numbers in, say, Tokyo addresses) and
  // ones Google only has in another script (Arabic area names in Dubai).
  const readable = (t: string) => !/^[\d\s-]+$/.test(t) && !/[^\p{Script=Latin}\p{N}\p{P}\p{Zs}]/u.test(t);
  const pick = (type: string) => parts.find((p) => p.types?.includes(type) && readable(p.longText))?.longText;
  return pick("sublocality_level_1") ?? pick("neighborhood") ?? pick("sublocality") ?? pick("locality") ?? city.name;
}

function timeIn(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
}

// The live Google line, always ending in the unchanged words "Google Maps".
function googleLine(place: Place, when: When, city: City) {
  if (when === "tonight" && !tonightMeansNow(city)) {
    const hours = eveningHours(place, city);
    const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const until = hours && hours[1] < 7 * 24 * 60 ? ` until ${clock(hours[1])}` : "";
    return `Open tonight${until} · checked just now · Google Maps`;
  }
  if (when === "tonight") {
    const close = place.currentOpeningHours?.nextCloseTime;
    const known = close && city.timeZone !== "UTC";
    return `Open now${known ? ` · closes ${timeIn(close, city.timeZone)}` : ""} · checked just now · Google Maps`;
  }
  const days = new Set(place.regularOpeningHours?.periods?.map((p) => p.open.day) ?? []);
  const open = days.has(6) && days.has(0) ? "Open Sat and Sun" : days.has(6) ? "Open Saturday" : "Open Sunday";
  return `${open} · checked just now · Google Maps`;
}

// Whether a place's price is at their spend level, not just under it, so the
// ✓ never claims a match for a much cheaper place (testers, 13 Nov 2026).
function spendMatches(place: Place, answers: Answers, city: City) {
  const match = /^level_(\d)$/.exec(answers.spend ?? "");
  if (!match) return false;
  const level = Number(match[1]);
  const bounds = spendBounds(city.currency);
  const range = place.priceRange?.startPrice?.currencyCode === city.currency ? Number(place.priceRange.startPrice.units) : NaN;
  if (Number.isFinite(range)) {
    const low = level > 1 ? bounds[level - 2] : 0;
    const high = level <= 4 ? bounds[level - 1] : Infinity;
    return range >= low * 0.8 && range <= high;
  }
  const google = PRICE_LEVELS[place.priceLevel ?? ""];
  const max = MAX_PRICE_LEVEL[answers.spend ?? ""];
  return google !== undefined && max !== undefined && google <= max && google >= max - 1;
}

// Matched chips are written by code from verified facts, never by the AI.
// With "Anywhere in <city>" there is no distance chip: kilometres from the
// city's centre point mean nothing to them.
function chips(c: Candidate, taste: Taste, city: City, wholeCity = false): string[] {
  const out: string[] = [];
  const diet = taste.answers.diet;
  if (c.place.servesVegetarianFood === true) {
    if (diet === "jain") out.push("Jain: ask for no onion, garlic or root veg · not confirmed");
    else if (diet === "vegan") out.push("Vegan options · not confirmed, check with staff");
    else if (needsDietCheck(taste.answers)) out.push("Veg-friendly ✓");
  }
  // Google has no halal data, so it is never claimed, only flagged honestly.
  if (taste.answers.halal && c.place.types?.some((t) => t.includes("restaurant") || t.includes("food") || t === "cafe")) {
    out.push("Halal · not confirmed, check with staff");
  }
  const spend = label("spend", taste.answers.spend, city);
  if (spend && isMainlyFoodOrDrink(c.place) && spendMatches(c.place, taste.answers, city)) out.push(`${spend} ✓`);
  if (!wholeCity) out.push(`${formatDistance(c.km, city.country)}${c.far ? "" : " ✓"}`);
  return out;
}

// Booking brands only where they operate: District for tables in India.
// Elsewhere the card leads with the map, and the venue's own website.
function booking(kind: Kind, place: Place, city: City) {
  if (city.country !== "IN" || (kind !== "EAT" && kind !== "DRINK")) return null;
  const name = place.displayName?.text ?? "";
  const q = encodeURIComponent(name.includes(city.name) ? name : `${name} ${city.name}`);
  return { label: "Book on District", url: `https://www.district.in/search?q=${q}` };
}

function naverSearch(name: string, city: City) {
  return city.country === "KR" ? `https://map.naver.com/p/search/${encodeURIComponent(name)}` : undefined;
}

// A photo address already fetched, or a reference the phone fetches later.
function lazyPhoto(uri: string | null | undefined, name: string | undefined, credit?: { displayName: string; uri?: string }): Pick["photo"] {
  const base = { credit: credit?.displayName ?? "Google Maps", creditUri: credit?.uri };
  if (uri) return { uri, ...base };
  if (uri === undefined && name) return { uri: "", ref: photoRef(name), ...base };
  return null;
}

export function buildPick(
  c: Candidate,
  stored: StoredPick,
  opts: { taste: Taste; when: When; city: City; photo?: string | null; wholeCity?: boolean },
): Pick {
  const p = c.place;
  const name = p.displayName?.text ?? "This place";
  const best = bestPhoto(p);
  const credit = best?.authorAttributions?.[0];
  return {
    ...stored,
    name,
    area: areaName(p, opts.city),
    distanceKm: opts.wholeCity ? 0 : Math.round(c.km * 10) / 10,
    chips: chips(c, opts.taste, opts.city, opts.wholeCity),
    googleLine: googleLine(p, opts.when, opts.city),
    rating: p.rating,
    ratingCount: p.userRatingCount,
    mapsUri: p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`,
    // Coordinates, with the place ID: a name alone can open a different place.
    directionsUri: `https://www.google.com/maps/dir/?api=1&destination=${p.location ? `${p.location.latitude},${p.location.longitude}` : encodeURIComponent(name)}&destination_place_id=${p.id}`,
    book: booking(stored.kind, p, opts.city),
    website: p.websiteUri ?? null,
    naverUri: naverSearch(name, opts.city),
    country: opts.city.country,
    photo: lazyPhoto(opts.photo, best?.name, credit),
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    closesAt: p.currentOpeningHours?.nextCloseTime,
    hours: weeklyHours(p),
  };
}

// Opening periods as [day, open minute, close minute] (a close after
// midnight counts as 24:00 + minutes), for checking a planned time.
function weeklyHours(p: Place): [number, number, number][] | undefined {
  const periods = p.regularOpeningHours?.periods;
  if (!periods?.length) return undefined;
  return periods.map((pe) => {
    const open = (pe.open.hour ?? 0) * 60 + (pe.open.minute ?? 0);
    if (!pe.close) return [pe.open.day, 0, 24 * 60 * 7] as [number, number, number]; // open all the time
    let close = (pe.close.hour ?? 0) * 60 + (pe.close.minute ?? 0);
    if (pe.close.day !== pe.open.day) close += 24 * 60;
    return [pe.open.day, open, close] as [number, number, number];
  });
}

// ---------- Event cards ----------

function eventWhen(e: EventInfo, today: string) {
  const day = e.date === today ? "Tonight" : new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${e.date}T00:00:00Z`));
  if (!e.time) return day;
  const [h, m] = e.time.split(":").map(Number);
  return `${day} · ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function buildEventPick(
  stored: StoredPick & { event: EventInfo },
  opts: { taste: Taste; city: City; today: string; venue: Place | null; photo?: string | null; wholeCity?: boolean },
): Pick {
  const e = stored.event;
  const limit = distanceLimitKm(opts.taste.answers);
  const km = opts.wholeCity ? undefined : e.distanceKm;
  const maxSpend = spendUpperBound(opts.taste.answers, opts.city);
  const chips = [eventWhen(e, opts.today), e.priceText && `${e.priceText}${maxSpend !== null && /\d/.test(e.priceText) ? " ✓" : ""}`, km !== undefined && `${formatDistance(km, opts.city.country)}${km <= limit ? " ✓" : ""}`].filter(Boolean) as string[];
  const destination = e.venuePlaceId
    ? `destination=${encodeURIComponent(e.venueName)}&destination_place_id=${e.venuePlaceId}`
    : `destination=${encodeURIComponent(`${e.venueName}, ${opts.city.name}`)}`;
  const best = opts.venue ? bestPhoto(opts.venue) : undefined;
  const credit = best?.authorAttributions?.[0];
  return {
    ...stored,
    name: e.title,
    area: e.venueName,
    distanceKm: km !== undefined ? Math.round(km * 10) / 10 : 0,
    chips,
    googleLine: "",
    mapsUri: opts.venue?.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${e.venueName}, ${opts.city.name}`)}`,
    directionsUri: `https://www.google.com/maps/dir/?api=1&${destination}`,
    book: { label: `Tickets on ${e.site}`, url: e.url },
    naverUri: naverSearch(e.venueName, opts.city),
    country: opts.city.country,
    photo: lazyPhoto(opts.photo, best?.name, credit),
    lat: opts.venue?.location?.latitude,
    lng: opts.venue?.location?.longitude,
  };
}

// ---------- Honest verdicts ----------

// The weakest pick in a set gets "Skip unless…" when there is a real,
// checkable compromise, worded from facts rather than left to the AI.
export function compromiseFor(c: Candidate, taste: Taste, when: When, city: City): string | null {
  const limit = distanceLimitKm(taste.answers);
  const close = c.place.currentOpeningHours?.nextCloseTime;
  if (when === "tonight" && tonightMeansNow(city) && close && new Date(close).getTime() - Date.now() < 75 * 60000) return "you can get there in the next hour";
  if (c.far || c.km > limit * 0.7) return `you're already near ${areaName(c.place, city)}`;
  if ((c.place.userRatingCount ?? 0) >= POPULAR_REVIEWS) return "you don't mind a crowd";
  return null;
}
