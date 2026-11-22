import { cityById } from "@/lib/server/cities";
import { askIs, overBudget, withCosts } from "@/lib/server/costs";
import { runPicks } from "@/lib/server/engine";
import type { Pick, When } from "@/lib/server/picks";
import { loadTaste, userDb, userIdFor } from "@/lib/server/taste";

export const maxDuration = 30;

// Plan my evening, when the picks on screen don't pair up (experiences are
// often across town): something to do and somewhere for after, within a
// walk of the chosen dinner. Through the same engine as every other pick
// (founder, 18 Nov 2026: one path for every screen), so it uses what they
// love, their loved places and Feta Picks, not Google's top-rated bar.
// Two searches each, only when the phone asks.
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
  if ((await overBudget(db))) return Response.json({ picks: [] });

  const taste = await loadTaste(db);
  const exclude = new Set([...(body.exclude ?? []).slice(0, 20), body.near?.placeId ?? ""]);
  const origin = { lat, lng, label: "near dinner", source: "area" as const, areaId: `near:${body.near?.placeId ?? `${lat.toFixed(3)},${lng.toFixed(3)}`}`, city: { id: city.id } };
  const after = taste.answers.drinks === "no_alcohol" ? "dessert or a late cafe after dinner" : "drinks after dinner";
  const run = (category: "experiences" | "food_drinks", note?: string) =>
    withCosts(db, "plan", () => {
      askIs({ key: [category, when, body.near?.placeId ?? origin.areaId, note ?? ""], label: `${note ? "after dinner" : category === "food_drinks" ? "dinner" : "something to do"} · ${when} · ${city.name}` });
      return runPicks(token, { category, when, origin, reach: "walk", searches: 2, ...(note ? { note, only: "asked" } : {}) });
    })
      .then((res) => res.json() as Promise<{ picks?: Pick[] }>)
      .then((r) => (r.picks ?? []).filter((p) => !exclude.has(p.placeId)).slice(0, 2))
      .catch((error) => {
        console.error(error);
        return [] as Pick[];
      });
  const [things, drinks] = await Promise.all([run("experiences"), run("food_drinks", after)]);
  return Response.json({ picks: [...things, ...drinks] });
}
