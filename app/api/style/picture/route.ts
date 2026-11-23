import { FAKE } from "@/lib/server/fake-places";
import { askIs, limitNoticeHere, overBudget, withCosts } from "@/lib/server/costs";
import { findSpots, lookPicture } from "@/lib/server/style";
import { userDb, userIdFor } from "@/lib/server/taste";
import { SLOTS, styleById, type Look, type Slot, type Wears } from "@/lib/style";

export const maxDuration = 60;

// A look's realistic picture, made when that look comes on screen (founder,
// 22 Nov 2026: about ₹4 each, only when seen). With their photo from My
// style, the look on them; the photo goes to Google's image AI only for
// this picture, and Feta keeps neither (the picture stays on their phone).
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { look?: Partial<Look>; wears?: Wears; photo?: string | null };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const l = body.look;
  if (!l || !styleById(String(l.style)) || !Array.isArray(l.pieces)) return Response.json({ error: "Bad request" }, { status: 400 });
  const t = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const look: Look = { id: t(l.id, 40), style: String(l.style), title: t(l.title, 60), why: "", pieces: l.pieces.slice(0, 6).filter((p) => SLOTS.includes(p.slot as Slot)).map((p) => ({ slot: p.slot as Slot, name: t(p.name, 60) })) };
  const photo = typeof body.photo === "string" && body.photo.startsWith("data:image/") && body.photo.length < 2_000_000 ? body.photo : null;
  const wears: Wears = body.wears === "men" || body.wears === "both" ? body.wears : "women";
  if (FAKE) return Response.json({ notice: "No pictures in test mode." });
  if (await overBudget(db)) return Response.json({ notice: await limitNoticeHere("style") });
  return withCosts(db, "style_picture", async () => {
    askIs({ key: [look.id, wears, !!photo], label: `picture · ${look.style}` });
    try {
      const image = await lookPicture(look, wears, photo);
      const spots = await findSpots(image, look.pieces).catch(() => null);
      return Response.json({ image, spots });
    } catch (error) {
      console.error(error);
      return Response.json({ notice: "Couldn't make this picture." });
    }
  });
}
