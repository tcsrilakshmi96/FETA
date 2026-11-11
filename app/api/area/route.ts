import { areaLocation, suggestAreas } from "@/lib/server/places";
import { withCosts } from "@/lib/server/costs";
import { userDb, userIdFor } from "@/lib/server/taste";

// "Type a neighbourhood or landmark": {input, lat, lng, country, session}
// → suggestions near the city; {placeId, session} → where it is.
// Nothing is stored here; the phone keeps the chosen spot.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { input?: string; lat?: number; lng?: number; country?: string; placeId?: string; session?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const session = (body.session ?? "").slice(0, 64);
  return withCosts(db, "area", async () => {
    if (body.placeId) {
      const at = await areaLocation(body.placeId.slice(0, 300), session);
      return Response.json(at ? { location: at } : { error: "Not found" }, { status: at ? 200 : 404 });
    }
    const input = (body.input ?? "").trim().slice(0, 80);
    if (input.length < 2 || !Number.isFinite(body.lat) || !Number.isFinite(body.lng) || !/^[A-Z]{2}$/.test(body.country ?? "")) {
      return Response.json({ suggestions: [] });
    }
    return Response.json({ suggestions: await suggestAreas(input, { lat: body.lat!, lng: body.lng! }, body.country!, session) });
  });
}
