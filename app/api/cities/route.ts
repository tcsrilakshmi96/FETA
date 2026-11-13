import { cityAt, cityById, cityForTimeZone, searchCities } from "@/lib/server/cities";

// "Type any city": ?q=lisb → matching cities. ?near=lat,lng → the city a
// point is in (for "Use my location"; the point is not kept or logged).
// ?id=gn:123 → that city (restoring a returning person's city).
// ?tz=Asia/Kolkata → the biggest city in that time zone (a guess for setup).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) return Response.json({ city: cityById(id) });
  const tz = url.searchParams.get("tz");
  if (tz) return Response.json({ city: cityForTimeZone(tz.slice(0, 60)) });
  const near = url.searchParams.get("near");
  if (near) {
    const [lat, lng] = near.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Response.json({ city: null }, { status: 400 });
    return Response.json({ city: cityAt({ lat, lng }) });
  }
  return Response.json({ cities: searchCities((url.searchParams.get("q") ?? "").slice(0, 60)) });
}
