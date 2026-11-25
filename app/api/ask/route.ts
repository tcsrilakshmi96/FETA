import { MEALS, asksQuestion, plainReply, tripDays, withDinner, type Meal } from "@/lib/ask-rules";
import { isMainlandChina, type City } from "@/lib/cities";
import { cityAt, cityById, isCountryName, searchCities } from "@/lib/server/cities";
import { askIs, limitNoticeHere, overBudget, withCosts } from "@/lib/server/costs";
import { todayScope } from "@/lib/profile-scope";
import { runPicks } from "@/lib/server/engine";
import { findDestination } from "@/lib/server/places";
import { tasteSummary, TWEAKS, type Pick, type StoredPick } from "@/lib/server/picks";
import { planDays } from "@/lib/server/plan-days";
import { makeLooks, styleGuide } from "@/lib/server/style";
import { WHERES, styleById, type Look, type Where } from "@/lib/style";
import { loadTaste, userDb, userIdFor } from "@/lib/server/taste";
import { veniceJson, type ChatTurn } from "@/lib/server/venice";
import type { Itinerary } from "@/lib/server/itinerary";
import { cleanRoute, tripHeader, type RouteIn, type Trip } from "@/lib/server/trip";

// Search, AI and photos can take a while; the default cut-off is shorter.
// A slow reply plus a trip route or two searches can pass a minute (backend audit, 23 Nov 2026).
export const maxDuration = 300; // background work started here (a city's guide posts read, up to 3 min) must finish to be counted (audit, 24 Nov 2026)

// Ask Feta. Venice understands the person (chat, profile updates, turning
// words into a search); the picks engine (Gemini + Google Maps) finds the
// places. Venice never sees Google content: only the chat text and a short
// taste summary from Feta's own data.

type Origin = { lat: number; lng: number; label: string; source: "gps" | "area" | "city"; areaId?: string; city: City };

type VeniceReply = {
  reply?: string;
  learned?: ({ text?: string; for?: string } | string)[];
  // What they said about someone else (a partner, friends), apart from what
  // they said about themselves (tester, 23 Nov 2026: a vegetarian's "he eats
  // meat" landed in her own profile as "Eats meat").
  people?: { who?: string; name?: string | null; text?: string }[];
  weekend?: string | null;
  itinerary?: { place?: string | null; days?: number; start?: string | null; who?: string; note?: string } | null;
  trip?: { place?: string; dates?: string } | null;
  route?: (RouteIn & { edit?: boolean }) | null;
  search?: Search | Search[] | null;
  why?: boolean;
  options?: string[];
  outfit?: { occasion?: string; vibe?: string; note?: string } | null;
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
    meal?: string | null; // breakfast, brunch, lunch or dinner they'll eat there
    further?: boolean; // worth going beyond their usual distance
};

export type AskReply = {
  reply: string;
  picks: Pick[];
  added: { id: string; text: string }[];
  // Lines about the people they go out with: "Noted about Arjun", never
  // "Added to your profile".
  noted?: { id: string; text: string; who: string; name: string | null }[];
  today?: boolean; // what was added counts only today ("out with my parents tonight")
  trip: string | null; // "Goa · 14–18 Dec"
  notice?: string;
  options?: string[]; // tap-able answers to a question Feta just asked
  weekend?: { text: string } | null; // offered for their weekend plan; their tap adds it
  itinerary?: Itinerary | null; // a full day (or up to 3), stop by stop
  tripId?: string | null; // a trip planner card (route, getting around, stays, days)
  // What to wear (founder, 20 Nov 2026: Ask Feta "should ideally" give style
  // suggestions): an outfit from their styles, drawn on the phone, with a few
  // brands for the look in their country.
  outfit?: Look | null;
  brands?: { id: string; name: string; logo: string | null; homegrown: boolean }[];
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
  // Chat counts toward today's budgets too (audit, 20 Nov 2026).
  if (await overBudget(db)) return Response.json({ reply: await limitNoticeHere("ask"), picks: [], added: [], trip: null } satisfies AskReply);

  const here = body.origin ?? null;
  const homeCity = cityById(here?.city?.id);
  const [taste, { data: history }, { data: lastTripMessage }, { data: peopleLines }] = await Promise.all([
    loadTaste(db),
    db.from("chat_messages").select("role, content, extras").order("id", { ascending: false }).limit(16),
    // The trip being planned in this chat, so changes ("less Tokyo, more
    // Kyoto") edit it; from the last 2 weeks only (tester, 22 Nov 2026: an
    // old Lisbon trip came back for a London guest).
    db.from("chat_messages").select("extras").not("extras->>trip_id", "is", null).gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString()).order("id", { ascending: false }).limit(1).maybeSingle(),
    // What they've told Feta about the people they go out with, kept apart
    // from their own taste (founder, 19 Nov 2026: a date night assumed her
    // boyfriend likes what she likes).
    db.from("profile_lines").select("line_key, text").like("line_key", "people:%").is("removed_at", null),
  ]);
  // Their style (Style), so "what should I wear?" is about them.
  const [{ data: styleProfile }, { data: lovedBrands }] = await Promise.all([
    db.from("style_profiles").select("*").maybeSingle(),
    db.from("loved_brands").select("brands (name)").limit(12),
  ]);
  const myStyles: string[] = styleProfile?.styles ?? [];
  const styleText = myStyles.length
    ? `Their styles, strongest first: ${myStyles.map((id) => styleById(id)?.name ?? id).join(", ")}. They shop for ${styleProfile.wears === "both" ? "womenswear and menswear" : styleProfile.wears === "men" ? "menswear" : "womenswear"}.${styleProfile.cues?.length ? ` Outfits they love: ${styleProfile.cues.join("; ")}.` : ""}${(lovedBrands ?? []).length ? ` Brands they love: ${(lovedBrands as unknown as { brands: { name: string } }[]).map((b) => b.brands.name).join(", ")}.` : ""}`
    : "They haven't set up Style yet (Home → Style: a few outfit photos and Feta learns their style).";
  const people = (peopleLines ?? []).map((l) => `- ${String(l.line_key).split(":")[1]}: ${l.text}`).join("\n");
  // "Why this one?" answers are Gemini's reasons, written from Google's place
  // data, so the chat model gets a stand-in for them (Venice never receives
  // Google content; audit, 20 Nov 2026).
  const past = (history ?? []).reverse().map((m) => (m.extras?.why ? { ...m, content: "(Explained why those places were picked.)" } : m));
  const currentTripId = (lastTripMessage?.extras?.trip_id as string | undefined) ?? null;
  const { data: currentTrip } = currentTripId ? await db.from("trips").select("*").eq("id", currentTripId).maybeSingle<Trip>() : { data: null };

  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: homeCity?.timeZone ?? "UTC" }).format(new Date());
  const system = `You are Feta: a personal assistant and a friend with great taste. People can talk to you about anything in their life, and you answer and suggest like a thoughtful friend who knows them; your speciality is deciding where to eat and drink, what to do, and planning days out and trips. Talk like a thoughtful friend texting: short, warm, specific, honest, no hype, no emoji. Think about what they actually want, use everything you know about them below (what they told you themselves you can say back: "You said you love Thai, so…"), and give real opinions and advice. Ask only what you genuinely need to do it well, one question at a time with tap-able "options", and act once you can; if they're in a hurry or say "just pick", act straight away with sensible guesses.

Today is ${today}. ${homeCity ? `They are in ${homeCity.name}, ${homeCity.countryName}${here?.source === "area" ? ` (${here.label})` : ""}.` : "They haven't said where they are."}

What Feta knows about them (this person only; taps in setup and on cards are leanings, not things they told you: never state them back as facts, and never assume who they're with or when they travel):
${(homeCity && tasteSummary({ ...taste, saved: [] }, homeCity)) || "Not much yet."}

Their style:
${styleText}

What they've told Feta about the people they go out with:
${people || "Nothing yet."}

Plans with or for someone else (a date, friends, family): what you know is about this person, not the others; never assume a partner or friend likes what they like. Before searching, ask at most one short question, with "options", and only when their message leaves it open (if it already says who, what and where, search straight away and say what you assumed; testers waited through three questions): whether they want somewhere to eat and drink, something to do, or both (options like "Food and drinks", "Something to do", "Both"), unless they already said (a date night or an evening out includes dinner, a search with "meal": "dinner", unless they say they've eaten or want only drinks or only something to do; drinks are their own search, never mixed into a dinner's note, since a brewery isn't dinner); the mood (romantic, fun, chill, adventurous); and what the others like (unless it's listed above). Then act, using what suits them all; if their tastes differ, say how the plan works for both. If they say "just pick", act straight away. Never say you're looking or searching without sending the search in that same reply. What they tell you about anyone else ("he eats meat", "my mum is Jain") goes in "people", never in "learned".
${currentTrip ? `\nThe trip you're planning together: ${currentTrip.title}${currentTrip.start_date ? `, from ${currentTrip.start_date}` : ""}${currentTrip.who ? `, with ${currentTrip.who}` : ""}: ${currentTrip.cities.map((c) => `${c.name} ${c.nights} nights`).join(", ")}. It's saved in Saved; its card has the next steps (getting around, hotels, then day plans for each city, which are kept with the trip). For day plans in its cities, point them to the card's "plan days" buttons instead of sending an itinerary.\n` : ""}
Be a real assistant, not a menu (founder, 19 Nov 2026: "you can chat with it about anything in life and it should be able to answer and suggest"). Answer anything they ask, about going out or not (a gift idea, what to say in a toast, how to plan a busy week, a recipe, what to wear, a tricky conversation), well and briefly, from what you know; then, when it fits naturally, offer how Feta can help (a place, a plan). Never claim to have checked facts or prices live; for medical, legal or money decisions, give general guidance and suggest a professional. Help with anything about eating out, things to do, days out and trips too, even when it isn't one of Feta's usual options (a sunrise hike, a pottery class, a quiet place to read, the best time to go, what to bring or wear). Suggest things they may not have thought of, from what you know about them, and say why; offer a natural next step ("Breakfast near the trail after?"). Put what you learn about them in "learned" (e.g. "Into hikes and sunrise treks"), so Feta gets to know them over time.
Real places come only from Feta's own search, which checks them against their diet, budget, distance and opening hours. Never present a place as checked yourself; you may name a well-known place or landmark in a search "note" so Feta looks it up. Your reply is written before the search comes back: never promise to pick one or say more once results arrive; the places show under your reply, each with Feta's own reason for it. So when you search, say only what you're looking for and why that suits what they asked ("Looking for a quiet South Indian dinner near Indiranagar, then a comedy night."); never describe the places or what they'll have (a veg menu, thalis, craft beer, live music, the vibe, a view): you haven't seen them. Don't tell them what their taste is from one loved place or a tap in setup ("You like hole-in-the-wall places"); say why a search suits what they asked for instead.
Besides talking, you can do one of these per reply (leave the others null).
- "search": up to 2 searches at once (an array), e.g. something to do and somewhere to eat for an evening out. Each: places to eat or drink, or things to do, at any day and time: {"category": "food_drinks" or "experiences", "when": "tonight" or "weekend", "day": YYYY-MM-DD when they mean a particular day (tomorrow, Friday), else null, "time": "HH:MM" when they mean a time of day (06:00 for a sunrise hike, 13:00 for lunch), else null, "hours": how long they'll be there (1 to 6), "meal": "breakfast", "brunch", "lunch" or "dinner" when they'll eat a meal there, else null,"further": true when it's worth going beyond their usual distance (a hike, a lake, a beach, a day trip) or they ask to, "place": a city or neighbourhood they named, or null for where they are, "tweaks": any of ${JSON.stringify(TWEAKS)}, "note": what they want in a few words, e.g. "romantic, quiet, live jazz" or "sunrise trek, Nandi Hills"}. Feta shows the best 3 that match for each.
- "itinerary": a stop-by-stop plan for a day or two where they are, or a day trip nearby: {"place": the city or area, or null for where they are, "days": 1 to 3, "start": YYYY-MM-DD only if they said when, else null, "who": "solo", "partner", "friends", "family" or "kids" only if they said who's coming in this chat, else null, "note": the mood and must-dos, e.g. "slow mornings, food and art"}.
- "outfit": what to wear, whenever they ask what to wear or how to dress for something: {"occasion": "dinner", "drinks", "work", "do" (something to do), "day" (an everyday look) or "else" (anything else, say it in vibe), "vibe": the kind of outing in a few words, e.g. "date night", "rooftop bar", "office party", "note": anything else that matters, e.g. "it'll be cold", "my boyfriend's parents"}. Feta shows a complete look from their own styles with brands for it; your reply adds a line of advice, never a list of items. Ask the kind of outing first (one question with options) if you don't know it.
- "route": any trip, once you know where (never choose the destination for them: if they want a trip and haven't said where, ask, with a few options that suit them): travelling somewhere for 2 days or more (even one city, like "3 days in Calicut"), a country or region, or several cities. It becomes a trip card with getting there and around, where to stay, and day plans: {"title": e.g. "Japan", "start": YYYY-MM-DD only if they said when (a month alone means the 1st of the coming one), else null, "who": as above (null unless they said), "edit": true when changing the trip above, "cities": [{"name", "country", "nights": a number, "story": two short sentences on why it's worth it for them, tied to what they asked for and the season (never invent who they're with or a taste they didn't tell you), "focus": 3 to 6 words}]} in a sensible order, nights adding up to the trip. To change the trip above, send the whole route again with "edit": true. Once they're happy with it, don't send it again.

Reply with only a JSON object:
{"reply": what you say, 1 to 4 short sentences (a little longer when they ask for advice or an explanation that needs it),
 "options": 2 to 4 tap-able answers (under 5 words each) whenever your reply asks a question (always, so they can just tap), else [],
 "learned": up to 3 new lasting things worth remembering about the person you're talking to, and only them, each {"text": a short plain line about them (e.g. "Loves Mexican food"), "for": "always", or "today" for something true only tonight or for this one outing (who they're with tonight, tonight's mood, an occasion: "out with my parents tonight" is "today")}; [] if nothing new; never labels, personality types, health or allergy details,
 "people": up to 3 things they told you about someone else they go out with, each {"who": "partner", "family", "friends" or "kids", "name": their name if they said it, else null, "text": a short line that names them (e.g. "Arjun eats meat and loves craft beer", "Mum is Jain")}; [] if nothing,
 "weekend": null, or a short phrase when they say they want to do something this coming weekend where they are (not a trip); Feta offers to add it, it never adds it itself,
 "trip": null, or {"place", "dates": e.g. "14–18 Dec"} while you're talking about a trip,
 "search": null or an array of 1 or 2 as above, "itinerary": null or as above, "route": null or as above, "outfit": null or as above,
 "why": true if they ask why a pick was chosen}
Write only plain words in "reply": never tags, code or tool calls; to look something up, fill "search" (or "itinerary", "route", "outfit"). Never say you're looking for something unless you fill "search" in this same reply. Never say food is safe for an allergy or a diet. Mainland China (not Hong Kong or Macau): no search, itinerary or route; give up to 3 ideas from what you know in "reply", saying they're less reliable than usual.`;

  let parsed: VeniceReply;
  try {
    // Counted as chat spend (Venice).
    parsed = await withCosts(db, "ask", () => (askIs({ key: [message, past.length], label: "chat reply" }), veniceJson<VeniceReply>(
      [
        { role: "system", content: system },
        // Its own past replies in the same JSON it must answer in, with the
        // options it offered (as plain words it drifted into plain-words
        // answers and lost its buttons, 19 Nov 2026).
        ...past.map((m) => ({ role: m.role, content: m.role === "assistant" ? JSON.stringify({ reply: plainReply(String(m.content)), options: m.extras?.options ?? [] }) : m.content }) as ChatTurn),
        { role: "user", content: message },
      ],
      3000,
    )));
  } catch (error) {
    console.error(error);
    return Response.json({ reply: "I couldn't think just now. Try again in a moment.", picks: [], added: [], trip: null } satisfies AskReply);
  }

  // One search or two (something to do and somewhere to eat for an evening out).
  // A date night includes dinner unless they said otherwise (lib/ask-rules.ts).
  const talk = [...past.filter((m) => m.role === "user").map((m) => String(m.content)), message];
  const asked = withDinner((Array.isArray(parsed.search) ? parsed.search : parsed.search ? [parsed.search] : []).filter((x): x is Search => !!x && typeof x === "object").slice(0, 2), talk);
  let reply = plainReply(String(parsed.reply ?? "")).slice(0, 1200) || "Tell me a bit more?";
  const tripLabel = parsed.trip?.place ? [parsed.trip.place, parsed.trip.dates].filter(Boolean).join(" · ").slice(0, 60) : null;

  // "Why this one?": answer from the reasons Feta already wrote.
  let explained = false;
  if (parsed.why) {
    const lastPicks = past.map((m) => m.extras?.picks as StoredPick[] | undefined).filter(Boolean).pop();
    if (lastPicks?.length) {
      // Only the engine's reasons, which name what each place really serves;
      // a place with none says so rather than getting an invented one.
      const reasons = [...new Set(lastPicks.map((p) => p.because).filter(Boolean))];
      reply = reasons.length ? reasons.join("\n") : "They matched what you asked for, within your budget and distance and open then. Tap one for its details.";
      explained = true;
    }
  }

  // Things learned go straight into the profile, shown with Undo.
  // Something true only tonight ("out with my parents tonight") counts for
  // today only (Round 6: it reached Lisbon picks a week later).
  const learned = (Array.isArray(parsed.learned) ? parsed.learned : [])
    .map((l) => (typeof l === "string" ? { text: l, for: "always" } : { text: l?.text ?? "", for: l?.for ?? "always" }))
    .map((l) => ({ text: String(l.text).trim().slice(0, 80), today: l.for === "today" }))
    .filter((l) => l.text)
    .slice(0, 3);
  let added: { id: string; text: string }[] = [];
  const todayOnly = learned.length > 0 && learned.every((l) => l.today);
  if (learned.length > 0) {
    const { data, error } = await db
      .from("profile_lines")
      .insert(learned.map((l) => ({ user_id: userId, line_key: `chat:${crypto.randomUUID()}`, text: l.text, source: "chat", trip: l.today ? todayScope() : null })))
      .select("id, text");
    if (error) console.error("Saving chat lines failed", error.message);
    added = data ?? [];
  }
  // About the people they go out with: kept apart (Ask's brief only, never
  // everyday picks) and shown as "Noted about Arjun", never in their profile.
  const others = (Array.isArray(parsed.people) ? parsed.people : [])
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      who: (ABOUT as readonly string[]).includes(p.who ?? "") ? p.who! : "friends",
      name: typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 30) : null,
      text: String(p.text ?? "").trim().slice(0, 80),
    }))
    .filter((p) => p.text)
    .slice(0, 3);
  let noted: NonNullable<AskReply["noted"]> = [];
  if (others.length > 0) {
    const { data, error } = await db
      .from("profile_lines")
      .insert(others.map((p) => ({ user_id: userId, line_key: `people:${p.who}:${crypto.randomUUID()}`, text: p.text, source: "chat" })))
      .select("id, text");
    if (error) console.error("Saving people lines failed", error.message);
    noted = (data ?? []).map((row, i) => ({ id: row.id, text: row.text, who: others[i].who, name: others[i].name }));
  }

  // Something for this weekend is offered with "Add to my weekend"; only
  // their tap adds it (tester, 22 Nov 2026: trips landed on the weekend list
  // with no one tapping Save).
  const wish = typeof parsed.weekend === "string" ? parsed.weekend.trim().slice(0, 80) : "";
  const weekend: AskReply["weekend"] = wish ? { text: wish } : null;

  // A search goes through the same picks engine and hard filters as Picks.
  let picks: Pick[] = [];
  let notice: string | undefined;
  let options = cleanOptions(parsed.options);
  // A question always comes with answers to tap (tester, 23 Nov 2026: "Are
  // you after somewhere to eat and drink, something to do, or both?" came
  // with none, though the brief asks for them): when the model leaves them
  // out, a second short call writes them for that question.
  if (!options.length && asksQuestion(reply) && !asked.length && !parsed.itinerary && !parsed.route?.cities?.length && !parsed.outfit) {
    options = await withCosts(db, "ask", () => (askIs({ key: reply, label: "chat options" }), optionsFor(message, reply))).catch((error) => {
      console.error(error);
      return [];
    });
  }
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
  // They asked for 2 days or more somewhere away from home, in their own
  // words in this chat's last few messages (the length often comes before
  // a question back; re-audit, 25 Nov 2026), and the model sent nothing for it (Opus/Sonnet trial, 25 Nov
  // 2026: "3 days in Porto next month" came back as "I'll put together a
  // 3-day plan" and no card): the route is made. Never while a trip is
  // being planned (its follow-ups, "Is Kyoto worth a day?", would replace
  // its hotels and day plans; audits, 25 Nov 2026), and never on a question
  // back to them.
  const tripPlace = parsed.trip?.place ?? null;
  const promisedTrip = !currentTrip && !!tripPlace && Math.max(...talk.slice(-6).map(tripDays)) >= 2 && !asked.length && !it && !parsed.outfit && !asksQuestion(reply) && awayFromHome(tripPlace);
  const wantsRoute =
    !parsed.why &&
    !parsed.route?.cities?.length &&
    (promisedTrip ||
    // Only once a place is named: a trip with no destination asks where first.
    ((it && !!it.place && ((it.days ?? 1) > 3 || isCountryName(it.place) || ((it.days ?? 1) >= 2 && awayFromHome(it.place)))) ||
      (asked.length && tripLabel && isCountryName(asked[0].place ?? parsed.trip?.place ?? ""))));
  if (wantsRoute) {
    const route = await withCosts(db, "ask_trip_route", () => (askIs({ key: message, label: "trip route" }), routeFor(past, message, system))).catch((error) => {
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
  // The header shows the saved trip when there is one, so it matches the card.
  const shownTrip = tripId ? (route ?? currentTrip) : null;
  const header = shownTrip ? tripHeader(shownTrip) : tripLabel;
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
    // A Google hiccup says so in the chat instead of losing the reply
    // already paid for (audit, 24 Nov 2026).
    const origin = await withCosts(db, "ask_place", () => (askIs({ key: plan.place ?? parsed.trip?.place ?? "", label: "find a place" }), resolvePlace(plan.place ?? parsed.trip?.place ?? null, here, homeCity))).catch(noGoogle(null));
    if (!origin || isMainlandChina(origin.city)) {
      notice = origin ? `Feta can't check places in mainland China yet, so I can't plan a day there.` : `I couldn't find ${plan.place} on the map. Try a nearby city?`;
    } else {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: origin.city.timeZone }).format(new Date());
      const start = /^\d{4}-\d{2}-\d{2}$/.test(plan.start ?? "") && plan.start! >= today ? plan.start! : today;
      const planned = await withCosts(db, "ask_day_plan", () =>
        planDays(token, { origin, start, days: plan.days ?? 1, who: plan.who, focus: plan.note, trip: tripLabel ?? undefined, place: origin.source === "area" ? origin.label : origin.city.name }),
      ).catch(noGoogle({ itinerary: null, limited: "Couldn't reach Google Maps just now. Ask me again in a minute?" }));
      itinerary = planned.itinerary;
      if (!itinerary) notice = planned.limited ?? "I couldn't find enough open places to plan a full day there. Try another area or day?";
    }
  }
  // Both at once, so an evening out takes no longer than one search.
  const results = await Promise.all(searches.map(async (s): Promise<{ found: Pick[]; notice?: string }> => searchFor(s).catch(noGoogle({ found: [], notice: "Couldn't reach Google Maps just now. Ask me again in a minute?" }))));
  async function searchFor(s: (typeof searches)[number]): Promise<{ found: Pick[]; notice?: string }> {
    const origin = await withCosts(db, "ask_place", () => (askIs({ key: s.place ?? parsed.trip?.place ?? "", label: "find a place" }), resolvePlace(s.place ?? parsed.trip?.place ?? null, here, homeCity)));
    if (origin && isMainlandChina(origin.city)) {
      return { found: [], notice: `Feta can't check places in mainland China yet, so ideas for ${origin.city.name} come from general knowledge and are less reliable. Check before you go.` };
    }
    if (!origin) return { found: [], notice: `I couldn't find ${s.place ?? parsed.trip?.place} on the map. Try a nearby city?` };
    const at = askedTime(s, origin.city);
    const res = await withCosts(db, "ask_search", () => (askIs({ key: [s.category, s.when, s.place ?? "", s.note ?? message, s.tweaks ?? [], s.further ?? false], label: `chat search · ${s.category === "experiences" ? "things to do" : "food"} · ${origin.city.name}` }), runPicks(token, {
        category: s.category === "experiences" ? "experiences" : "food_drinks",
        when: s.when === "weekend" || tripLabel || (at && [0, 6].includes(new Date(`${at.day}T12:00:00Z`).getUTCDay())) ? "weekend" : "tonight",
        ...(at ? { at } : {}),
        // "Dinner tonight" asked by day means the evening, not the next few
        // hours (audit, 24 Nov 2026); "lunch" or "now" keeps the clock's slot.
        ...(!at && s.when !== "weekend" && !tripLabel && (s.meal === "dinner" || /\b(tonight|this evening|evening|night|dinner|drinks)\b/i.test(`${message} ${s.note ?? ""}`)) ? { evening: true } : {}),
        // A neighbourhood they named ("near Indiranagar") means near it,
        // not their usual distance from it (tester, 21 Nov 2026).
        ...(s.further ? { reach: "day_trip" } : origin.source === "area" && s.place ? { reach: "walk" } : {}),
        // Only places that match what was asked, never the rest of their
        // everyday set (founder, 18 Nov 2026: asked for a hike, got bowling).
        only: "asked",
        ...(MEALS.includes(s.meal as Meal) ? { meal: s.meal } : {}),
        origin,
        tweaks: (s.tweaks ?? []).filter((t) => (TWEAKS as readonly string[]).includes(t)),
        // Their own words lead, and always mean a fresh search (never
        // the last list again), e.g. "something Pokémon-related".
        note: ((s.note ?? "").trim() || message).slice(0, 120),
        ...(tripLabel ? { trip: tripLabel } : {}),
    })));
    const data = (await res.json().catch(() => ({}))) as { picks?: Pick[]; notice?: string; error?: string };
    // Chat shows a short answer: the best 3. Nothing that matches is said plainly.
    const found = (data.picks ?? []).slice(0, 3);
    // Why nothing came back, in chat words: the engine's reason without its
    // tips for the picks screen, then what Feta can try next.
    const whenText = at ? dayText(at.day, origin.city) : s.when === "weekend" || tripLabel ? "this weekend" : "tonight";
    const reason = (data.notice ?? data.error)?.replace(/\s*Try [^.]*\.$/, "") || `Nothing I found fits ${whenText}${s.further ? "" : " within your distance"}.`;
    return { found, notice: found.length ? undefined : `${reason} ${s.further ? "Want to try another day, or something similar?" : "Want me to look further out, or another day?"}` };
  }
  for (const r of results) picks = [...picks, ...r.found.filter((p) => !picks.some((q) => q.placeId === p.placeId))];
  const notices = results.map((r) => r.notice).filter(Boolean);
  if (notices.length) notice = notices.join(" ");

  // What to wear: an outfit from their styles (Gemini, Feta's own data
  // only), with brands for the look that sell in their country.
  let outfit: Look | null = null;
  let brands: AskReply["brands"] = [];
  // "What should I wear…" always gets the outfit card: the model sometimes
  // answered in words only (audit, 20 Nov 2026).
  const wearAsk = /\b(what (should|do|can) i wear|what to wear|outfit|how (should|do) i dress|dress (up )?for)\b/i.test(message);
  // …unless it's asking what kind of outing first (then the card comes with the answer).
  if (!parsed.outfit && wearAsk && !(parsed.options ?? []).length && !searches.length && !itinerary && !tripId) {
    const occ = /\b(drinks?|bar|pub|club|party)\b/i.test(message) ? "drinks" : /\b(dinner|lunch|brunch|restaurant|date)\b/i.test(message) ? "dinner" : /\b(work|office)\b/i.test(message) ? "work" : /\b(errands|day)\b/i.test(message) ? "day" : "do";
    parsed.outfit = { occasion: occ, vibe: message.slice(0, 60) };
  }
  if (parsed.outfit && typeof parsed.outfit === "object" && !(parsed.options ?? []).length && !searches.length && !itinerary && !tripId) {
    const o = parsed.outfit;
    // The old "day" (an everyday look) and the new outings both map to Style's.
    const where: Where = WHERES.some((x) => x.id === o.occasion) ? (o.occasion as Where) : "else";
    const cut = (v: unknown, n: number) => (v ? String(v).slice(0, n) : undefined);
    const { data: lovedNames } = await db.from("loved_brands").select("brands (name)");
    const guide = await styleGuide(db, myStyles.length ? myStyles : ["smart-casual", "basics"]).catch(() => "");
    outfit = await withCosts(db, "ask_outfit", () =>
      makeLooks({
        styles: myStyles.length ? myStyles : ["smart-casual", "basics"],
        guide,
        wears: styleProfile?.wears ?? "women",
        for: { key: "ask", text: cut(o.vibe, 60) ?? "Ask Feta", where, stops: [], walkKm: null, place: where === "else" ? cut(o.vibe, 60) : undefined },
        note: cut([o.vibe, o.note].filter(Boolean).join(". "), 200) ?? null,
        city: homeCity?.name ?? "their city",
        localTime: new Intl.DateTimeFormat("en-GB", { weekday: "long", hour: "numeric", minute: "2-digit", hour12: true, timeZone: homeCity?.timeZone ?? "UTC" }).format(new Date()),
        count: 1,
        wardrobe: styleProfile?.wardrobe ?? [],
        usuals: ((lovedNames ?? []) as unknown as { brands: { name: string } | null }[]).map((r) => r.brands?.name).filter((n): n is string => !!n),
        cues: styleProfile?.cues ?? [],
        worn: [],
        off: styleProfile?.off_notes ?? [],
        avoid: [],
      }).then((ls) => ls[0] ?? null),
    ).catch((error) => {
      console.error(error);
      return null;
    });
    if (outfit && homeCity) {
      const { data: rows } = await db
        .from("brand_styles")
        .select("association, review_status, brands!inner (id, name, logo_url, origin_country, brand_markets!inner (country, presence_type))")
        .eq("style_id", outfit.style)
        .neq("review_status", "rejected")
        .eq("brands.brand_markets.country", homeCity.country)
        .limit(40);
      type Row = { association: string; review_status: string; brands: { id: string; name: string; logo_url: string | null; origin_country: string | null; brand_markets: { presence_type: string }[] } };
      brands = ((rows ?? []) as unknown as Row[])
        .filter((r) => r.brands.brand_markets.every((m) => m.presence_type !== "ships from abroad"))
        .sort((a, b) => Number(b.review_status === "approved") - Number(a.review_status === "approved") || Number(b.association === "main") - Number(a.association === "main"))
        .slice(0, 4)
        .map((r) => ({ id: r.brands.id, name: r.brands.name, logo: r.brands.logo_url, homegrown: r.brands.origin_country === homeCity.country }));
    }
  }

  // Learned while planning a trip: for that trip only unless they say
  // otherwise (traveller, 23 Nov 2026: "Porto sights" reached Lisbon's
  // everyday picks and searched both lists again).
  const forTrip = header && added.length && !todayOnly ? header : null;
  if (forTrip) {
    const { error } = await db.from("profile_lines").update({ trip: forTrip }).in("id", added.map((a) => a.id));
    if (error) console.error("Scoping trip lines failed", error.message);
  }
  await db.from("chat_messages").insert([
    { user_id: userId, role: "user", content: message },
    {
      user_id: userId,
      role: "assistant",
      content: reply,
      // Place IDs and Feta's own words only: everything else the answer
      // showed comes back when Ask is opened again (lib/ask-client.ts).
      extras: {
        picks: picks.map((p) => ({ placeId: p.placeId, kind: p.kind, verdict: p.verdict, because: p.because })),
        added,
        ...(noted.length ? { noted } : {}),
        ...(todayOnly ? { today: true } : {}),
        ...(notice ? { notice } : {}),
        ...(outfit ? { outfit, brands } : {}),
        trip: header,
        weekend,
        ...(explained ? { why: true } : {}),
        ...(options.length && !searches.length && !tripId ? { options } : {}),
        ...(tripId ? { trip_id: tripId } : {}),
        ...(itinerary
          ? { itinerary: { title: itinerary.title, days: itinerary.days.map((d) => ({ label: d.label, stops: d.stops.map((st) => ({ time: st.time, slot: st.slot, placeId: st.pick.placeId, kind: st.pick.kind, because: st.pick.because })) })) } }
          : {}),
      },
    },
  ]);

  return Response.json({ reply, picks, added, ...(noted.length ? { noted } : {}), ...(todayOnly ? { today: true } : {}), trip: header, weekend, itinerary, tripId, ...(outfit ? { outfit, brands } : {}), ...(notice ? { notice } : {}), ...(options.length && !searches.length && !tripId ? { options } : {}) } satisfies AskReply);
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
  const mealAt: Record<string, number> = { breakfast: 9 * 60, brunch: 11 * 60 + 30, lunch: 13 * 60, dinner: 19 * 60 + 30 };
  const start = time ? Number(time[1]) * 60 + Number(time[2]) : s.category === "experiences" ? 12 * 60 : (mealAt[s.meal ?? ""] ?? 19 * 60 + 30);
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

function cleanOptions(list: unknown): string[] {
  return (Array.isArray(list) ? list : [])
    .filter((o): o is string => typeof o === "string")
    .map((o) => o.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 4);
}

// Tap-able answers for a question the reply asked (chat text only).
async function optionsFor(message: string, question: string): Promise<string[]> {
  const reply = await veniceJson<{ options?: string[] }>(
    [
      { role: "system", content: `You write the answers someone can tap to reply to a question in a chat. Reply with only {"options": 2 to 4 short answers, under 5 words each, in their voice, covering the likely choices}.` },
      { role: "user", content: `They said: "${message}"\nThe question: "${question}"` },
    ],
    300,
  );
  return cleanOptions(reply.options);
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

// A failed Google lookup inside a chat reply: logged, and the reply goes on.
function noGoogle<T>(fallback: T) {
  return (error: unknown): T => {
    console.error(error);
    return fallback;
  };
}
