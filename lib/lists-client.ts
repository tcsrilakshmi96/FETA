"use client";

import type { ListItem } from "@/app/api/lists/route";
import type { Origin } from "@/lib/origin";
import { currentUserId, supabase } from "@/lib/supabase";

export type { ListItem };

// Saved reads every place live from Google (about ₹1.5 each), so the list
// is kept on the phone for 15 minutes (audit, 20 Nov 2026: about ₹50 each
// time Saved opened). Saving, Been and removing forget it.
const KEEP_MS = 15 * 60 * 1000;
let kept: { at: number; q: string; items: ListItem[] } | null = null;
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
  try {
    const res = await fetch(`/api/lists${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return kept?.items ?? null;
    const body = (await res.json()) as { items: ListItem[]; notice?: string };
    if (body.notice) return kept?.items ?? body.items;
    kept = { at: Date.now(), q, items: body.items };
    return body.items;
  } catch {
    return kept?.items ?? null;
  }
}
