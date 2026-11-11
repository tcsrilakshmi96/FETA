import { withCosts } from "@/lib/server/costs";
import { areaName } from "@/lib/server/picks";
import { cityAt } from "@/lib/server/cities";
import { placeDetails } from "@/lib/server/places";
import { userDb } from "@/lib/server/taste";

// Admin only: what Google has for a place ID (name, area, Maps link), read
// live with the cheaper "Pro" fields so the founder can check a match,
// and the Feta city it belongs to.
export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });
  const db = userDb(token);
  const { data: admin } = await db.rpc("is_admin");
  if (admin !== true) return Response.json({ error: "Not allowed" }, { status: 403 });
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") ?? "").slice(0, 300);
  if (!id) return Response.json({ error: "No place" }, { status: 400 });
  const place = await withCosts(db, "admin", () => placeDetails(id, false, true));
  if (!place) return Response.json({ found: false });
  // The Feta city it is in, from where Google puts it.
  const city = place.location ? cityAt({ lat: place.location.latitude, lng: place.location.longitude }) : null;
  const country = place.addressComponents?.find((c) => c.types?.includes("country"))?.longText ?? "";
  return Response.json({
    found: true,
    name: place.displayName?.text ?? "",
    area: [city ? areaName(place, city) : "", country].filter(Boolean).join(", "),
    mapsUri: place.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${id}`,
    city,
  });
}
