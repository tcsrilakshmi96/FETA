import { cityById } from "@/lib/server/cities";
import { withCosts } from "@/lib/server/costs";
import { userDb, userIdFor } from "@/lib/server/taste";
import { cleanRoute, estimateTransport, findStays, planCityDays, type Stay, type Trip } from "@/lib/server/trip";

// Search, AI and photos can take a while; the default cut-off is shorter.
export const maxDuration = 60;

// The trip planner's steps after the route (which comes from chat):
// save (edited cities), transport (rough estimates), stays (hotels per city
// for a budget), choose (a hotel), days (day plans for one city).
type Body = {
  id?: string;
  action?: "save" | "transport" | "stays" | "choose" | "days";
  cities?: Trip["cities"];
  budget?: string;
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
    const kept = cleanRoute({ cities: (body.cities ?? []).map((c) => ({ name: c.name, country: c.country, nights: c.nights, story: c.story, focus: c.focus })) }).cities;
    await save({ cities: kept, transport: null, stays: {} });
    return Response.json({ trip: { ...trip, cities: kept, transport: null, stays: {} } });
  }

  if (body.action === "transport") {
    const transport = await withCosts(db, "trip", () => estimateTransport(trip, cityById(body.home ?? null))).catch((error) => {
      console.error(error);
      return null;
    });
    if (!transport) return Response.json({ error: "Couldn't work out the travel just now. Try again." }, { status: 502 });
    await save({ transport });
    return Response.json({ transport });
  }

  if (body.action === "stays") {
    const budget = ["1", "2", "3", "4"].includes(body.budget ?? "") ? body.budget! : "2";
    const found = await withCosts(db, "trip", () => Promise.all(trip.cities.map((c) => findStays(c, budget, trip.who).catch(() => [] as Stay[]))));
    const stays = Object.fromEntries(found.map((list, i) => [String(i), { shown: list.map((s) => s.placeId), chosen: null }]));
    await save({ hotel_budget: budget, stays });
    return Response.json({ stays: found });
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
    const result = await withCosts(db, "trip", () => planCityDays({ token, trip, index, fromDay, hotel }));
    return Response.json(result);
  }

  return Response.json({ error: "Bad request" }, { status: 400 });
}
