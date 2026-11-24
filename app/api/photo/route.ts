import { askIs, overBudget, withCosts } from "@/lib/server/costs";
import { photoName } from "@/lib/server/photo-ref";
import { photoUri } from "@/lib/server/places";
import { userDb, userIdFor } from "@/lib/server/taste";

// One pick's photo, asked for by the phone only when the card is on screen.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { ref } = (await request.json().catch(() => ({}))) as { ref?: string };
  const name = ref ? photoName(ref) : null;
  if (!name) return Response.json({ error: "Bad photo" }, { status: 400 });
  const db = userDb(token);
  if (!(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  // Nothing more is spent once their day's limit is reached (audit, 24 Nov 2026).
  if (await overBudget(db)) return Response.json({ uri: null });
  const uri = await withCosts(db, "photo", () => {
    askIs({ key: name, label: "place photo" });
    return photoUri(name);
  });
  return Response.json({ uri });
}
