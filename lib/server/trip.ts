import "server-only";
import { isMainlandChina, type City } from "@/lib/cities";
import { cityAt, searchCities } from "@/lib/server/cities";
import { runPicks } from "@/lib/server/engine";
import { buildItinerary, type Itinerary } from "@/lib/server/itinerary";
import { bestPhoto, findDestination, searchPlaces, type Place } from "@/lib/server/places";
import { photoRef } from "@/lib/server/photo-ref";
import type { Pick } from "@/lib/server/picks";
import { veniceJson } from "@/lib/server/venice";

// The trip planner in Ask Feta (founder, 14 Nov 2026): 1) a route of cities,
// nights and a two-line story for each (Venice, from general knowledge, no
// Google content), 2) getting around with rough costs (Venice, marked as
// estimates), 3) hotels per city (Google Maps, place IDs stored), 4) day
// plans per city, built live with the picks engine, 3 days at a time.

export type TripCity = { name: string; country: string; cityId: string | null; nights: number; story: string; focus: string };
export type TripLeg = { from: string; to: string; mode: "train" | "flight" | "bus" | "ferry" | "car"; minutes: number; cost: number; note?: string };
export type TripTransport = { legs: TripLeg[]; trains: number; flights: number; tip: string; currency: string };
export type Stay = {
  placeId: string;
  name: string;
  area: string;
  rating?: number;
  ratingCount?: number;
  mapsUri: string;
  website: string | null;
  photo: Pick["photo"];
  lat?: number;
  lng?: number;
};
export type Trip = {
  id: string;
  title: string;
  start_date: string | null;
  who: string | null;
  home_currency: string | null;
  cities: TripCity[];
  transport: TripTransport | null;
  hotel_budget: string | null;
  stays: Record<string, { shown: string[]; chosen: string | null }>;
};

// What Venice returns for a route.
export type RouteIn = { title?: string; start?: string | null; who?: string; cities?: { name?: string; country?: string; nights?: number; story?: string; focus?: string }[] };

// Cities as Feta knows them (its own GeoNames list), so stays and day plans
// can find them. A city Feta doesn't know keeps its name and is chat-only.
export function cleanRoute(route: RouteIn) {
  const cities: TripCity[] = (route.cities ?? [])
    .filter((c) => c.name)
    .slice(0, 12)
    .map((c) => {
      const [match] = searchCities(c.name!, 1);
      return {
        name: c.name!.slice(0, 40),
        country: (c.country ?? match?.countryName ?? "").slice(0, 40),
        cityId: match ? match.id : null,
        nights: Math.max(1, Math.min(30, Math.round(c.nights ?? 1))),
        story: (c.story ?? "").slice(0, 280),
        focus: (c.focus ?? "").slice(0, 80),
      };
    });
  const start = /^\d{4}-\d{2}-\d{2}$/.test(route.start ?? "") ? route.start! : null;
  return { title: (route.title ?? "Your trip").slice(0, 80), start_date: start, who: route.who ?? null, cities };
}

// Getting around: the legs between the cities in order, by train, flight,
// bus or ferry, with rough times and costs per person in their currency.
export async function estimateTransport(trip: Trip, home: City | null): Promise<TripTransport> {
  const currency = trip.home_currency ?? home?.currency ?? "USD";
  const route = trip.cities.map((c) => `${c.name} (${c.nights} nights)`).join(" → ");
  const reply = await veniceJson<{ legs?: TripLeg[]; tip?: string }>([
    {
      role: "system",
      content: `You plan how travellers get between cities. Reply with only a JSON object:
{"legs": [{"from": city, "to": city, "mode": "train", "flight", "bus", "ferry" or "car", "minutes": door-to-door travel time as a number, "cost": typical one-way cost per person in ${currency} as a number (economy or standard class, booked a few weeks ahead), "note": under 8 words, e.g. "Shinkansen, covered by a rail pass"}],
 "tip": one short sentence that saves money or hassle on this route (e.g. whether a rail pass pays off), or "".}
One leg between each pair of cities in the order given, by the way most travellers would go. Rough numbers are fine; never invent precision.`,
    },
    { role: "user", content: `Route: ${route}.${home ? ` They live in ${home.name}, ${home.countryName}, but only list the legs between these cities.` : ""}` },
  ]);
  const legs = (reply.legs ?? [])
    .filter((l) => l.from && l.to)
    .slice(0, 15)
    .map((l) => ({
      from: String(l.from).slice(0, 40),
      to: String(l.to).slice(0, 40),
      mode: (["train", "flight", "bus", "ferry", "car"].includes(l.mode) ? l.mode : "train") as TripLeg["mode"],
      minutes: Math.max(10, Math.round(Number(l.minutes) || 60)),
      cost: Math.max(0, Math.round(Number(l.cost) || 0)),
      note: l.note ? String(l.note).slice(0, 60) : undefined,
    }));
  return {
    legs,
    trains: legs.filter((l) => l.mode === "train").length,
    flights: legs.filter((l) => l.mode === "flight").length,
    tip: (reply.tip ?? "").slice(0, 200),
    currency,
  };
}

// Words for each hotel budget, so the search finds the right kind of stay.
const STAY_WORDS: Record<string, string> = { "1": "budget hotel", "2": "hotel", "3": "boutique hotel", "4": "luxury hotel" };

// A city on the route as a place to search from: Feta's list first, else
// Google Maps (an island, a small town), placed in its nearest city.
async function cityPoint(c: TripCity): Promise<{ lat: number; lng: number; city: City } | null> {
  const [match] = searchCities(c.name, 1);
  if (match && match.name.toLowerCase() === c.name.toLowerCase()) return { lat: match.lat, lng: match.lng, city: match };
  const found = await findDestination(`${c.name}, ${c.country}`);
  const city = found ? cityAt(found) : match ?? null;
  return found && city ? { lat: found.lat, lng: found.lng, city } : match ? { lat: match.lat, lng: match.lng, city: match } : null;
}

function toStay(p: Place, city: City): Stay {
  const best = bestPhoto(p);
  const credit = best?.authorAttributions?.[0];
  const area = p.addressComponents?.find((a) => a.types?.includes("sublocality") || a.types?.includes("neighborhood"))?.longText ?? city.name;
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "Hotel",
    area,
    rating: p.rating,
    ratingCount: p.userRatingCount,
    mapsUri: p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`,
    website: p.websiteUri ?? null,
    photo: best ? { uri: "", ref: photoRef(best.name), credit: credit?.displayName ?? "Google Maps", creditUri: credit?.uri } : null,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
  };
}

// Three well-reviewed stays in a city for their budget (one search per city).
// A couple in Japan might like a ryokan; the budget words decide the kind.
export async function findStays(c: TripCity, budget: string, who: string | null): Promise<Stay[]> {
  const at = await cityPoint(c);
  if (!at || isMainlandChina(at.city)) return [];
  const kind = STAY_WORDS[budget] ?? "hotel";
  const places = await searchPlaces({
    query: `${who === "partner" && budget !== "1" ? `romantic ${kind}` : kind} in ${c.name}`,
    lat: at.lat,
    lng: at.lng,
    radiusKm: 20,
    openNow: false,
    needsDiet: false,
    regionCode: at.city.country,
    count: 10,
  });
  return places
    .filter((p) => (p.types ?? []).some((t) => ["lodging", "hotel", "resort_hotel", "inn", "japanese_inn", "bed_and_breakfast", "guest_house"].includes(t)))
    .filter((p) => (p.rating ?? 0) >= 4 && (p.userRatingCount ?? 0) >= 30)
    .sort((a, b) => (b.rating ?? 0) * Math.log10((b.userRatingCount ?? 1) + 10) - (a.rating ?? 0) * Math.log10((a.userRatingCount ?? 1) + 10))
    .slice(0, 3)
    .map((p) => toStay(p, at.city));
}

// Day plans for one city on the route, from its first night (or a later
// day), 3 days at a time, near their hotel when they've chosen one.
export async function planCityDays(opts: {
  token: string;
  trip: Trip;
  index: number;
  fromDay: number;
  hotel: { lat: number; lng: number } | null;
}): Promise<{ itinerary: Itinerary | null; notice?: string }> {
  const c = opts.trip.cities[opts.index];
  const at = await cityPoint(c);
  if (!at) return { itinerary: null, notice: `I couldn't find ${c.name} on the map.` };
  if (isMainlandChina(at.city)) return { itinerary: null, notice: `Feta can't check places in mainland China yet, so I can't plan days in ${c.name}.` };
  const point = opts.hotel ?? at;
  const origin = { lat: point.lat, lng: point.lng, label: `Anywhere in ${c.name}`, source: "city" as const, city: at.city };
  const who = opts.trip.who ?? "";
  const tweaks = who === "friends" ? ["groups"] : who === "kids" ? ["kids"] : [];
  const note = [who === "partner" ? "with my partner" : who === "family" ? "with family" : "", c.focus].filter(Boolean).join(", ").slice(0, 120);
  const label = `${c.name} · ${opts.trip.title}`.slice(0, 60);
  const ask = (category: "food_drinks" | "experiences") =>
    runPicks(opts.token, { category, when: "weekend", origin, tweaks, note, trip: label }).then(
      (r) => r.json().catch(() => ({})) as Promise<{ picks?: Pick[]; spares?: Pick[] }>,
    );
  const [food, doing] = await Promise.all([ask("food_drinks"), ask("experiences")]);
  const all = [...(food.picks ?? []), ...(doing.picks ?? []), ...(food.spares ?? []), ...(doing.spares ?? [])];
  // The first day in this city: the trip's start plus the nights before it.
  const before = opts.trip.cities.slice(0, opts.index).reduce((n, x) => n + x.nights, 0) + opts.fromDay;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: at.city.timeZone }).format(new Date());
  const startDate = new Date(`${opts.trip.start_date && opts.trip.start_date >= today ? opts.trip.start_date : today}T12:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() + before);
  const days = Math.min(3, c.nights - opts.fromDay);
  const itinerary = buildItinerary(all, { start: startDate.toISOString().slice(0, 10), days, place: c.name });
  if (!itinerary.days.some((d) => d.stops.length > 0)) return { itinerary: null, notice: `I couldn't find enough open places to plan those days in ${c.name}.` };
  return { itinerary };
}
