import { placeNotes } from "@/lib/server/details";
import { placeDetails } from "@/lib/server/places";
import { userDb, userIdFor } from "@/lib/server/taste";

// Up to 15 s for Gemini to read the reviews.
export const maxDuration = 30;

// "What to order" / "Highlights" for one place, for the Details view.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token || !(await userIdFor(userDb(token), token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { placeId?: string; kind?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const placeId = body.placeId ?? "";
  if (!placeId || placeId.startsWith("event:")) return Response.json({ items: [], sources: [] });
  const place = await placeDetails(placeId, false, true);
  if (!place) return Response.json({ items: [], sources: [] });
  try {
    const notes = await placeNotes(place, body.kind === "DO" ? "DO" : body.kind === "DRINK" ? "DRINK" : "EAT");
    return Response.json(notes);
  } catch (error) {
    console.error(error);
    return Response.json({ items: [], sources: [] });
  }
}
