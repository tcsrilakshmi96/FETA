import { FAKE } from "@/lib/server/fake-places";
import { DAILY_BUDGET_INR, spentToday, withCosts } from "@/lib/server/costs";
import { drawOnYou } from "@/lib/server/style";
import { userDb, userIdFor } from "@/lib/server/taste";
import { lookImage, styleById } from "@/lib/style";

export const maxDuration = 60;

// "See it on you" (founder, 20 Nov 2026): their one photo drawn in one of
// their styles, about ₹4. The photo goes to Google's image AI only for this
// drawing; Feta keeps neither the photo nor the drawing (it stays on their
// phone).
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { photo?: string; style?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const style = styleById(String(body.style ?? ""));
  if (!style || typeof body.photo !== "string" || !body.photo.startsWith("data:image/") || body.photo.length > 2_000_000) return Response.json({ error: "Bad request" }, { status: 400 });
  if (!FAKE && (await spentToday(db)) >= DAILY_BUDGET_INR) return Response.json({ notice: "Feta has done all its drawing for today." });
  return withCosts(db, "style_draw", async () => {
    try {
      const ref = await fetch(new URL(lookImage(style.id), request.url));
      const reference = `data:image/jpeg;base64,${Buffer.from(await ref.arrayBuffer()).toString("base64")}`;
      return Response.json({ image: await drawOnYou(body.photo!, style.id, reference) });
    } catch (error) {
      console.error(error);
      return Response.json({ notice: "Couldn't draw this one." });
    }
  });
}
