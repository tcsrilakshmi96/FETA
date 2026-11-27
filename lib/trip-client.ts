"use client";

import type { Itinerary } from "@/lib/server/itinerary";
import type { Stay, Trip, TripTransport } from "@/lib/server/trip";
import { currentUserId, supabase } from "@/lib/supabase";

export type { Stay, Trip, TripTransport };

// A trip from the planner (the person's own row; Feta's words and place IDs).
export async function loadTrip(id: string): Promise<Trip | null> {
  await currentUserId();
  const { data } = await supabase().from("trips").select("*").eq("id", id).maybeSingle<Trip>();
  return data ?? null;
}

export async function loadTrips(): Promise<{ id: string; title: string }[]> {
  await currentUserId();
  const { data } = await supabase().from("trips").select("id, title").order("updated_at", { ascending: false }).limit(10);
  return data ?? [];
}

export async function tripAction<T>(body: object): Promise<(T & { error?: string }) | null> {
  await currentUserId();
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  try {
    const res = await fetch("/api/trip", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T & { error?: string };
  } catch {
    return null;
  }
}

export type DaysReply = { itinerary: Itinerary | null; notice?: string };

