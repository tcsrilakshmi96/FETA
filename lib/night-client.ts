"use client";

import { didSomething } from "@/components/Feedback";
import type { City } from "@/lib/cities";
import { planIsOver, type NightPlace } from "@/lib/night-plan";
import { currentUserId, supabase } from "@/lib/supabase";

// Plans made from Saved: the live details for planning, and the person's
// own saved plans (place IDs, the day and the start time only).

export type SavedPlan = { id: string; day: string; startMinute: number; placeIds: string[]; cityId: string | null; checkedAt: string | null };

const kept = new Map<string, Promise<{ places?: NightPlace[]; notice?: string } | null>>();

// Kept while the app is open, so going back and forth costs nothing.
export function fetchNightPlaces(placeIds: string[]) {
  const key = [...placeIds].sort().join("|");
  if (!kept.has(key)) {
    const work = (async () => {
      await currentUserId();
      const { data } = await supabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) return null;
      try {
        const res = await fetch("/api/night-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ placeIds }),
        });
        return res.ok ? ((await res.json()) as { places?: NightPlace[]; notice?: string }) : null;
      } catch {
        return null;
      }
    })();
    kept.set(key, work);
    work.then((r) => !r?.places && kept.delete(key));
  }
  return kept.get(key)!;
}

const fromRow = (r: { id: string; day: string; start_minute: number; place_ids: string[]; city_id: string | null; checked_at: string | null }): SavedPlan => ({
  id: r.id,
  day: r.day,
  startMinute: r.start_minute,
  placeIds: r.place_ids,
  cityId: r.city_id,
  checkedAt: r.checked_at,
});

export async function loadPlans(): Promise<SavedPlan[]> {
  if (!(await currentUserId())) return [];
  const { data } = await supabase().from("saved_plans").select("id, day, start_minute, place_ids, city_id, checked_at").order("day", { ascending: false }).limit(20);
  return (data ?? []).map(fromRow);
}

// A new plan, or the same plan changed.
export async function savePlan(plan: { id?: string; day: string; startMinute: number; placeIds: string[] }, city: City): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const row = { user_id: userId, day: plan.day, start_minute: plan.startMinute, place_ids: plan.placeIds, city_id: city.id, country: city.country, time_zone: city.timeZone, currency: city.currency, updated_at: new Date().toISOString() };
  const db = supabase().from("saved_plans");
  const { data, error } = plan.id ? await db.update(row).eq("id", plan.id).select("id").single() : await db.insert(row).select("id").single();
  if (error) console.error("Saving plan failed", error.message);
  else didSomething();
  return data?.id ?? null;
}

export async function removePlan(id: string) {
  if (!(await currentUserId())) return;
  await supabase().from("saved_plans").delete().eq("id", id);
}

// A plan from the last week whose day has passed and hasn't been asked
// about, for "How was <day>?" on Home.
export async function duePlan(cityId?: string): Promise<SavedPlan | null> {
  if (!(await currentUserId())) return null;
  const today = localDay(new Date());
  const weekAgo = localDay(new Date(Date.now() - 7 * 86400 * 1000));
  const now = new Date();
  const { data } = await supabase().from("saved_plans").select("id, day, start_minute, place_ids, city_id, checked_at").is("checked_at", null).lte("day", today).gte("day", weekAgo).order("day", { ascending: false }).limit(5);
  const plan = (data ?? []).map(fromRow).find((p) => (!cityId || !p.cityId || p.cityId === cityId) && planIsOver(p, today, now.getHours() * 60 + now.getMinutes()));
  return plan ?? null;
}

export async function markPlanChecked(id: string) {
  if (!(await currentUserId())) return;
  await supabase().from("saved_plans").update({ checked_at: new Date().toISOString() }).eq("id", id);
}

// "2026-11-22" for a date on the phone's calendar.
export function localDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "Saturday" for "2026-11-22", or Tonight / Today for today.
export function dayName(day: string, long = true) {
  const d = new Date(`${day}T12:00:00`);
  if (day === localDay(new Date())) return new Date().getHours() >= 16 ? "Tonight" : "Today";
  return new Intl.DateTimeFormat("en-GB", long ? { weekday: "long" } : { weekday: "short", day: "numeric" }).format(d);
}
