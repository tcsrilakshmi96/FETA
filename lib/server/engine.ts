import "server-only";

import { CITIES, distanceKm, type City } from "@/lib/cities";
import type { Currency } from "@/lib/currency";
import { loadTaste, userDb, userIdFor } from "@/lib/server/taste";
import { placeDetails, photoUri, searchNearby, searchPlaces, type Place } from "@/lib/server/places";
import { cityCalendar, eventPasses, findEvents, findVenue, siteName } from "@/lib/server/events";
import {
  applyHardFilters,
  FOOD_DRINK_TYPES,
  emptyDrops,
  whyNothing,
  buildEventPick,
  buildPick,
  chooseWithGemini,
  distanceLimitKm,
  kindOf,
  needsDietCheck,
  searchPhrases,
  spendUpperBound,
  tasteSummary,
  unknownPriceOk,
  takeThree,
  applyTweaks,
  foodPhrases,
  TWEAKS,
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
import { swipeCards } from "@/lib/swipes";

// Cost guards (founder can change these in Vercel without a code change).
const DAILY_LIMIT = Number(process.env.PICKS_DAILY_LIMIT ?? 30);
const USER_DAILY_LIMIT = Number(process.env.PICKS_USER_DAILY_LIMIT ?? 6);
const REUSE_HOURS: Record<When, number> = { tonight: 3, weekend: 12 };

type Body = {
  category: Category;
  when: When;
  origin: {
    lat: number;
    lng: number;
    label: string;
    source: "gps" | "area" | "city";
    cityId: string;
    // A trip destination outside the covered cities, from Ask Feta.
    place?: { name: string; country: string; currency: string; timeZone: string };
  };
  trip?: string; // trip-only profile lines for this trip count too
  more?: boolean; // "Show me 3 more"
  tweaks?: string[]; // from the Tweak sheet
  note?: string; // free text from the Tweak sheet
};

type Reply = { picks: Pick[]; banner?: string; notice?: string };

function json(body: Reply | { error: string }, status = 200) {
  return Response.json(body, { status });
}

// The picks engine, shared by Picks (/api/picks) and Ask Feta (/api/ask).
// Returns a Response so callers can pass it straight on or read it.
export async function runPicks(token: string | undefined, input: unknown): Promise<Response> {
  if (!token) return json({ error: "Not signed in" }, 401);
  const body = input as Body;
  const city = resolveCity(body.origin);
  if (!city || !["food_drinks", "experiences"].includes(body.category) || !["tonight", "weekend"].includes(body.when)) {
    return json({ error: "Bad request" }, 400);
  }

  const db = userDb(token);
  const userId = await userIdFor(db, token);
  if (!userId) return json({ error: "Not signed in" }, 401);

  const [taste, actionsRes] = await Promise.all([loadTaste(db, body.trip), db.from("pick_actions").select("place_id")]);
  const answers = taste.answers;
  const exclude = new Set((actionsRes.data ?? []).map((r) => r.place_id as string));
  const originKey = body.origin.source === "gps" ? "gps" : body.origin.label;
  const origin = { lat: body.origin.lat, lng: body.origin.lng };
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

  // 1. Reuse recent picks: re-check each place live. If some have closed,
  //    top them up to 3 with a fresh search below.
  let kept: { stored: StoredPick[]; picks: Pick[] } = { stored: [], picks: [] };
  let keptBanner: string | null = null;
  if (latest && !body.more && !tweaked && new Date(latest.expires_at) > new Date()) {
    const shown = await showStored(latest.picks as StoredPick[], latest.banner, { taste, body, city, origin, exclude, needsDiet });
    if (shown.picks.length >= 3) return json(shown.reply);
    kept = shown;
    keptBanner = latest.banner;
  }

  // 2. Daily cost limits.
  const { data: counts } = await db.rpc("pick_searches_today").single<{ everyone: number; mine: number }>();
  if (counts && (counts.everyone >= DAILY_LIMIT || counts.mine >= USER_DAILY_LIMIT)) {
    if (kept.picks.length > 0) return json({ picks: kept.picks, notice: "That's all the new searching for today, so here are your latest picks." });
    if (latest) {
      const shown = await showStored(latest.picks as StoredPick[], latest.banner, { taste, body, city, origin, exclude, needsDiet });
      if (shown.picks.length > 0) return json({ ...shown.reply, notice: "That's all the new searching for today, so here are your latest picks." });
    }
    return json({ picks: [], notice: "Feta has done all its searching for today. Fresh picks tomorrow morning." });
  }

  // 3. New search. "Show me 3 more" and tweaks skip anything shown in the
  //    last day; topping up skips what is already kept.
  if (body.more || tweaked) {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    for (const set of recent ?? []) {
      if (new Date(set.created_at).getTime() > dayAgo) for (const p of set.picks as StoredPick[]) exclude.add(p.placeId);
    }
  }
  for (const k of kept.stored) exclude.add(k.placeId);
  const need = 3 - kept.picks.length;
  const todaysSets = (recent ?? []).filter((s) => new Date(s.created_at).toDateString() === new Date().toDateString()).length;

  // Experiences also look for this week's events, at the same time.
  const eventsSearch =
    body.category === "experiences" && need > 1 && !body.trip && !body.origin.place
      ? eventPicks({ taste: effective, body, city, origin, exclude }).catch((error) => {
          console.error(error);
          return [] as EventPick[];
        })
      : Promise.resolve([] as EventPick[]);

  const drops = emptyDrops();
  let pool: Candidate[];
  try {
    pool = await gatherCandidates({ taste: effective, tweaks, body, city, origin, exclude, needsDiet, need, rotation: todaysSets, drops });
  } catch (error) {
    console.error(error);
    if (body.category === "food_drinks" && kept.picks.length === 0) {
      return json({ picks: [], notice: "Couldn't reach Google Maps just now. Try again in a minute." }, 502);
    }
    pool = [];
  }

  // Rank places while the event search is still running.
  const ranking =
    pool.length > 0
      ? chooseWithGemini({ candidates: pool, taste: effective, city, category: body.category, when: body.when, tweaks, note }).catch((error) => {
          console.error(error);
          return [] as Awaited<ReturnType<typeof chooseWithGemini>>;
        })
      : Promise.resolve([] as Awaited<ReturnType<typeof chooseWithGemini>>);
  const [allEvents, ranked] = await Promise.all([eventsSearch, ranking]);
  const events = allEvents.slice(0, Math.min(2, need));
  if (pool.length === 0 && events.length === 0) {
    if (kept.picks.length > 0) return json({ picks: kept.picks, ...(keptBanner ? { banner: keptBanner } : {}) });
    console.log("No picks", { category: body.category, when: body.when, drops });
    return json({ picks: [], notice: whyNothing(drops, effective.answers, body.when) });
  }

  // Up to 2 events first, then places to make 3.
  const chosen = takeThree(ranked, pool, need - events.length);
  const placeStored: StoredPick[] = chosen.map(({ candidate, ranked: r }) => ({
    placeId: candidate.place.id,
    kind: kindOf(candidate.place, body.category),
    verdict: r?.verdict ?? "Good if you're nearby",
    ...(r?.verdict === "Skip unless" && r.skipUnless ? { skipUnless: r.skipUnless } : {}),
    because: r?.because ?? fallbackBecause(taste),
  }));
  const stored: StoredPick[] = [...kept.stored, ...events.map((e) => e.stored), ...placeStored];
  const farCount = chosen.filter((c) => c.candidate.far).length;
  const banner = farCount > 0
    ? `Nothing great right around you ${body.when === "tonight" ? "tonight" : "this weekend"}. ${farCount === 1 ? "Here's 1" : `Here are ${farCount}`} worth a short ride.`
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
    const fresh = await Promise.all([
      ...events.map(async (e) => buildEventPick(e.stored, { taste, city, today, venue: e.venue, photo: e.venue ? await firstPhoto(e.venue) : null })),
      ...chosen.map(async ({ candidate }, i) =>
        buildPick(candidate, placeStored[i], { taste, when: body.when, city, photo: await firstPhoto(candidate.place) }),
      ),
    ]);
    return json({ picks: [...kept.picks, ...fresh], ...(banner ? { banner } : {}) });
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
    searchPlaces({ ...common, query, radiusKm, openNow: body.when === "tonight" });
  const nearby = (radiusKm: number) => searchNearby({ ...common, types: FOOD_DRINK_TYPES, radiusKm, rank: "POPULARITY" });

  // What they asked for in their own words (Tweak sheet or Ask Feta) leads.
  const asked = (ctx.body.note ?? "").trim();
  const base = body.category === "food_drinks" ? foodPhrases(taste, ctx.tweaks) : searchPhrases(body.category, taste, ctx.tweaks);
  const phrases = asked ? [asked, ...base.filter((p) => p !== asked)] : base;
  const pick = (i: number) => (asked && i === 0 ? asked : phrases.length ? phrases[(ctx.rotation + i) % phrases.length] : null);
  const first = pick(0);
  const second = phrases.length > 1 ? pick(1) : null;
  const searches: Promise<Place[]>[] =
    body.category === "food_drinks"
      ? [nearby(limit), ...(first ? [text(first, limit)] : [])]
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
  return (near.length >= ctx.need ? near : passed).slice(0, 15);
}

async function firstPhoto(place: Place) {
  const name = place.photos?.[0]?.name;
  return name ? photoUri(name) : null;
}

function fallbackBecause(taste: Taste) {
  const card = swipeCards(taste.answers).find((c) => taste.yes.includes(c.id));
  return card ? `Because you said yes to ${card.label.toLowerCase()}.` : "Because it fits what you told me.";
}

// Shows a saved set again with live Google details, dropping anything that
// no longer passes the hard filters (say, it has closed for the night).
async function showStored(
  stored: StoredPick[],
  banner: string | null,
  ctx: {
    taste: Taste;
    body: Body;
    city: (typeof CITIES)[number];
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
        return buildEventPick(s, { taste: ctx.taste, city: ctx.city, today, venue, photo: venue ? await firstPhoto(venue) : null });
      }),
  );
  const live = await Promise.all(placeStored.map((s) => placeDetails(s.placeId, ctx.needsDiet)));
  const places = live.filter((p): p is Place => !!p);
  const passed = applyHardFilters(places, { taste: ctx.taste, category: ctx.body.category, when: ctx.body.when, origin: ctx.origin, exclude: ctx.exclude, city: ctx.city });
  const byId = new Map<string, Candidate>(passed.map((c) => [c.place.id, c]));
  const placePicks = await Promise.all(
    placeStored
      .filter((s) => byId.has(s.placeId))
      .map(async (s) => {
        const c = byId.get(s.placeId)!;
        return buildPick(c, s, { taste: ctx.taste, when: ctx.body.when, city: ctx.city, photo: await firstPhoto(c.place) });
      }),
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
  taste: Taste;
  body: Body;
  city: City;
  origin: { lat: number; lng: number };
  exclude: Set<string>;
}): Promise<EventPick[]> {
  const { taste, body, city, origin } = ctx;
  const limit = distanceLimitKm(taste.answers);
  const { events, searchHtml } = await findEvents({
    city,
    near: nearName(city, body.origin),
    when: body.when,
    tasteSummary: tasteSummary(taste, city),
    distanceKm: limit,
  });
  if (!searchHtml) return []; // Google's chip must be shown; without it, no events.
  const rules = { when: body.when, timeZone: city.timeZone, maxSpend: spendUpperBound(taste.answers, city), unknownPriceOk: unknownPriceOk(taste.answers) };
  const fresh = events.filter((e) => eventPasses(e, rules) && !ctx.exclude.has(`event:${e.url}`)).slice(0, 4);
  const withVenues = await Promise.all(fresh.map(async (e) => ({ e, venue: await findVenue(e, city, origin) })));
  return withVenues
    .filter(({ venue }) => venue && venue.km <= Math.max(limit * 2, 8))
    .slice(0, 2)
    .map(({ e, venue }) => ({
      venue: venue!.place,
      stored: {
        placeId: `event:${e.url}`,
        kind: "EVENT" as const,
        verdict: ["Worth a detour", "Good if you're nearby", "Skip unless"].includes(e.verdict) ? e.verdict : "Good if you're nearby",
        ...(e.verdict === "Skip unless" && e.skipUnless ? { skipUnless: e.skipUnless } : {}),
        because: e.because?.startsWith("Because you") ? e.because : fallbackBecause(taste),
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

// The area name sent to the event search: the chosen area, or the nearest
// listed neighbourhood. Coordinates are never sent.
function nearName(city: City, o: Body["origin"]) {
  if (o.source === "area") return `${o.label}, ${city.name}`;
  const nearest = (city.areas ?? [])
    .map((a) => ({ a, km: distanceKm(o, a) }))
    .sort((x, y) => x.km - y.km)[0];
  return nearest && nearest.km <= 4 ? `${nearest.a.name}, ${city.name}` : city.name;
}

// A covered city, or (for trips planned in Ask Feta) a destination anywhere,
// described by the caller and checked here.
const CURRENCIES: Currency[] = ["INR", "USD", "CAD", "GBP", "EUR", "AED", "SGD", "AUD", "JPY"];

function resolveCity(o: Body["origin"] | undefined): City | null {
  if (!o) return null;
  const covered = CITIES.find((c) => c.id === o.cityId && c.covered);
  if (covered) return covered;
  if (!o.cityId?.startsWith("trip:") || !o.place || !Number.isFinite(o.lat) || !Number.isFinite(o.lng)) return null;
  const currency = CURRENCIES.includes(o.place.currency as Currency) ? (o.place.currency as Currency) : "USD";
  let timeZone = "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: o.place.timeZone });
    timeZone = o.place.timeZone;
  } catch {
    // Unknown zone: closing times are shown without a local clock.
  }
  return {
    id: o.cityId.slice(0, 80),
    name: o.place.name.slice(0, 60),
    region: "",
    country: o.place.country.slice(0, 2).toUpperCase(),
    timeZone,
    currency,
    lat: o.lat,
    lng: o.lng,
    covered: true,
  };
}
