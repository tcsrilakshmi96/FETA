import { timingSafeEqual } from "node:crypto";
import { userDb } from "@/lib/server/taste";

export const maxDuration = 20;

// Is Gemini answering? (founder, 21 Nov 2026: its prepaid credit ran out a
// third time and picks and Style failed quietly all day.) One tiny call,
// about ₹0.15. Asked by Admin (an admin's sign-in) and by the founder's n8n
// check (the report key in "x-report-key"), which emails her when it isn't.
export type Health = { gemini: "ok" | "no_credit" | "failing"; detail?: string };

function keyOk(given: string | null) {
  const key = process.env.USAGE_REPORT_KEY;
  if (!key || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function allowed(request: Request) {
  if (keyOk(request.headers.get("x-report-key"))) return true;
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return false;
  const { data } = await userDb(token).rpc("is_admin");
  return data === true;
}

export async function GET(request: Request) {
  if (!(await allowed(request))) return Response.json({ error: "Not allowed" }, { status: 403 });
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with: ok" }] }], generationConfig: { maxOutputTokens: 5, thinkingConfig: { thinkingLevel: "low" } } }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  const body: Health = !res
    ? { gemini: "failing", detail: "Gemini didn't answer in 15 seconds" }
    : res.status === 402
      ? { gemini: "no_credit", detail: "Gemini's prepaid credit has run out. Top it up in Google AI Studio (ai.studio → your project → Billing)." }
      : res.ok
        ? { gemini: "ok" }
        : { gemini: "failing", detail: `Gemini answered ${res.status}: ${(await res.text()).slice(0, 160)}` };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
