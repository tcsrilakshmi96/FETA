"use client";

import { loadCity } from "@/lib/cities";
import { currentUserId, supabase } from "@/lib/supabase";
import { weekendSaturday } from "@/lib/weekend";

// This weekend: saved places ticked for it, and things they want to do
// (typed in Lists or said in chat). The founder drafts the WhatsApp plan
// from these on Fridays.

export type Wish = { id: string; text: string };

export function thisSaturday() {
  return weekendSaturday(loadCity()?.timeZone);
}

export async function loadWishes(): Promise<Wish[]> {
  if (!(await currentUserId())) return [];
  const { data } = await supabase().from("weekend_wishes").select("id, text").eq("for_date", thisSaturday()).order("created_at");
  return (data ?? []) as Wish[];
}

export async function addWeekendWish(text: string): Promise<Wish | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase()
    .from("weekend_wishes")
    .insert({ user_id: userId, text: text.trim().slice(0, 80), for_date: thisSaturday() })
    .select("id, text")
    .single();
  if (error) console.error("Saving weekend wish failed", error.message);
  return (data as Wish) ?? null;
}

export async function removeWeekendWish(id: string) {
  const { error } = await supabase().from("weekend_wishes").delete().eq("id", id);
  if (error) console.error("Removing weekend wish failed", error.message);
}

// Ticks (or unticks) a saved place for this weekend.
export async function tickWeekend(placeId: string, on: boolean) {
  const userId = await currentUserId();
  if (!userId) return;
  const { error } = await supabase()
    .from("pick_actions")
    .update({ weekend_for: on ? thisSaturday() : null })
    .eq("user_id", userId)
    .eq("place_id", placeId)
    .eq("action", "saved");
  if (error) console.error("Saving weekend tick failed", error.message);
}
