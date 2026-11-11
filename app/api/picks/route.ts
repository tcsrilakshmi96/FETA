import { withCosts } from "@/lib/server/costs";
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
  return withCosts(token ? userDb(token) : null, "picks", () => runPicks(token, body));
}
