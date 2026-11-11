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

// Plan my evening: something to do or a drink close to the chosen dinner,
// when the picks on screen are too far apart.
export async function fetchNearDinner(dinner: Pick, when: When, cityId: string, exclude: string[]): Promise<Pick[]> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return [];
  try {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ when, cityId, near: { placeId: dinner.placeId, lat: dinner.lat, lng: dinner.lng }, exclude }),
    });
    return ((await res.json()) as { picks?: Pick[] }).picks ?? [];
  } catch {
    return [];
  }
}

export type PlaceNotes = { items: string[]; sources: { title: string; uri: string }[] };

// "What to order" / "Highlights" for the Details view (read live from
// Google Maps reviews by Gemini; never stored). Kept in the phone's memory
// while the app is open, so reopening the same place costs nothing.
// A request still on its way is shared too.
const notesKept = new Map<string, { notes: Promise<PlaceNotes>; at: number }>();

export function fetchNotes(pick: Pick): Promise<PlaceNotes> {
  const hit = notesKept.get(pick.placeId);
  if (hit && Date.now() - hit.at < 60 * 60000) return hit.notes;
  const notes = askNotes(pick);
  notesKept.set(pick.placeId, { notes, at: Date.now() });
  notes.then((n) => n.items.length || notesKept.delete(pick.placeId));
  return notes;
}

async function askNotes(pick: Pick): Promise<PlaceNotes> {
  const empty = { items: [], sources: [] };
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return empty;
  try {
    const res = await fetch("/api/details", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ placeId: pick.placeId, kind: pick.kind, name: pick.name, lat: pick.lat, lng: pick.lng }),
    });
    return res.ok ? ((await res.json()) as PlaceNotes) : empty;
  } catch {
    return empty;
  }
}
