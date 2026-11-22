import "server-only";

import type { City } from "@/lib/cities";
import { allIntents, kindKey, matches, planSearches, type Intent } from "@/lib/server/intents";
import { searchNearby, searchPlaces, type Place } from "@/lib/server/places";
import {
  applyHardFilters,
  brandOf,
  chooseWithGemini,
  distanceLimitKm,
  TRIP_OUT_KM,
  emptyDrops,
  fastFoodChain,
  DOING_TYPES,
  FOOD_DRINK_TYPES,
  mainlyOf,
  POPULAR_REVIEWS,
  reasonFits,
  tonightMeansNow,
  type Candidate,
  type Category,
  type DropCounts,
  type Kind,
  type Ranked,
  type Taste,
  type Tweak,
  type At,
  type When,
} from "@/lib/server/picks";
import { sideById } from "@/lib/swipes";

// How Feta curates, in five steps that every caller shares (Picks, Ask
// Feta, plans and trips):
//   1. What they want: intents.ts turns their choices and words into intents.
//   2. Find: one Google search per intent (plus what's popular nearby).
//   3. Hard filters in code: diet, budget, distance, drinks, hours.
//   4. Rank: Gemini orders the places for this person.
//   5. Keep the promise: each thing they asked for gets its best place
//      among the picks when one passed, and together those fill at least
//      half; the rest follow the ranking, mixed and not too famous.
// Nothing else reorders or swaps the picks afterwards.

export type Chosen = { candidate: Candidate; ranked: Ranked | null };

export type CurateInput = {
  taste: Taste;
  city: City;
  origin: { lat: number; lng: number };
  category: Category;
  when: When;
  tweaks: Tweak[];
  note?: string;
  exclude: Set<string>;
  needsDiet: boolean;
  need: number; // places wanted (a wider search runs when fewer pass)
  rotation: number; // later sets search the next words
  searchedBefore?: string[][]; // what recent sets searched, newest first
  extra?: Intent[]; // read from their own words (taste-reader.ts)
  dayPlan?: boolean; // a day out or a trip city: sights and meals, any hours (itinerary.ts checks them)
  searches?: number; // Google searches this set may run (default MAX_SEARCHES; Surprise me runs 1)
  at?: At; // a day and time asked for in chat, checked instead of tonight or the weekend
  // Feta's lists (the founder's places, local favourites, Featured in, Feta
  // users' favourites), checked live against the same hard filters before
  // Google is searched (engine.ts); what they want picks which to check.
  favourites?: (intents: Intent[]) => Promise<Curated>;
};

// looked: the list places checked live that passed; mark: labels a place
// Google's search found that is on a list too (free), else null.
export type Curated = { looked: Candidate[]; mark: (c: Candidate) => Candidate | null };

// Lists first (founder, 22 Nov 2026: "your curated edge isn't in the
// product yet"): a choice that this many list places already serve isn't
// searched on Google this set.
const LIST_ENOUGH = 2;

// Found, filtered and ranked; pickFrom keeps the promise once the number
// of places to show is known (events may take some spots).
export type CurateResult = {
  pool: Candidate[];
  ranked: Ranked[];
  intents: Intent[]; // searched this time
  fromLists?: string[]; // served by Feta's lists, so not searched on Google
  drops: DropCounts;
};

const POOL_MAX = 30;

export async function curate(input: CurateInput): Promise<CurateResult> {
  const { taste, city, origin, category, when } = input;
  const intents = allIntents(taste, { category, city, tweaks: input.tweaks, note: input.note, rotation: input.rotation, extra: input.extra, dayPlan: input.dayPlan });
  const plan = planSearches(intents, { category, when, max: input.searches, searchedBefore: input.searchedBefore });

  // 2. Find.
  const limit = distanceLimitKm(taste.answers);
  const common = { lat: origin.lat, lng: origin.lng, needsDiet: input.needsDiet, regionCode: city.country };
  const text = (query: string, radiusKm: number) => searchPlaces({ ...common, query, radiusKm, openNow: !input.at && when === "tonight" && tonightMeansNow(city) });
  // What's popular nearby, only places that are mainly that kind of place.
  const nearby = (radiusKm: number) => searchNearby({ ...common, types: category === "food_drinks" ? FOOD_DRINK_TYPES : DOING_TYPES, radiusKm, rank: "POPULARITY" }).then((r) => r.filter((p) => mainlyOf(p, category)));
  const found = new Map<string, { place: Place; from: Set<string> }>();
  const add = (places: Place[], from: string) =>
    places.forEach((p) => {
      const f = found.get(p.id) ?? { place: p, from: new Set<string>() };
      f.from.add(from);
      found.set(p.id, f);
    });
  // A hike or an adventure at the weekend may be a trip out (founder, 21 Nov
  // 2026), searched further and allowed that far only for what it matches.
  const tripOut = when === "weekend" && !input.at;
  const reach = (i: Intent) => (tripOut && i.def.far ? Math.max(limit, TRIP_OUT_KM) : limit);
  // Feta's lists first; Google searches only what they don't cover yet.
  const lists = input.favourites ? await input.favourites(intents).catch(() => null) : null;
  const listed = lists?.looked ?? [];
  const fromLists = plan.searched.filter((i) => i.def.types && listed.filter((c) => matches(c.place, i, false)).length >= LIST_ENOUGH);
  const searches = [
    ...plan.searched.filter((i) => !fromLists.includes(i)).map((i) => text(i.query, reach(i)).then((r) => add(r, i.id))),
    ...(plan.broad ? [nearby(limit).then((r) => add(r, "popular"))] : []),
  ];
  const settled = await Promise.allSettled(searches);
  if (!listed.length && settled.length && settled.every((r) => r.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;

  // 3. Hard filters, then what each place matches.
  const matched = (p: Place) => {
    const from = found.get(p.id)?.from ?? new Set<string>();
    return plan.searched.filter((i) => matches(p, i, from.has(i.id))).map((i) => i.id);
  };
  const drops = emptyDrops();
  const filter = () => {
    Object.assign(drops, emptyDrops());
    return applyHardFilters([...found.values()].map((f) => f.place), {
      taste,
      category,
      when,
      origin,
      exclude: input.exclude,
      city,
      anyHours: input.dayPlan,
      at: input.at,
      foodDrinkOk: (p) => matched(p).some((id) => plan.searched.find((i) => i.id === id)?.def.foodDrink),
      reachKm: (p) => Math.max(limit, ...plan.searched.filter((i) => matched(p).includes(i.id)).map(reach)),
    }, drops).map((c) => ({ ...c, intents: matched(c.place) }));
  };
  const passed = chainsOnlyIfNeeded(filter());
  const onList = [...listed, ...passed.flatMap((c) => lists?.mark(c) ?? [])].filter((c, i, all) => all.findIndex((o) => o.place.id === c.place.id) === i);
  const listIds = new Set(onList.map((c) => c.place.id));
  let pool = [...onList.map((c) => ({ ...c, intents: matched(c.place) })), ...roundRobin(passed, plan.searched).filter((c) => !listIds.has(c.place.id))].slice(0, POOL_MAX);

  // 4. Rank. Places Gemini says are mainly meat or fish leave the pool for
  // vegetarians; what Gemini says a place "serves" confirms (never adds to)
  // what it matched.
  let ranked = pool.length ? await chooseWithGemini({ candidates: pool, taste, city, category, when, tweaks: input.tweaks, note: input.note, intents: plan.searched, dayPlan: input.dayPlan }).catch((error) => {
    console.error(error);
    return [] as Ranked[];
  }) : [];
  const nonVeg = new Set((ranked as { nonVeg?: string[] }).nonVeg ?? []);
  if (nonVeg.size) {
    const kept = pool.filter((c) => !nonVeg.has(c.place.id));
    ranked = ranked.map((r) => ({ ...r, index: kept.indexOf(pool[r.index]) })).filter((r) => r.index >= 0);
    pool = kept;
  }
  // (Only when Gemini filled "serves" at all, so a reply without it can't
  // undo every match.)
  if (ranked.some((r) => r.serves?.length)) {
    for (const r of ranked) {
      const c = pool[r.index];
      if (c?.intents?.length) c.intents = c.intents.filter((id) => (r.serves ?? []).includes(id) || !plan.searched.find((i) => i.id === id)?.explicit);
    }
  }

  return { pool, ranked, intents: plan.searched, fromLists: fromLists.map((i) => i.id), drops };
}

// 5. Keep the promise: the picks to show (room of them), then the rest as
// backup, and what they asked for that found nothing ("missing").
// only: just the places that match one intent ("asked": what they asked
// for in chat or Plan my evening), never the rest of their everyday set.
export function pickFrom(found: CurateResult, opts: { room: number; small: boolean; popularCap: number; only?: string; taken?: string[] }) {
  const result = opts.only ? onlyFor(found, opts.only) : found;
  const explicit = result.intents.filter((i) => i.explicit);
  const all = selectPicks(result.ranked, result.pool, { ...opts, explicit });
  const shown = all.filter((c) => !c.spare).length;
  const covered = new Set(all.slice(0, shown).flatMap((c) => c.candidate.intents ?? []));
  const missing = explicit.filter((i) => !covered.has(i.id) && i.source !== "tweak");
  return { chosen: all.map(({ candidate, ranked }) => ({ candidate, ranked })) as Chosen[], shown, missing };
}

function onlyFor(result: CurateResult, id: string): CurateResult {
  const keep = result.pool.map((c, i) => [c, i] as const).filter(([c]) => c.intents?.includes(id));
  const at = new Map(keep.map(([, i], j) => [i, j]));
  return { ...result, pool: keep.map(([c]) => c), ranked: result.ranked.filter((r) => at.has(r.index)).map((r) => ({ ...r, index: at.get(r.index)! })) };
}

// Places in turn from each search, so the pool Gemini ranks holds every
// intent's best, not only the biggest search's.
function roundRobin(cands: Candidate[], searched: Intent[]): Candidate[] {
  const groups = searched.map((i) => cands.filter((c) => c.intents?.includes(i.id)));
  const rest = cands.filter((c) => !c.intents?.length);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (let k = 0; out.length < cands.length && k < cands.length; k++) {
    for (const g of [...groups, rest]) {
      const c = g[k];
      if (c && !seen.has(c.place.id)) {
        seen.add(c.place.id);
        out.push(c);
      }
    }
  }
  return out;
}

// The picks, in ranking order. Steps: each explicit intent's best place
// (the promise, even if it's very popular); then every curated place (the
// founder's, loved by Feta users with a similar taste, local favourites)
// that the ranking didn't mark "Skip unless", best fit first, with no set
// number per source (founder, 19 Nov 2026: "think about what fits them
// the best… keep Google search the last"); places for
// what they asked for up to half; then the ranking. Never two branches of
// one chain, at most popularCap very popular places, and a few of one kind
// at most (3 of 8 when they asked for only one or two things, events of
// that kind already shown included: Round 6, pottery took 5 of 8).
// A small city only takes places Gemini ranked ("no weak filler", a "Skip
// unless" only to reach 2); a bigger city fills up in the filtered order.
// The most of one thing they're into among the 8, places and events together.
export const KIND_MAX = 3;

export function selectPicks(
  ranked: Ranked[],
  pool: Candidate[],
  opts: { room: number; small: boolean; popularCap: number; explicit: Intent[]; taken?: string[] },
): (Chosen & { spare: boolean })[] {
  const byIndex = new Map(ranked.map((r) => [r.index, r]));
  const good = ranked.filter((r) => r.verdict !== "Skip unless").map((r) => r.index);
  const weak = ranked.filter((r) => r.verdict === "Skip unless").map((r) => r.index);
  const unranked = pool.map((_, i) => i).filter((i) => !byIndex.has(i));
  const favourite = (i: number) => pool[i].fetaNote !== undefined || (pool[i].lovedBy ?? 0) > 0 || !!pool[i].local || !!pool[i].featured;
  // No filler (founder, 19 Nov 2026: "the whole point of this app is
  // showing customised suggestions"): once they've shared anything, every
  // place shown, or kept as backup, is something they chose, said or love
  // (its intents), or a curated place the ranking didn't mark "Skip unless".
  // A short list says so in the banner; what's merely popular nearby is
  // never shown to fill up.
  const fits = (i: number) => (pool[i].intents?.length ?? 0) > 0 || (favourite(i) && byIndex.get(i)?.verdict !== "Skip unless");
  const order: number[] = (opts.small && ranked.length ? [...good, ...weak] : [...good, ...weak, ...unranked]).filter((i) => !opts.explicit.length || fits(i));
  const rankOf = new Map(order.map((i, k) => [i, k]));
  const explicitIds = opts.explicit.map((i) => i.id);
  const kindCap = opts.explicit.length <= 2 ? KIND_MAX : 2;
  const taken = (k: string) => (opts.taken ?? []).filter((t) => t === k).length;

  const chosen: number[] = [];
  const isPopular = (i: number) => (pool[i].place.userRatingCount ?? 0) >= POPULAR_REVIEWS;
  const brand = (i: number) => brandOf(pool[i].place.displayName?.text ?? pool[i].place.id);
  const kind = (i: number) => kindKey(pool[i].place, pool[i].intents ?? [], opts.explicit);
  const forExplicit = (i: number) => (pool[i].intents ?? []).some((id) => explicitIds.includes(id));
  const can = (i: number, rules: { popular?: boolean; kinds?: boolean } = {}) => {
    if (chosen.includes(i) || chosen.some((c) => brand(c) === brand(i))) return false;
    if (rules.popular !== false && isPopular(i) && chosen.filter(isPopular).length >= opts.popularCap) return false;
    const k = kind(i);
    if (rules.kinds !== false && k && chosen.filter((c) => kind(c) === k).length + taken(k) >= (explicitIds.includes(k) ? kindCap : 2)) return false;
    return true;
  };
  const room = opts.small && ranked.length ? Math.min(opts.room, good.length + Math.max(0, 2 - good.length)) : opts.room;
  const take = (i: number | undefined) => {
    if (i !== undefined && chosen.length < room) chosen.push(i);
  };

  for (const intent of opts.explicit) {
    if (chosen.some((c) => pool[c].intents?.includes(intent.id))) continue;
    take(order.find((i) => pool[i].intents?.includes(intent.id) && can(i, { popular: false })));
  }
  for (const i of order) if (favourite(i) && byIndex.get(i)?.verdict !== "Skip unless" && can(i)) take(i);
  const half = Math.ceil(room / 2);
  for (const i of order) if (chosen.filter(forExplicit).length < half && forExplicit(i) && can(i)) take(i);
  for (const i of order) if (can(i)) take(i);
  // Short of places: one more of what they asked for beats a famous place
  // they didn't (live check, 15 Nov 2026: a Thai lover in London got Dishoom).
  // With two or more things chosen, no one thing passes KIND_MAX: a shorter
  // list beats 5 of the same (Round 6).
  const one = opts.explicit.length <= 1;
  if (one) for (const i of order) if (forExplicit(i) && can(i, { kinds: false })) take(i);
  for (const i of order) if (can(i, { popular: false })) take(i);
  if (one) for (const i of order) if (can(i, { popular: false, kinds: false })) take(i);

  // Shown curated first (founder, 19 Nov 2026: "feta picks and local
  // recommendations should be shown before the google searches"): hers,
  // then loved by Feta users, local favourites, featured in a guide; then
  // Google's. Best fit first within each.
  const source = (i: number) => (pool[i].fetaNote !== undefined ? 0 : (pool[i].lovedBy ?? 0) > 0 ? 1 : pool[i].local ? 2 : pool[i].featured ? 3 : 4);
  chosen.sort((a, b) => source(a) - source(b) || (rankOf.get(a) ?? 99) - (rankOf.get(b) ?? 99));
  const spares = order.filter((i) => !chosen.includes(i));
  return [...chosen.map((i) => ({ candidate: pool[i], ranked: byIndex.get(i) ?? null, spare: false })), ...spares.map((i) => ({ candidate: pool[i], ranked: byIndex.get(i) ?? null, spare: true }))];
}

// "Because you…" when Gemini's line is missing or doesn't fit: the first
// thing they asked for that this place is, else a taste-card side that fits
// the kind of place, else nothing: no reason beats a filler one (Round 5
// review: "Because it fits what you told me" on 4 of 8 picks).
const KIND_SIDES: Record<string, string[]> = { DRINK: ["buzzing", "buzzing_sober", "quiet_cafe"], EAT: ["hole_in_wall", "dressed_up", "quiet_cafe"] };

export function becauseFor(c: Candidate | null, intents: Intent[], taste: Taste, kind: Kind, aiLine?: string) {
  if (aiLine && aiLine.startsWith("Because you") && reasonFits(aiLine, taste, c?.place)) return aiLine;
  const first = intents.find((i) => c?.intents?.includes(i.id) && i.reason && i.source !== "side");
  if (first) return first.reason;
  const side = taste.yes.find((y) => KIND_SIDES[kind]?.includes(y) && (!c || reasonFits(sideById(y, taste.answers)?.label ?? "", { ...taste, no: [] }, c.place)));
  const label = side ? sideById(side, taste.answers)?.label : null;
  if (label) return `Because you picked ${label.replace(/^[A-Za-z ]+: /, "").replace(/^A /, "a ")}.`;
  return "";
}

// A global fast-food chain stays only when it's the only place found for
// something they asked for (founder, 21 Nov 2026); with nothing asked, only
// when nothing else passed.
function chainsOnlyIfNeeded(passed: Candidate[]): Candidate[] {
  const others = passed.filter((c) => !fastFoodChain(c.place));
  const served = new Set(others.flatMap((c) => c.intents ?? []));
  return passed.filter((c) => !fastFoodChain(c.place) || (c.intents?.length ? c.intents.some((id) => !served.has(id)) : others.length === 0));
}
