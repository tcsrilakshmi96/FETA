import { placeNotes } from "@/lib/server/details";
import { placeDetails, type Place } from "@/lib/server/places";
import { userDb, userIdFor } from "@/lib/server/taste";

// Up to 15 s for Gemini to read the reviews.
export const maxDuration = 30;

// "What to order" / "Highlights" for one place, for the Details view.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !(await userIdFor(userDb(token), token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { placeId?: string; kind?: string; name?: string; lat?: number; lng?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const placeId = body.placeId ?? "";
  if (!placeId || placeId.startsWith("event:")) return Response.json({ items: [], sources: [] });
  // The phone already has the name and spot from the pick, which saves a
  // paid Google lookup; older callers without them still get one.
  const place: Place | null =
    body.name && typeof body.lat === "number" && typeof body.lng === "number"
      ? { id: placeId, displayName: { text: body.name.slice(0, 120) }, location: { latitude: body.lat, longitude: body.lng } }
      : await placeDetails(placeId, false, true);
  if (!place) return Response.json({ items: [], sources: [] });
  try {
    const notes = await placeNotes(place, body.kind === "DO" ? "DO" : body.kind === "DRINK" ? "DRINK" : "EAT");
    return Response.json(notes);
  } catch (error) {
    console.error(error);
    return Response.json({ items: [], sources: [] });
  }
}
