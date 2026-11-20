import { FAKE } from "@/lib/server/fake-places";
import { overBudget, withCosts } from "@/lib/server/costs";
import { readPhotos } from "@/lib/server/style";
import { userDb, userIdFor } from "@/lib/server/taste";
import type { Wears } from "@/lib/style";

export const maxDuration = 40;

// Style setup: up to 8 inspiration photos read into their styles (founder,
// 20 Nov 2026). The photos are read and forgotten; only style ids come back.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { photos?: string[]; wears?: Wears };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const photos = (body.photos ?? []).filter((p) => typeof p === "string" && p.startsWith("data:image/") && p.length < 1_500_000).slice(0, 8);
  const wears = body.wears === "men" || body.wears === "both" ? body.wears : "women";
  if (!photos.length) return Response.json({ error: "No photos" }, { status: 400 });
  if (!FAKE && (await overBudget(db))) return Response.json({ notice: "Feta has done all its reading for today. Pick your styles yourself, or try again tomorrow." });
  return withCosts(db, "style_read", async () => {
    try {
      return Response.json(await readPhotos(db, photos, wears));
    } catch (error) {
      console.error(error);
      return Response.json({ notice: "Feta couldn't read those photos just now. Pick your styles yourself, or try again." });
    }
  });
}
