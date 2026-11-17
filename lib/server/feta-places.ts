import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { distanceKm, type City } from "@/lib/cities";
import { placeLocation } from "@/lib/server/places";
import { tooFar, type Kind, type Taste } from "@/lib/server/picks";

// The founder's places within reach of the person, nearest first, for the
// picks and the ★ Feta Picks sheet (founder, 17 Nov 2026: "it's showing
// everything in Bangalore instead of just places near me"). Their
// locations are kept for up to 30 days, as Google allows; missing or old
// ones are looked up first (about ₹0.4 each, once a month per place).

const LOCATE_AT_ONCE = 40;
const DUE_MS = 25 * 24 * 3600 * 1000;

export type FounderPlace = { placeId: string; note: string; kind: Kind; km: number };

export async function founderPlacesNear(db: SupabaseClient, opts: { city: City; kinds: Kind[]; origin: { lat: number; lng: number }; taste: Taste }): Promise<FounderPlace[]> {
  const { data } = await db.from("founder_places").select("place_id, note, kind, lat, lng, located_at").eq("city_id", opts.city.id).eq("active", true).in("kind", opts.kinds).limit(500);
  const rows = data ?? [];
  const due = rows.filter((r) => r.lat === null || !r.located_at || Date.now() - new Date(r.located_at).getTime() > DUE_MS).slice(0, LOCATE_AT_ONCE);
  if (due.length) {
    const found = (await Promise.all(due.map(async (r) => ({ r, at: await placeLocation(r.place_id).catch(() => null) })))).filter((x) => x.at);
    for (const { r, at } of found) Object.assign(r, { lat: at!.lat, lng: at!.lng });
    if (found.length) await db.rpc("locate_founder_places", { p_places: found.map(({ r, at }) => ({ place_id: r.place_id, ...at })) });
  }
  return rows
    .filter((r) => r.lat !== null && r.lng !== null)
    .map((r) => ({ placeId: r.place_id as string, note: (r.note as string) ?? "", kind: r.kind as Kind, km: distanceKm(opts.origin, { lat: r.lat as number, lng: r.lng as number }) }))
    .filter((p) => !tooFar(p.km, opts.taste.answers))
    .sort((a, b) => a.km - b.km);
}
