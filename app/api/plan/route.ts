import { cityById } from "@/lib/server/cities";
import { DAILY_BUDGET_INR, spentToday, withCosts } from "@/lib/server/costs";
import { photoUri, bestPhoto, searchPlaces, type Place } from "@/lib/server/places";
import { applyHardFilters, buildPick, kindOf, searchPhrases, type Candidate, type Category, type Pick, type When } from "@/lib/server/picks";
import { loadTaste, userDb, userIdFor } from "@/lib/server/taste";

export const maxDuration = 30;

// Plan my evening, when the picks on screen don't pair up (experiences are
// often across town): something to do or a drink close to the chosen
// dinner, through the same hard filters as picks. One search per kind,
// only when the phone asks.
const NEAR_KM = 2;

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { when?: When; cityId?: string; near?: { placeId?: string; lat?: number; lng?: number }; exclude?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const city = cityById(body.cityId);
  const when: When = body.when === "weekend" ? "weekend" : "tonight";
  const lat = body.near?.lat;
  const lng = body.near?.lng;
  if (!city || typeof lat !== "number" || typeof lng !== "number") return Response.json({ error: "Bad request" }, { status: 400 });
  if ((await spentToday(db)) >= DAILY_BUDGET_INR) return Response.json({ picks: [] });

  return withCosts(db, "plan", async () => {
    const taste = await loadTaste(db);
    const exclude = new Set([...(body.exclude ?? []).slice(0, 20), body.near?.placeId ?? ""]);
    const { data: actions } = await db.from("pick_actions").select("place_id");
    for (const a of actions ?? []) exclude.add(a.place_id as string);
    const origin = { lat, lng };
    const afterDinner = taste.answers.drinks === "no_alcohol" ? "dessert cafe" : "cocktail bar";
    const doing = searchPhrases("experiences", taste)[0] ?? "live music";
    const search = (query: string, category: Category) =>
      searchPlaces({ query, lat, lng, radiusKm: NEAR_KM, openNow: false, needsDiet: false, regionCode: city.country, count: 10 })
        .then((places) => applyHardFilters(places, { taste, category, when, origin, exclude, city }).filter((c) => c.km <= NEAR_KM))
        .catch((error) => {
          console.error(error);
          return [] as Candidate[];
        });
    const [things, drinks] = await Promise.all([search(doing, "experiences"), search(afterDinner, "food_drinks")]);
    const best = (list: Candidate[]) => [...list].sort((a, b) => (b.place.rating ?? 0) - (a.place.rating ?? 0)).slice(0, 2);
    const chosen: [Candidate, Category][] = [...best(things).map((c) => [c, "experiences"] as [Candidate, Category]), ...best(drinks).map((c) => [c, "food_drinks"] as [Candidate, Category])];
    const picks: Pick[] = await Promise.all(
      chosen.map(async ([c, category]) => {
        const photo = await firstPhoto(c.place);
        return buildPick(
          c,
          { placeId: c.place.id, kind: kindOf(c.place, category), verdict: "Good if you're nearby", because: "Close to dinner, so the evening flows." },
          { taste, when, city, photo },
        );
      }),
    );
    return Response.json({ picks });
  });
}

async function firstPhoto(place: Place) {
  const name = bestPhoto(place)?.name;
  return name ? photoUri(name) : null;
}
