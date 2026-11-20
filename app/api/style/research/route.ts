import { cityById } from "@/lib/server/cities";
import { LIBRARY_BUDGET_INR, librarySpentToday, withCosts } from "@/lib/server/costs";
import { FAKE } from "@/lib/server/fake-places";
import { loadBrief, researchStyle, saveResearch } from "@/lib/server/style-research";
import { userDb, userIdFor } from "@/lib/server/taste";
import { styleById } from "@/lib/style";

export const maxDuration = 300;

// Feta's own brand research (founder, 20 Nov 2026: "feta's own research on
// all the styles in a country when asked"). Style asks for one style in the
// person's country at a time; the first phone to claim it researches it
// (about ₹15–30) and saves the brands as proposed for everyone there.
// Redone after 120 days. Her AI's imported lists are the starting set;
// this adds the outliers and fills the gaps.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { style?: string; cityId?: string };
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
  const { data: claimed, error } = await db.rpc("start_style_research", { p_key: process.env.USAGE_REPORT_KEY, p_country: city.country, p_style: style.id });
  if (error || !claimed) return Response.json({ skipped: error ? "unavailable" : "done or running" });
  return withCosts(db, "style_research", async () => {
    try {
      const brief = await loadBrief(db, style.id);
      if (!brief) return Response.json({ skipped: "no brief" });
      const found = await researchStyle(brief, { code: city.country, name: city.countryName });
      await saveResearch(db, city.country, style.id, found);
      return Response.json({ found: found.brands.length });
    } catch (e) {
      console.error(e);
      return Response.json({ skipped: "failed" });
    }
  });
}
