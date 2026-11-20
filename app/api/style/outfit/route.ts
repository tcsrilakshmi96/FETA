import { FAKE } from "@/lib/server/fake-places";
import { cityById } from "@/lib/server/cities";
import { DAILY_BUDGET_INR, spentToday, withCosts } from "@/lib/server/costs";
import { outfitIdea, type OutfitAsk } from "@/lib/server/style";
import { userDb, userIdFor } from "@/lib/server/taste";
import { OCCASIONS, styleById } from "@/lib/style";

export const maxDuration = 20;

// What to wear (founder, 20 Nov 2026): a direction from their own styles for
// tonight's plan, or for the outing they tapped when there's no plan.
type Body = Partial<Omit<OutfitAsk, "city">> & { cityId?: string };

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
  const styles = (body.styles ?? []).filter((s) => styleById(s)).slice(0, 6);
  if (!styles.length) return Response.json({ error: "No styles" }, { status: 400 });
  if (!FAKE && (await spentToday(db)) >= DAILY_BUDGET_INR) return Response.json({ notice: "Feta has done all its thinking for today. Try again tomorrow." });
  const short = (a: unknown, n: number, len = 60) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => String(x).slice(0, len));
  const ask: OutfitAsk = {
    styles,
    wears: body.wears === "men" || body.wears === "both" ? body.wears : "women",
    occasion: OCCASIONS.some((o) => o.id === body.occasion) ? body.occasion! : null,
    vibe: body.vibe ? String(body.vibe).slice(0, 60) : null,
    stops: (body.stops ?? []).slice(0, 5).map((s) => ({ name: String(s.name).slice(0, 60), kind: String(s.kind).slice(0, 40), time: s.time ? String(s.time).slice(0, 10) : undefined })),
    walkKm: typeof body.walkKm === "number" && Number.isFinite(body.walkKm) ? body.walkKm : null,
    city: cityById(body.cityId)?.name ?? "their city",
    localTime: String(body.localTime ?? "").slice(0, 30),
    avoid: short(body.avoid, 6),
    usedStyles: short(body.usedStyles, 8, 30),
    cues: short(body.cues, 8, 80),
    loved: short(body.loved, 6),
    notMe: short(body.notMe, 6),
  };
  return withCosts(db, "style_outfit", async () => {
    try {
      return Response.json({ outfit: await outfitIdea(ask) });
    } catch (error) {
      console.error(error);
      return Response.json({ notice: "Feta couldn't think of a look just now. Try again." });
    }
  });
}
