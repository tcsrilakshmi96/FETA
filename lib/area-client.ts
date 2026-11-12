"use client";

import type { City } from "@/lib/cities";
import { currentUserId, supabase } from "@/lib/supabase";

export type AreaSuggestion = { placeId: string; name: string; detail: string; types?: string[] };

async function call<T>(body: object): Promise<T | null> {
  await currentUserId();
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  try {
    const res = await fetch("/api/area", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// One "session" per typing run keeps Google's suggestions free when one is chosen.
export function newAreaSession() {
  return crypto.randomUUID();
}

export async function suggestAreas(input: string, city: City, session: string): Promise<AreaSuggestion[]> {
  const r = await call<{ suggestions: AreaSuggestion[] }>({ input, lat: city.lat, lng: city.lng, country: city.country, session });
  return r?.suggestions ?? [];
}

export async function locateArea(placeId: string, session: string) {
  const r = await call<{ location: { lat: number; lng: number } }>({ placeId, session });
  return r?.location ?? null;
}
