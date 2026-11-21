import { cityById } from "@/lib/server/cities";
import { limitNoticeHere, overBudget, withCosts } from "@/lib/server/costs";
import { placeDetails, type Place } from "@/lib/server/places";
import { applyHardFilters, buildPick, needsDietCheck, type Candidate, type Kind, type Pick, type When } from "@/lib/server/picks";
import { founderPlacesNear, syncFounderLoved } from "@/lib/server/feta-places";
import { loadTaste, userDb, userIdFor } from "@/lib/server/taste";

export const maxDuration = 30;

// "Feta Picks near you" on Home (founder, 16 Nov 2026): the founder's own
// places and Feta users' favourites that fit their diet, budget and
// distance, nearest first. Read live only when someone opens it: up to 10
// places are checked (about ₹2 each): favourites from people with a
// similar taste, then her places nearest to them (feta-places.ts; founder,
// 17 Nov 2026: "showing everything in Bangalore instead of just places near
// me"). Places they've been to or saved still show (only a skip hides one).
// Nothing from Google is kept but where her places are, for up to 30 days.
const LOOKUPS = 10;
const COMMUNITY_LOOKUPS = 4;

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { cityId?: string; lat?: number; lng?: number; when?: When };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const city = cityById(body.cityId);
  if (!city || typeof body.lat !== "number" || typeof body.lng !== "number") return Response.json({ error: "Bad request" }, { status: 400 });
  if ((await overBudget(db))) return Response.json({ picks: [], notice: await limitNoticeHere("picks") });
  const when: When = body.when === "weekend" ? "weekend" : "tonight";

  return withCosts(db, "feta_picks", async () => {
    const origin = { lat: body.lat!, lng: body.lng! };
    const [taste] = await Promise.all([loadTaste(db), syncFounderLoved(db)]);
    const [founder, community, skips] = await Promise.all([
      founderPlacesNear(db, { city, kinds: ["EAT", "DRINK", "DO"], origin, taste }),
      db.rpc("feta_favourites", { p_city: city.id, p_category: null }),
      db.from("pick_actions").select("place_id").eq("action", "skipped"),
    ]);
    const skipped = new Set((skips.data ?? []).map((r) => r.place_id as string));
    const notes = new Map(founder.map((f) => [f.placeId, f]));
    const loved = ((community.data ?? []) as { place_id: string; lovers: number; similar: number }[]).filter((c) => !skipped.has(c.place_id));
    const lovedBy = new Map(loved.map((c) => [c.place_id, c.lovers]));
    const ids = [
      ...loved.filter((c) => c.similar > 0).slice(0, COMMUNITY_LOOKUPS).map((c) => c.place_id),
      ...founder.filter((f) => !skipped.has(f.placeId)).map((f) => f.placeId),
    ];
    const chosen = [...new Set(ids)].slice(0, LOOKUPS);
    if (chosen.length === 0) return Response.json({ picks: [] });

    const needsDiet = needsDietCheck(taste.answers);
    const places = (await Promise.all(chosen.map((id) => placeDetails(id, needsDiet).catch(() => null)))).filter((p): p is Place => !!p);
    // Diet, budget and distance always; opening hours are shown on the
    // card rather than hiding the place.
    const filter = (category: "food_drinks" | "experiences", list: Place[]) =>
      applyHardFilters(list, { taste, category, when, origin, exclude: new Set(), city, foodDrinkOk: () => true, anyHours: true });
    const isDo = (p: Place) => notes.get(p.id)?.kind === "DO";
    const passed: Candidate[] = [...filter("food_drinks", places.filter((p) => !isDo(p))), ...filter("experiences", places.filter(isDo))].sort((a, b) => a.km - b.km);
    const picks: Pick[] = passed.map((c) => {
      const mine = notes.get(c.place.id);
      const kind: Kind = mine?.kind ?? (/(bar|pub|cafe|coffee)/.test(c.place.primaryType ?? "") ? "DRINK" : "EAT");
      return {
        ...buildPick(
          c,
          {
            placeId: c.place.id,
            kind,
            verdict: "Good if you're nearby",
            because: mine ? "Because it's one of Feta's own favourites." : "Because Feta users with a taste like yours love it.",
            ...(mine ? { fetaNote: mine.note ?? "" } : {}),
          },
          { taste, when, city },
        ),
        ...(lovedBy.get(c.place.id) ? { lovedBy: lovedBy.get(c.place.id) } : {}),
        // Hours weren't a filter here, so the line says plainly if it's closed.
        googleLine: `${c.place.currentOpeningHours?.openNow === true ? "Open now · " : c.place.currentOpeningHours?.openNow === false ? "Closed now · " : ""}checked just now · Google Maps`,
      };
    });
    return Response.json({ picks });
  });
}

// The founder rated a place: her loved places join Feta Picks
// (feta-places.ts). Does nothing for anyone else.
export async function PUT(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  await syncFounderLoved(db);
  return Response.json({ ok: true });
}
