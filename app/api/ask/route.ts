import { CITIES, coveredCityAt, searchCities, type City } from "@/lib/cities";
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

type Origin = { lat: number; lng: number; label: string; source: "gps" | "area" | "city"; cityId: string };

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
};

export type AskReply = {
  reply: string;
  picks: Pick[];
  added: { id: string; text: string }[];
  trip: string | null; // "Goa · 14–18 Dec"
  notice?: string;
};

const SINGLE_ZONE: Record<string, string> = {
  IN: "Asia/Kolkata", GB: "Europe/London", JP: "Asia/Tokyo", AE: "Asia/Dubai", SG: "Asia/Singapore",
  FR: "Europe/Paris", IT: "Europe/Rome", ES: "Europe/Madrid", DE: "Europe/Berlin", NL: "Europe/Amsterdam",
  PT: "Europe/Lisbon", TH: "Asia/Bangkok", LK: "Asia/Colombo", NP: "Asia/Kathmandu", MV: "Indian/Maldives",
  VN: "Asia/Ho_Chi_Minh", KR: "Asia/Seoul", HK: "Asia/Hong_Kong", GR: "Europe/Athens", TR: "Europe/Istanbul",
};
const EURO = ["FR", "IT", "ES", "DE", "NL", "PT", "GR", "IE", "AT", "BE", "FI"];
const CURRENCY: Record<string, string> = { IN: "INR", US: "USD", CA: "CAD", GB: "GBP", AE: "AED", SG: "SGD", AU: "AUD", JP: "JPY" };

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
  const homeCity = CITIES.find((c) => c.id === here?.cityId) ?? CITIES[0];
  const [taste, { data: history }] = await Promise.all([
    loadTaste(db),
    db.from("chat_messages").select("role, content, extras").order("id", { ascending: false }).limit(12),
  ]);
  const past = (history ?? []).reverse();

  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: homeCity.timeZone }).format(new Date());
  const system = `You are Feta, a warm, honest friend who picks places to eat and drink and things to do. You talk briefly, like a friend texting.
Today is ${today}. They are in ${homeCity.name}${here?.source === "area" ? ` (${here.label})` : ""}.

What Feta knows about them:
${tasteSummary(taste, homeCity) || "Not much yet."}

Reply with only a JSON object:
{"reply": 1 or 2 short, plain sentences. No hype, no emoji.
 "learned": at most 3 new, lasting things worth remembering about their taste, company, budget or plans, each a short plain line such as "Often out with parents" or "Prefers quiet places". [] if nothing new. Never labels or personality types, never health or allergy details.
 "trip": null, or {"place": city or region, "dates": short dates like "14–18 Dec"} if they are planning a trip.
 "search": null, or {"category": "food_drinks" or "experiences", "when": "tonight" or "weekend", "place": a city or neighbourhood they named, or null, "tweaks": any of ${JSON.stringify(TWEAKS)}, "note": a short phrase for anything else they want, e.g. "beach shack"} whenever they want suggestions, different ones, or plans.
 "why": true if they ask why a pick was chosen.}
When you set "search", say in "reply" that you're finding 3. You can search anywhere in the world. When they mention a trip or a place, set "search" straight away (food_drinks unless they say otherwise) rather than asking first. Never say food is safe for an allergy or a diet.`;

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
  // A trip mentioned without a search still gets 3 places there.
  const s = parsed.why ? null : (parsed.search ?? (parsed.trip?.place ? { category: "food_drinks", place: parsed.trip.place } : null));
  if (s) {
    const origin = await resolvePlace(s.place ?? parsed.trip?.place ?? null, here, homeCity);
    if (!origin) {
      notice = `I couldn't find ${s.place ?? parsed.trip?.place} on the map. Try a nearby city?`;
    } else {
      const res = await runPicks(token, {
          category: s.category === "experiences" ? "experiences" : "food_drinks",
          when: s.when === "weekend" || tripLabel ? "weekend" : "tonight",
          origin,
          tweaks: (s.tweaks ?? []).filter((t) => (TWEAKS as readonly string[]).includes(t)),
          note: (s.note ?? "").slice(0, 120),
          ...(tripLabel ? { trip: tripLabel } : {}),
      });
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

  return Response.json({ reply, picks, added, trip: tripLabel, ...(notice ? { notice } : {}) } satisfies AskReply);
}

// Where to search: a covered city or one of its areas, or anywhere else as
// a trip destination. No place named means where the user is now.
async function resolvePlace(name: string | null, here: Origin | null, home: City) {
  if (!name) return here ?? { lat: home.lat, lng: home.lng, label: `Anywhere in ${home.name}`, source: "city", cityId: home.id };
  const q = name.toLowerCase();
  for (const city of CITIES.filter((c) => c.covered)) {
    const area = city.areas?.find((a) => q.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(q));
    if (area) return { lat: area.lat, lng: area.lng, label: area.name, source: "area", cityId: city.id };
  }
  const [match] = searchCities(name).filter((c) => c.covered);
  if (match && (q.includes(match.name.toLowerCase()) || match.aliases?.some((a) => q.includes(a)))) {
    return { lat: match.lat, lng: match.lng, label: `Anywhere in ${match.name}`, source: "city", cityId: match.id };
  }
  const found = await findDestination(name);
  if (!found) return null;
  const covered = found.country === "IN" ? coveredCityAt(found) : null;
  if (covered) return { lat: found.lat, lng: found.lng, label: found.name, source: "area", cityId: covered.id };
  return {
    lat: found.lat,
    lng: found.lng,
    label: found.name,
    source: "city",
    cityId: `trip:${found.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    place: {
      name: found.name,
      country: found.country,
      currency: EURO.includes(found.country) ? "EUR" : CURRENCY[found.country] ?? "USD",
      timeZone: SINGLE_ZONE[found.country] ?? "UTC",
    },
  };
}
