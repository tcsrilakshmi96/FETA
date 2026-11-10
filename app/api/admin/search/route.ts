import { CITIES } from "@/lib/cities";
import { searchPlaces } from "@/lib/server/places";
import { areaName } from "@/lib/server/picks";
import { userDb } from "@/lib/server/taste";

// Admin only: find a place on Google Maps to add as a Feta pick.
export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });
  const db = userDb(token);
  const { data: admin } = await db.rpc("is_admin");
  if (admin !== true) return Response.json({ error: "Not allowed" }, { status: 403 });
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const city = CITIES.find((c) => c.id === url.searchParams.get("city")) ?? CITIES[0];
  if (q.length < 2) return Response.json({ results: [] });
  const places = await searchPlaces({ query: `${q}, ${city.name}`, lat: city.lat, lng: city.lng, radiusKm: 30, openNow: false, needsDiet: false, regionCode: city.country, lite: true, count: 6 });
  return Response.json({
    results: places.map((p) => ({ placeId: p.id, name: p.displayName?.text ?? "", area: areaName(p, city) })),
  });
}
