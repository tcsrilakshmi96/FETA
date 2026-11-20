"use client";

import type { Origin } from "@/lib/origin";
import type { Category, Pick, When } from "@/lib/server/picks";
import { currentUserId, supabase } from "@/lib/supabase";

export type { Category, Pick, When };

export type PicksReply = { picks: Pick[]; spares?: Pick[]; banner?: string; notice?: string; error?: string };

// Asks Feta's server for picks (8 to show, the rest as backup). The server reads the user's answers and
// swipes from the database itself.
// A change to their taste still being saved: every search waits for it, so
// it uses the new choices (founder, 19 Nov 2026: back on Home a moment
// after turning a cuisine on in You, picks searched with the old ones).
let saving: Promise<unknown> = Promise.resolve();
export function savingTaste<T>(write: PromiseLike<T>): Promise<T> {
  const p = Promise.resolve(write);
  saving = Promise.all([saving, p.catch(() => null)]);
  return p;
}

export async function fetchPicks(
  category: Category,
  when: When,
  origin: Origin,
  more = false,
  tweak?: { tweaks: string[]; note?: string },
): Promise<PicksReply> {
  await saving;
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

export type PlaceNotes = { items: string[]; sources: { title: string; uri: string }[]; dietSignal?: string };

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

// A pick's photo, fetched only when it comes on screen (Google charges per
// photo). Kept in the phone's memory while the app is open.
const photosKept = new Map<string, Promise<string | null>>();

export function fetchPhoto(ref: string): Promise<string | null> {
  const hit = photosKept.get(ref);
  if (hit) return hit;
  const uri = (async () => {
    const { data } = await supabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    try {
      const res = await fetch("/api/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ref }),
      });
      return res.ok ? (((await res.json()) as { uri?: string }).uri ?? null) : null;
    } catch {
      return null;
    }
  })();
  photosKept.set(ref, uri);
  uri.then((u) => u || photosKept.delete(ref));
  return uri;
}

// "Feta Picks near you": the founder's places and Feta users' favourites in
// their city, nearest first. Kept for an hour on the phone (each opening
// checks places live, about ₹2 each).
const fetaKept = new Map<string, { at: number; reply: PicksReply }>();

// Their taste changed: the sheet checks again with the new diet, budget and distance.
export function forgetFetaPicks() {
  fetaKept.clear();
}

// "Surprise me": a kind of place they haven't chosen but would likely love,
// one search (about ₹3–4). tried: kinds already shown; shown: places in
// their lists, never surprised with.
export async function fetchSurprise(origin: Origin, when: When, category: Category, tried: string[], shown: string[]): Promise<{ pick?: Pick; kind?: string; notice?: string; tried?: string[] }> {
  await saving;
  await currentUserId();
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { notice: "Couldn't sign you in. Check your connection and try again." };
  try {
    const res = await fetch("/api/surprise", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ category, when, origin, tried, shown }),
    });
    return await res.json();
  } catch {
    return { notice: "Couldn't reach Feta. Check your connection and try again." };
  }
}

// A place on Been changed (rated, noted, removed): the founder's loved
// places join Feta Picks; the server ignores it for anyone else.
export async function syncFetaPicks() {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (token) await fetch("/api/feta-picks", { method: "PUT", headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
}

export async function fetchFetaPicks(origin: Origin, when: When): Promise<PicksReply> {
  const key = `${origin.city.id}|${origin.lat.toFixed(2)},${origin.lng.toFixed(2)}|${when}`;
  const hit = fetaKept.get(key);
  if (hit && Date.now() - hit.at < 3600 * 1000) return hit.reply;
  await saving;
  await currentUserId();
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { picks: [], notice: "Couldn't sign you in. Check your connection and try again." };
  try {
    const res = await fetch("/api/feta-picks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cityId: origin.city.id, lat: origin.lat, lng: origin.lng, when }),
    });
    const reply = (await res.json()) as PicksReply;
    if (res.ok) fetaKept.set(key, { at: Date.now(), reply });
    return reply;
  } catch {
    return { picks: [], notice: "No connection just now. Try again in a moment." };
  }
}

// Whether the founder has places in this city, so the star's arrival on
// Home only says "Feta Picks in <city>" when there are some. Read from
// Feta's own list: no Google call, free. Asked each time Home shows, so
// kept in memory while the app is open.
const hasPicks = new Map<string, Promise<boolean>>();

export function hasFetaPicks(cityId: string): Promise<boolean> {
  if (!hasPicks.has(cityId)) {
    hasPicks.set(
      cityId,
      (async () => {
        await currentUserId(); // the list is readable once signed in
        const { count } = await supabase().from("founder_places").select("place_id", { count: "exact", head: true }).eq("city_id", cityId).eq("active", true).eq("source", "founder");
        return (count ?? 0) > 0;
      })(),
    );
  }
  return hasPicks.get(cityId)!;
}
