import { isMainlandChina, type City } from "@/lib/cities";
import { cityAt, cityById, searchCities } from "@/lib/server/cities";
import { withCosts } from "@/lib/server/costs";
import { runPicks } from "@/lib/server/engine";
import { findDestination } from "@/lib/server/places";
import { tasteSummary, TWEAKS, type Pick, type StoredPick } from "@/lib/server/picks";
import { loadTaste, userDb, userIdFor } from "@/lib/server/taste";
import { veniceJson, type ChatTurn } from "@/lib/server/venice";

// Search, AI and photos can take a while; the default cut-off is shorter.
export const maxDuration = 60;

// Ask Feta. Venice understands the person (chat, profile updates, turning
// words into a search); the picks engine (Gemini + Google Maps) finds the
// places. Venice never sees Google content: only the chat text and a short
// taste summary from Feta's own data.

type Origin = { lat: number; lng: number; label: string; source: "gps" | "area" | "city"; areaId?: string; city: City };

type VeniceReply = {
  reply?: string;
  learned?: ({ text?: string } | string)[];
  trip?: { place?: string; dates?: string } | null;
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
};


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

  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: homeCity?.timeZone ?? "UTC" }).format(new Date());
  const system = `You are Feta, a warm, honest friend who picks places to eat and drink and things to do. You talk briefly, like a friend texting.
Today is ${today}. ${homeCity ? `They are in ${homeCity.name}, ${homeCity.countryName}${here?.source === "area" ? ` (${here.label})` : ""}.` : "They haven't said where they are."}

What Feta knows about them:
${(homeCity && tasteSummary(taste, homeCity)) || "Not much yet."}

Reply with only a JSON object:
{"reply": 1 or 2 short, plain sentences (a question counts as one). No hype, no emoji.
 "options": when "reply" asks a question, 2 to 4 short answers they can tap (each under 5 words, e.g. "Quiet and cosy", "Something lively", "Surprise me"); otherwise [].
 "learned": at most 3 new, lasting things worth remembering about their taste, the people they go out with (e.g. "Partner loves live music", "Parents prefer early dinners"), budget or plans, each a short plain line. [] if nothing new. Never labels or personality types, never health or allergy details.
 "trip": null, or {"place": city or region, "dates": short dates like "14–18 Dec"} if they are planning a trip.
 "search": null, or {"category": "food_drinks" or "experiences", "when": "tonight" or "weekend", "place": a city or neighbourhood they named, or null, "tweaks": any of ${JSON.stringify(TWEAKS)}, "note": a short phrase capturing what they want, e.g. "romantic, quiet, live jazz"} once you know enough to suggest places.
 "why": true if they ask why a pick was chosen.}
How to talk: like a friend who plans well. For a plan that matters (a date night, a birthday, an anniversary, family visiting, friends in town, a trip), get to know it first: ask one question at a time, at most 3 in total, before searching. Good things to ask: who it's with and what they're like, the mood they want, food or activity, budget, when. Skip anything you already know from above or from the chat, and use what you know ("Your partner loves live music, so a jazz bar after dinner?"). If they say "just suggest", "surprise me" or seem in a hurry, search straight away. Quick everyday asks ("coffee near me", "something cheaper tonight", "3 more") need no questions: search straight away. When you set "search", "options" is [] and "reply" says you're finding 3 and, in a few words, what you're looking for. While you are still asking, "search" is null and "trip" may be set.
You can search anywhere in the world except mainland China (Hong Kong and Macau are fine): for mainland China, set "search" to null and give up to 3 ideas from what you know in "reply" (up to 4 short sentences), saying they are less reliable than usual and to check before going. Never say food is safe for an allergy or a diet.`;

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
    .map((l) => (typeof l === "string" ? l : (l.text ?? "")).trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 3);
  let added: { id: string; text: string }[] = [];
  if (learned.length > 0) {
    const { data, error } = await db
      .from("profile_lines")
      .insert(learned.map((text) => ({ user_id: userId, line_key: `chat:${crypto.randomUUID()}`, text, source: "chat" })))
      .select("id, text");
    if (error) console.error("Saving chat lines failed", error.message);
    added = data ?? [];
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
  const s = parsed.why ? null : (parsed.search ?? (parsed.trip?.place && options.length === 0 ? { category: "food_drinks", place: parsed.trip.place } : null));
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
          note: (s.note ?? "").slice(0, 120),
          ...(tripLabel ? { trip: tripLabel } : {}),
      }));
      const data = (await res.json().catch(() => ({}))) as { picks?: Pick[]; notice?: string };
      picks = data.picks ?? [];
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
      },
    },
  ]);

  return Response.json({ reply, picks, added, trip: tripLabel, ...(notice ? { notice } : {}), ...(options.length && !s ? { options } : {}) } satisfies AskReply);
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
