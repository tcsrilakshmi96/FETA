import { DAILY_BUDGET_INR, spentToday, withCosts } from "@/lib/server/costs";
import { placeDetails, type Place } from "@/lib/server/places";
import { weeklyHours } from "@/lib/server/picks";
import { userDb, userIdFor } from "@/lib/server/taste";
import type { NightPlace } from "@/lib/night-plan";

export const maxDuration = 30;

// Plan a night from Saved: live details for the places they ticked (and at
// most one more from their saved list, for "Room for dessert?"): where each
// is, what kind of place, and its weekly hours. About ₹1.7 a place. The
// order and times are worked out on the phone (lib/night-plan.ts). Nothing
// is stored here.
const MAX_PLACES = 6;
const DRINKS = /^(bar|pub|night_club|brewery|wine_bar|cocktail_bar|beer_garden|brewpub|sports_bar|lounge_bar)$/;
const FOOD = /restaurant|cafe|bar|bakery|food|meal|pub|brewery|coffee|dessert|ice_cream|tea_house|juice|winery/;
const LIGHT = /cafe|coffee|bakery|dessert|ice_cream|tea_house|juice|confectionery|chocolate|donut/;

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { placeIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const ids = Array.isArray(body.placeIds) ? [...new Set(body.placeIds.filter((id): id is string => typeof id === "string" && !!id && !id.startsWith("event:") && id.length < 300))].slice(0, MAX_PLACES) : [];
  if (ids.length < 2) return Response.json({ error: "Bad request" }, { status: 400 });
  if ((await spentToday(db)) >= DAILY_BUDGET_INR) return Response.json({ notice: "Feta has done all its searching for today. Try again tomorrow." });

  return withCosts(db, "night_plan", async () => {
    // Saved from Things to do: a thing to do, even if Google also calls it
    // a restaurant (a live-music venue that serves food is not dinner).
    const [places, { data: saved }] = await Promise.all([Promise.all(ids.map((id) => placeDetails(id, false).catch(() => null))), db.from("pick_actions").select("place_id, category").in("place_id", ids)]);
    const toDo = new Set((saved ?? []).filter((r) => r.category === "experiences").map((r) => r.place_id as string));
    return Response.json({ places: places.flatMap((p) => (p?.location ? [nightPlace(p, p.location, toDo.has(p.id))] : [])) });
  });
}

function nightPlace(p: Place, at: NonNullable<Place["location"]>, toDo: boolean): NightPlace {
  const types = [p.primaryType ?? "", ...(p.types ?? [])].filter(Boolean);
  const food = !toDo && types.some((t) => FOOD.test(t));
  const parts = p.addressComponents ?? [];
  const part = (type: string) => parts.find((c) => c.types?.includes(type))?.longText;
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "A saved place",
    area: part("sublocality_level_1") ?? part("neighborhood") ?? part("locality") ?? "",
    kind: !food ? "DO" : DRINKS.test(p.primaryType ?? "") ? "DRINK" : "EAT",
    light: food && LIGHT.test(p.primaryType ?? types.join(" ")),
    lat: at.latitude,
    lng: at.longitude,
    hours: weeklyHours(p),
    mapsUri: p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`,
    ...(p.businessStatus === "CLOSED_PERMANENTLY" ? { gone: true } : {}),
  };
}
