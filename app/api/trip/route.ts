import { cityById } from "@/lib/server/cities";
import { limitNoticeHere, overBudget, withCosts } from "@/lib/server/costs";
import { userDb, userIdFor } from "@/lib/server/taste";
import { parseRange, stayRange } from "@/lib/stay-budget";
import { cleanRoute, estimateTransport, tripTitle, findStays, planCityDays, type SavedDay, type Stay, type Trip } from "@/lib/server/trip";

// Search, AI and photos can take a while; the default cut-off is shorter.
export const maxDuration = 300; // background work started here (a city's guide posts read, up to 3 min) must finish to be counted (audit, 24 Nov 2026)

// The trip planner's steps after the route (which comes from chat):
// save (edited cities), transport (rough estimates), stays (hotels per city
// for a budget), choose (a hotel), days (day plans for one city).
type Body = {
  id?: string;
  action?: "save" | "transport" | "stays" | "choose" | "days" | "base";
  cities?: Trip["cities"];
  budget?: string; // "500-3000" a night, in the trip's currency
  base?: string | null; // the area they'll stay in, for one city
  index?: number;
  placeId?: string | null;
  fromDay?: number;
  hotel?: { lat?: number; lng?: number } | null;
  home?: string | null; // their city id, for the currency
};

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const { data: trip } = await db.from("trips").select("*").eq("id", body.id ?? "").maybeSingle<Trip>();
  if (!trip) return Response.json({ error: "No such trip" }, { status: 404 });
  const save = (patch: Partial<Trip>) => db.from("trips").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", trip.id);
  const index = Number(body.index);
  const city = Number.isInteger(index) ? trip.cities[index] : undefined;

  if (body.action === "save") {
    // Edited on the phone: the cities they kept, in their order, with their
    // nights. Getting around and hotels are worked out again after a change.
    const kept = cleanRoute({ cities: (body.cities ?? []).map((c) => ({ name: c.name, country: c.country, nights: c.nights, story: c.story, focus: c.focus, areas: c.areas, base: c.base })) }).cities;
    // "7 nights in Japan" follows the nights they kept.
    const title = tripTitle(trip.title, kept);
    await save({ title, cities: kept, transport: null, stays: {}, days: {} });
    return Response.json({ trip: { ...trip, title, cities: kept, transport: null, stays: {}, days: {} } });
  }

  // Getting around and hotels cost money too: today's limit holds for them
  // (backend audit, 23 Nov 2026: only day plans were limited).
  if ((body.action === "transport" || body.action === "stays") && (await overBudget(db))) return Response.json({ error: await limitNoticeHere("ask") }, { status: 429 });

  if (body.action === "transport") {
    const transport = await withCosts(db, "trip_transport", () => estimateTransport(trip, cityById(body.home ?? null))).catch((error) => {
      console.error(error);
      return null;
    });
    if (!transport) return Response.json({ error: "Couldn't work out the travel just now. Try again." }, { status: 502 });
    await save({ transport });
    return Response.json({ transport });
  }

  if (body.action === "stays") {
    const currency = trip.home_currency ?? cityById(body.home ?? null)?.currency ?? "USD";
    const { floor, currency: cur } = stayRange(currency);
    const asked = parseRange(body.budget, cur);
    if (!asked) return Response.json({ error: "Bad request" }, { status: 400 });
    const min = Math.max(floor, Math.round(asked.min));
    const max = Math.max(min, Math.round(asked.max));
    const budget = `${min}-${max}`;
    const found = await withCosts(db, "trip_stays", () => Promise.all(trip.cities.map((c) => findStays(c, { min, max, currency: cur }, trip.who).catch(() => [] as Stay[]))));
    const stays = Object.fromEntries(found.map((list, i) => [String(i), { shown: list.map((s) => s.placeId), chosen: null }]));
    await save({ hotel_budget: budget, stays });
    return Response.json({ stays: found, budget });
  }

  // Where in a city or region they'll stay: one of the areas suggested with
  // the route, or their own words. Its hotels are found again after.
  if (body.action === "base" && city) {
    const base = typeof body.base === "string" && body.base.trim() ? body.base.trim().slice(0, 40) : null;
    const cities = trip.cities.map((c, i) => (i === index ? { ...c, base } : c));
    const stays = { ...trip.stays };
    delete stays[String(index)];
    await save({ cities, stays });
    return Response.json({ trip: { ...trip, cities, stays } });
  }

  if (body.action === "choose" && city) {
    const current = trip.stays[String(index)] ?? { shown: [], chosen: null };
    const chosen = body.placeId && current.shown.includes(body.placeId) ? body.placeId : null;
    await save({ stays: { ...trip.stays, [String(index)]: { ...current, chosen } } });
    return Response.json({ ok: true });
  }

  if (body.action === "days" && city) {
    const fromDay = Math.max(0, Math.min(city.nights - 1, Math.round(Number(body.fromDay) || 0)));
    const hotel = Number.isFinite(body.hotel?.lat) && Number.isFinite(body.hotel?.lng) ? { lat: body.hotel!.lat!, lng: body.hotel!.lng! } : null;
    const result = await withCosts(db, "trip_days", () => planCityDays({ token, trip, index, fromDay, hotel })).catch((error) => {
      // A Google hiccup says so instead of breaking the card (audit, 24 Nov 2026).
      console.error(error);
      return null;
    });
    if (!result) return Response.json({ itinerary: null, notice: "Couldn't reach Google Maps just now. Try again in a minute." }, { status: 502 });
    // Kept on the trip, so it shows when they open the trip again.
    if (result.itinerary) {
      const kept: SavedDay[] = result.itinerary.days.map((d) => ({
        date: d.date,
        label: d.label,
        stops: d.stops.map((st) => ({ time: st.time, slot: st.slot, placeId: st.pick.placeId, kind: st.pick.kind, ...(st.travel ? { travel: st.travel } : {}) })),
        ...(d.back ? { back: d.back } : {}),
      }));
      const before = (trip.days ?? {})[String(index)] ?? [];
      await save({ days: { ...(trip.days ?? {}), [String(index)]: [...before.filter((d) => !kept.some((k) => k.date === d.date)), ...kept] } });
    }
    return Response.json(result);
  }

  return Response.json({ error: "Bad request" }, { status: 400 });
}
