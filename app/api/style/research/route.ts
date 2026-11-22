import { after } from "next/server";
import { cityById } from "@/lib/server/cities";
import { LIBRARY_BUDGET_INR, librarySpentToday, withCosts } from "@/lib/server/costs";
import { FAKE } from "@/lib/server/fake-places";
import { loadBrief, researchStyle, saveResearch } from "@/lib/server/style-research";
import { userDb, userIdFor } from "@/lib/server/taste";
import { styleById } from "@/lib/style";

export const maxDuration = 300;

// Feta's own brand research (founder, 20 Nov 2026: "feta's own research on
// all the styles in a country when asked"). Style asks for one style in the
// person's country; the first phone to claim it starts the research (about
// ₹15–30), which carries on in the background after replying (it takes
// about 2 minutes, and nobody should have to keep the screen open), and
// saves the brands as proposed for everyone there. Redone after 120 days.
// "more" (the Find more brands button) asks for another round now, for
// brands Feta doesn't have yet.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { style?: string; cityId?: string; more?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const city = cityById(body.cityId);
  const style = styleById(String(body.style ?? ""));
  if (!city || !style) return Response.json({ error: "Bad request" }, { status: 400 });
  if (FAKE) return Response.json({ skipped: "test mode" });
  if ((await librarySpentToday(db)) >= LIBRARY_BUDGET_INR) return Response.json({ skipped: "budget" });
  const { data: claimed, error } = await db.rpc(body.more ? "start_style_research_more" : "start_style_research", { p_key: process.env.USAGE_REPORT_KEY, p_country: city.country, p_style: style.id });
  if (error || !claimed) return Response.json({ skipped: error ? "unavailable" : "done or running" });

  // The brands Feta already has here for this style, so another round looks past them.
  const { data: rows } = await db
    .from("brand_styles")
    .select("brands!inner (name, brand_markets!inner (country))")
    .eq("style_id", style.id)
    .eq("brands.brand_markets.country", city.country)
    .limit(80);
  const known = ((rows ?? []) as unknown as { brands: { name: string } }[]).map((r) => r.brands.name);

  after(() =>
    withCosts(db, "style_research", async () => {
      try {
        const brief = await loadBrief(db, style.id);
        if (!brief) return;
        const found = await researchStyle(brief, { code: city.country, name: city.countryName }, 14, known);
        // A round that found nothing isn't kept as done: it would block this
        // style here for 120 days (Berlin and Lisbon had no brands at all);
        // the claim lapses after 15 minutes and the next visitor tries again,
        // within the library's daily budget.
        if (!found.brands.length) return console.error(`Style research found nothing: ${style.id} in ${city.country}`, found.dropped.slice(0, 5));
        await saveResearch(db, city.country, style.id, found);
      } catch (e) {
        // The claim lapses after 15 minutes, so the next visitor tries again.
        console.error(e);
      }
    }),
  );
  return Response.json({ started: true });
}
