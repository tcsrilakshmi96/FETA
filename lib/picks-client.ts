"use client";

import type { Origin } from "@/lib/origin";
import type { Category, Pick, When } from "@/lib/server/picks";
import { currentUserId, supabase } from "@/lib/supabase";

export type { Category, Pick, When };

export type PicksReply = { picks: Pick[]; banner?: string; notice?: string; error?: string };

// Asks Feta's server for 3 picks. The server reads the user's answers and
// swipes from the database itself.
export async function fetchPicks(
  category: Category,
  when: When,
  origin: Origin,
  more = false,
  tweak?: { tweaks: string[]; note?: string },
): Promise<PicksReply> {
  await currentUserId();
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { picks: [], notice: "Couldn't sign you in. Check your connection and try again." };
  try {
    const res = await fetch("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ category, when, origin, more, ...tweak }),
    });
    return (await res.json()) as PicksReply;
  } catch {
    return { picks: [], notice: "No connection just now. Try again in a moment." };
  }
}

export type PlaceNotes = { items: string[]; sources: { title: string; uri: string }[] };

// "What to order" / "Highlights" for the Details view (read live from
// Google Maps reviews by Gemini; never stored).
export async function fetchNotes(placeId: string, kind: string): Promise<PlaceNotes> {
  const empty = { items: [], sources: [] };
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return empty;
  try {
    const res = await fetch("/api/details", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ placeId, kind }),
    });
    return res.ok ? ((await res.json()) as PlaceNotes) : empty;
  } catch {
    return empty;
  }
}
