import { placeNotes } from "@/lib/server/details";
import { placeDetails, type Place } from "@/lib/server/places";
import { withCosts } from "@/lib/server/costs";
import { userDb, userIdFor } from "@/lib/server/taste";

// Up to 15 s for Gemini to read the reviews.
export const maxDuration = 30;

// "What to order" / "Highlights" for one place, for the Details view.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  return withCosts(db, "details", () => notesFor(request, db));
}

async function notesFor(request: Request, db: NonNullable<ReturnType<typeof userDb>>) {
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
    // Their diet and drinks, so suggested dishes fit them.
    const { data: a } = await db.from("answers").select("diet, halal, drinks").maybeSingle();
    const notes = await placeNotes(place, body.kind === "DO" ? "DO" : body.kind === "DRINK" ? "DRINK" : "EAT", {
      diet: a?.diet ?? null,
      halal: !!a?.halal,
      noAlcohol: a?.drinks === "no_alcohol",
    });
    return Response.json(notes);
  } catch (error) {
    console.error(error);
    return Response.json({ items: [], sources: [] });
  }
}
