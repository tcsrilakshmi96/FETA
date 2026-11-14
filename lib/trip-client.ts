"use client";

import { formatMoney } from "@/lib/currency";
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

// Hotel budgets per night, in their currency: converted from US dollars at a
// rough rate (a hotel abroad costs what it costs, unlike dinner at home).
const PER_USD: Record<string, number> = {
  INR: 84, EUR: 0.92, GBP: 0.79, AED: 3.67, SGD: 1.35, HKD: 7.8, THB: 36, AUD: 1.5, CAD: 1.37, CHF: 0.88, JPY: 150, KRW: 1350, CZK: 23, NZD: 1.65, USD: 1,
};
const USD_BANDS = [80, 180, 350];

function round(n: number) {
  const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

export function hotelBudgets(currency: string): { id: string; label: string }[] {
  const rate = PER_USD[currency] ?? 1;
  const cur = PER_USD[currency] ? currency : "USD";
  const money = (n: number) => formatMoney(round(n * rate), cur);
  return [
    { id: "1", label: `Under ${money(USD_BANDS[0])}` },
    { id: "2", label: `${money(USD_BANDS[0])}–${money(USD_BANDS[1]).replace(/^[^\d]+/, "")}` },
    { id: "3", label: `${money(USD_BANDS[1])}–${money(USD_BANDS[2]).replace(/^[^\d]+/, "")}` },
    { id: "4", label: `${money(USD_BANDS[2])}+` },
  ];
}
