import { isMainlandChina, type City } from "@/lib/cities";
import { cityAt, cityById, isCountryName, searchCities } from "@/lib/server/cities";
import { withCosts } from "@/lib/server/costs";
import { runPicks } from "@/lib/server/engine";
import { findDestination } from "@/lib/server/places";
import { tasteSummary, TWEAKS, type Pick, type StoredPick } from "@/lib/server/picks";
import { planDays } from "@/lib/server/plan-days";
import { loadTaste, userDb, userIdFor } from "@/lib/server/taste";
import { veniceJson, type ChatTurn } from "@/lib/server/venice";
import { weekendSaturday } from "@/lib/weekend";
import type { Itinerary } from "@/lib/server/itinerary";
import { cleanRoute, type RouteIn, type Trip } from "@/lib/server/trip";

// Search, AI and photos can take a while; the default cut-off is shorter.
export const maxDuration = 60;

// Ask Feta. Venice understands the person (chat, profile updates, turning
// words into a search); the picks engine (Gemini + Google Maps) finds the
// places. Venice never sees Google content: only the chat text and a short
// taste summary from Feta's own data.

type Origin = { lat: number; lng: number; label: string; source: "gps" | "area" | "city"; areaId?: string; city: City };

type VeniceReply = {
  reply?: string;
  learned?: ({ text?: string; about?: string | null } | string)[];
  weekend?: string | null;
  itinerary?: { place?: string | null; days?: number; start?: string | null; who?: string; note?: string } | null;
  trip?: { place?: string; dates?: string } | null;
  route?: (RouteIn & { edit?: boolean }) | null;
  search?: Search | Search[] | null;
  why?: boolean;
  options?: string[];
};

type Search = {
    category?: string;
    when?: string;
    place?: string | null;
    tweaks?: string[];
    note?: string;
    day?: string | null; // YYYY-MM-DD, a particular day ("tomorrow")
    time?: string | null; // HH:MM, a time of day ("a sunrise hike")
    hours?: number; // how long they'll be there
    further?: boolean; // worth going beyond their usual distance
};

export type AskReply = {
  reply: string;
  picks: Pick[];
  added: { id: string; text: string }[];
  trip: string | null; // "Goa · 14–18 Dec"
  notice?: string;
  options?: string[]; // tap-able answers to a question Feta just asked
  weekend?: { id: string; text: string } | null; // added to their weekend plan
  itinerary?: Itinerary | null; // a full day (or up to 3), stop by stop
  tripId?: string | null; // a trip planner card (route, getting around, stays, days)
};

// Who a learned line is about, for the People group on You.
const ABOUT = ["partner", "family", "friends", "kids"] as const;


export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { message?: string; origin?: Origin | null };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const message = (body.message ?? "").trim().slice(0, 500);
  if (!message) return Response.json({ error: "Empty message" }, { status: 400 });

  const db = userDb(token);
  const userId = await userIdFor(db, token);
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const here = body.origin ?? null;
  const homeCity = cityById(here?.city?.id);
  const [taste, { data: history }, { data: lastTripMessage }, { data: peopleLines }] = await Promise.all([
    loadTaste(db),
    db.from("chat_messages").select("role, content, extras").order("id", { ascending: false }).limit(16),
    // The trip being planned in this chat, however long ago it started, so
    // changes ("less Tokyo, more Kyoto") edit it.
    db.from("chat_messages").select("extras").not("extras->>trip_id", "is", null).order("id", { ascending: false }).limit(1).maybeSingle(),
    // What they've told Feta about the people they go out with, kept apart
    // from their own taste (founder, 19 Nov 2026: a date night assumed her
    // boyfriend likes what she likes).
    db.from("profile_lines").select("line_key, text").like("line_key", "people:%").is("removed_at", null),
  ]);
  const people = (peopleLines ?? []).map((l) => `- ${String(l.line_key).split(":")[1]}: ${l.text}`).join("\n");
  const past = (history ?? []).reverse();
  const currentTripId = (lastTripMessage?.extras?.trip_id as string | undefined) ?? null;
  const { data: currentTrip } = currentTripId ? await db.from("trips").select("*").eq("id", currentTripId).maybeSingle<Trip>() : { data: null };

  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: homeCity?.timeZone ?? "UTC" }).format(new Date());
  const system = `You are Feta: a personal assistant and a friend with great taste. People can talk to you about anything in their life, and you answer and suggest like a thoughtful friend who knows them; your speciality is deciding where to eat and drink, what to do, and planning days out and trips. Talk like a thoughtful friend texting: short, warm, specific, honest, no hype, no emoji. Think about what they actually want, use everything you know about them below (and say so: "You love Thai, so…"), and give real opinions and advice. Ask only what you genuinely need to do it well, one question at a time with tap-able "options", and act once you can; if they're in a hurry or say "just pick", act straight away with sensible guesses.

Today is ${today}. ${homeCity ? `They are in ${homeCity.name}, ${homeCity.countryName}${here?.source === "area" ? ` (${here.label})` : ""}.` : "They haven't said where they are."}

What Feta knows about them (this person only):
${(homeCity && tasteSummary(taste, homeCity)) || "Not much yet."}

What they've told Feta about the people they go out with:
${people || "Nothing yet."}

Plans with or for someone else (a date, friends, family): what you know is about this person, not the others; never assume a partner or friend likes what they like. Before searching, find out what you don't know yet, one short question at a time with "options": whether they want somewhere to eat and drink, something to do, or both (options like "Food and drinks", "Something to do", "Both"), unless they already said; the mood (romantic, fun, chill, adventurous); and what the others like (unless it's listed above). Then act, using what suits them all; if their tastes differ, say how the plan works for both. If they say "just pick", act straight away. Never say you're looking or searching without sending the search in that same reply. Save what they tell you about the others in "learned" with "about".
${currentTrip ? `\nThe trip you're planning together: ${currentTrip.title}${currentTrip.start_date ? `, from ${currentTrip.start_date}` : ""}${currentTrip.who ? `, with ${currentTrip.who}` : ""}: ${currentTrip.cities.map((c) => `${c.name} ${c.nights} nights`).join(", ")}. It's saved in Saved; its card has the next steps (getting around, hotels, then day plans for each city, which are kept with the trip). For day plans in its cities, point them to the card's "plan days" buttons instead of sending an itinerary.\n` : ""}
Be a real assistant, not a menu (founder, 19 Nov 2026: "you can chat with it about anything in life and it should be able to answer and suggest"). Answer anything they ask, about going out or not (a gift idea, what to say in a toast, how to plan a busy week, a recipe, what to wear, a tricky conversation), well and briefly, from what you know; then, when it fits naturally, offer how Feta can help (a place, a plan). Never claim to have checked facts or prices live; for medical, legal or money decisions, give general guidance and suggest a professional. Help with anything about eating out, things to do, days out and trips too, even when it isn't one of Feta's usual options (a sunrise hike, a pottery class, a quiet place to read, the best time to go, what to bring or wear). Suggest things they may not have thought of, from what you know about them, and say why; offer a natural next step ("Breakfast near the trail after?"). Put what you learn about them in "learned" (e.g. "Into hikes and sunrise treks"), so Feta gets to know them over time.
Real places come only from Feta's own search, which checks them against their diet, budget, distance and opening hours. Never present a place as checked yourself; you may name a well-known place or landmark in a search "note" so Feta looks it up.
Besides talking, you can do one of these per reply (leave the others null).
- "search": up to 2 searches at once (an array), e.g. something to do and somewhere to eat for an evening out. Each: places to eat or drink, or things to do, at any day and time: {"category": "food_drinks" or "experiences", "when": "tonight" or "weekend", "day": YYYY-MM-DD when they mean a particular day (tomorrow, Friday), else null, "time": "HH:MM" when they mean a time of day (06:00 for a sunrise hike, 13:00 for lunch), else null, "hours": how long they'll be there (1 to 6), "further": true when it's worth going beyond their usual distance (a hike, a lake, a beach, a day trip) or they ask to, "place": a city or neighbourhood they named, or null for where they are, "tweaks": any of ${JSON.stringify(TWEAKS)}, "note": what they want in a few words, e.g. "romantic, quiet, live jazz" or "sunrise trek, Nandi Hills"}. Feta shows the best 3 that match for each.
- "itinerary": a stop-by-stop plan for a day or two where they are, or a day trip nearby: {"place": the city or area, or null for where they are, "days": 1 to 3, "start": YYYY-MM-DD, "who": "solo", "partner", "friends", "family" or "kids", "note": the mood and must-dos, e.g. "slow mornings, food and art"}.
- "route": any trip: travelling somewhere for 2 days or more (even one city, like "3 days in Calicut"), a country or region, or several cities. It becomes a trip card with getting there and around, where to stay, and day plans: {"title": e.g. "30 days in Japan", "start": YYYY-MM-DD (a month alone means the 1st of the coming one), "who": as above, "edit": true when changing the trip above, "cities": [{"name", "country", "nights": a number, "story": two short sentences on why it's worth it for them, tied to their taste, company and the season, "focus": 3 to 6 words}]} in a sensible order, nights adding up to the trip. To change the trip above, send the whole route again with "edit": true. Once they're happy with it, don't send it again.

Reply with only a JSON object:
{"reply": what you say, 1 to 4 short sentences (a little longer when they ask for advice or an explanation that needs it),
 "options": 2 to 4 tap-able answers (under 5 words each) whenever your reply asks a question (always, so they can just tap), else [],
 "learned": up to 3 new lasting things worth remembering about them or the people they go out with, each {"text": a short plain line with no pronouns (e.g. "Loves Mexican food"), "about": null, "partner", "family", "friends" or "kids"}; [] if nothing new; never labels, personality types, health or allergy details,
 "weekend": null, or a short phrase when they mention something they want to do this weekend,
 "trip": null, or {"place", "dates": e.g. "14–18 Dec"} while you're talking about a trip,
 "search": null or an array of 1 or 2 as above, "itinerary": null or as above, "route": null or as above,
 "why": true if they ask why a pick was chosen}
Never say food is safe for an allergy or a diet. Mainland China (not Hong Kong or Macau): no search, itinerary or route; give up to 3 ideas from what you know in "reply", saying they're less reliable than usual.`;

  let parsed: VeniceReply;
  try {
    parsed = await veniceJson<VeniceReply>(
      [
        { role: "system", content: system },
        // Its own past replies in the same JSON it must answer in, with the
        // options it offered (as plain words it drifted into plain-words
        // answers and lost its buttons, 19 Nov 2026).
        ...past.map((m) => ({ role: m.role, content: m.role === "assistant" ? JSON.stringify({ reply: m.content, options: m.extras?.options ?? [] }) : m.content }) as ChatTurn),
        { role: "user", content: message },
      ],
      3000,
    );
  } catch (error) {
    console.error(error);
    return Response.json({ reply: "I couldn't think just now. Try again in a moment.", picks: [], added: [], trip: null } satisfies AskReply);
  }

  // One search or two (something to do and somewhere to eat for an evening out).
  const asked = (Array.isArray(parsed.search) ? parsed.search : parsed.search ? [parsed.search] : []).filter((x): x is Search => !!x && typeof x === "object").slice(0, 2);
  let reply = (parsed.reply ?? "").slice(0, 1200) || "Tell me a bit more?";
  const tripLabel = parsed.trip?.place ? [parsed.trip.place, parsed.trip.dates].filter(Boolean).join(" · ").slice(0, 60) : null;

  // "Why this one?": answer from the reasons Feta already wrote.
  if (parsed.why) {
    const lastPicks = past.map((m) => m.extras?.picks as StoredPick[] | undefined).filter(Boolean).pop();
    if (lastPicks?.length) reply = lastPicks.map((p) => p.because).join("\n");
  }

  // Things learned go straight into the profile, shown with Undo.
  const learned = (parsed.learned ?? [])
    .map((l) => (typeof l === "string" ? { text: l, about: null } : { text: l.text ?? "", about: l.about ?? null }))
    .map((l) => ({ text: l.text.trim().slice(0, 80), about: (ABOUT as readonly string[]).includes(l.about ?? "") ? l.about : null }))
    .filter((l) => l.text)
    .slice(0, 3);
  let added: { id: string; text: string }[] = [];
  if (learned.length > 0) {
    const { data, error } = await db
      .from("profile_lines")
      .insert(learned.map((l) => ({ user_id: userId, line_key: `${l.about ? `people:${l.about}` : "chat"}:${crypto.randomUUID()}`, text: l.text, source: "chat" })))
      .select("id, text");
    if (error) console.error("Saving chat lines failed", error.message);
    added = data ?? [];
  }

  // Something for this weekend goes on their weekend plan (Lists shows it).
  let weekend: AskReply["weekend"] = null;
  const wish = typeof parsed.weekend === "string" ? parsed.weekend.trim().slice(0, 80) : "";
  if (wish) {
    const { data, error } = await db
      .from("weekend_wishes")
      .insert({ user_id: userId, text: wish, for_date: weekendSaturday(homeCity?.timeZone) })
      .select("id, text")
      .single();
    if (error) console.error("Saving weekend wish failed", error.message);
    weekend = data ?? null;
  }

  // A search goes through the same picks engine and hard filters as Picks.
  let picks: Pick[] = [];
  let notice: string | undefined;
  const options = (parsed.options ?? [])
    .filter((o): o is string => typeof o === "string")
    .map((o) => o.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 4);
  // What to do with the reply. The model decides, except for one thing code
  // checks (founder, 15–16 Nov 2026: trips ended in restaurant cards, and
  // "3 days in Calicut" got a day plan with no stay or travel): a whole
  // country, more than 3 days, or 2 days or more away from where they are,
  // is always a trip (route, getting there, stays, day plans).
  const it = parsed.itinerary;
  const awayFromHome = (place?: string | null) => {
    if (!place) return false;
    const [match] = searchCities(place, 1);
    // A place Feta's city list doesn't know (an area, a region) counts as
    // away only when they're talking about a trip.
    return match ? !homeCity || match.id !== homeCity.id : !!tripLabel;
  };
  const wantsRoute =
    !parsed.why &&
    !parsed.route?.cities?.length &&
    ((it && ((it.days ?? 1) > 3 || isCountryName(it.place ?? "") || ((it.days ?? 1) >= 2 && awayFromHome(it.place)))) ||
      (asked.length && tripLabel && isCountryName(asked[0].place ?? parsed.trip?.place ?? "")));
  if (wantsRoute) {
    const route = await routeFor(past, message, system).catch((error) => {
      console.error(error);
      return null;
    });
    if (route?.cities?.length) {
      parsed = { ...parsed, route, itinerary: null };
      asked.length = 0;
      reply = "Here's a route you can change. Then we'll sort out getting around and where to stay.";
    } else {
      parsed = { ...parsed, itinerary: null };
      asked.length = 0;
      notice = "I couldn't put the route together just now. Ask me again?";
    }
  }

  // A route becomes a trip card; edits change the trip already being planned.
  let tripId: string | null = null;
  const route = parsed.why ? null : parsed.route?.cities?.length ? cleanRoute(parsed.route) : null;
  if (route && route.cities.length > 0) {
    const fields = { ...route, home_currency: homeCity?.currency ?? null, transport: null, stays: {}, days: {}, updated_at: new Date().toISOString() };
    // The same trip sent again keeps everything planned so far; a changed
    // one (mostly the same cities) edits it; somewhere else is a new trip.
    const key = (c: { name: string; nights: number }) => `${c.name.toLowerCase()}:${c.nights}`;
    const unchanged = currentTrip && currentTrip.cities.map(key).join() === route.cities.map(key).join();
    const names = new Set((currentTrip?.cities ?? []).map((c) => c.name.toLowerCase()));
    const overlap = route.cities.filter((c) => names.has(c.name.toLowerCase())).length / route.cities.length;
    if (unchanged) {
      tripId = currentTrip.id;
    } else if (currentTrip && (parsed.route?.edit || overlap >= 0.5)) {
      await db.from("trips").update(fields).eq("id", currentTrip.id);
      tripId = currentTrip.id;
    } else {
      const { data, error } = await db.from("trips").insert({ user_id: userId, ...fields }).select("id").single();
      if (error) console.error("Saving trip failed", error.message);
      tripId = data?.id ?? null;
    }
  }
  // Day plans for a city on the trip being planned belong on its card
  // (kept with the trip), not in a separate plan.
  const askedPlace = (parsed.itinerary?.place ?? "").toLowerCase().trim();
  const tripCity =
    currentTrip && askedPlace
      ? (currentTrip.cities.find((c) => askedPlace.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(askedPlace)) ??
        (currentTrip.title.toLowerCase().includes(askedPlace) || isCountryName(askedPlace) ? currentTrip.cities[0] : null))
      : null;
  if (!tripId && currentTrip && tripCity) {
    tripId = currentTrip.id;
    reply = `Tap “plan days” under ${tripCity.name} on your trip card and I'll plan them stop by stop, near your hotel if you've chosen one.`;
  }
  const plan = parsed.why || tripId ? null : (parsed.itinerary ?? null);
  let searches = parsed.why || plan || tripId ? [] : asked;
  // A search of a whole country finds one point on the map: ask for a city.
  const country = searches.find((x) => isCountryName(x.place ?? ""));
  if (country) {
    notice = `Which city in ${country.place}? Feta looks one city at a time.`;
    searches = [];
  }
  let itinerary: Itinerary | null = null;
  if (plan) {
    const origin = await withCosts(db, "ask", () => resolvePlace(plan.place ?? parsed.trip?.place ?? null, here, homeCity));
    if (!origin || isMainlandChina(origin.city)) {
      notice = origin ? `Feta can't check places in mainland China yet, so I can't plan a day there.` : `I couldn't find ${plan.place} on the map. Try a nearby city?`;
    } else {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: origin.city.timeZone }).format(new Date());
      const start = /^\d{4}-\d{2}-\d{2}$/.test(plan.start ?? "") && plan.start! >= today ? plan.start! : today;
      itinerary = await withCosts(db, "ask", () =>
        planDays(token, { origin, start, days: plan.days ?? 1, who: plan.who, focus: plan.note, trip: tripLabel ?? undefined, place: origin.source === "area" ? origin.label : origin.city.name }),
      );
      if (!itinerary) notice = "I couldn't find enough open places to plan a full day there. Try another area or day?";
    }
  }
  // Both at once, so an evening out takes no longer than one search.
  const results = await Promise.all(searches.map(async (s): Promise<{ found: Pick[]; notice?: string }> => {
    const origin = await withCosts(db, "ask", () => resolvePlace(s.place ?? parsed.trip?.place ?? null, here, homeCity));
    if (origin && isMainlandChina(origin.city)) {
      return { found: [], notice: `Feta can't check places in mainland China yet, so ideas for ${origin.city.name} come from general knowledge and are less reliable. Check before you go.` };
    }
    if (!origin) return { found: [], notice: `I couldn't find ${s.place ?? parsed.trip?.place} on the map. Try a nearby city?` };
    const at = askedTime(s, origin.city);
    const res = await withCosts(db, "ask", () => runPicks(token, {
        category: s.category === "experiences" ? "experiences" : "food_drinks",
        when: s.when === "weekend" || tripLabel || (at && [0, 6].includes(new Date(`${at.day}T12:00:00Z`).getUTCDay())) ? "weekend" : "tonight",
        ...(at ? { at } : {}),
        ...(s.further ? { reach: "day_trip" } : {}),
        // Only places that match what was asked, never the rest of their
        // everyday set (founder, 18 Nov 2026: asked for a hike, got bowling).
        only: "asked",
        origin,
        tweaks: (s.tweaks ?? []).filter((t) => (TWEAKS as readonly string[]).includes(t)),
        // Their own words lead, and always mean a fresh search (never
        // the last list again), e.g. "something Pokémon-related".
        note: ((s.note ?? "").trim() || message).slice(0, 120),
        ...(tripLabel ? { trip: tripLabel } : {}),
    }));
    const data = (await res.json().catch(() => ({}))) as { picks?: Pick[]; notice?: string };
    // Chat shows a short answer: the best 3. Nothing that matches is said plainly.
    const found = (data.picks ?? []).slice(0, 3);
    // Why nothing came back, in chat words: the engine's reason without its
    // tips for the picks screen, then what Feta can try next.
    const whenText = at ? dayText(at.day, origin.city) : s.when === "weekend" || tripLabel ? "this weekend" : "tonight";
    const reason = data.notice?.replace(/\s*Try [^.]*\.$/, "") || `Nothing I found fits ${whenText}${s.further ? "" : " within your distance"}.`;
    return { found, notice: found.length ? undefined : `${reason} ${s.further ? "Want to try another day, or something similar?" : "Want me to look further out, or another day?"}` };
  }));
  for (const r of results) picks = [...picks, ...r.found.filter((p) => !picks.some((q) => q.placeId === p.placeId))];
  const notices = results.map((r) => r.notice).filter(Boolean);
  if (notices.length) notice = notices.join(" ");

  await db.from("chat_messages").insert([
    { user_id: userId, role: "user", content: message },
    {
      user_id: userId,
      role: "assistant",
      content: reply,
      // Place IDs and Feta's own words only.
      extras: {
        picks: picks.map((p) => ({ placeId: p.placeId, kind: p.kind, verdict: p.verdict, because: p.because })),
        added,
        trip: tripLabel,
        weekend,
        ...(options.length && !searches.length && !tripId ? { options } : {}),
        ...(tripId ? { trip_id: tripId } : {}),
        ...(itinerary
          ? { itinerary: { title: itinerary.title, days: itinerary.days.map((d) => ({ label: d.label, stops: d.stops.map((st) => ({ time: st.time, slot: st.slot, placeId: st.pick.placeId, kind: st.pick.kind, because: st.pick.because })) })) } }
          : {}),
      },
    },
  ]);

  return Response.json({ reply, picks, added, trip: tripLabel, weekend, itinerary, tripId, ...(notice ? { notice } : {}), ...(options.length && !searches.length && !tripId ? { options } : {}) } satisfies AskReply);
}

// The day and time asked for, in the city's own time: a time with no day
// is today (tomorrow if it has passed); a day with no time is midday for
// things to do and 7:30 pm for food.
function askedTime(s: Search, city: City): { day: string; start: number; minutes: number } | null {
  const time = /^(\d{1,2}):(\d{2})$/.exec(s.time ?? "");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(s.day ?? "") ? s.day! : null;
  if (!time && !day) return null;
  const now = new Date();
  const local = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: city.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: city.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).split(":").map(Number);
  const start = time ? Number(time[1]) * 60 + Number(time[2]) : s.category === "experiences" ? 12 * 60 : 19 * 60 + 30;
  const passed = !day && start <= h * 60 + m;
  return { day: day ?? local(new Date(now.getTime() + (passed ? 86400000 : 0))), start, minutes: Math.round(Math.min(6, Math.max(1, s.hours ?? 2)) * 60) };
}

// "tomorrow", "Friday", or "on 3 Dec", from the city's today.
function dayText(day: string, city: City) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: city.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const days = Math.round((Date.parse(day) - Date.parse(today)) / 86400000);
  const date = new Date(`${day}T12:00:00Z`);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 7) return `on ${new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(date)}`;
  return `on ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date)}`;
}

// Where to search: a city anywhere in the world (by name, from Feta's own
// list), or a neighbourhood, landmark or region found on Google Maps and
// placed in its nearest city. No place named means where the user is now.
async function resolvePlace(name: string | null, here: Origin | null, home: City | null): Promise<Origin | null> {
  if (!name) return here ?? (home ? { lat: home.lat, lng: home.lng, label: `Anywhere in ${home.name}`, source: "city", city: home } : null);
  const q = name.toLowerCase().trim();
  const [match] = searchCities(name, 1);
  const named = match && [match.name, match.matched].some((n) => n && n.toLowerCase() === q.split(",")[0].trim());
  if (match && named) return { lat: match.lat, lng: match.lng, label: `Anywhere in ${match.name}`, source: "city", city: match };
  const found = await findDestination(name);
  if (!found) return match ? { lat: match.lat, lng: match.lng, label: `Anywhere in ${match.name}`, source: "city", city: match } : null;
  const city = cityAt(found);
  if (!city) return null;
  // A neighbourhood in their own city is an area; anywhere else (a trip to
  // Goa, Bali or Kyoto) means the whole place around it.
  const source = city.id === home?.id ? "area" : "city";
  return { lat: found.lat, lng: found.lng, label: source === "area" ? name.slice(0, 60) : `Anywhere in ${name.slice(0, 50)}`, source, city };
}

// A trip route when the chat asked for a search or a day plan of a whole
// country or a long stay: the same conversation, asked for the route only.
async function routeFor(past: { role: string; content: string }[], message: string, system: string): Promise<RouteIn | null> {
  const reply = await veniceJson<{ route?: RouteIn | null }>(
    [
      { role: "system", content: `${system}\n\nThis time, reply with only {"route": …} for the trip they're planning, as described above.` },
      ...past.map((m) => ({ role: m.role, content: m.content }) as ChatTurn),
      { role: "user", content: message },
    ],
    3000,
  );
  return reply.route ?? null;
}
