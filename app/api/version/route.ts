import { connection } from "next/server";

// The deploy that's live now, for FreshVersion on the phone.
export async function GET() {
  await connection();
  return Response.json({ build: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" }, { headers: { "Cache-Control": "no-store" } });
}
