import { FAKE } from "@/lib/server/fake-places";
import { cityById } from "@/lib/server/cities";
import { limitNoticeHere, overBudget, withCosts } from "@/lib/server/costs";
import { outfitIdea, type OutfitAsk } from "@/lib/server/style";
import { userDb, userIdFor } from "@/lib/server/taste";
import { OCCASIONS, styleById, type Outfit } from "@/lib/style";

export const maxDuration = 20;

// What to wear (founder, 20 Nov 2026): a direction from their own styles for
// tonight's plan, or for the outing they tapped when there's no plan.
type Body = Partial<Omit<OutfitAsk, "city">> & { cityId?: string };

// One piece to change, with the outfit it belongs to.
function changeOf(c: unknown): OutfitAsk["change"] {
  const x = c as { piece?: string; outfit?: Outfit } | null;
  if (!x || !["top", "bottom", "shoes"].includes(String(x.piece)) || !x.outfit?.pieces) return null;
  const t = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const o = x.outfit;
  return {
    piece: x.piece as "top" | "bottom" | "shoes",
    outfit: { style: t(o.style, 30), title: t(o.title, 40), big1: t(o.big1, 10), big2: t(o.big2, 16), line: t(o.line, 260), pieces: { top: t(o.pieces.top, 40), bottom: t(o.pieces.bottom, 40), shoes: t(o.pieces.shoes, 48) }, chips: (o.chips ?? []).slice(0, 4).map((c2) => t(c2, 24)) },
  };
}

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
  if (!FAKE && (await overBudget(db))) return Response.json({ notice: await limitNoticeHere("style"), limited: true });
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
    note: body.note ? String(body.note).slice(0, 160) : null,
    change: changeOf(body.change),
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
