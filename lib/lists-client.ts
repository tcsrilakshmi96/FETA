"use client";

import type { ListItem } from "@/app/api/lists/route";
import type { Origin } from "@/lib/origin";
import { currentUserId, supabase } from "@/lib/supabase";

export type { ListItem };

// Saved reads every place live from Google (about ₹1.5 each), so the list
// is kept on the phone for 15 minutes (audit, 20 Nov 2026: about ₹50 each
// time Saved opened). Saving, Been and removing forget the list, but each
// place's live details stay for those 15 minutes, so only a new place is
// looked up (audit, 24 Nov 2026: every save looked up all 30 again).
const KEEP_MS = 15 * 60 * 1000;
let kept: { at: number; q: string; items: ListItem[] } | null = null;
const live = new Map<string, { at: number; q: string; item: ListItem }>();
export function forgetLists() {
  kept = null;
}

export async function fetchLists(origin: Origin | null): Promise<ListItem[] | null> {
  const q = origin ? `?lat=${origin.lat}&lng=${origin.lng}` : "";
  if (kept && kept.q === q && Date.now() - kept.at < KEEP_MS) return kept.items;
  await currentUserId();
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const fresh = [...live].filter(([, v]) => v.q === q && Date.now() - v.at < KEEP_MS);
  try {
    // In a header, not the address: what they saved stays out of logs.
    const res = await fetch(`/api/lists${q}`, { headers: { Authorization: `Bearer ${token}`, "x-feta-have": fresh.map(([id]) => id).join(",") } });
    if (!res.ok) return kept?.items ?? null;
    const body = (await res.json()) as { items: ListItem[]; notice?: string };
    if (body.notice) return kept?.items ?? body.items;
    const items = body.items.flatMap((it) => {
      if (!it.cached) return [it];
      const known = live.get(it.placeId)?.item;
      // What's saved about it is new; where it is and its photo are kept.
      return known ? [{ ...known, list: it.list, note: it.note, savedAt: it.savedAt, weekendFor: it.weekendFor, visits: it.visits, verdict: it.verdict }] : [];
    });
    // Only places just looked up start a new 15 minutes.
    for (const it of body.items) if (!it.event && !it.unchecked && !it.cached) live.set(it.placeId, { at: Date.now(), q, item: it });
    kept = { at: Date.now(), q, items };
    return items;
  } catch {
    return kept?.items ?? null;
  }
}
