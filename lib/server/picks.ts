import "server-only";

import { distanceKm, type City } from "@/lib/cities";
import { SPEND_LEVELS } from "@/lib/currency";
import { optionsFor, QUESTIONS, type Answers } from "@/lib/onboarding";
import type { Place } from "@/lib/server/places";

export type Category = "food_drinks" | "experiences";
export type When = "tonight" | "weekend";
export type Kind = "EAT" | "DRINK" | "DO";
export type Verdict = "Worth a detour" | "Good if you're nearby" | "Skip unless";

// What Feta knows about the user, read from the database.
export type Taste = {
  answers: Answers;
  lines: string[]; // profile lines still in use (never trip-only ones)
  yes: string[]; // swipe card ids the user said "Yes, me" to
  no: string[];
};

// Saved per set: place IDs and Feta's own words only.
export type StoredPick = { placeId: string; kind: Kind; verdict: Verdict; skipUnless?: string; because: string };

// Sent to the phone for one card.
export type Pick = StoredPick & {
  name: string;
  area: string;
  distanceKm: number;
  chips: string[];
  googleLine: string;
  mapsUri: string;
  directionsUri: string;
  book: { label: string; url: string } | null;
  photo: { uri: string; credit: string; creditUri?: string } | null;
};

// ---------- What to search for ----------

const VEG_DIETS = ["vegetarian", "vegetarian_eggs", "jain", "vegan"];

export function needsDietCheck(answers: Answers) {
  return VEG_DIETS.includes(answers.diet ?? "");
}

// Search phrases from the user's swipes and interests. Each new set for the
// same slot rotates to the next phrase, so "Show me 3 more" feels different.
export function searchPhrases(category: Category, when: When, taste: Taste): string[] {
  const { answers, yes } = taste;
  const drinks = answers.drinks !== "no_alcohol";
  const phrases: string[] = [];
  if (category === "food_drinks") {
    const veg = needsDietCheck(answers) ? "vegetarian " : "";
    if (yes.includes("street_food")) phrases.push(`${veg}street food`);
    if (yes.includes("spicy_regional")) phrases.push(`${veg}spicy regional food restaurant`);
    if (yes.includes("local_breakfast")) phrases.push(when === "weekend" ? `${veg}breakfast` : `${veg}authentic local restaurant`);
    if (yes.includes("quiet_cafe")) phrases.push("quiet cafe");
    if (yes.includes("night_out") && drinks) phrases.push("cocktail bar");
    phrases.push(when === "tonight" ? `${veg}restaurant for dinner` : `${veg}restaurant`);
  } else {
    const map: Record<string, string> = {
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
      if (id === "nightlife" && !drinks) continue;
      if (map[id]) phrases.push(map[id]);
    }
    if (yes.includes("hands_on")) phrases.push("pottery workshop");
    if (yes.includes("night_out_sober")) phrases.push("live music venue");
    if (phrases.length === 0) phrases.push("art gallery", "park", "museum");
  }
  return [...new Set(phrases)];
}

// ---------- Hard filters, enforced in code ----------

const DISTANCE_KM: Record<string, number> = { walk_2km: 2, ride_5km: 5, city: 15 };

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
const DRINK_TYPES = [...ALCOHOL_TYPES, "cafe", "coffee_shop", "tea_house", "juice_shop"];

export const POPULAR_REVIEWS = 3000;

export type Candidate = { place: Place; km: number; far: boolean };

// Returns places that pass every hard filter. Unknown price passes only for
// spend levels 1–3 (up to ₹1,500 in India): small places with no price on
// Google are usually cheap (founder's decision). Unknown diet info fails for
// vegetarian diets; unknown hours fail.
export function applyHardFilters(
  places: Place[],
  opts: { taste: Taste; category: Category; when: When; origin: { lat: number; lng: number }; exclude: Set<string>; city: City },
): Candidate[] {
  const { answers } = opts.taste;
  const limit = distanceLimitKm(answers);
  const maxPrice = MAX_PRICE_LEVEL[answers.spend ?? ""] ?? 4;
  const maxSpend = spendUpperBound(answers, opts.city);
  const out: Candidate[] = [];
  for (const place of places) {
    if (opts.exclude.has(place.id)) continue;
    if (place.businessStatus && place.businessStatus !== "OPERATIONAL") continue;
    if (!place.location) continue;
    const km = distanceKm(opts.origin, { lat: place.location.latitude, lng: place.location.longitude });
    // Up to twice the limit is kept aside for the "worth a short ride" case.
    if (km > limit * 2 || (limit >= 15 && km > limit)) continue;
    const level = PRICE_LEVELS[place.priceLevel ?? ""];
    if (level !== undefined && level > maxPrice) continue;
    if (level === undefined && !place.priceRange && !UNKNOWN_PRICE_OK.has(answers.spend ?? "")) continue;
    const start = Number(place.priceRange?.startPrice?.units);
    if (maxSpend !== null && place.priceRange?.startPrice?.currencyCode === opts.city.currency && start > maxSpend) continue;
    // Diet applies to food and drinks only (Google has no diet data for, say, a park).
    if (opts.category === "food_drinks" && needsDietCheck(answers) && place.servesVegetarianFood !== true) continue;
    if (answers.drinks === "no_alcohol" && place.types?.some((t) => ALCOHOL_TYPES.includes(t))) continue;
    if (opts.when === "tonight" && place.currentOpeningHours?.openNow !== true) continue;
    if (opts.when === "weekend" && !opensOnWeekend(place)) continue;
    out.push({ place, km, far: km > limit });
  }
  return out;
}

function spendUpperBound(answers: Answers, city: City): number | null {
  const match = /^level_(\d)$/.exec(answers.spend ?? "");
  if (!match || answers.spendCurrency !== city.currency) return null;
  const level = Number(match[1]);
  return level <= 4 ? SPEND_LEVELS[city.currency][level - 1] : null;
}

function opensOnWeekend(place: Place) {
  const days = place.regularOpeningHours?.periods?.map((p) => p.open.day) ?? [];
  return days.includes(6) || days.includes(0);
}

export function kindOf(place: Place, category: Category): Kind {
  if (category === "experiences") return "DO";
  return place.types?.some((t) => DRINK_TYPES.includes(t)) ? "DRINK" : "EAT";
}

// ---------- Gemini chooses and explains ----------

function label(questionId: string, optionId: string | null, city: City) {
  const q = QUESTIONS.find((x) => x.id === questionId);
  if (!q || !optionId) return null;
  return optionsFor(q, city.currency).find((o) => o.id === optionId)?.label ?? null;
}

// A short taste summary built only from Feta's own data.
export function tasteSummary(taste: Taste, city: City) {
  const a = taste.answers;
  const multi = (id: string, values: string[]) => values.map((v) => label(id, v, city)).filter(Boolean).join(", ");
  return [
    a.diet && `Eats: ${label("diet", a.diet, city)}${a.halal ? ", halal only" : ""}`,
    a.distance && `Distance: ${label("distance", a.distance, city)}`,
    a.spend && `Spend per person: ${label("spend", a.spend, city)}`,
    a.who.length > 0 && `Usually goes out with: ${multi("who", a.who)}`,
    a.drinks && `Drinks: ${label("drinks", a.drinks, city)}`,
    a.interests.length > 0 && `Into: ${multi("interests", a.interests)}`,
    taste.lines.length > 0 && `What they like: ${taste.lines.join("; ")}`,
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
}): Promise<Ranked[]> {
  const { candidates, category, when, city } = opts;
  const prompt = `You are Feta, a friend with great taste who picks places for one person in ${city.name}, India.

About them:
${tasteSummary(opts.taste, city)}

They want ${category === "food_drinks" ? "somewhere to eat or drink" : "something to do"} ${when === "tonight" ? "tonight" : "this weekend"}.
Every place below already fits their diet, budget, distance, drinks and opening hours, so choose on taste and fit.

Places:
${candidates.map((c, i) => describe(c, i, category)).join("\n")}

Rank the best 5 for them, best first. Rules:
- Prefer finds over the obvious: at most 1 place marked VERY POPULAR in the top 3.
- "because": one line, at most 110 characters, starting "Because you", tied to something they said or liked above. Never say a place is safe for a diet or allergy.
- "verdict": "Worth a detour" for a great fit even if a bit far, "Good if you're nearby" for a solid fit, "Skip unless" for a weaker fit, with "skipUnless" finishing the sentence (e.g. "you want somewhere loud").
- Be honest. No hype words.`;

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
  const ranked = (JSON.parse(text).ranked ?? []) as Ranked[];
  return ranked.filter((r, i, all) => Number.isInteger(r.index) && r.index >= 0 && r.index < candidates.length && all.findIndex((x) => x.index === r.index) === i);
}

// Keeps Gemini's order but allows at most 1 very popular place in the 3.
// If Gemini returned too few, fills from the remaining candidates in order.
export function takeThree(ranked: Ranked[], candidates: Candidate[]): { candidate: Candidate; ranked: Ranked | null }[] {
  const chosen: { candidate: Candidate; ranked: Ranked | null }[] = [];
  let popular = 0;
  const tryAdd = (candidate: Candidate, r: Ranked | null) => {
    if (chosen.length >= 3 || chosen.some((c) => c.candidate === candidate)) return;
    const isPopular = (candidate.place.userRatingCount ?? 0) >= POPULAR_REVIEWS;
    if (isPopular && popular >= 1) return;
    if (isPopular) popular++;
    chosen.push({ candidate, ranked: r });
  };
  for (const r of ranked) tryAdd(candidates[r.index], r);
  return chosen;
}

// ---------- Building a card ----------

function areaName(place: Place, city: City) {
  const parts = place.addressComponents ?? [];
  const pick = (type: string) => parts.find((p) => p.types.includes(type))?.longText;
  return pick("sublocality_level_1") ?? pick("neighborhood") ?? pick("sublocality") ?? pick("locality") ?? city.name;
}

function timeIn(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
}

// The live Google line, always ending in the unchanged words "Google Maps".
function googleLine(place: Place, when: When, city: City) {
  if (when === "tonight") {
    const close = place.currentOpeningHours?.nextCloseTime;
    return `Open now${close ? ` · closes ${timeIn(close, city.timeZone)}` : ""} · checked just now · Google Maps`;
  }
  const days = new Set(place.regularOpeningHours?.periods?.map((p) => p.open.day) ?? []);
  const open = days.has(6) && days.has(0) ? "Open Sat and Sun" : days.has(6) ? "Open Saturday" : "Open Sunday";
  return `${open} · checked just now · Google Maps`;
}

// Matched chips are written by code from verified facts, never by the AI.
function chips(c: Candidate, taste: Taste, city: City): string[] {
  const out: string[] = [];
  const diet = taste.answers.diet;
  if (c.place.servesVegetarianFood === true) {
    if (diet === "jain" || diet === "vegan") out.push("Veg options · not confirmed, check with staff");
    else if (needsDietCheck(taste.answers)) out.push("Veg-friendly ✓");
  }
  // Google has no halal data, so it is never claimed, only flagged honestly.
  if (taste.answers.halal && c.place.types?.some((t) => t.includes("restaurant") || t.includes("food") || t === "cafe")) {
    out.push("Halal · not confirmed, check with staff");
  }
  const spend = label("spend", taste.answers.spend, city);
  if (spend && taste.answers.spend !== "depends" && c.place.priceLevel) out.push(`${spend} ✓`);
  out.push(`${c.km < 1 ? c.km.toFixed(1) : Math.round(c.km * 10) / 10} km${c.far ? "" : " ✓"}`);
  return out;
}

function booking(kind: Kind, place: Place, city: City) {
  const name = place.displayName?.text ?? "";
  const q = encodeURIComponent(name.includes(city.name) ? name : `${name} ${city.name}`);
  if (kind === "EAT" || kind === "DRINK") return { label: "Book on District", url: `https://www.district.in/search?q=${q}` };
  if (place.websiteUri) return { label: "Website", url: place.websiteUri };
  return null;
}

export function buildPick(
  c: Candidate,
  stored: StoredPick,
  opts: { taste: Taste; when: When; city: City; photo: string | null },
): Pick {
  const p = c.place;
  const name = p.displayName?.text ?? "This place";
  const credit = p.photos?.[0]?.authorAttributions?.[0];
  return {
    ...stored,
    name,
    area: areaName(p, opts.city),
    distanceKm: Math.round(c.km * 10) / 10,
    chips: chips(c, opts.taste, opts.city),
    googleLine: googleLine(p, opts.when, opts.city),
    mapsUri: p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`,
    directionsUri: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(name)}&destination_place_id=${p.id}`,
    book: booking(stored.kind, p, opts.city),
    photo: opts.photo ? { uri: opts.photo, credit: credit?.displayName ?? "Google Maps", creditUri: credit?.uri } : null,
  };
}
