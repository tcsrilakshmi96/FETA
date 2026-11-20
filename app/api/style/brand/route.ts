import { cityById } from "@/lib/server/cities";
import { LIBRARY_BUDGET_INR, librarySpentToday, withCosts } from "@/lib/server/costs";
import { FAKE } from "@/lib/server/fake-places";
import { lookupBrand } from "@/lib/server/style-research";
import { userDb, userIdFor } from "@/lib/server/taste";
import { STYLES } from "@/lib/style";

export const maxDuration = 60;

// A brand someone loves that isn't in Feta's library yet: looked up once
// (about ₹3) and added as proposed, so everyone after finds it instantly.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { name?: string; cityId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const name = String(body.name ?? "").trim().slice(0, 60);
  const city = cityById(body.cityId);
  if (name.length < 2 || !city) return Response.json({ error: "Bad request" }, { status: 400 });
  if (FAKE) return Response.json({ notice: "Looking up new brands is off in test mode." });
  if ((await librarySpentToday(db)) >= LIBRARY_BUDGET_INR) return Response.json({ notice: "Feta has done all its searching for today. Try again tomorrow." });
  return withCosts(db, "style_brand", async () => {
    try {
      const brand = await lookupBrand(db, name, { code: city.country, name: city.countryName }, STYLES.map((s) => s.id));
      return brand ? Response.json({ brand }) : Response.json({ notice: `Couldn't find a clothing brand called "${name}".` });
    } catch (error) {
      console.error(error);
      return Response.json({ notice: "Couldn't look that up just now. Try again." });
    }
  });
}
