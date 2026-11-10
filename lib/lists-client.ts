"use client";

import type { ListItem } from "@/app/api/lists/route";
import type { Origin } from "@/lib/origin";
import { currentUserId, supabase } from "@/lib/supabase";

export type { ListItem };

export async function fetchLists(origin: Origin | null): Promise<ListItem[] | null> {
  await currentUserId();
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const q = origin ? `?lat=${origin.lat}&lng=${origin.lng}` : "";
  try {
    const res = await fetch(`/api/lists${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return ((await res.json()) as { items: ListItem[] }).items;
  } catch {
    return null;
  }
}
