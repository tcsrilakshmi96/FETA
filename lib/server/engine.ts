import "server-only";
import { after } from "next/server";

import { isMainlandChina, type City } from "@/lib/cities";
import { cityById, isSmallCity } from "@/lib/server/cities";
import { budgetToday, later, limitNoticeHere, saveEventsCache } from "@/lib/server/costs";
import { loadTaste, tasteFingerprint, userDb, userIdFor } from "@/lib/server/taste";
import { placeDetails, type Place } from "@/lib/server/places";
import { becauseFor, curate, eventsFirst, pickFrom, type Curated, type CurateResult } from "@/lib/server/curate";
import { allIntents, intentWords, plainText, type Intent } from "@/lib/server/intents";
import { learnedKey, readTaste } from "@/lib/server/taste-reader";
import { founderPlacesNear } from "@/lib/server/feta-places";
import { featuredFor } from "@/lib/server/featured";
import { guideEventsFor } from "@/lib/server/guide-events";
import { feedEvents } from "@/lib/server/event-feeds";
import { cityCalendar, eventLinkLands, eventPasses, findEvents, findVenue, personalizeEvents, siteName, type EventSpan, type FoundEvent } from "@/lib/server/events";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listFit, listServes } from "@/lib/server/list-tags";
import {
  applyHardFilters,
  whyNothing,
  buildEventPick,
  compromiseFor,
  buildPick,
  distanceLimitKm,
  TRIP_OUT_KM,
  kindOf,
  needsDietCheck,
  spendUpperBound,
  tasteSummary,
  SHOW,
  applyTweaks,
  TWEAKS,
  popularCap,
  mainlyOf,
  type Candidate,
  type Tweak,
  type EventInfo,
  type Category,
  type Kind,
  type Pick,
  type StoredPick,
  type Taste,
  type When,
  type At,
} from "@/lib/server/picks";

const REUSE_HOURS: Record<When, number> = { tonight: 3, weekend: 12 };
// How long places wait for what's on. Things to do are led by events now
// (founder, 19 Nov 2026), so the first search of the day waits for them
// (one web search, about 11 s, then the venues); testers found 20 s too slow.
const EVENTS_WAIT_MS = 15000;
const EVENT_SEARCHES = 2;

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
  dayPlan?: boolean; // a day out or a trip city (plan-days.ts): sights and meals through the day
  more?: boolean; // "Show me more", once the backup places run out
  shown?: string[]; // with more: what the phone has already shown from this list
  eventsOnly?: boolean; // the phone's second ask for events found after the reply
  tweaks?: string[]; // from the Tweak sheet
  note?: string; // free text from the Tweak sheet
  // Ask Feta (founder, 18 Nov 2026: "it has to work like an AI assistant"):
  // a day and time ("tomorrow at 7 am", for 3 hours) checked instead of
  // tonight or the weekend, and how far they'll go for this one ask.
  at?: { day: string; start: number; minutes: number };
  // How far for this one ask: "walk" (near a chosen dinner, Plan my
  // evening) or "day_trip" (a hike from chat), instead of their usual distance.
  reach?: "walk" | "day_trip";
  searches?: number; // Google searches this set may run (Plan my evening runs 2)
  only?: "asked"; // just places that match the note (chat, Plan my evening), no everyday filler or events
  // A meal they'll eat there (a date night's dinner, from chat): searched
  // for, and only places mainly to eat count as what was asked (tester,
  // 23 Nov 2026: "dinner and craft beer" brought two breweries, no dinner).
  meal?: "breakfast" | "brunch" | "lunch" | "dinner";
  // From the Search screen (founder, 23 Nov 2026): just what they typed
  // (note), one Google search, events of that kind for things to do, and a
  // place named in it always shown first, saying any rule it breaks. Their
  // taste isn't read or changed: a search is for right now.
  search?: boolean;
};

const MEALS = ["breakfast", "brunch", "lunch", "dinner"] as const;

// spares: the next best places, kept on the phone for "Show me more".
// left: new searches left today, when 3 or fewer (the phone says so);
// limited: today's limit is reached.
// eventsComing: events were still being found when the list was sent; they
// join the stored set, and the phone asks again shortly.
type Reply = { picks: Pick[]; spares?: Pick[]; banner?: string; notice?: string; left?: number; limited?: boolean; eventsComing?: boolean };

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

  // A search keeps only what was typed, like a chat search.
  const only = body.only ?? (body.search && body.note?.trim() ? "asked" : undefined);
  const db = userDb(token);
  const userId = await userIdFor(db, token);
  if (!userId) return json({ error: "Not signed in" }, 401);

  const [taste, actionsRes] = await Promise.all([loadTaste(db, body.trip), db.from("pick_actions").select("place_id, action")]);
  const answers = taste.answers;
  const exclude = new Set((actionsRes.data ?? []).map((r) => r.place_id as string));
  // The founder's own places may come back even if they've been or saved
  // them (founder, 16 Nov 2026); only a skip keeps one away.
  const skipped = new Set((actionsRes.data ?? []).filter((r) => r.action === "skipped").map((r) => r.place_id as string));
  const keptOnly = new Set((actionsRes.data ?? []).filter((r) => r.action !== "skipped").map((r) => r.place_id as string));
  // Place IDs and rounded coordinates only: no Google text in the database.
  // The taste fingerprint means a changed taste (a new line, new answers)
  // searches that category again instead of showing the last picks; day
  // plans are kept apart from everyday picks.
  const keyFor = (category: Category) =>
    `${
      body.origin.source === "gps"
        ? `gps:${city.id}`
        : body.origin.source === "area"
          ? `area:${body.origin.areaId ?? `${body.origin.lat.toFixed(3)},${body.origin.lng.toFixed(3)}`}`
          : // A hotel or a town placed in its nearest city is its own place
            // (audit, 24 Nov 2026: day plans near the chosen hotel reused the
            // city centre's set).
            `city:${city.id}${body.dayPlan || Math.abs(body.origin.lat - city.lat) > 0.01 || Math.abs(body.origin.lng - city.lng) > 0.01 ? `@${body.origin.lat.toFixed(3)},${body.origin.lng.toFixed(3)}` : ""}`
    }|t:${tasteFingerprint(taste, category)}${body.dayPlan ? "|plan" : ""}`;
  const originKey = keyFor(body.category);
  const origin = { lat: body.origin.lat, lng: body.origin.lng };
  const small = isSmallCity(city.id);
  const needsDiet = body.category === "food_drinks" && needsDietCheck(answers);

  const { data: recent } = await db
    .from("pick_sets")
    .select("picks, banner, expires_at, origin_key, created_at, searched")
    .eq("category", body.category)
    .eq("when_slot", body.when)
    .order("created_at", { ascending: false })
    .limit(20);
  // A place in their Food & drinks list right now isn't repeated in Things
  // to do (tester, 23 Nov 2026: the same café in both lists); food owns it.
  if (body.category === "experiences" && !body.dayPlan && !only) {
    const { data: food } = await db
      .from("pick_sets")
      .select("picks")
      .eq("category", "food_drinks")
      .eq("when_slot", body.when)
      .eq("origin_key", keyFor("food_drinks"))
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    for (const p of (food?.[0]?.picks as StoredPick[] | undefined) ?? []) exclude.add(p.placeId);
  }

  // Tweaks ("Cheaper", "Closer"…) always search fresh and are kept apart.
  const tweaks = (body.tweaks ?? []).filter((t) => TWEAKS.includes(t as Tweak)) as Tweak[];
  const meal = body.category === "food_drinks" && MEALS.includes(body.meal as (typeof MEALS)[number]) ? body.meal! : null;
  const asked = (body.note ?? "").slice(0, 200).trim();
  const note = meal && !new RegExp(`\\b${meal}\\b`, "i").test(asked) ? `${meal}${asked ? `, ${asked}` : ""}` : asked;
  const tweaked = tweaks.length > 0 || note.length > 0;
  const at: At | undefined = body.at && /^\d{4}-\d{2}-\d{2}$/.test(body.at.day) ? { weekday: new Date(`${body.at.day}T12:00:00Z`).getUTCDay(), start: Math.min(1439, Math.max(0, Math.round(body.at.start) || 0)), minutes: Math.min(720, Math.max(30, Math.round(body.at.minutes) || 60)) } : undefined;
  const setKey = tweaked ? `${originKey}|${[...tweaks].sort().join(",")}|${note}${body.at ? `|${body.at.day}@${body.at.start}` : ""}${body.reach ? `|${body.reach}` : ""}` : originKey;
  // The same ask comes back the same, tweaked or typed too (audit, 24 Nov
  // 2026: the same Ask Feta search or a reloaded search paid again).
  const latest = (recent ?? []).find((s) => s.origin_key === setKey);
  // "Anywhere in Goa" or a trip destination means the whole place, not a
  // walk from its centre.
  // A trip's day plans cover the whole city: its famous sights are rarely
  // within an everyday distance of the hotel (traveller, 23 Nov 2026:
  // Lisbon's days had no Belém or castle).
  const wide = body.reach || body.origin.source === "city" || body.dayPlan ? { ...taste, answers: { ...taste.answers, distance: body.reach === "walk" ? "walk_2km" : (body.reach ?? "city") } } : taste;
  const effective = applyTweaks(wide, tweaks);

  // 1. Recent picks for the same place come back the same: the places and
  //    events shown last time, re-checked live against the hard filters, in
  //    the same order and with the same words. No new search, so it's quick,
  //    costs only the re-checks and isn't one of their searches for the day
  //    (testers, 21 Nov 2026: every Home visit searched again, about 20 s and
  //    ₹100). If most no longer pass (closed now), it searches afresh.
  const firstShown = (s: { picks: unknown }) => (s.picks as StoredPick[]).filter((p) => !p.spare);
  const live = latest && new Date(latest.expires_at) > new Date();
  const fresh = live && !body.more;
  const previous = fresh ? firstShown(latest) : [];
  // A search that found nothing that fits is kept too, so opening again
  // says so without paying for the same search (backend audit, 23 Nov 2026).
  if (fresh && (latest.picks as StoredPick[]).length === 0 && latest.banner) return json({ picks: [], notice: latest.banner });
  // The phone's second ask for events found after the reply: only the
  // events, so the places aren't paid for twice 20 s apart (audit, 24 Nov 2026).
  if (fresh && body.eventsOnly) {
    const events = previous.filter((p) => p.event);
    const shown = events.length ? await showStored(events, null, { taste: effective, body, city, origin, exclude, needsDiet }) : null;
    return json({ picks: shown?.picks ?? [] });
  }
  // "Show me more" on a kept list: its next backup places, checked live,
  // before any new search (audit, 24 Nov 2026: a reused list came without
  // them, so more paid for a new search, about ₹100 instead of about ₹14).
  if (live && body.more && !body.eventsOnly) {
    const seen = new Set(Array.isArray(body.shown) ? body.shown.filter((id) => typeof id === "string") : []);
    const next = (latest.picks as StoredPick[]).filter((p) => p.spare && !seen.has(p.placeId) && !exclude.has(p.placeId));
    if (next.length) {
      const more = await showStored(next.slice(0, SHOW).map((p) => ({ ...p, spare: false })), null, { taste: effective, body, city, origin, exclude, needsDiet });
      if (more.picks.length) return json({ picks: more.picks });
    }
  }
  let checked: Awaited<ReturnType<typeof showStored>> | null = null;
  if (previous.length) {
    checked = await showStored(previous, latest!.banner, { taste: effective, body, city, origin, exclude, needsDiet });
    if (checked.picks.length >= Math.min(4, previous.length)) return json(checked.reply);
  }

  // 2. Daily cost limits: searches, and today's estimated spend (costs.ts;
  //    the founder can change them in Vercel without a code change).
  const budget = await budgetToday(db);
  if (budget.left <= 0 || budget.over) {
    // The set just checked is shown as it is, never checked a second time
    // (audit, 24 Nov 2026: the same places were paid for twice).
    if (latest) {
      const shown = checked ?? (await showStored(firstShown(latest), latest.banner, { taste: effective, body, city, origin, exclude, needsDiet }));
      if (shown.picks.length > 0) return json({ ...shown.reply, notice: await limitNoticeHere("kept"), limited: true });
    }
    return json({ picks: [], notice: await limitNoticeHere("picks"), limited: true });
  }
  // This search uses one of them.
  const left = budget.left - 1 <= 3 ? { left: budget.left - 1 } : {};

  // 3. New search. "Show me more" and tweaks skip anything shown (or kept
  //    as backup) in the last day; topping up skips what is already kept.
  // (Not for day plans: asking again for the same days should find them again.)
  // (A search finds what was typed even if it was in today's lists.)
  if ((body.more || (tweaked && !body.search)) && !body.dayPlan) {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    for (const set of recent ?? []) {
      if (new Date(set.created_at).getTime() > dayAgo) for (const p of set.picks as StoredPick[]) exclude.add(p.placeId);
    }
  }
  const need = SHOW;
  // Today in the city, not the server's (audit, 24 Nov 2026: turns reset at UTC midnight).
  const cityDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: city.timeZone }).format(d);
  const todaysSets = (recent ?? []).filter((s) => cityDate(new Date(s.created_at)) === cityDate(new Date())).length;
  // The same search words as last time, so the same places come back.
  const rotation = previous.length ? Math.max(0, todaysSets - 1) : todaysSets;

  // What they've said and the places they love, read once for both the
  // events and the places.
  const extra = body.search ? [] : await describeLoved(effective, rotation, body.category)
    .then(() => readTaste(effective, city, body.category))
    .catch((error) => {
      console.error(error);
      return [] as Intent[];
    });
  // What it picked up from loved places shows in You, where ✕ stops it
  // (founder, 21 Nov 2026). A line removed before stays removed.
  const learned = extra.filter((i) => i.source === "loved").map((i) => ({ user_id: userId, line_key: learnedKey(body.category, i.label), text: i.label, source: "loved" }));
  if (learned.length)
    after(async () => {
      const { error } = await db.from("profile_lines").upsert(learned, { onConflict: "user_id,line_key", ignoreDuplicates: true });
      if (error) console.error("learned lines", error.message);
    });

  // Things to do look for what's on that they're into, at the same time as
  // places. Places don't wait more than a few seconds for them: a slow
  // first search keeps going after the reply and fills the shared events
  // cache, so the next search (or pull down) has them straight away.
  // A tweak an event can't be checked for (outdoors, quieter, with kids…)
  // leaves events out, so the top pick follows the tweaks like the list
  // (Round 6: Outdoors + Closer, and the top pick was an indoor café 8 km away).
  // A search looks for events of what they typed only.
  const eventKinds = allIntents(effective, { category: body.category, city, tweaks, note, rotation, extra, typed: body.search }).filter((i) => i.explicit && i.source !== "tweak" && (!body.search || i.id === "asked"));
  const eventsTweakable = tweaks.every((t) => t === "cheaper" || t === "closer");
  const eventsFull =
    body.category === "experiences" && need > 1 && !body.trip && (!only || body.search) && eventsTweakable
      ? eventPicks({ db, taste: effective, body, city, origin, exclude, intents: eventKinds, need, rotation }).catch((error) => {
          console.error(error);
          return [] as EventPick[];
        })
      : Promise.resolve([] as EventPick[]);
  later(eventsFull); // counted with this search even when it finishes after the reply
  let eventsDone = false;
  void eventsFull.then(() => (eventsDone = true));
  const eventsSearch = Promise.race([eventsFull, new Promise<EventPick[]>((resolve) => setTimeout(() => resolve([]), EVENTS_WAIT_MS))]);

  // Events shown last time stay while they're still on; new ones wait a
  // few seconds at most (see above).
  const prevEvents: EventPick[] = previous
    .filter((p): p is StoredPick & { event: EventInfo } => !!p.event && !exclude.has(p.placeId) && eventStillOn(p.event, body.when, city))
    .map((stored) => ({ stored, venue: null }));
  const allEventsPromise = eventsSearch;

  // Places: what they want, found, filtered, ranked, and the promise kept
  // (curate.ts). Events that fit first, then places to make 8; every other
  // place that passed is kept, in order, as backup.
  let found: CurateResult;
  try {
    found = await curate({
      taste: effective,
      city,
      origin,
      category: body.category,
      when: body.when,
      tweaks,
      note,
      exclude,
      needsDiet,
      need,
      rotation,
      // What the last day's sets searched, newest first, so a choice not
      // searched yet (just added in You) goes first.
      searchedBefore: (recent ?? []).filter((s) => new Date(s.created_at).getTime() > Date.now() - 24 * 3600 * 1000).map((s) => (s.searched as string[] | null) ?? []),
      extra,
      dayPlan: !!body.dayPlan,
      at,
      ...(body.searches ? { searches: Math.min(4, Math.max(1, body.searches)) } : body.search ? { searches: 1 } : {}),
      ...(body.search ? { search: true } : {}),
      favourites: (intents) =>
        fetaCandidates({ db, taste: effective, body, city, origin, exclude, founderExclude: new Set([...exclude].filter((id) => skipped.has(id) || !keptOnly.has(id))), needsDiet, intents: body.search ? intents.filter((i) => i.id === "asked") : intents }),
    });
  } catch (error) {
    console.error(error);
    if (body.category === "food_drinks") {
      // As an error, so the phone shows the failed-search screen, not an
      // empty list (audit, 24 Nov 2026).
      return json({ error: "Couldn't reach Google Maps just now. Try again in a minute." }, 502);
    }
    found = { pool: [], ranked: [], intents: [], drops: { seen: 0, far: 0, price: 0, diet: 0, alcohol: 0, hours: 0, other: 0 } };
  }
  // A meal is only served by a place mainly to eat (a brewery isn't dinner).
  if (meal) for (const c of found.pool) if (kindOf(c.place, body.category) !== "EAT") c.intents = (c.intents ?? []).filter((id) => id !== "asked");
  // Events that finished while the places were found are used, even after
  // the wait ran out (audit, 24 Nov 2026: they were dropped and, marked
  // done, never joined the set later either).
  const allEvents = eventsDone ? await eventsFull : await allEventsPromise;
  // At most KIND_MAX events for any one thing they're into, and places for
  // it count those (Round 6: pottery took 5 of 8 and crowded out riding).
  const events = only && !body.search ? [] : eventsFirst([...prevEvents, ...allEvents.filter((e) => !prevEvents.some((p) => p.stored.placeId === e.stored.placeId))], need);
  // Found after the wait (live check, 23 Nov 2026: 7 events in Bengaluru
  // took 18 s and were left off, then the list without them was reused for
  // 3 hours). They join this set once found; the phone asks again.
  const late = !eventsDone && body.category === "experiences" && (!only || body.search) && events.length < need;
  const room = Math.max(0, need - events.length);
  const taken = events.map((e) => e.stored.serves?.[0]).filter((k): k is string => !!k);
  // A day plan wants the famous sights, not the "something new" cap on very popular places.
  const picked = pickFrom(found, { room, small, popularCap: body.dayPlan ? 99 : popularCap(taste), taken, ...(only ? { only } : {}) });
  // The place they searched for by name comes first, in or out of their usual rules.
  if (found.named) {
    const named = found.named;
    const at = picked.chosen.findIndex((c) => c.candidate.place.id === named.place.id);
    const entry = at >= 0 ? picked.chosen.splice(at, 1)[0] : { candidate: named, ranked: null };
    picked.chosen.unshift(entry);
    if (at < 0 || at >= picked.shown) picked.shown = Math.min(picked.chosen.length, picked.shown + 1);
  }
  const result = { ...found, ...picked };
  if (result.chosen.length === 0 && events.length === 0) {
    console.log("No picks", { category: body.category, when: body.when, drops: result.drops });
    const notice = whyNothing(result.drops, effective.answers, body.when, city.country);
    await db.from("pick_sets").insert({ user_id: userId, category: body.category, when_slot: body.when, origin_key: setKey, city_id: city.id, country: city.country, time_zone: city.timeZone, currency: city.currency, picks: [], searched: result.intents.filter((i) => i.explicit).map((i) => i.id), banner: notice, expires_at: new Date(Date.now() + REUSE_HOURS[body.when] * 3600 * 1000).toISOString() });
    return json({ picks: [], notice });
  }

  // Places shown last time keep their order at the top.
  const shownCount = result.shown;
  const prevOrder = new Map(previous.map((p, i) => [p.placeId, i]));
  const byPrev = (list: typeof result.chosen) => (prevOrder.size ? [...list].sort((a, b) => (prevOrder.get(a.candidate.place.id) ?? 99) - (prevOrder.get(b.candidate.place.id) ?? 99)) : list);
  const chosen = [...byPrev(result.chosen.slice(0, shownCount)), ...result.chosen.slice(shownCount)];
  const placeStored: StoredPick[] = chosen.map(({ candidate, ranked: r }, i) => {
    const before = previous.find((p) => p.placeId === candidate.place.id);
    if (before) return { ...before, ...(i >= shownCount ? { spare: true } : {}) };
    // The last pick shown says "Skip unless…" when there is a real compromise.
    const weakest = i === shownCount - 1 && events.length + shownCount >= 3 && r?.verdict !== "Worth a detour";
    const compromise = weakest ? compromiseFor(candidate, effective, body.when, city) : null;
    // A search can find a place to eat from Things to do: it says what it is.
    const kind = kindOf(candidate.place, body.search && mainlyOf(candidate.place, "food_drinks") ? "food_drinks" : body.category);
    // The place they searched for by name says so, and any usual rule it breaks, on the card.
    const named = found.named?.place.id === candidate.place.id;
    return {
      placeId: candidate.place.id,
      kind,
      verdict: compromise ? "Skip unless" : (r?.verdict ?? "Good if you're nearby"),
      ...(compromise ? { skipUnless: compromise } : r?.verdict === "Skip unless" && r.skipUnless ? { skipUnless: r.skipUnless } : {}),
      because: named ? `You searched for it.${candidate.outside?.length ? ` ${candidate.outside.join(" · ")}.` : ""}` : becauseFor(result.intents.filter((i) => candidate.intents?.includes(i.id))),
      ...(candidate.fetaNote !== undefined ? { fetaNote: candidate.fetaNote } : {}),
      ...(candidate.local && candidate.fetaNote === undefined ? { local: true } : {}),
      ...(candidate.featured && candidate.fetaNote === undefined ? { featured: candidate.featured } : {}),
      ...(candidate.intents?.length ? { serves: candidate.intents } : {}),
      ...(i >= shownCount ? { spare: true } : {}),
    };
  });
  // One "Worth a detour" among the ones shown at most, across events and places.
  let detours = 0;
  const capped = (p: StoredPick): StoredPick => (p.verdict === "Worth a detour" && detours++ > 0 ? { ...p, verdict: "Good if you're nearby" } : p);
  for (const e of events) e.stored = capped(e.stored) as typeof e.stored;
  placeStored.forEach((p, i) => (placeStored[i] = capped(p)));
  const stored: StoredPick[] = [...events.map((e) => e.stored), ...placeStored];
  const shownTotal = events.length + shownCount;
  const short = shownTotal < 3;
  const whenText = body.when === "tonight" ? "tonight" : "this weekend";
  // Said plainly when something they asked for found nothing that fits.
  const missing = result.missing.length ? `No ${listOf(result.missing.map((i) => i.label))} near you that fits ${whenText}.` : null;
  // A search for one place by name needs no "only 1 fits".
  const banner = body.search
    ? found.named && shownTotal === 1
      ? null
      : short
        ? `Only ${shownTotal} ${shownTotal === 1 ? "place" : "places"} for “${note}” ${shownTotal === 1 ? "fits" : "fit"} you here ${whenText}.`
        : missing
    : short
      ? `Only ${shownTotal} ${shownTotal === 1 ? "place" : "places"} really ${shownTotal === 1 ? "fits" : "fit"} you here ${whenText}. No weak filler.`
      : missing;

  const { data: inserted } = await db.from("pick_sets").insert({
    user_id: userId,
    category: body.category,
    when_slot: body.when,
    origin_key: setKey,
    city_id: city.id,
    country: city.country,
    time_zone: city.timeZone,
    currency: city.currency,
    picks: stored,
    searched: result.intents.filter((i) => i.explicit).map((i) => i.id),
    banner,
    expires_at: new Date(Date.now() + REUSE_HOURS[body.when] * 3600 * 1000).toISOString(),
  }).select("id").single();
  if (late && inserted?.id)
    later(
      eventsFull.then(async (found) => {
        const now = eventsFirst([...events, ...found.filter((e) => !events.some((x) => x.stored.placeId === e.stored.placeId))], need);
        if (now.length <= events.length) return;
        // Events lead; places that no longer fit in the 8 become backup.
        const places = stored.filter((p) => !p.event);
        let room = need - now.length;
        const picks = [...now.map((e) => e.stored), ...places.map((p) => (p.spare || room-- > 0 ? p : { ...p, spare: true }))];
        const { error } = await db.from("pick_sets").update({ picks }).eq("id", inserted.id);
        if (error) console.error("late events", error.message);
      }),
    );

  try {
    const today = cityCalendar(city.timeZone).today;
    // Photos are fetched by the phone only once a card is on screen.
    const fresh = [
      ...events.map((e) => buildEventPick(e.stored, { taste, city, today, venue: e.venue, wholeCity: body.origin.source === "city" })),
      ...chosen.map(({ candidate }, i) => buildPick(candidate, placeStored[i], { taste, when: body.when, city, wholeCity: body.origin.source === "city" })),
    ];
    const counts = await loveCounts(db, fresh.map((p) => p.placeId)).catch(() => new Map<string, number>());
    const withLove = fresh.map((p) => (counts.get(p.placeId) ? { ...p, lovedBy: counts.get(p.placeId) } : p));
    return json({ picks: withLove.filter((p) => !p.spare), spares: withLove.filter((p) => p.spare), ...(banner ? { banner } : {}), ...left, ...(late ? { eventsComing: true } : {}) });
  } catch (error) {
    console.error(error);
    return json({ picks: [], notice: "Something went wrong showing your picks. Try again in a minute." }, 500);
  }
}

function listOf(words: string[]) {
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
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
        return buildEventPick(s, { taste: ctx.taste, city: ctx.city, today, venue, wholeCity: ctx.body.origin.source === "city" });
      }),
  );
  const live = await Promise.all(placeStored.map((s) => placeDetails(s.placeId, ctx.needsDiet)));
  const places = live.filter((p): p is Place => !!p);
  // A bar or café shown as a thing to do (karaoke, a rooftop) was checked
  // against what they asked for when it was chosen.
  // Where they are hasn't changed (the set is kept per place), so distance
  // and what each place was found for were checked when it was found; what
  // changes is whether it's open and still there (backend audit, 23 Nov
  // 2026: re-checking with their everyday distance dropped a whole-city set
  // and paid for a new search; a trip out at the weekend vanished).
  const passed = applyHardFilters(places, { taste: ctx.taste, category: ctx.body.category, when: ctx.body.when, origin: ctx.origin, exclude: ctx.exclude, city: ctx.city, foodDrinkOk: () => true, untypedOk: () => true, reachKm: () => Infinity, anyHours: ctx.body.dayPlan });
  const byId = new Map<string, Candidate>(passed.map((c) => [c.place.id, c]));
  const placePicks = await Promise.all(
    placeStored
      .filter((s) => byId.has(s.placeId))
      .map((s) => buildPick(byId.get(s.placeId)!, s, { taste: ctx.taste, when: ctx.body.when, city: ctx.city, wholeCity: ctx.body.origin.source === "city" })),
  );
  const picks = [...eventPicksShown, ...placePicks];
  const keptIds = new Set(picks.map((p) => p.placeId));
  return {
    picks,
    stored: stored.filter((s) => keptIds.has(s.placeId)),
    reply: { picks, ...(banner ? { banner } : {}) },
  };
}

function eventStillOn(e: EventInfo, when: When, city: City) {
  return eventPasses({ ...e, minPrice: null, because: "", verdict: "Good if you're nearby" }, { when: e.ahead ? "week" : when, timeZone: city.timeZone, maxSpend: null });
}

type EventPick = { stored: StoredPick & { event: EventInfo }; venue: Place | null };

// What's on that they're into (founder, 19 Nov 2026: "lets not only focus
// on places, lets focus on events and things to do"): one search per thing
// they chose, said or love (comedy, pottery, hiking…), shared by everyone in
// the city into the same thing (about ₹3 each, cached a few hours), with no
// set number. Events that pass the hard filters (date, budget, distance via
// the venue on Google Maps) lead the set, taking turns across what they're
// into; each serves the thing it was found for.
async function eventPicks(ctx: {
  db: SupabaseClient;
  taste: Taste;
  body: Body;
  city: City;
  origin: { lat: number; lng: number };
  exclude: Set<string>;
  intents: Intent[];
  need: number;
  rotation: number;
}): Promise<EventPick[]> {
  const { db, taste, body, city, origin } = ctx;
  const limit = distanceLimitKm(taste.answers);
  const cal = cityCalendar(city.timeZone);
  // Turned by the set's rotation, so with the cap every interest gets its new search in turn.
  const turn = ctx.rotation % Math.max(1, ctx.intents.length);
  const kinds: (Intent | null)[] = ctx.intents.length ? [...ctx.intents.slice(turn), ...ctx.intents.slice(0, turn)] : [null];

  // At most EVENT_SEARCHES new web searches a set (about ₹3 each); kinds
  // already searched in the city today are free and always used. The order
  // of kinds turns with each set, so every interest gets its search in turn
  // (founder, 23 Nov 2026: a fresh list paid for 3.5 event searches).
  let freshLeft = EVENT_SEARCHES;
  const [searches, guides] = await Promise.all([
    Promise.all(
      kinds.map(async (intent) => {
      // Things booked ahead (a class, a tasting, a hike) are looked for
      // across the coming week (founder, 21 Nov 2026).
      const span: EventSpan = intent?.def.ahead ? "week" : body.when;
      const day = span === "weekend" ? cal.weekend.join("+") : cal.today;
      const kind = intent ? `${intent.label} (${intent.query})` : undefined;
      // A city's free open-data feed first, where it has one for this kind (event-feeds.ts).
      const fed = await feedEvents(city, intent, span, span === "weekend" ? cal.weekend : span === "week" ? cal.week : [cal.today]);
      if (fed) return { intent, span, events: fed, searchHtml: "", feed: true };
      const key = [city.id, "events", span, day, intent?.query.toLowerCase() ?? "any"].join("|");
      const { data: cached } = await db.from("events_cache").select("events, search_html").eq("key", key).maybeSingle();
      if (cached) return { intent, span, events: cached.events as FoundEvent[], searchHtml: cached.search_html as string };
      if (freshLeft <= 0) return { intent, span, events: [] as FoundEvent[], searchHtml: "" };
      freshLeft--;
      const found = await findEvents({ city, when: span, kind }).catch((error) => {
        console.error(error);
        return { events: [] as FoundEvent[], searchHtml: "" };
      });
      // Google's chip must be shown with what its search found, so a search
      // without one is kept for nothing.
      if (found.searchHtml) {
        // Shared by everyone there into the same thing; kept longer to cut
        // repeat searches (founder, 23 Nov 2026: ₹512 of event searches a day).
        const hours = span === "tonight" ? 6 : 24;
        await saveEventsCache(db, key, found.events, found.searchHtml, hours);
      }
      return { intent, span, ...found };
      }),
    ),
    guideEventsFor(db, city).catch(() => null),
  ]);
  // What's on in her city's guides (guide-events.ts) comes first, each for
  // the thing they're into that it's about (or anything, if nothing chosen).
  const fromGuides = guides?.searchHtml
    ? kinds.map((intent) => {
        const words = intent ? intentWords([intent]) : [];
        return {
          intent,
          span: (intent?.def.ahead ? "week" : body.when) as EventSpan,
          events: guides.events.filter((e) => !intent || words.some((w) => plainText(`${e.kind} ${e.title}`).includes(w))) as FoundEvent[],
          searchHtml: guides.searchHtml,
        };
      })
    : [];

  // Taking turns across what they're into, so one kind doesn't fill the set.
  const maxSpend = spendUpperBound(taste.answers, city);
  const lists = [...fromGuides, ...searches]
    .filter((s) => s.searchHtml || ("feed" in s && s.feed))
    .map((s) =>
      s.events
        .filter((e) => eventPasses(e, { when: s.span, timeZone: city.timeZone, maxSpend }) && !ctx.exclude.has(`event:${e.url}`))
        .map((e) => ({ e, intent: s.intent, span: s.span, searchHtml: s.searchHtml })),
    );
  const seen = new Set<string>();
  const turns: { e: FoundEvent; intent: Intent | null; span: EventSpan; searchHtml: string }[] = [];
  for (let round = 0; lists.some((l) => l.length > round); round++) {
    for (const l of lists) {
      const x = l[round];
      if (x && !seen.has(x.e.url)) {
        seen.add(x.e.url);
        turns.push(x);
      }
    }
  }
  // Each venue is looked up on Google Maps (about ₹1.7), only for as many
  // as could be shown.
  const fresh = turns.slice(0, Math.max(ctx.need, 2));
  // A hike or an adventure may be a trip out (founder, 21 Nov 2026): the card says so.
  // Its link must open (tester, 22 Nov 2026: a Melbourne ticket link didn't
  // resolve); only the answer is read, never the page. The sites never to
  // be scraped aren't touched at all.
  const opens = (url: string) => (/district\.in|bookmyshow|meetup\.com|zomato|swiggy|insider\.in/.test(url) ? Promise.resolve(true) : eventLinkLands(url, 4000));
  const withVenues = (
    await Promise.all(fresh.map(async (x) => {
        const [venue, ok] = await Promise.all([findVenue(x.e, city, origin, x.intent?.def.far ? TRIP_OUT_KM : undefined), opens(x.e.url)]);
        return { ...x, venue, opens: ok };
      }))
  ).filter(
    // Their distance holds for events too (it was stretched to twice it).
    ({ venue, intent, opens }) => opens && venue && venue.km <= (intent?.def.far ? Math.max(limit, TRIP_OUT_KM) : limit),
  );
  // Which of these suit this person, and why (no search, about 2 s). If
  // that fails, each was still found for something they're into.
  const chosen = await personalizeEvents(withVenues.map((w) => w.e), tasteSummary(taste, city), body.when, withVenues.length).catch(() =>
    withVenues.map((_, index) => ({ index, because: "", verdict: "Good if you're nearby" as const, skipUnless: undefined })),
  );
  return chosen
    .map((c) => ({ ...withVenues[c.index], c }))
    .map(({ e, venue, intent, span, searchHtml, c }) => ({
      venue: venue!.place,
      stored: {
        placeId: `event:${e.url}`,
        kind: "EVENT" as const,
        verdict: c.verdict && ["Worth a detour", "Good if you're nearby", "Skip unless"].includes(c.verdict) ? c.verdict : "Good if you're nearby",
        ...(c.verdict === "Skip unless" && c.skipUnless ? { skipUnless: c.skipUnless } : {}),
        because: becauseFor(intent ? [intent] : []),
        ...(intent ? { serves: [intent.id] } : {}),
        event: {
          title: e.title,
          venueName: e.venueName,
          date: e.date,
          ...(e.endDate && e.endDate > e.date ? { endDate: e.endDate } : {}),
          time: e.time ?? "",
          priceText: e.priceText ?? "",
          url: e.url,
          site: siteName(e.url),
          searchHtml,
          venuePlaceId: venue!.place.id,
          distanceKm: Math.round(venue!.km * 10) / 10,
          ...(span === "week" ? { ahead: true } : {}),
          ...(e.fromList ? { fromList: true } : {}),
        },
      },
    }));
}

// Feta's lists, checked live before Google is searched (founder, 22 Nov
// 2026: "lists first, Google to fill gaps"; curate.ts searches Google only
// for what they don't already cover): up to 3 of the founder's within
// reach, the ones whose tags say most about what this person wants first,
// then the nearest (feta-places.ts, list-tags.ts), 4 local favourites
// chosen the same way (a food one must turn out to be mainly a place to eat
// or drink), up to 4 places the city's guides feature that match them
// (featured.ts), and 1 from people with a similar taste; about ₹1.7 each.
// The ones that fit, by Google type or by their tags, come before Google's
// (curate.ts). A list place Google's search finds anyway is
// labelled for free (mark). Only place IDs, her notes, counts and (for up
// to 30 days) where her places and local favourites are, are stored.
const FETA_LOOKUPS = 3;
const COMMUNITY_LOOKUPS = 1;
const LOCAL_LOOKUPS = 4;
// Featured in (founder, 24 Nov 2026: "hardly we see any featured lists"):
// up to 4 whose tags match what they want; none that match nothing, as they
// can't pass anyway. Someone who hasn't shared anything gets the guides' first 2.
const FEATURED_LOOKUPS = 2;
const FEATURED_MATCHED = 4;

export function featuredToCheck(places: { id: string; name: string; tags?: string[] }[], intents: Intent[]) {
  return places
    .map((f, i) => ({ id: f.id, i, fit: listFit(f, intents) }))
    .sort((a, b) => b.fit - a.fit || a.i - b.i)
    .filter((f) => !intents.length || f.fit > 0)
    .slice(0, intents.length ? FEATURED_MATCHED : FEATURED_LOOKUPS)
    .map((f) => f.id);
}

async function fetaCandidates(ctx: {
  db: SupabaseClient;
  taste: Taste;
  body: Body;
  city: City;
  origin: { lat: number; lng: number };
  exclude: Set<string>;
  founderExclude: Set<string>; // her places come back even if been or saved
  needsDiet: boolean;
  intents: Intent[];
}): Promise<Curated> {
  const kinds: Kind[] = ctx.body.category === "food_drinks" ? ["EAT", "DRINK"] : ["DO"];
  const [curated, guides, community] = await Promise.all([
    founderPlacesNear(ctx.db, { city: ctx.city, kinds, origin: ctx.origin, taste: ctx.taste, sources: ["founder", "local"] }),
    featuredFor(ctx.db, ctx.city, ctx.body.category, cityCalendar(ctx.city.timeZone).today),
    ctx.db.rpc("feta_favourites", { p_city: ctx.city.id, p_category: ctx.body.category }),
  ]);
  const founder = curated.filter((f) => !f.local);
  const locals = curated.filter((f) => f.local && !founder.some((m) => m.placeId === f.placeId));
  const localIds = new Set(locals.map((f) => f.placeId));
  // One label per place, as they're ordered: hers, then local favourite,
  // then Featured in (tester, 23 Nov 2026: "Local favourite" on the card,
  // "Featured in" in its details).
  const featured = new Map((guides?.places ?? []).filter((f) => !founder.some((m) => m.placeId === f.placeId) && !localIds.has(f.placeId)).map((f) => [f.placeId, { guide: f.guide, url: f.url, searchHtml: guides!.searchHtml, name: f.name, tags: f.tags }]));
  const notes = new Map(founder.map((f) => [f.placeId, f.note]));
  const loved = new Map(((community.data ?? []) as { place_id: string; lovers: number; similar: number }[]).map((c) => [c.place_id, c]));
  const onList = (id: string) => notes.has(id) || loved.has(id) || localIds.has(id) || featured.has(id);
  const tagsOf = new Map<string, { name: string; note?: string; tags?: string[] }>([...curated.map((f) => [f.placeId, f] as const), ...[...featured.entries()].map(([id, f]) => [id, f] as const)]);
  const label = (c: Candidate): Candidate => ({
    ...c,
    ...(tagsOf.has(c.place.id) ? { listServes: listServes(tagsOf.get(c.place.id)!, ctx.intents) } : {}),
    ...(notes.has(c.place.id) ? { fetaNote: notes.get(c.place.id) } : {}),
    ...(loved.has(c.place.id) ? { lovedBy: loved.get(c.place.id)!.lovers } : {}),
    ...(localIds.has(c.place.id) ? { local: true } : {}),
    ...(featured.has(c.place.id) ? { featured: { guide: featured.get(c.place.id)!.guide, url: featured.get(c.place.id)!.url, searchHtml: featured.get(c.place.id)!.searchHtml } } : {}),
  });
  const mark = (c: Candidate) => (onList(c.place.id) ? label(c) : null);
  if (notes.size === 0 && loved.size === 0 && localIds.size === 0 && featured.size === 0) return { looked: [], mark };
  // Each live check costs about ₹1.7: places whose tags, name and note say
  // nothing about what they want get at most 2 checks between them, nearest
  // first (founder, 23 Nov 2026: optimise; they rarely turn out to fit).
  // A search checks only list places whose tags, name or note match what was typed.
  const UNSURE = ctx.body.search ? 0 : 1;
  const byFit = (list: typeof curated) => {
    const scored = list.map((f, near) => ({ id: f.placeId, near, fit: listFit(f, ctx.intents) })).sort((a, b) => b.fit - a.fit || a.near - b.near);
    return ctx.intents.length ? [...scored.filter((f) => f.fit > 0), ...scored.filter((f) => f.fit === 0).slice(0, UNSURE)].map((f) => f.id) : scored.map((f) => f.id);
  };
  const lookups = [
    ...byFit(founder.filter((f) => !ctx.founderExclude.has(f.placeId))).slice(0, FETA_LOOKUPS),
    ...byFit(locals.filter((f) => !ctx.exclude.has(f.placeId))).slice(0, LOCAL_LOOKUPS),
    ...featuredToCheck([...featured.entries()].filter(([id]) => !ctx.exclude.has(id)).map(([id, f]) => ({ id, name: f.name, tags: f.tags })), ctx.intents),
    ...(ctx.body.search ? [] : [...loved.values()].filter((c) => c.similar > 0 && !ctx.exclude.has(c.place_id)).slice(0, COMMUNITY_LOOKUPS).map((c) => c.place_id)),
  ];
  const places = (await Promise.all([...new Set(lookups)].map((id) => placeDetails(id, ctx.needsDiet))))
    .filter((p): p is Place => !!p)
    // A local favourite matched by name only: a food one must really be a place to eat or drink.
    .filter((p) => !(localIds.has(p.id) || featured.has(p.id)) || ctx.body.category !== "food_drinks" || mainlyOf(p, "food_drinks"));
  const passed = applyHardFilters(places, {
    taste: ctx.taste,
    category: ctx.body.category,
    when: ctx.body.when,
    origin: ctx.origin,
    exclude: new Set(places.filter((p) => !notes.has(p.id) && ctx.exclude.has(p.id)).map((p) => p.id)),
    city: ctx.city,
  });
  return { looked: passed.map(label), mark };
}

// How many Feta users recommend each pick, shown on the card.
async function loveCounts(db: SupabaseClient, ids: string[]) {
  const places = ids.filter((id) => !id.startsWith("event:"));
  if (!places.length) return new Map<string, number>();
  const { data } = await db.rpc("feta_love_counts", { p_place_ids: places });
  return new Map(((data ?? []) as { place_id: string; lovers: number }[]).map((r) => [r.place_id, r.lovers]));
}

// What their favourite places are like (founder, 14 Nov 2026: "Name a few
// places you love" didn't shape anything). 3 at a time, read live for each
// new food search (about ₹1.7 each), taking turns through all of them so
// every place they love counts; Gemini finds places in the same spirit and
// price, and the search includes their kinds of place.
const PRICE_WORDS: Record<string, string> = {
  PRICE_LEVEL_INEXPENSIVE: "inexpensive",
  PRICE_LEVEL_MODERATE: "mid-priced",
  PRICE_LEVEL_EXPENSIVE: "pricey",
  PRICE_LEVEL_VERY_EXPENSIVE: "very expensive",
};

// Two loved places per search (cost cut, 23 Nov 2026), taking turns through all.
const LOVED_READS = 2;

async function describeLoved(taste: Taste, rotation: number, category: Category) {
  const all = (taste.loved ?? []).filter((l) => !l.id.startsWith("event:") && (!l.category || l.category === category)).map((l) => l.id);
  if (all.length === 0) return;
  const start = (rotation * LOVED_READS) % all.length;
  const ids = [...all.slice(start), ...all.slice(0, start)].slice(0, LOVED_READS);
  const places = (await Promise.all(ids.map((id) => placeDetails(id, false).catch(() => null)))).filter((p): p is Place => !!p);
  taste.lovedPlaces = places.map((p) => {
    const about = [p.primaryType?.replace(/_/g, " "), p.priceLevel && PRICE_WORDS[p.priceLevel], p.rating && `★${p.rating}`].filter(Boolean).join(", ");
    return `${p.displayName?.text ?? "A place"}${about ? ` (${about})` : ""}`;
  });
}
