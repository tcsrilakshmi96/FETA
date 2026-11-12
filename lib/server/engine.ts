import "server-only";
import { after } from "next/server";

import { isMainlandChina, type City } from "@/lib/cities";
import { cityById, isSmallCity } from "@/lib/server/cities";
import { DAILY_BUDGET_INR, spentToday } from "@/lib/server/costs";
import { loadTaste, userDb, userIdFor } from "@/lib/server/taste";
import { placeDetails, searchNearby, searchPlaces, type Place } from "@/lib/server/places";
import { cityCalendar, eventPasses, findEvents, findVenue, personalizeEvents, siteName, type FoundEvent } from "@/lib/server/events";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyHardFilters,
  FOOD_DRINK_TYPES,
  emptyDrops,
  whyNothing,
  buildEventPick,
  compromiseFor,
  buildPick,
  chooseWithGemini,
  distanceLimitKm,
  kindOf,
  needsDietCheck,
  searchPhrases,
  spendUpperBound,
  tasteSummary,
  unknownPriceOk,
  takePicks,
  tastePlaceTypes,
  SHOW,
  tonightMeansNow,
  applyTweaks,
  foodPhrases,
  TWEAKS,
  POPULAR_REVIEWS,
  reasonFits,
  type Candidate,
  type DropCounts,
  type Tweak,
  type EventInfo,
  type Category,
  type Pick,
  type StoredPick,
  type Taste,
  type When,
} from "@/lib/server/picks";
import { sideById } from "@/lib/swipes";

// Cost guards (founder can change these in Vercel without a code change).
// Alpha: 600 new searches a day across everyone, 20 per person (each
// category counts once), and an estimated-spend cap per day (costs.ts).
const DAILY_LIMIT = Number(process.env.PICKS_DAILY_LIMIT ?? 600);
const USER_DAILY_LIMIT = Number(process.env.PICKS_USER_DAILY_LIMIT ?? 20);
const REUSE_HOURS: Record<When, number> = { tonight: 3, weekend: 12 };
// How long places wait for this week's events (founder's testers: 20 s
// for first picks was too slow).
const EVENTS_WAIT_MS = 5000;

type Body = {
  category: Category;
  when: When;
  origin: {
    lat: number;
    lng: number;
    label: string;
    source: "gps" | "area" | "city";
    areaId?: string;
    city: { id: string };
  };
  trip?: string; // trip-only profile lines for this trip count too
  more?: boolean; // "Show me more", once the backup places run out
  tweaks?: string[]; // from the Tweak sheet
  note?: string; // free text from the Tweak sheet
};

// spares: the next best places, kept on the phone for "Show me more".
type Reply = { picks: Pick[]; spares?: Pick[]; banner?: string; notice?: string };

function json(body: Reply | { error: string }, status = 200) {
  return Response.json(body, { status });
}

// The picks engine, shared by Picks (/api/picks) and Ask Feta (/api/ask).
// Returns a Response so callers can pass it straight on or read it.
export async function runPicks(token: string | undefined, input: unknown): Promise<Response> {
  if (!token) return json({ error: "Not signed in" }, 401);
  const body = input as Body;
  const city = cityById(body.origin?.city?.id);
  if (city && isMainlandChina(city)) {
    return json({ picks: [], notice: `Feta can't find reliable places in mainland China yet, because Google Maps has very little there. Ask Feta in chat for ideas in ${city.name}; they'll be less reliable than usual.` });
  }
  if (!city || !Number.isFinite(body.origin.lat) || !Number.isFinite(body.origin.lng) || !["food_drinks", "experiences"].includes(body.category) || !["tonight", "weekend"].includes(body.when)) {
    return json({ error: "Bad request" }, 400);
  }

  const db = userDb(token);
  const userId = await userIdFor(db, token);
  if (!userId) return json({ error: "Not signed in" }, 401);

  const [taste, actionsRes] = await Promise.all([loadTaste(db, body.trip), db.from("pick_actions").select("place_id")]);
  const answers = taste.answers;
  const exclude = new Set((actionsRes.data ?? []).map((r) => r.place_id as string));
  // Place IDs and rounded coordinates only: no Google text in the database.
  const originKey =
    body.origin.source === "gps"
      ? `gps:${city.id}`
      : body.origin.source === "area"
        ? `area:${body.origin.areaId ?? `${body.origin.lat.toFixed(3)},${body.origin.lng.toFixed(3)}`}`
        : `city:${city.id}`;
  const origin = { lat: body.origin.lat, lng: body.origin.lng };
  const small = isSmallCity(city.id);
  const needsDiet = body.category === "food_drinks" && needsDietCheck(answers);

  const { data: recent } = await db
    .from("pick_sets")
    .select("picks, banner, expires_at, origin_key, created_at")
    .eq("category", body.category)
    .eq("when_slot", body.when)
    .order("created_at", { ascending: false })
    .limit(20);
  const latest = (recent ?? []).find((s) => s.origin_key === originKey);

  // Tweaks ("Cheaper", "Closer"…) always search fresh and are kept apart.
  const tweaks = (body.tweaks ?? []).filter((t) => TWEAKS.includes(t as Tweak)) as Tweak[];
  const note = (body.note ?? "").slice(0, 200).trim();
  const tweaked = tweaks.length > 0 || note.length > 0;
  const setKey = tweaked ? `${originKey}|${[...tweaks].sort().join(",")}|${note}` : originKey;
  // "Anywhere in Goa" or a trip destination means the whole place, not a
  // walk from its centre.
  const wide = body.origin.source === "city" ? { ...taste, answers: { ...taste.answers, distance: "city" } } : taste;
  const effective = applyTweaks(wide, tweaks);

  // 1. Recent picks for the same place come back the same: one fresh search
  //    (one search returns 20 places, cheaper than re-checking 8 one by
  //    one), with the places shown last time first, in the same order and
  //    with the same words, as long as they still pass the hard filters.
  const kept: { stored: StoredPick[]; picks: Pick[] } = { stored: [], picks: [] };
  const firstShown = (s: { picks: unknown }) => (s.picks as StoredPick[]).filter((p) => !p.spare);
  const previous = latest && !body.more && !tweaked && new Date(latest.expires_at) > new Date() ? firstShown(latest) : [];
  const keptBanner: string | null = previous.length ? latest!.banner : null;

  // 2. Daily cost limits: searches, and today's estimated spend.
  const [{ data: counts }, spent] = await Promise.all([
    db.rpc("pick_searches_today").single<{ everyone: number; mine: number }>(),
    spentToday(db),
  ]);
  if ((counts && (counts.everyone >= DAILY_LIMIT || counts.mine >= USER_DAILY_LIMIT)) || spent >= DAILY_BUDGET_INR) {
    if (kept.picks.length > 0) return json({ picks: kept.picks, notice: "That's all the new searching for today, so here are your latest picks." });
    if (latest) {
      const shown = await showStored(firstShown(latest), latest.banner, { taste, body, city, origin, exclude, needsDiet });
      if (shown.picks.length > 0) return json({ ...shown.reply, notice: "That's all the new searching for today, so here are your latest picks." });
    }
    return json({ picks: [], notice: "Feta has done all its searching for today. Fresh picks tomorrow morning." });
  }

  // 3. New search. "Show me more" and tweaks skip anything shown (or kept
  //    as backup) in the last day; topping up skips what is already kept.
  if (body.more || tweaked) {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    for (const set of recent ?? []) {
      if (new Date(set.created_at).getTime() > dayAgo) for (const p of set.picks as StoredPick[]) exclude.add(p.placeId);
    }
  }
  for (const k of kept.stored) exclude.add(k.placeId);
  const need = SHOW - kept.picks.length;
  const todaysSets = (recent ?? []).filter((s) => new Date(s.created_at).toDateString() === new Date().toDateString()).length;
  // The same search words as last time, so the same places come back.
  const rotation = previous.length ? Math.max(0, todaysSets - 1) : todaysSets;

  // Experiences also look for this week's events, at the same time. Places
  // don't wait more than a few seconds for them: a slow first search keeps
  // going after the reply and fills the shared events cache, so the next
  // person in the area (or the next open) gets events straight away.
  const eventsFull =
    body.category === "experiences" && need > 1 && !body.trip
      ? eventPicks({ db, taste: effective, body, city, origin, exclude }).catch((error) => {
          console.error(error);
          return [] as EventPick[];
        })
      : Promise.resolve([] as EventPick[]);
  after(() => eventsFull);
  const eventsSearch = Promise.race([eventsFull, new Promise<EventPick[]>((resolve) => setTimeout(() => resolve([]), EVENTS_WAIT_MS))]);

  const drops = emptyDrops();
  let pool: Candidate[];
  try {
    pool = await gatherCandidates({ taste: effective, tweaks, body, city, origin, exclude, needsDiet, need, rotation, drops });
  } catch (error) {
    console.error(error);
    if (body.category === "food_drinks" && kept.picks.length === 0) {
      return json({ picks: [], notice: "Couldn't reach Google Maps just now. Try again in a minute." }, 502);
    }
    pool = [];
  }

  // The founder's own places ("Feta picks") that pass the same hard filters.
  const feta = await fetaCandidates({ db, taste: effective, body, city, origin, exclude, needsDiet, pool }).catch((error) => {
    console.error(error);
    return [] as Candidate[];
  });
  pool = [...feta, ...pool.filter((c) => !feta.some((f) => f.place.id === c.place.id))].slice(0, 24);

  // Rank places while the event search is still running.
  const ranking =
    pool.length > 0
      ? chooseWithGemini({ candidates: pool, taste: effective, city, category: body.category, when: body.when, tweaks, note }).catch((error) => {
          console.error(error);
          return [] as Awaited<ReturnType<typeof chooseWithGemini>>;
        })
      : Promise.resolve([] as Awaited<ReturnType<typeof chooseWithGemini>>);
  const [allEvents, rankedAll] = await Promise.all([eventsSearch, ranking]);
  // Mainly meat or fish places Gemini flagged leave the pool for vegetarians.
  const flagged = new Set((rankedAll as { nonVeg?: string[] }).nonVeg ?? []);
  let ranked = rankedAll;
  if (flagged.size) {
    const kept = pool.filter((c) => !flagged.has(c.place.id));
    ranked = rankedAll.map((r) => ({ ...r, index: kept.indexOf(pool[r.index]) })).filter((r) => r.index >= 0);
    pool = kept;
  }
  // Events shown last time stay while they're still on.
  const prevEvents: EventPick[] = previous
    .filter((p): p is StoredPick & { event: EventInfo } => !!p.event && !exclude.has(p.placeId) && eventStillOn(p.event, body.when, city))
    .map((stored) => ({ stored, venue: null }));
  const events = [...prevEvents, ...allEvents.filter((e) => !prevEvents.some((p) => p.stored.placeId === e.stored.placeId))].slice(0, Math.min(2, need));
  if (pool.length === 0 && events.length === 0) {
    if (kept.picks.length > 0) return json({ picks: kept.picks, ...(keptBanner ? { banner: keptBanner } : {}) });
    console.log("No picks", { category: body.category, when: body.when, drops });
    return json({ picks: [], notice: whyNothing(drops, effective.answers, body.when, city.country) });
  }

  // Up to 2 events first, then places to make 8; every other place that
  // passed is kept, in order, as backup. A Feta pick that passed the hard
  // filters always gets a place in the 8, unless it is a very popular place
  // (a famous sight is not a find; Gemini may still pick it).
  const room = Math.max(0, need - events.length);
  const chosen = takePicks(ranked, pool, pool.length, small);
  const fetaInPool = pool.filter((c) => c.fetaNote !== undefined && (c.place.userRatingCount ?? 0) < POPULAR_REVIEWS);
  if (fetaInPool.length > 0 && room > 0 && !chosen.slice(0, room).some((c) => c.candidate.fetaNote !== undefined)) {
    const best = ranked.map((r) => pool[r.index]).find((c) => c && fetaInPool.includes(c)) ?? fetaInPool[0];
    const at = chosen.findIndex((c) => c.candidate === best);
    const entry = at >= 0 ? chosen.splice(at, 1)[0] : { candidate: best, ranked: ranked.find((r) => pool[r.index] === best) ?? null };
    chosen.splice(Math.min(2, room - 1, chosen.length), 0, entry);
  }
  const prevOrder = new Map(previous.map((p, i) => [p.placeId, i]));
  if (prevOrder.size) chosen.sort((a, b) => (prevOrder.get(a.candidate.place.id) ?? 99) - (prevOrder.get(b.candidate.place.id) ?? 99));
  // Every favourite cuisine they chose shows up among the 8 when the search
  // found one: it swaps in for the lowest pick that isn't a Feta pick
  // (founder's testers: 6 of 8 were Italian, none of their Japanese or Thai).
  if (!previous.length && body.category === "food_drinks") {
    for (const y of taste.yes.filter((id) => id.startsWith("cuisine_"))) {
      const re = CUISINE_TYPES[y.slice(8)];
      if (!re || chosen.slice(0, room).some((c) => re.test(c.candidate.place.primaryType ?? ""))) continue;
      const j = chosen.findIndex((c, i) => i >= room && re.test(c.candidate.place.primaryType ?? ""));
      if (j < 0) continue;
      let k = Math.min(room, chosen.length) - 1;
      while (k >= 0 && (chosen[k].candidate.fetaNote !== undefined || Object.values(CUISINE_TYPES).some((r) => r !== re && taste.yes.some((t) => CUISINE_TYPES[t.slice(8)] === r) && r.test(chosen[k].candidate.place.primaryType ?? "") && chosen.slice(0, room).filter((c) => r.test(c.candidate.place.primaryType ?? "")).length === 1))) k--;
      if (k < 0) continue;
      [chosen[k], chosen[j]] = [chosen[j], chosen[k]];
    }
  }
  const shownCount = Math.min(room, chosen.length);
  const placeStored: StoredPick[] = chosen.map(({ candidate, ranked: r }, i) => {
    const before = previous.find((p) => p.placeId === candidate.place.id);
    if (before) return { ...before, ...(i >= room ? { spare: true } : {}) };
    // The last pick shown says "Skip unless…" when there is a real compromise.
    const weakest = i === shownCount - 1 && kept.picks.length + events.length + shownCount >= 3 && r?.verdict !== "Worth a detour";
    const compromise = weakest ? compromiseFor(candidate, effective, body.when, city) : null;
    return {
      placeId: candidate.place.id,
      kind: kindOf(candidate.place, body.category),
      verdict: compromise ? "Skip unless" : (r?.verdict ?? "Good if you're nearby"),
      ...(compromise ? { skipUnless: compromise } : r?.verdict === "Skip unless" && r.skipUnless ? { skipUnless: r.skipUnless } : {}),
      because: r?.because && reasonFits(r.because, taste, candidate.place) ? r.because : fallbackBecause(taste, candidate.place, kindOf(candidate.place, body.category)),
      ...(candidate.fetaNote !== undefined ? { fetaNote: candidate.fetaNote } : {}),
      ...(i >= room ? { spare: true } : {}),
    };
  });
  // One "Worth a detour" among the ones shown at most, across events and places.
  let detours = kept.stored.filter((p) => p.verdict === "Worth a detour").length;
  const capped = (p: StoredPick): StoredPick => (p.verdict === "Worth a detour" && detours++ > 0 ? { ...p, verdict: "Good if you're nearby" } : p);
  for (const e of events) e.stored = capped(e.stored) as typeof e.stored;
  placeStored.forEach((p, i) => (placeStored[i] = capped(p)));
  const stored: StoredPick[] = [...kept.stored, ...events.map((e) => e.stored), ...placeStored];
  const shownTotal = kept.picks.length + events.length + shownCount;
  const farCount = chosen.slice(0, shownCount).filter((c) => c.candidate.far).length;
  const short = shownTotal < 3;
  const whenText = body.when === "tonight" ? "tonight" : "this weekend";
  const banner = short
    ? `Only ${shownTotal} ${shownTotal === 1 ? "place" : "places"} really ${shownTotal === 1 ? "fits" : "fit"} you here ${whenText}${farCount > 0 ? `, worth a short ride` : ""}. No weak filler.`
    : farCount > 0
      ? `Nothing great right around you ${whenText}. ${farCount === 1 ? "1 is" : `${farCount} are`} worth a short ride.`
      : keptBanner;

  await db.from("pick_sets").insert({
    user_id: userId,
    category: body.category,
    when_slot: body.when,
    origin_key: setKey,
    city_id: city.id,
    country: city.country,
    time_zone: city.timeZone,
    currency: city.currency,
    picks: stored,
    banner,
    expires_at: new Date(Date.now() + REUSE_HOURS[body.when] * 3600 * 1000).toISOString(),
  });

  try {
    const today = cityCalendar(city.timeZone).today;
    // Photos are fetched by the phone only once a card is on screen.
    const fresh = [
      ...events.map((e) => buildEventPick(e.stored, { taste, city, today, venue: e.venue })),
      ...chosen.map(({ candidate }, i) => buildPick(candidate, placeStored[i], { taste, when: body.when, city })),
    ];
    const shownFresh = fresh.filter((p) => !p.spare);
    return json({ picks: [...kept.picks, ...shownFresh], spares: fresh.filter((p) => p.spare), ...(banner ? { banner } : {}) });
  } catch (error) {
    console.error(error);
    return json({ picks: [], notice: "Something went wrong showing your picks. Try again in a minute." }, 500);
  }
}

// Places to choose from. Food & drinks: everything popular nearby plus a
// search shaped by the user's taste. Experiences: two phrases from their
// interests. If fewer than needed pass the hard filters, one wider search
// ("worth a short ride").
async function gatherCandidates(ctx: {
  taste: Taste;
  tweaks: Tweak[];
  body: Body;
  city: City;
  origin: { lat: number; lng: number };
  exclude: Set<string>;
  needsDiet: boolean;
  need: number;
  rotation: number;
  drops: DropCounts;
}): Promise<Candidate[]> {
  const { taste, body, city, origin } = ctx;
  const limit = distanceLimitKm(taste.answers);
  const common = { lat: origin.lat, lng: origin.lng, needsDiet: ctx.needsDiet, regionCode: city.country };
  const text = (query: string, radiusKm: number) =>
    searchPlaces({ ...common, query, radiusKm, openNow: body.when === "tonight" && tonightMeansNow(city) });
  const nearby = (radiusKm: number, types = FOOD_DRINK_TYPES) => searchNearby({ ...common, types, radiusKm, rank: "POPULARITY" });
  // Their favourite cuisines (and bars or cafés from the cards) in one
  // Nearby Search, so every cuisine they chose can come up.
  const tasteTypes = body.category === "food_drinks" ? tastePlaceTypes(taste) : [];

  // What they asked for in their own words (Tweak sheet or Ask Feta) leads.
  const asked = (ctx.body.note ?? "").trim();
  const base = body.category === "food_drinks" ? foodPhrases(taste, ctx.tweaks, city, tasteTypes.length > 0) : searchPhrases(body.category, taste, ctx.tweaks);
  const phrases = asked ? [asked, ...base.filter((p) => p !== asked)] : base;
  const pick = (i: number) => (asked && i === 0 ? asked : phrases.length ? phrases[(ctx.rotation + i) % phrases.length] : null);
  const first = pick(0);
  const second = phrases.length > 1 ? pick(1) : null;
  const searches: Promise<Place[]>[] =
    body.category === "food_drinks"
      ? // Their cuisines (one search for all of them), then their words or
        // a card's phrase ("small local favourite"), else what's popular.
        tasteTypes.length > 0
        ? [nearby(limit, tasteTypes), first ? text(first, limit) : nearby(limit)]
        : [nearby(limit), ...(first ? [text(first, limit)] : [])]
      : [text(first ?? "things to do", limit), ...(second ? [text(second, limit)] : [])];
  const settled = await Promise.allSettled(searches);
  if (settled.every((r) => r.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;
  const seen = new Map<string, Place>();
  const addAll = (list: Place[]) => list.forEach((p) => seen.has(p.id) || seen.set(p.id, p));
  settled.forEach((r) => r.status === "fulfilled" && addAll(r.value));

  const filter = () => {
    Object.assign(ctx.drops, emptyDrops());
    return applyHardFilters([...seen.values()], { taste, category: body.category, when: body.when, origin, exclude: ctx.exclude, city }, ctx.drops);
  };
  let passed = filter();
  if (passed.filter((c) => !c.far).length < ctx.need && limit < 15) {
    const wider = await (body.category === "food_drinks" ? nearby(limit * 2) : text(first ?? "things to do", limit * 2)).catch(() => [] as Place[]);
    addAll(wider);
    passed = filter();
  }
  const near = passed.filter((c) => !c.far);
  return (near.length >= ctx.need ? near : passed).slice(0, 24);
}

// When Gemini's reason is missing or leans on something they turned down: a
// plain reason that fits this place (its cuisine, or what kind of place it
// is), never a side that has nothing to do with it.
const CUISINE_TYPES: Record<string, RegExp> = {
  italian: /italian|pizza/, japanese: /japanese|sushi|ramen/, korean: /korean/, thai: /thai/, mexican: /mexican/,
  middle_eastern: /middle_eastern|lebanese|turkish|mediterranean/, indian: /indian/, south_indian: /indian/, north_indian: /indian/,
  bakery: /bakery|dessert|cafe/, healthy: /vegan|vegetarian|salad/,
};
const KIND_SIDES: Record<string, string[]> = { DRINK: ["buzzing", "buzzing_sober", "quiet_cafe"], EAT: ["hole_in_wall", "dressed_up", "quiet_cafe"] };

function fallbackBecause(taste: Taste, place?: Place, kind?: string) {
  const type = place?.primaryType ?? "";
  const cuisine = taste.yes.find((y) => y.startsWith("cuisine_") && CUISINE_TYPES[y.slice(8)]?.test(type));
  if (cuisine) return `Because ${sideById(cuisine, taste.answers)?.label ?? "it"} is one of your favourites.`;
  const side = taste.yes.find((y) => KIND_SIDES[kind ?? ""]?.includes(y) && (!place || reasonFits(sideById(y, taste.answers)?.label ?? "", { ...taste, no: [] }, place)));
  const label = side ? sideById(side, taste.answers)?.label : null;
  if (label) return `Because you picked ${label.replace(/^[A-Za-z ]+: /, "").replace(/^A /, "a ")}.`;
  return "Because it fits what you told me.";
}

// Shows a saved set again with live Google details, dropping anything that
// no longer passes the hard filters (say, it has closed for the night).
async function showStored(
  stored: StoredPick[],
  banner: string | null,
  ctx: {
    taste: Taste;
    body: Body;
    city: City;
    origin: { lat: number; lng: number };
    exclude: Set<string>;
    needsDiet: boolean;
  },
): Promise<{ picks: Pick[]; stored: StoredPick[]; reply: Reply }> {
  const today = cityCalendar(ctx.city.timeZone).today;
  const eventStored = stored.filter((s): s is StoredPick & { event: EventInfo } => !!s.event);
  const placeStored = stored.filter((s) => !s.event);
  // Events stay while their date is still ahead and they weren't skipped.
  const eventPicksShown = await Promise.all(
    eventStored
      .filter((s) => !ctx.exclude.has(s.placeId) && eventStillOn(s.event, ctx.body.when, ctx.city))
      .map(async (s) => {
        const venue = s.event.venuePlaceId ? await placeDetails(s.event.venuePlaceId, false, true) : null;
        return buildEventPick(s, { taste: ctx.taste, city: ctx.city, today, venue });
      }),
  );
  const live = await Promise.all(placeStored.map((s) => placeDetails(s.placeId, ctx.needsDiet)));
  const places = live.filter((p): p is Place => !!p);
  const passed = applyHardFilters(places, { taste: ctx.taste, category: ctx.body.category, when: ctx.body.when, origin: ctx.origin, exclude: ctx.exclude, city: ctx.city });
  const byId = new Map<string, Candidate>(passed.map((c) => [c.place.id, c]));
  const placePicks = await Promise.all(
    placeStored
      .filter((s) => byId.has(s.placeId))
      .map((s) => buildPick(byId.get(s.placeId)!, s, { taste: ctx.taste, when: ctx.body.when, city: ctx.city })),
  );
  const picks = [...eventPicksShown, ...placePicks];
  const keptIds = new Set(picks.map((p) => p.placeId));
  return {
    picks,
    stored: stored.filter((s) => keptIds.has(s.placeId)),
    reply: { picks, ...(banner && placePicks.some((p) => p.distanceKm > distanceLimitKm(ctx.taste.answers)) ? { banner } : {}) },
  };
}

function eventStillOn(e: EventInfo, when: When, city: City) {
  return eventPasses({ ...e, minPrice: null, because: "", verdict: "Good if you're nearby" }, { when, timeZone: city.timeZone, maxSpend: null, unknownPriceOk: true });
}

type EventPick = { stored: StoredPick & { event: EventInfo }; venue: Place | null };

// This week's events near you that pass the hard filters (date, budget,
// distance via the venue on Google Maps). At most 2 per set.
async function eventPicks(ctx: {
  db: SupabaseClient;
  taste: Taste;
  body: Body;
  city: City;
  origin: { lat: number; lng: number };
  exclude: Set<string>;
}): Promise<EventPick[]> {
  const { db, taste, body, city, origin } = ctx;
  const limit = distanceLimitKm(taste.answers);
  const near = nearName(city, body.origin);

  // This area's events are shared by everyone for a few hours, so only the
  // first person waits for the web search.
  const cal = cityCalendar(city.timeZone);
  const cacheKey = [city.id, near, body.when, body.when === "tonight" ? cal.today : cal.weekend.join("+")].join("|");
  const { data: cached } = await db.from("events_cache").select("events, search_html").eq("key", cacheKey).maybeSingle();
  let events: FoundEvent[];
  let searchHtml: string;
  if (cached) {
    events = cached.events as FoundEvent[];
    searchHtml = cached.search_html;
  } else {
    ({ events, searchHtml } = await findEvents({ city, near, when: body.when, distanceKm: limit }));
    if (searchHtml && events.length > 0) {
      const hours = body.when === "tonight" ? 3 : 12;
      await db.from("events_cache").upsert({
        key: cacheKey,
        events,
        search_html: searchHtml,
        expires_at: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
      });
    }
  }
  if (!searchHtml) return []; // Google's chip must be shown; without it, no events.

  const rules = { when: body.when, timeZone: city.timeZone, maxSpend: spendUpperBound(taste.answers, city), unknownPriceOk: unknownPriceOk(taste.answers) };
  // Each venue is looked up on Google Maps (about ₹3), and at most 2 events
  // are shown, so only the first 4 that pass are checked.
  const fresh = events.filter((e) => eventPasses(e, rules) && !ctx.exclude.has(`event:${e.url}`)).slice(0, 4);
  const withVenues = (await Promise.all(fresh.map(async (e) => ({ e, venue: await findVenue(e, city, origin) })))).filter(
    ({ venue }) => venue && venue.km <= Math.max(limit * 2, 8),
  );
  // Which of these suit this person, and why (no search, about 2 s).
  const chosen = await personalizeEvents(withVenues.map((w) => w.e), tasteSummary(taste, city), body.when).catch(() => []);
  return chosen
    .map((c) => ({ ...withVenues[c.index], c }))
    .map(({ e, venue, c }) => ({
      venue: venue!.place,
      stored: {
        placeId: `event:${e.url}`,
        kind: "EVENT" as const,
        verdict: c.verdict && ["Worth a detour", "Good if you're nearby", "Skip unless"].includes(c.verdict) ? c.verdict : "Good if you're nearby",
        ...(c.verdict === "Skip unless" && c.skipUnless ? { skipUnless: c.skipUnless } : {}),
        because: c.because?.startsWith("Because you") && reasonFits(c.because, taste) ? c.because : fallbackBecause(taste),
        event: {
          title: e.title,
          venueName: e.venueName,
          date: e.date,
          time: e.time ?? "",
          priceText: e.priceText ?? "",
          url: e.url,
          site: siteName(e.url),
          searchHtml,
          venuePlaceId: venue!.place.id,
          distanceKm: Math.round(venue!.km * 10) / 10,
        },
      },
    }));
}

// The area name sent to the event search: the typed area, or the city.
// Coordinates are never sent.
function nearName(city: City, o: Body["origin"]) {
  return o.source === "area" ? `${o.label.slice(0, 60)}, ${city.name}` : city.name;
}

// The founder's places in this city for this category. Ones already found
// by the search cost nothing; at most FETA_LOOKUPS others (chosen at random,
// so each gets a turn) are checked live against the person's hard filters.
// Only place IDs and her notes are stored.
const FETA_LOOKUPS = 1;

async function fetaCandidates(ctx: {
  db: SupabaseClient;
  taste: Taste;
  body: Body;
  city: City;
  origin: { lat: number; lng: number };
  exclude: Set<string>;
  needsDiet: boolean;
  pool: Candidate[];
}): Promise<Candidate[]> {
  const kinds = ctx.body.category === "food_drinks" ? ["EAT", "DRINK"] : ["DO"];
  const { data, error } = await ctx.db
    .from("founder_places")
    .select("place_id, note")
    .eq("city_id", ctx.city.id)
    .eq("active", true)
    .in("kind", kinds)
    .limit(500);
  if (error || !data?.length) return [];
  const notes = new Map(data.map((f) => [f.place_id as string, f.note as string]));
  const found = ctx.pool.filter((c) => notes.has(c.place.id)).map((c) => ({ ...c, fetaNote: notes.get(c.place.id) }));
  const others = data
    .map((f) => f.place_id as string)
    .filter((id) => !ctx.exclude.has(id) && !found.some((c) => c.place.id === id))
    .sort(() => Math.random() - 0.5)
    .slice(0, FETA_LOOKUPS);
  const places = (await Promise.all(others.map((id) => placeDetails(id, ctx.needsDiet)))).filter((p): p is Place => !!p);
  const passed = applyHardFilters(places, {
    taste: ctx.taste,
    category: ctx.body.category,
    when: ctx.body.when,
    origin: ctx.origin,
    exclude: ctx.exclude,
    city: ctx.city,
  });
  return [...found, ...passed.filter((c) => !c.far).map((c) => ({ ...c, fetaNote: notes.get(c.place.id) }))];
}
