import { anonDb, askIs, DAILY_BUDGET_INR, overBudget, realSpendToday, withCosts } from "@/lib/server/costs";
import { bestPhoto, photoUri, placeDetails } from "@/lib/server/places";
import { userDb, userIdFor } from "@/lib/server/taste";

// For the public share page (/p/<place id>): the place's name, area and a
// photo, fetched live from Google (nothing stored). No personal data.
// ?lite=1: name and area only, without the photo (for "How was it?").
// From the app, the lookup is counted as the signed-in person's (audit, 20
// Nov 2026: it was never counted); a friend's counts toward everyone's day.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_.-]{10,300}$/.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  const lite = new URL(request.url).searchParams.get("lite") === "1";
  const signedIn = db && (await userIdFor(db, token!)) ? db : null;
  // A friend with no account (backend audit, 23 Nov 2026: it was free to
  // call over and over, and never counted): counted toward everyone's day,
  // and refused once the day's budget is spent.
  const asker = signedIn ?? anonDb();
  if (!signedIn) {
    const spent = await realSpendToday(asker);
    if (spent !== null && spent >= DAILY_BUDGET_INR) return Response.json({ error: "Busy" }, { status: 429 });
  } else if (await overBudget(signedIn)) return Response.json({ error: "Busy" }, { status: 429 });
  return withCosts(asker, "place", () => {
    askIs({ key: [id, lite], label: lite ? "live check (lite)" : "live check" });
    return live(request, id);
  }, { limit: signedIn ? "person" : "route" });
}

async function live(request: Request, id: string) {
  const place = await placeDetails(id, false, true);
  if (!place) return Response.json({ error: "Not found" }, { status: 404 });
  const parts = place.addressComponents ?? [];
  const pick = (type: string) => parts.find((p) => p.types?.includes(type))?.longText;
  const lite = new URL(request.url).searchParams.get("lite") === "1";
  const photo = lite ? undefined : bestPhoto(place);
  return Response.json({
    name: place.displayName?.text ?? "A place",
    area: [pick("sublocality_level_1") ?? pick("neighborhood"), pick("locality")].filter(Boolean).join(", "),
    mapsUri: place.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${id}`,
    photo: photo?.name ? await photoUri(photo.name) : null,
    credit: photo?.authorAttributions?.[0]?.displayName ?? null,
  });
}
