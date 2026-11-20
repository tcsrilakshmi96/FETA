import { overBudget, withCosts } from "@/lib/server/costs";
import { FAKE } from "@/lib/server/fake-places";
import { rankBrands, type RankAsk } from "@/lib/server/style";
import { userDb, userIdFor } from "@/lib/server/taste";
import { styleById } from "@/lib/style";

export const maxDuration = 30;

// Brands for their styles, ordered for them with a line on why (about ₹0.1).
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: Partial<RankAsk>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const s = (x: unknown, n: number) => String(x ?? "").slice(0, n);
  const ask: RankAsk = {
    cues: (body.cues ?? []).slice(0, 8).map((c) => s(c, 80)),
    styles: (body.styles ?? []).filter((x) => styleById(x)).slice(0, 8),
    wears: body.wears === "men" || body.wears === "both" ? body.wears : "women",
    budget: (body.budget ?? []).filter((b) => /^c[1-4]$/.test(b)),
    loved: (body.loved ?? []).slice(0, 12).map((x) => s(x, 60)),
    country: s(body.country, 60),
    brands: (body.brands ?? []).slice(0, 80).map((b) => ({ id: s(b.id, 40), name: s(b.name, 60), style: s(b.style, 30), cues: s(b.cues, 160), priceFeel: b.priceFeel ? s(b.priceFeel, 10) : null, homegrown: !!b.homegrown, lovers: Number(b.lovers) || 0 })),
  };
  if (!ask.brands.length) return Response.json({ order: [] });
  if (!FAKE && (await overBudget(db))) return Response.json({ order: [] });
  return withCosts(db, "style_rank", async () => {
    try {
      return Response.json({ order: await rankBrands(ask) });
    } catch (error) {
      console.error(error);
      return Response.json({ order: [] });
    }
  });
}
