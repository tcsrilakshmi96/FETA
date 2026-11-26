import "server-only";

import type { City } from "@/lib/cities";
import { QUESTIONS } from "@/lib/onboarding";
import { CUISINE_SEARCH, LOCAL_TASTING, DAY_PLAN, DEFAULT_DOING, INTEREST_SEARCH, SIDE_SEARCH, TWEAK_SEARCH, type SearchDef } from "@/lib/server/catalog";
import type { Place } from "@/lib/server/places";
import { sideById } from "@/lib/swipes";
import { isVegDiet } from "@/lib/onboarding";
import type { Category, Taste, Tweak } from "@/lib/server/picks";

// What this person wants, as a list of things to look for ("intents"),
// most important first. Each one is searched on Google on its own, so a
// favourite cuisine is never crowded out by what's popular nearby, and
// every choice they made can be checked against the picks (founder,
// 15 Nov 2026: "the things they tell Feta must decide what it finds").
//
// explicit: something they chose, said or showed (a cuisine, an interest,
// words they typed, what the places they love have in common, a tweak). Feta promises each a spot among the picks when one
// passes the hard filters, or says plainly that none did. Taste-card sides
// only steer the search when there's room.

export type IntentSource = "asked" | "plan" | "tweak" | "cuisine" | "interest" | "typed" | "loved" | "side";

export type Intent = {
  id: string;
  label: string; // "Thai & SE Asian"
  reason: string; // the "Because you…" line when the AI's is missing
  query: string; // this search's words
  def: SearchDef;
  explicit: boolean;
  source: IntentSource;
  food: boolean; // a kind of food or drink place (cuisine conflicts apply)
};

// Google searches per new set (about ₹3 each). Both categories also look at
// what's popular nearby when fewer than this many things are asked for.
export const MAX_SEARCHES = 4;

export const NOW: IntentSource[] = ["asked", "plan", "tweak"];
const SHARED: IntentSource[] = ["cuisine", "interest", "typed", "loved"];

function interestLabel(id: string) {
  return QUESTIONS.find((q) => q.id === "interests")?.options.find((o) => o.id === id)?.label ?? id.replace(/_/g, " ");
}

const variant = (list: string[], rotation: number) => list[rotation % list.length];

// Every intent this person has for one category, before choosing which to
// search this time. extra: intents read from their own words and the places
// they love (taste-reader.ts).
// dayPlan: a day out or a trip city, which needs sights and meals through
// the day, not only evening places.
// typed: a search from the Search screen looks for exactly what they typed
// (a place's name with "vegetarian" in front can miss it); their diet is
// still a hard filter.
export function allIntents(taste: Taste, opts: { category: Category; city: City; tweaks: Tweak[]; note?: string; rotation: number; extra?: Intent[]; dayPlan?: boolean; typed?: boolean }): Intent[] {
  const { category, city, rotation } = opts;
  const food = category === "food_drinks";
  const sober = taste.answers.drinks === "no_alcohol";
  const veg = isVegDiet(taste.answers.diet);
  // Abroad, vegetarians only see places Google confirms serve vegetarian
  // food, so the search asks for them; in India most places do.
  // What they ask for right now (a chat note, a tweak) always carries their
  // diet (tester, 23 Nov 2026: a vegetarian's "dinner near Alfama" was
  // searched as "local food" and found meat-led taverns).
  const saysDiet = (q: string) => /\b(veg|vegan|vegetarian|veggie|plant[- ]based|jain)\b/i.test(q);
  const vegWord = (q: string) => (veg && food && !saysDiet(q) ? `vegetarian ${q}` : q);
  const cuisineVeg = (q: string) => (veg && city.country !== "IN" ? `vegetarian ${q}` : q);
  const out: Intent[] = [];
  const note = (opts.note ?? "").trim();
  const askedQuery = opts.typed ? note : vegWord(note);
  if (note) out.push({ id: "asked", label: note, reason: `Because you asked for ${note}.`, query: askedQuery, def: { searches: [askedQuery] }, explicit: true, source: "asked", food });
  if (opts.dayPlan) {
    if (food) for (const p of DAY_PLAN.food) out.push({ id: p.id, label: p.label, reason: `Because a good day there starts with ${p.label}.`, query: vegWord(p.query), def: { searches: [p.query] }, explicit: true, source: "plan", food });
    else for (const p of DAY_PLAN.doing) out.push({ id: p.id, label: p.label, reason: `Because it's one of the best things to see there.`, query: p.query, def: p.def, explicit: true, source: "plan", food });
  }
  for (const t of opts.tweaks) {
    const words = TWEAK_SEARCH[t];
    if (!words) continue;
    const q = food ? words.food : words.doing;
    out.push({ id: `tweak_${t}`, label: q, reason: `Because you asked for somewhere ${t === "groups" ? "good for groups" : t === "kids" ? "good with kids" : t}.`, query: vegWord(q), def: { searches: [q] }, explicit: true, source: "tweak", food });
  }
  // Hidden bars and rooftops are places to drink: Food & drinks searches
  // them, Things to do doesn't.
  // A group with specifics chosen inside it ("Pottery" in "Classes and
  // workshops") is searched as those, not as any kind.
  const options = QUESTIONS.find((q) => q.id === "interests")?.options ?? [];
  const narrowed = new Set(taste.answers.interests.map((id) => options.find((o) => o.id === id)?.parent).filter(Boolean));
  for (const id of taste.answers.interests) {
    if (narrowed.has(id)) continue;
    const def = INTEREST_SEARCH[id];
    if (!def || !!def.drinkPlace !== food || (def.alcohol && sober)) continue;
    const label = interestLabel(id);
    // Tastings in general: the city's own speciality first (beer in Prague).
    const local = id === "tastings" && !sober ? LOCAL_TASTING[city.country] : undefined;
    const searches = sober && def.soberSearches ? def.soberSearches : local ? [local, ...def.searches.filter((q) => q !== local)] : def.searches;
    out.push({ id: `interest_${id}`, label, reason: `Because you're into ${label.toLowerCase()}.`, query: variant(searches, rotation), def, explicit: true, source: "interest", food });
  }
  if (food) {
    for (const id of taste.yes.filter((y) => y.startsWith("cuisine_"))) {
      const key = id.slice(8);
      const def = CUISINE_SEARCH[key];
      if (!def) continue;
      const label = sideById(id, taste.answers)?.label ?? key;
      const searches = key === "local" ? [`traditional ${city.countryName} food`] : key === "indo_chinese" && city.country !== "IN" ? ["chinese restaurant"] : def.searches;
      out.push({ id, label, reason: `Because you love ${label}${key === "bakery" || key === "healthy" || /\bfood$/i.test(label) ? "" : " food"}.`, query: cuisineVeg(variant(searches, rotation)), def, explicit: true, source: "cuisine", food });
    }
  }
  for (const x of opts.extra ?? []) if (x.food === food) out.push(x);
  for (const id of taste.yes) {
    const def = SIDE_SEARCH[id];
    if (!def || def.category !== category || (def.alcohol && sober)) continue;
    const label = (sideById(id, taste.answers)?.label ?? id).replace(/^[A-Za-z ]+: /, "");
    const q = variant(def.searches, rotation);
    out.push({ id: `side_${id}`, label, reason: `Because you picked ${label.replace(/^A /, "a ")}.`, query: def.vegWords ? vegWord(q) : q, def, explicit: false, source: "side", food });
  }
  // One of each: what they asked for right now first, then everything
  // they've shared taken in turn (a cuisine, an interest, their own words,
  // a place they love, then the next of each), so every set reflects all
  // of it and nothing they shared is crowded out by a long list of another
  // kind (founder, 17 Nov 2026: "the more they share the more you are able
  // to curate"). Taste-card sides last.
  const seen = new Set<string>();
  const unique = out.filter((i) => !seen.has(i.query.toLowerCase()) && (seen.add(i.query.toLowerCase()), true));
  const kinds = SHARED.map((s) => unique.filter((i) => i.source === s));
  const shared = Array.from({ length: Math.max(0, ...kinds.map((k) => k.length)) }, (_, n) => kinds.map((k) => k[n]).filter((i): i is Intent => !!i)).flat();
  return [...unique.filter((i) => NOW.includes(i.source)), ...shared, ...unique.filter((i) => i.source === "side")];
}

// Which intents to search this time, and whether to also look at what's
// popular nearby (places to eat and drink, or things to do). What they
// asked for right now is always searched; if they chose more than fit, the
// rest take turns across sets: never searched first (a choice just added in
// You), then the ones searched longest ago (founder, 19 Nov 2026).
export function planSearches(intents: Intent[], opts: { category: Category; when: "tonight" | "weekend"; max?: number; searchedBefore?: string[][] }) {
  const now = intents.filter((i) => NOW.includes(i.source));
  const chosen = intents.filter((i) => i.explicit && !now.includes(i));
  // A day plan searches one more, so their own interests fill the evening.
  const max = opts.max ?? MAX_SEARCHES + (intents.some((i) => i.source === "plan") ? 1 : 0);
  const room = Math.max(0, max - Math.min(now.length, max));
  const before = opts.searchedBefore ?? [];
  const setsAgo = (i: Intent) => {
    const k = before.findIndex((ids) => ids.includes(i.id));
    return k < 0 ? Infinity : k;
  };
  // What Feta read from places they love takes one search a set before
  // their other choices have theirs, so it never crowds those out; more
  // only when there's room left.
  const order = chosen
    .map((i, n) => ({ i, n, ago: setsAgo(i) }))
    .sort((a, b) => (a.ago === b.ago ? a.n - b.n : b.ago - a.ago))
    .map((x) => x.i);
  const firstLoved = order.find((i) => i.source === "loved");
  const first = order.filter((i) => i.source !== "loved" || i === firstLoved);
  const turn = [...first, ...order.filter((i) => !first.includes(i))].slice(0, room);
  turn.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const searched = [...now.slice(0, max), ...turn];
  const food = opts.category === "food_drinks";
  const broad = searched.length < max;
  const left = max - searched.length - (broad ? 1 : 0);
  const sides = intents.filter((i) => !i.explicit).slice(0, Math.max(0, left));
  // Nothing chosen for things to do yet: evening or weekend ideas, as well
  // as what's popular nearby (popular places at night are often closed).
  const fallback: Intent[] =
    !food && searched.length + sides.length === 0
      ? DEFAULT_DOING[opts.when].slice(0, Math.max(0, left)).map((d) => ({ id: `default_${d.query}`, label: d.query, reason: "", query: d.query, def: d.def, explicit: false, source: "side", food: false }))
      : [];
  return { searched: [...searched, ...sides, ...fallback], broad };
}

// The telling words of what they want ("thai", "comedy", "popup"), for
// checking that a reason or a guide's event is about it.
// Their diet, added to what they ask for, is never on its own a reason a
// place fits (it may not be confirmed).
const PLAIN = new Set(["restaurant", "restaurants", "place", "places", "food", "with", "near", "best", "class", "classes", "night", "something", "local", "good", "event", "events", "vegetarian", "vegan"]);
export const plainText = (t: string) => t.toLowerCase().replace(/pop[- ]?ups?\b/g, "popup");
export function intentWords(intents: Intent[]) {
  return intents.flatMap((i) => plainText(`${i.label} ${i.query}`).match(/[a-z]{4,}/g) ?? []).filter((w) => !PLAIN.has(w));
}

// ---------- Does a place match an intent? ----------

// Restaurant types that say nothing about the cuisine.
const GENERIC = /^(restaurant|fine_dining_restaurant|fast_food_restaurant|family_restaurant|breakfast_restaurant|brunch_restaurant|buffet_restaurant|vegetarian_restaurant|vegan_restaurant|bar_and_grill|diner|bistro|gastropub|food_court|meal_takeaway|cafeteria|food)$/;

// A restaurant type that names a cuisine ("indian_restaurant").
export function specificCuisine(type: string) {
  return /_restaurant$/.test(type) && !GENERIC.test(type);
}

const words = (q: string) => q.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !["restaurant", "food", "with", "place", "near", "cafe", "small", "local"].includes(w));

// Strong evidence (the place's type) counts wherever it was found. A place
// found by the intent's own search counts too, unless it's clearly another
// cuisine (an Indian place from a "thai restaurant" search) or a thing to
// do Google can't say what it is.
export function matches(place: Place, intent: Intent, fromThisSearch: boolean) {
  const types = [place.primaryType ?? "", ...(place.types ?? [])].filter(Boolean);
  if (intent.def.types && types.some((t) => intent.def.types!.test(t))) return true;
  if (!fromThisSearch) return false;
  const primary = place.primaryType ?? "";
  // A thing to do Google has no type for counts only when its name says
  // it's what was searched ("Kiln Pottery" for "pottery class"): a band for
  // hire isn't a live music venue (persona test, 23 Nov 2026).
  if (!intent.food && !primary) return words(intent.query).some((w) => (place.displayName?.text ?? "").toLowerCase().includes(w));
  if (intent.def.related?.test(primary)) return true;
  if (!intent.food || !specificCuisine(primary)) return true;
  // A cuisine type named in the search itself ("vietnamese restaurant").
  return words(intent.query).some((w) => primary.includes(w));
}

// What a place counts as for "no more than a few of one kind": the first
// thing they asked for that it matches, else its cuisine, else nothing.
export function kindKey(place: Place, matched: string[], explicit: Intent[]): string | null {
  const first = explicit.find((i) => matched.includes(i.id));
  if (first) return first.id;
  const primary = place.primaryType ?? "";
  if (!specificCuisine(primary)) return null;
  for (const [id, def] of Object.entries(CUISINE_SEARCH)) if (def.types?.test(primary)) return `cuisine_${id}`;
  return primary;
}
