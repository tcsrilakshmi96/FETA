import { cityById } from "@/lib/server/cities";
import { userDb } from "@/lib/server/taste";

// Admin only: curated places per city, next to how many real people
// searched there in the last 30 days (city_coverage()), with each city's
// name. A city people use with none of the founder's places or local
// favourites is a gap to fill.
export type Coverage = { cityId: string; name: string; people: number; founder: number; local: number };

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });
  const db = userDb(token);
  const { data: admin } = await db.rpc("is_admin");
  if (admin !== true) return Response.json({ error: "Not allowed" }, { status: 403 });
  const { data, error } = await db.rpc("city_coverage");
  if (error) return Response.json({ error: "Not ready" }, { status: 500 });
  const rows = (data as { city_id: string; city_name: string | null; people: number; founder: number; local: number }[]).map(
    (r): Coverage => ({ cityId: r.city_id, name: cityById(r.city_id)?.name ?? r.city_name ?? r.city_id, people: Number(r.people), founder: Number(r.founder), local: Number(r.local) }),
  );
  return Response.json({ rows });
}
