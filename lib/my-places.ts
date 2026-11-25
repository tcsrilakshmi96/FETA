"use client";

import { forgetLists } from "@/lib/lists-client";
import { syncFetaPicks } from "@/lib/picks-client";
import { currentUserId, supabase } from "@/lib/supabase";

// My places and check-in: places people add themselves ("I've been"), and
// how it was after an outing. Stored on the "been" row in pick_actions:
// place ID, how often, how it was, their note. No Google content.

export type Visits = "once" | "few" | "regular";
export type Verdict = "loved" | "fine" | "not_for_me";

export const VISITS: { id: Visits; label: string }[] = [
  { id: "once", label: "Once" },
  { id: "few", label: "A few times" },
  { id: "regular", label: "My regular" },
];

export const VERDICTS: { id: Verdict; label: string }[] = [
  { id: "loved", label: "Loved it" },
  { id: "fine", label: "It was fine" },
  { id: "not_for_me", label: "Not for me" },
];

// Google's place types say whether it's somewhere to eat or drink.
const FOOD_TYPES = /restaurant|cafe|bar|bakery|food|meal|pub|brewery|coffee|dessert|ice_cream|tea_house|juice|winery/;
export const categoryOf = (types: string[] = []) => (types.some((t) => FOOD_TYPES.test(t)) ? "food_drinks" : "experiences");

export async function saveBeen(
  placeId: string,
  fields: { visits?: Visits | null; verdict?: Verdict | null; note?: string; dietOk?: boolean | null; category?: string; cityId?: string; recommend?: boolean },
) {
  const userId = await currentUserId();
  if (!userId) return false;
  const row: Record<string, unknown> = { user_id: userId, place_id: placeId, action: "been" };
  if (fields.visits !== undefined) row.visits = fields.visits;
  if (fields.verdict !== undefined) row.verdict = fields.verdict;
  if (fields.note !== undefined) row.note = fields.note.trim() || null;
  if (fields.dietOk !== undefined) row.diet_ok = fields.dietOk;
  if (fields.category) row.category = fields.category;
  if (fields.cityId) row.city_id = fields.cityId;
  // Feta Favourites: recommended to others with a similar taste (only the
  // place and a count are shared, never who).
  if (fields.recommend !== undefined) row.recommend = fields.recommend;
  const { error } = await supabase().from("pick_actions").upsert(row, { onConflict: "user_id,place_id,action" });
  if (error) console.error("Saving place failed", error.message);
  else {
    // Saved shows it straight away (round 3 audit, 26 Nov 2026).
    forgetLists();
    if (fields.verdict !== undefined || fields.note !== undefined) void syncFetaPicks();
  }
  return !error;
}

// A saved place from 1 to 14 days ago that they haven't told Feta about,
// and haven't been asked about in the last week. One at a time, and only
// for the city they're in (testers: asked about Bengaluru on a first night
// in Dubai).
export async function nextCheckin(cityId?: string): Promise<{ placeId: string; category: string | null } | null> {
  if (!(await currentUserId())) return null;
  const now = Date.now();
  const db = supabase();
  const [{ data: saved }, { data: been }] = await Promise.all([
    db
      .from("pick_actions")
      .select("place_id, category, checkin_asked_at, city_id")
      .eq("action", "saved")
      .lt("created_at", new Date(now - 20 * 3600 * 1000).toISOString())
      .gt("created_at", new Date(now - 14 * 86400 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
    db.from("pick_actions").select("place_id").eq("action", "been"),
  ]);
  const done = new Set((been ?? []).map((b) => b.place_id));
  const weekAgo = now - 7 * 86400 * 1000;
  const next = (saved ?? []).find(
    (s) =>
      !s.place_id.startsWith("event:") &&
      !done.has(s.place_id) &&
      (!cityId || !s.city_id || s.city_id === cityId) &&
      (!s.checkin_asked_at || new Date(s.checkin_asked_at).getTime() < weekAgo),
  );
  return next ? { placeId: next.place_id, category: next.category } : null;
}

export async function markAsked(placeId: string) {
  const userId = await currentUserId();
  if (!userId) return;
  await supabase()
    .from("pick_actions")
    .update({ checkin_asked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("place_id", placeId)
    .eq("action", "saved");
}

// A place's name and area (and a photo unless lite), read live from Google
// (nothing stored). Signed in, the lookup is counted as theirs; the same
// place isn't asked for twice within the hour on this phone (audit, 20 Nov
// 2026: Saved and trips looked the same places up on every open).
export type LivePlace = { name: string; area: string; mapsUri: string; photo?: string | null; credit?: string | null };
const placeCache = new Map<string, { at: number; place: Promise<LivePlace | null> }>();
export function livePlace(placeId: string, lite = true): Promise<LivePlace | null> {
  const key = `${placeId}:${lite}`;
  const hit = placeCache.get(key);
  if (hit && Date.now() - hit.at < 3600 * 1000) return hit.place;
  const place = (async () => {
    const { data } = await supabase()
      .auth.getSession()
      .catch(() => ({ data: { session: null } }));
    const token = data.session?.access_token;
    const res = await fetch(`/api/place/${encodeURIComponent(placeId)}${lite ? "?lite=1" : ""}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return res.ok ? ((await res.json()) as LivePlace) : null;
  })().catch(() => null);
  placeCache.set(key, { at: Date.now(), place });
  // A failed lookup can be tried again.
  place.then((p) => p || placeCache.delete(key));
  return place;
}

// The place's name for the question, read live (nothing stored).
export async function placeName(placeId: string): Promise<string | null> {
  return (await livePlace(placeId))?.name ?? null;
}
