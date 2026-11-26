import { FAKE } from "@/lib/server/fake-places";
import { askIs, later, limitNoticeHere, overBudget, withCosts } from "@/lib/server/costs";
import { findSpots, lookPicture } from "@/lib/server/style";
import { userDb, userIdFor } from "@/lib/server/taste";
import { SLOTS, styleById, type Look, type Slot, type Wears } from "@/lib/style";

// The picture (up to 60 s), then where its pieces are (up to 15 s, after the reply).
export const maxDuration = 90;

// A look's realistic picture, made when that look comes on screen (founder,
// 22 Nov 2026: about ₹4 each): an outfit board (no person; never on their
// photo since 25 Nov 2026), kept on their account too, the latest 60
// (founder, 23 Nov 2026: never a sketch, never made twice).
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  const userId = token && db ? await userIdFor(db, token) : null;
  if (!token || !db || !userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { look?: Partial<Look>; wears?: Wears };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const l = body.look;
  if (!l || !styleById(String(l.style)) || !Array.isArray(l.pieces)) return Response.json({ error: "Bad request" }, { status: 400 });
  const t = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const look: Look = { id: t(l.id, 40), style: String(l.style), title: t(l.title, 60), why: "", pieces: l.pieces.slice(0, 6).filter((p) => SLOTS.includes(p.slot as Slot)).map((p) => ({ slot: p.slot as Slot, name: t(p.name, 60) })) };
  const wears: Wears = body.wears === "men" || body.wears === "both" ? body.wears : "women";
  if (FAKE) return Response.json({ notice: "No pictures in test mode." });
  if (await overBudget(db)) return Response.json({ notice: await limitNoticeHere("style") });
  return withCosts(db, "style_picture", async () => {
    askIs({ key: [look.id, wears], label: `picture · ${look.style}` });
    try {
      const image = await lookPicture(look, wears);
      // The picture goes to the phone at once; where its pieces are (up to
      // 15 s more) is found after and kept with it, and the phone picks the
      // dots up from there (testers, 26 Nov 2026: Style too slow).
      const { error } = await db.from("look_pictures").upsert({ user_id: userId, look_id: look.id, style_id: look.style, image, spots: null });
      if (error) console.error("look picture", error.message);
      later(async () => {
        const spots = await findSpots(image, look.pieces).catch(() => null);
        if (spots) await db.from("look_pictures").update({ spots }).eq("look_id", look.id);
        const { data: old } = await db.from("look_pictures").select("look_id").order("created_at", { ascending: false }).range(60, 200);
        if (old?.length) await db.from("look_pictures").delete().in("look_id", old.map((r) => r.look_id));
      });
      return Response.json({ image });
    } catch (error) {
      console.error(error);
      return Response.json({ notice: "Couldn't make this picture." });
    }
  });
}
