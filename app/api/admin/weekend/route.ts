import { distanceKm } from "@/lib/cities";
import { cityById } from "@/lib/server/cities";
import { withCosts } from "@/lib/server/costs";
import { placeDetails, type Place } from "@/lib/server/places";
import type { StoredPick } from "@/lib/server/picks";
import { userDb } from "@/lib/server/taste";

export const maxDuration = 60;

// Admin only: this weekend's WhatsApp plans, drafted in code for everyone
// who added a number. Built from the places they ticked for the weekend and
// their latest weekend picks, with opening hours checked live for Saturday
// evening and Sunday late morning. Nothing is stored: the founder reads,
// edits and sends each one herself. Never mentions diet.

type Input = {
  userId: string;
  whatsapp: string;
  cityId: string | null;
  ticked: { placeId: string; category: string | null; because: string | null; note: string | null }[];
  wishes: string[];
  picks: StoredPick[][];
  people: string[];
  sentAt: string | null;
};

type Option = { placeId: string; kind: string; ticked: boolean; event?: StoredPick["event"] };
type Stop = { label: string; time: string; name: string; area: string; mapsUri: string; ticked: boolean };

export type WeekendDraft = {
  userId: string;
  whatsapp: string;
  city: string;
  sentAt: string | null;
  people: string[];
  wishes: string[];
  stops: Stop[];
  message: string;
};

const SITE = "https://feta-beige.vercel.app";
const MAX_PLACES = 8; // live lookups per person (Google charges each one)
const WEEK = 7 * 24 * 60;

// Open on that weekday from "start" (minutes after midnight) for "minutes",
// by the place's weekly hours. Places with no hours on Google are left out.
function openFor(place: Place, day: number, start: number, minutes: number) {
  const periods = place.regularOpeningHours?.periods ?? [];
  const from = day * 24 * 60 + start;
  return periods.some(({ open, close }) => {
    if (!close) return true; // open all day, every day
    const o = open.day * 1440 + (open.hour ?? 0) * 60 + (open.minute ?? 0);
    let c = close.day * 1440 + (close.hour ?? 0) * 60 + (close.minute ?? 0);
    if (c <= o) c += WEEK;
    return [from, from + WEEK].some((f) => f >= o && f + minutes <= c);
  });
}

function areaOf(place: Place) {
  const parts = place.addressComponents ?? [];
  const pick = (type: string) => parts.find((p) => p.types?.includes(type))?.longText;
  return pick("sublocality_level_1") ?? pick("neighborhood") ?? pick("locality") ?? "";
}

const clock = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
};

async function draft(input: Input, sat: string): Promise<WeekendDraft> {
  const city = cityById(input.cityId);
  // Ticked places first, then their weekend picks; one of each place.
  const seen = new Set<string>();
  const options: Option[] = [];
  const add = (o: Option) => {
    if (seen.has(o.placeId)) return;
    seen.add(o.placeId);
    options.push(o);
  };
  for (const t of input.ticked)
    add({ placeId: t.placeId, kind: t.category === "experiences" ? "DO" : "EAT", ticked: true });
  for (const set of input.picks) for (const p of set) add({ placeId: p.placeId, kind: p.kind, ticked: false, event: p.event });

  const events = options.filter((o) => o.event);
  const venues = options.filter((o) => !o.event && !o.placeId.startsWith("event:")).slice(0, MAX_PLACES);
  const places = new Map<string, Place>();
  await Promise.all(
    venues.map(async (o) => {
      const p = await placeDetails(o.placeId, false);
      if (p && (p.businessStatus ?? "OPERATIONAL") === "OPERATIONAL") places.set(o.placeId, p);
    }),
  );
  // A ticked place's kind comes from Google's main type.
  const kindOf = (o: Option, p: Place) => {
    if (!o.ticked) return o.kind;
    const t = p.primaryType ?? "";
    if (/bar|pub|night_club|wine|cocktail|brewery/.test(t)) return "DRINK";
    if (/restaurant|cafe|bakery|food|coffee|dessert|brunch/.test(t)) return "EAT";
    return "DO";
  };
  const live = venues
    .map((o) => ({ o, p: places.get(o.placeId) }))
    .filter((x): x is { o: Option; p: Place } => !!x.p)
    .map((x) => ({ ...x, kind: kindOf(x.o, x.p) }));
  const at = (p: Place) => (p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null);
  const near = (a: Place, b: Place) => {
    const x = at(a);
    const y = at(b);
    return x && y ? distanceKm(x, y) : 99;
  };

  const stops: Stop[] = [];
  const stop = (label: string, time: number, p: Place, ticked: boolean): Stop => ({
    label,
    time: clock(time),
    name: p.displayName?.text ?? "",
    area: areaOf(p),
    mapsUri: p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`,
    ticked,
  });

  // Saturday: dinner at 7:30, then something within 3 km at about 9:15.
  const dinner = live.find((x) => (x.kind === "EAT" || x.kind === "DRINK") && openFor(x.p, 6, 19 * 60 + 30, 75));
  if (dinner) {
    stops.push(stop("Saturday dinner", 19 * 60 + 30, dinner.p, dinner.o.ticked));
    const after = live.find(
      (x) => x !== dinner && (x.kind === "DO" || x.kind === "DRINK") && near(dinner.p, x.p) <= 3 && openFor(x.p, 6, 21 * 60 + 15, 45),
    );
    if (after) stops.push(stop("Then", 21 * 60 + 15, after.p, after.o.ticked));
  }
  // Something to do on Saturday or Sunday afternoon, if not already planned.
  const used = new Set(stops.map((s) => s.mapsUri));
  const doing = live.find((x) => x.kind === "DO" && !used.has(x.p.googleMapsUri ?? "") && (openFor(x.p, 6, 16 * 60, 90) || openFor(x.p, 0, 16 * 60, 90)));
  // Sunday: a late breakfast or brunch at 11:30.
  const brunch = live.find((x) => x.kind === "EAT" && x !== dinner && openFor(x.p, 0, 11 * 60 + 30, 75));
  if (brunch) stops.push(stop("Sunday brunch", 11 * 60 + 30, brunch.p, brunch.o.ticked));
  if (doing) stops.push(stop(openFor(doing.p, 0, 16 * 60, 90) ? "Sunday afternoon" : "Saturday afternoon", 16 * 60, doing.p, doing.o.ticked));
  // This weekend's events from their picks, with their own listing.
  const event = events.find((e) => e.event && e.event.date >= sat);

  const lines = [`Hi! Your weekend plan from Feta${city ? ` for ${city.name}` : ""}:`, ""];
  for (const s of stops) lines.push(`${s.label}, ${s.time}: ${s.name}${s.area ? ` (${s.area})` : ""}`, s.mapsUri, "");
  if (event?.event) lines.push(`Also on: ${event.event.title} at ${event.event.venueName}${event.event.time ? `, ${event.event.time}` : ""}`, event.event.url, "");
  for (const w of input.wishes) lines.push(`You wanted: ${w}. Tap for 3 ideas:`, `${SITE}/ask?q=${encodeURIComponent(`Ideas for this weekend: ${w}`)}`, "");
  if (stops.length === 0 && !event && input.wishes.length === 0)
    lines.push("Tell me what you feel like this weekend, or tick a few places in My lists, and I'll plan it for you.", `${SITE}/lists`, "");
  lines.push("Reply here if you want anything changed.");

  return {
    userId: input.userId,
    whatsapp: input.whatsapp,
    city: city?.name ?? "",
    sentAt: input.sentAt,
    people: input.people,
    wishes: input.wishes,
    stops,
    message: lines.join("\n"),
  };
}

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });
  const db = userDb(token);
  const { data: admin } = await db.rpc("is_admin");
  if (admin !== true) return Response.json({ error: "Not allowed" }, { status: 403 });
  const sat = new URL(request.url).searchParams.get("sat") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sat)) return Response.json({ error: "Bad date" }, { status: 400 });
  const { data, error } = await db.rpc("weekend_plan_inputs", { sat });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const drafts = await withCosts(db, "weekend", () => Promise.all((data as Input[]).map((i) => draft(i, sat))));
  return Response.json({ drafts });
}
