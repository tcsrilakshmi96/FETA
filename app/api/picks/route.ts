import { createClient } from "@supabase/supabase-js";
import { CITIES } from "@/lib/cities";
import { EMPTY_ANSWERS, type Answers } from "@/lib/onboarding";
import { placeDetails, photoUri, searchNearby, searchPlaces, type Place } from "@/lib/server/places";
import {
  applyHardFilters,
  FOOD_DRINK_TYPES,
  emptyDrops,
  whyNothing,
  buildPick,
  chooseWithGemini,
  distanceLimitKm,
  kindOf,
  needsDietCheck,
  searchPhrases,
  takeThree,
  type Candidate,
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
  origin: { lat: number; lng: number; label: string; source: "gps" | "area" | "city"; cityId: string };
  more?: boolean; // "Show me 3 more"
};

type Reply = { picks: Pick[]; banner?: string; notice?: string };

function json(body: Reply | { error: string }, status = 200) {
  return Response.json(body, { status });
}

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return json({ error: "Not signed in" }, 401);

  const body = (await request.json()) as Body;
  const city = CITIES.find((c) => c.id === body.origin?.cityId && c.covered);
  if (!city || !["food_drinks", "experiences"].includes(body.category) || !["tonight", "weekend"].includes(body.when)) {
    return json({ error: "Bad request" }, 400);
  }

  // Acts as the user, so row-level security applies to every query below.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await db.auth.getUser(token);
  const userId = auth.user?.id;
  if (!userId) return json({ error: "Not signed in" }, 401);

  const [answersRes, linesRes, swipesRes, actionsRes] = await Promise.all([
    db.from("answers").select("*").maybeSingle(),
    db.from("profile_lines").select("text").is("removed_at", null).is("trip", null),
    db.from("swipes").select("card_id, verdict"),
    db.from("pick_actions").select("place_id"),
  ]);
  const a = answersRes.data;
  const answers: Answers = a
    ? {
        diet: a.diet,
        halal: a.halal,
        distance: a.distance,
        spend: a.spend,
        spendCurrency: a.spend_currency,
        who: a.who ?? [],
        drinks: a.drinks,
        interests: a.interests ?? [],
      }
    : EMPTY_ANSWERS;
  const swipes = swipesRes.data ?? [];
  const taste: Taste = {
    answers,
    lines: (linesRes.data ?? []).map((l) => l.text),
    yes: swipes.filter((s) => s.verdict === "yes").map((s) => s.card_id),
    no: swipes.filter((s) => s.verdict === "no").map((s) => s.card_id),
  };
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

  // 1. Reuse recent picks: re-check each place live, show what still passes.
  if (latest && !body.more && new Date(latest.expires_at) > new Date()) {
    const reply = await showStored(latest.picks as StoredPick[], latest.banner, { taste, body, city, origin, exclude, needsDiet });
    if (reply.picks.length > 0) return json(reply);
  }

  // 2. Daily cost limits.
  const { data: counts } = await db.rpc("pick_searches_today").single<{ everyone: number; mine: number }>();
  if (counts && (counts.everyone >= DAILY_LIMIT || counts.mine >= USER_DAILY_LIMIT)) {
    if (latest) {
      const reply = await showStored(latest.picks as StoredPick[], latest.banner, { taste, body, city, origin, exclude, needsDiet });
      if (reply.picks.length > 0) return json({ ...reply, notice: "That's all the new searching for today, so here are your latest picks." });
    }
    return json({ picks: [], notice: "Feta has done all its searching for today. Fresh picks tomorrow morning." });
  }

  // 3. New search. "Show me 3 more" skips anything shown in the last day.
  if (body.more) {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    for (const set of recent ?? []) {
      if (new Date(set.created_at).getTime() > dayAgo) for (const p of set.picks as StoredPick[]) exclude.add(p.placeId);
    }
  }
  const phrases = searchPhrases(body.category, taste);
  const todaysSets = (recent ?? []).filter((s) => new Date(s.created_at).toDateString() === new Date().toDateString()).length;
  const phrase = phrases[todaysSets % phrases.length];

  // Food & drinks: everything near you, alternating most popular and
  // closest. Experiences: a search phrase from your interests and swipes.
  let places: Place[];
  try {
    places =
      body.category === "food_drinks"
        ? await searchNearby({
            types: FOOD_DRINK_TYPES,
            lat: origin.lat,
            lng: origin.lng,
            radiusKm: distanceLimitKm(answers),
            rank: todaysSets % 2 === 0 ? "POPULARITY" : "DISTANCE",
            needsDiet,
            regionCode: city.country,
          })
        : await searchPlaces({
            query: phrase,
            lat: origin.lat,
            lng: origin.lng,
            radiusKm: distanceLimitKm(answers),
            openNow: body.when === "tonight",
            needsDiet,
            regionCode: city.country,
          });
  } catch (error) {
    console.error(error);
    return json({ picks: [], notice: "Couldn't reach Google Maps just now. Try again in a minute." }, 502);
  }

  const drops = emptyDrops();
  const passed = applyHardFilters(places, { taste, category: body.category, when: body.when, origin, exclude, city }, drops);
  const near = passed.filter((c) => !c.far);
  const pool = (near.length >= 3 ? near : passed).slice(0, 15);
  if (pool.length === 0) {
    console.log("No picks", { category: body.category, when: body.when, phrase, drops });
    return json({ picks: [], notice: whyNothing(drops, answers, body.when) });
  }

  let ranked: Awaited<ReturnType<typeof chooseWithGemini>> = [];
  try {
    ranked = await chooseWithGemini({ candidates: pool, taste, city, category: body.category, when: body.when });
  } catch (error) {
    console.error(error);
  }
  const chosen = takeThree(ranked, pool);
  if (chosen.length === 0) return json({ picks: [], notice: "Couldn't choose picks just now. Try again in a minute." }, 502);

  const stored: StoredPick[] = chosen.map(({ candidate, ranked: r }) => ({
    placeId: candidate.place.id,
    kind: kindOf(candidate.place, body.category),
    verdict: r?.verdict ?? "Good if you're nearby",
    ...(r?.verdict === "Skip unless" && r.skipUnless ? { skipUnless: r.skipUnless } : {}),
    because: r?.because ?? fallbackBecause(taste),
  }));
  const farCount = chosen.filter((c) => c.candidate.far).length;
  const banner = farCount > 0
    ? `Nothing great right around you ${body.when === "tonight" ? "tonight" : "this weekend"}. ${farCount === 1 ? "Here's 1" : `Here are ${farCount}`} worth a short ride.`
    : null;

  await db.from("pick_sets").insert({
    user_id: userId,
    category: body.category,
    when_slot: body.when,
    origin_key: originKey,
    city_id: city.id,
    country: city.country,
    time_zone: city.timeZone,
    currency: city.currency,
    picks: stored,
    banner,
    expires_at: new Date(Date.now() + REUSE_HOURS[body.when] * 3600 * 1000).toISOString(),
  });

  try {
    const picks = await Promise.all(
      chosen.map(async ({ candidate }, i) =>
        buildPick(candidate, stored[i], { taste, when: body.when, city, photo: await firstPhoto(candidate.place) }),
      ),
    );
    return json({ picks, ...(banner ? { banner } : {}) });
  } catch (error) {
    console.error(error);
    return json({ picks: [], notice: "Something went wrong showing your picks. Try again in a minute." }, 500);
  }
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
): Promise<Reply> {
  const live = await Promise.all(stored.map((s) => placeDetails(s.placeId, ctx.needsDiet)));
  const places = live.filter((p): p is Place => !!p);
  const passed = applyHardFilters(places, { taste: ctx.taste, category: ctx.body.category, when: ctx.body.when, origin: ctx.origin, exclude: ctx.exclude, city: ctx.city });
  const byId = new Map<string, Candidate>(passed.map((c) => [c.place.id, c]));
  const picks = await Promise.all(
    stored
      .filter((s) => byId.has(s.placeId))
      .map(async (s) => {
        const c = byId.get(s.placeId)!;
        return buildPick(c, s, { taste: ctx.taste, when: ctx.body.when, city: ctx.city, photo: await firstPhoto(c.place) });
      }),
  );
  return { picks, ...(banner && picks.some((p) => p.distanceKm > distanceLimitKm(ctx.taste.answers)) ? { banner } : {}) };
}
