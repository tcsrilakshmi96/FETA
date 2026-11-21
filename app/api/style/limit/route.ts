import { FAKE } from "@/lib/server/fake-places";
import { limitNoticeHere, overBudget } from "@/lib/server/costs";
import { userDb, userIdFor } from "@/lib/server/taste";

// Asked when Style setup opens, so someone over today's limit hears it
// before answering any questions, not after (founder, 21 Nov 2026).
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!FAKE && (await overBudget(db))) return Response.json({ notice: await limitNoticeHere("style") });
  return Response.json({});
}
