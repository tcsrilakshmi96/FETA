import { isMainlandChina, type City } from "@/lib/cities";
import { cityAt, cityById, searchCities } from "@/lib/server/cities";
import { withCosts } from "@/lib/server/costs";
import { runPicks } from "@/lib/server/engine";
import { findDestination } from "@/lib/server/places";
import { tasteSummary, TWEAKS, type Pick, type StoredPick } from "@/lib/server/picks";
import { loadTaste, userDb, userIdFor } from "@/lib/server/taste";
import { veniceJson, type ChatTurn } from "@/lib/server/venice";
import { weekendSaturday } from "@/lib/weekend";
import { buildItinerary, type Itinerary } from "@/lib/server/itinerary";
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
  search?: {
    category?: string;
    when?: string;
    place?: string | null;
    tweaks?: string[];
    note?: string;
  } | null;
  why?: boolean;
  options?: string[];
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
  const [taste, { data: history }] = await Promise.all([
    loadTaste(db),
    db.from("chat_messages").select("role, content, extras").order("id", { ascending: false }).limit(12),
  ]);
  const past = (history ?? []).reverse();
  // The trip being planned in this chat, if any, so changes ("less Tokyo,
  // more Kyoto") edit it.
  const currentTripId = past.map((m) => m.extras?.trip_id as string | undefined).filter(Boolean).pop() ?? null;
  const { data: currentTrip } = currentTripId ? await db.from("trips").select("*").eq("id", currentTripId).maybeSingle<Trip>() : { data: null };

  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: homeCity?.timeZone ?? "UTC" }).format(new Date());
  const system = `You are Feta, a warm, honest friend who picks places to eat and drink and things to do. You talk briefly, like a friend texting.
Today is ${today}. ${homeCity ? `They are in ${homeCity.name}, ${homeCity.countryName}${here?.source === "area" ? ` (${here.label})` : ""}.` : "They haven't said where they are."}

What Feta knows about them:
${(homeCity && tasteSummary(taste, homeCity)) || "Not much yet."}

Reply with only a JSON object:
{"reply": 1 or 2 short, plain sentences (a question counts as one). No hype, no emoji.
 "options": when "reply" asks a question, 2 to 4 short answers they can tap (each under 5 words, e.g. "Quiet and cosy", "Something lively", "Surprise me"); otherwise [].
 "learned": at most 3 new, lasting things worth remembering, each {"text": a short plain line, "about": null for them, or "partner", "family", "friends" or "kids" when it is about the people they go out with (e.g. {"text": "Partner loves live music", "about": "partner"}, {"text": "Parents prefer early dinners", "about": "family"})}. Their taste, budget or plans count too. [] if nothing new. Never labels or personality types, never health or allergy details.
 "weekend": null, or a short phrase (under 8 words) when they say something they want to do or try this weekend, e.g. "Pottery class with my sister", "Brunch somewhere new". It goes on their weekend plan.
 "trip": null, or {"place": city or region, "dates": short dates like "14–18 Dec"} if they are planning a trip.
 "search": null, or {"category": "food_drinks" or "experiences", "when": "tonight" or "weekend", "place": a city or neighbourhood they named, or null, "tweaks": any of ${JSON.stringify(TWEAKS)}, "note": a short phrase capturing what they want, e.g. "romantic, quiet, live jazz"} once you know enough to suggest places.
 "itinerary": null, or {"place": the city or area, or null for where they are now, "days": 1 to 3, "start": the first day as YYYY-MM-DD, "who": "solo", "partner", "friends", "family" or "kids", "note": a short phrase of the mood and must-dos, e.g. "romantic, food and art, slow mornings"} once you have the basics for an itinerary, a day plan or a plan for a whole day or trip. It gives them a stop-by-stop plan (breakfast, morning, lunch, afternoon, dinner, a drink).
 "route": null, or for a trip to a country or region, to several cities, or longer than 3 days: {"title": e.g. "30 days in Japan", "start": the first day as YYYY-MM-DD (a month alone, like "April", means the 1st of the coming one), "who": "solo", "partner", "friends", "family" or "kids", "edit": true when this changes the current trip below, "cities": [{"name": a city or town, "country": its country, "nights": a number, "story": two short sentences on why it's worth it for them: what makes it special (its history or character) and what they'll feel there, tied to their taste, who they're with and the season, "focus": 3 to 6 words, e.g. "temples, tea houses, slow mornings"}]} in a sensible travelling order, the nights adding up to the trip length.
 "why": true if they ask why a pick was chosen.}
How to talk: like a friend who plans well. For a plan that matters (a date night, a birthday, an anniversary, family visiting, friends in town, a trip), get to know it first: ask one question at a time, at most 3 in total, before searching. Good things to ask: who it's with and what they're like, the mood they want, food or activity, budget, when. Skip anything you already know from above or from the chat, and use what you know ("Your partner loves live music, so a jazz bar after dinner?"). If they say "just suggest", "surprise me" or seem in a hurry, search straight away. For an itinerary, get the basics right first, one question at a time with tap-able "options", skipping anything they already said or you already know: 1) who it's with (just me, partner, friends, family, with kids), 2) which day or days and how many (if they named a day like "Saturday", take the coming one and don't ask again), 3) the mood or anything they'd love to fit in (e.g. "Slow and foodie", "Packed with sights", "Some nightlife", "Surprise me"). At most 3 questions, even if they're vague. Only then set "itinerary" (with "search" null) and say you're putting the plan together. A trip to a country or region, to several cities, or longer than 3 days is a route, not an itinerary: after the same basics (who, when and for how long, the mood), set "route" (with "itinerary" and "search" null) and say in "reply" that here's a route they can change, and then you'll sort out getting around and where to stay. Never ask where they are now for a trip; it's about the destination. When they ask to change the current trip (more or fewer nights, add or drop a city, a different order), set "route" again with "edit": true and every city. If they say "just plan it", plan straight away with sensible guesses. Quick everyday asks ("coffee near me", "something cheaper tonight", "3 more") need no questions: search straight away. When you set "search", "options" is [] and "reply" says you're finding 3 and, in a few words, what you're looking for. While you are still asking, "search" is null and "trip" may be set.
${currentTrip ? `The current trip being planned: ${currentTrip.title}${currentTrip.start_date ? `, from ${currentTrip.start_date}` : ""}${currentTrip.who ? `, with ${currentTrip.who}` : ""}: ${currentTrip.cities.map((c) => `${c.name} ${c.nights} nights`).join(", ")}.
` : ""}You can search anywhere in the world except mainland China (Hong Kong and Macau are fine): for mainland China, set "search" to null and give up to 3 ideas from what you know in "reply" (up to 4 short sentences), saying they are less reliable than usual and to check before going. Never say food is safe for an allergy or a diet.`;

  let parsed: VeniceReply;
  try {
    parsed = await veniceJson<VeniceReply>([
      { role: "system", content: system },
      ...past.map((m) => ({ role: m.role, content: m.content }) as ChatTurn),
      { role: "user", content: message },
    ]);
  } catch (error) {
    console.error(error);
    return Response.json({ reply: "I couldn't think just now. Try again in a moment.", picks: [], added: [], trip: null } satisfies AskReply);
  }

  let reply = (parsed.reply ?? "").slice(0, 400) || "Tell me a bit more?";
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
  // A trip mentioned without a search still gets 3 places there, unless
  // Feta is still asking about it.
  // A route (a country, several cities or a long trip) becomes a trip card;
  // edits change the trip already being planned.
  let tripId: string | null = null;
  const route = parsed.why ? null : parsed.route?.cities?.length ? cleanRoute(parsed.route) : null;
  if (route && route.cities.length > 0) {
    const fields = { ...route, home_currency: homeCity?.currency ?? null, transport: null, stays: {}, updated_at: new Date().toISOString() };
    if (parsed.route?.edit && currentTrip) {
      await db.from("trips").update(fields).eq("id", currentTrip.id);
      tripId = currentTrip.id;
    } else {
      const { data, error } = await db.from("trips").insert({ user_id: userId, ...fields }).select("id").single();
      if (error) console.error("Saving trip failed", error.message);
      tripId = data?.id ?? null;
    }
  }
  const plan = parsed.why || tripId ? null : (parsed.itinerary ?? null);
  const s = parsed.why || plan || tripId ? null : (parsed.search ?? (parsed.trip?.place && options.length === 0 ? { category: "food_drinks", place: parsed.trip.place } : null));
  let itinerary: Itinerary | null = null;
  if (plan) {
    // Food & drinks and experiences there, through the same hard filters,
    // then arranged into a day in code (Venice never sees the places).
    const origin = await withCosts(db, "ask", () => resolvePlace(plan.place ?? parsed.trip?.place ?? null, here, homeCity));
    if (!origin || isMainlandChina(origin.city)) {
      notice = origin ? `Feta can't check places in mainland China yet, so I can't plan a day there.` : `I couldn't find ${plan.place} on the map. Try a nearby city?`;
    } else {
      // Who it's with shapes the search: groups and kids are tweaks; a
      // partner or family goes into the note.
      const who = plan.who ?? "";
      const tweaks = who === "friends" ? ["groups"] : who === "kids" ? ["kids"] : [];
      const note = [who === "partner" ? "with my partner" : who === "family" ? "with family" : "", plan.note ?? ""].filter(Boolean).join(", ").slice(0, 120);
      const ask = (category: "food_drinks" | "experiences") =>
        withCosts(db, "ask", () =>
          runPicks(token, { category, when: "weekend", origin, tweaks, note, ...(tripLabel ? { trip: tripLabel } : {}) }),
        ).then((r) => r.json().catch(() => ({})) as Promise<{ picks?: Pick[]; spares?: Pick[] }>);
      const [food, doing] = await Promise.all([ask("food_drinks"), ask("experiences")]);
      const all = [...(food.picks ?? []), ...(doing.picks ?? []), ...(food.spares ?? []), ...(doing.spares ?? [])];
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: origin.city.timeZone }).format(new Date());
      const start = /^\d{4}-\d{2}-\d{2}$/.test(plan.start ?? "") && plan.start! >= today ? plan.start! : today;
      const place = origin.source === "area" ? origin.label : origin.city.name;
      itinerary = buildItinerary(all, { start, days: Math.round(plan.days ?? 1), place });
      if (!itinerary.days.some((d) => d.stops.length > 0)) {
        itinerary = null;
        notice = "I couldn't find enough open places to plan a full day there. Try another area or day?";
      }
    }
  }
  if (s) {
    const origin = await withCosts(db, "ask", () => resolvePlace(s.place ?? parsed.trip?.place ?? null, here, homeCity));
    if (origin && isMainlandChina(origin.city)) {
      notice = `Feta can't check places in mainland China yet, so ideas for ${origin.city.name} come from general knowledge and are less reliable. Check before you go.`;
    } else if (!origin) {
      notice = `I couldn't find ${s.place ?? parsed.trip?.place} on the map. Try a nearby city?`;
    } else {
      const res = await withCosts(db, "ask", () => runPicks(token, {
          category: s.category === "experiences" ? "experiences" : "food_drinks",
          when: s.when === "weekend" || tripLabel ? "weekend" : "tonight",
          origin,
          tweaks: (s.tweaks ?? []).filter((t) => (TWEAKS as readonly string[]).includes(t)),
          // Their own words lead, and always mean a fresh search (never
          // the last list again), e.g. "something Pokémon-related".
          note: ((s.note ?? "").trim() || message).slice(0, 120),
          ...(tripLabel ? { trip: tripLabel } : {}),
      }));
      const data = (await res.json().catch(() => ({}))) as { picks?: Pick[]; notice?: string };
      // Chat shows a short answer: the best 3.
      picks = (data.picks ?? []).slice(0, 3);
      notice = data.notice;
    }
  }

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
        ...(tripId ? { trip_id: tripId } : {}),
        ...(itinerary
          ? { itinerary: { title: itinerary.title, days: itinerary.days.map((d) => ({ label: d.label, stops: d.stops.map((st) => ({ time: st.time, slot: st.slot, placeId: st.pick.placeId, kind: st.pick.kind, because: st.pick.because })) })) } }
          : {}),
      },
    },
  ]);

  return Response.json({ reply, picks, added, trip: tripLabel, weekend, itinerary, tripId, ...(notice ? { notice } : {}), ...(options.length && !s && !tripId ? { options } : {}) } satisfies AskReply);
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
