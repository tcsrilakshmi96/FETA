import { cityById } from "@/lib/server/cities";
import { DAILY_BUDGET_INR, spentToday, withCosts } from "@/lib/server/costs";
import { curate, pickFrom } from "@/lib/server/curate";
import { buildPick, kindOf, needsDietCheck, type Category, type When } from "@/lib/server/picks";
import { loadTaste, userDb, userIdFor } from "@/lib/server/taste";
import { readSurprise } from "@/lib/server/taste-reader";

export const maxDuration = 30;

// "Surprise me" in Choose for me (founder, 17 Nov 2026: "there is really no
// surprise"). Feta reads everything they've shared and suggests kinds of
// place they haven't chosen but would likely love (taste-reader.ts), then
// looks for the first kind with one Google search through the same steps as
// every pick (curate.ts: hard filters, ranking). About ₹3–4 a tap. Never a
// place already in their lists, saved, skipped or been to. Nothing is stored.
type Body = {
  category: Category;
  when: When;
  origin: { lat: number; lng: number; source: "gps" | "area" | "city"; city: { id: string } };
  tried?: string[]; // kinds already shown this time
  shown?: string[]; // place IDs in their lists on the phone
};

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const city = cityById(body.origin?.city?.id);
  if (!city || !Number.isFinite(body.origin.lat) || !Number.isFinite(body.origin.lng) || !["food_drinks", "experiences"].includes(body.category) || !["tonight", "weekend"].includes(body.when)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if ((await spentToday(db)) >= DAILY_BUDGET_INR) return Response.json({ notice: "Feta has done all its searching for today. Try again tomorrow." });

  return withCosts(db, "surprise", async () => {
    const [loaded, actions] = await Promise.all([loadTaste(db), db.from("pick_actions").select("place_id")]);
    const taste = body.origin.source === "city" ? { ...loaded, answers: { ...loaded.answers, distance: "city" } } : loaded;
    const exclude = new Set([...(actions.data ?? []).map((r) => r.place_id as string), ...(body.shown ?? []).slice(0, 200)]);
    const tried = (body.tried ?? []).slice(0, 12).map((t) => String(t).slice(0, 30));
    const kinds = await readSurprise(taste, city, body.category, tried).catch((error) => {
      console.error(error);
      return [];
    });
    // The first kind that finds a place; at most two searches.
    for (const kind of kinds.slice(0, 2)) {
      const found = await curate({
        taste,
        city,
        origin: { lat: body.origin.lat, lng: body.origin.lng },
        category: body.category,
        when: body.when,
        tweaks: [],
        note: kind.query,
        exclude,
        needsDiet: body.category === "food_drinks" && needsDietCheck(taste.answers),
        need: 1,
        rotation: 0,
        searches: 1,
      });
      const best = pickFrom(found, { room: 1, small: false, popularCap: 1 }).chosen[0];
      if (!best) {
        tried.push(kind.label);
        continue;
      }
      const c = best.candidate;
      const pick = buildPick(c, { placeId: c.place.id, kind: kindOf(c.place, body.category), verdict: "Good if you're nearby", because: kind.why }, { taste, when: body.when, city, wholeCity: body.origin.source === "city" });
      return Response.json({ pick, kind: kind.label });
    }
    return Response.json({ notice: "Couldn't find a surprise that fits right now. Try again in a bit.", tried });
  });
}
