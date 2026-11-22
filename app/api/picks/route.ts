import { askIs, withCosts } from "@/lib/server/costs";
import { runPicks } from "@/lib/server/engine";
import { userDb } from "@/lib/server/taste";

// Search, AI and photos can take a while; the default cut-off is shorter.
export const maxDuration = 60;

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const b = (body ?? {}) as { when?: string; category?: string; origin?: { lat?: number; lng?: number; city?: { id?: string; name?: string } }; note?: string; tweaks?: unknown; more?: unknown };
  // The same place, time and ask is the same search (rounded to ~100 m).
  const at = (n?: number) => (typeof n === "number" ? n.toFixed(3) : "");
  return withCosts(token ? userDb(token) : null, "picks", () => {
    askIs({
      key: [b.when, b.category, b.origin?.city?.id, at(b.origin?.lat), at(b.origin?.lng), b.note ?? "", b.tweaks ?? null, b.more ?? null],
      label: [b.when, b.category === "food_drinks" ? "food" : b.category === "experiences" ? "things to do" : b.category, b.origin?.city?.name, b.note ? "with a note" : "", b.more ? "more" : ""].filter(Boolean).join(" · "),
    });
    return runPicks(token, body);
  });
}
