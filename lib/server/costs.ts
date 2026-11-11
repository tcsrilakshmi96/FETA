import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";

// Every paid call is counted while a request runs and written to api_costs
// at the end, one row per kind, with Google's standard list price (US
// dollars per call, before the free monthly allowance; India pricing is
// lower). Estimates, so the Monday report and the daily budget can see
// spend before the real bill arrives.
export const PRICE_USD = {
  places_nearby: 0.035, // Nearby Search Enterprise
  places_nearby_atmos: 0.04, // … + Atmosphere (vegetarian check)
  places_text: 0.035, // Text Search Enterprise
  places_text_atmos: 0.04,
  places_text_pro: 0.032, // Text Search Pro (event venues, trip destinations)
  places_details: 0.02, // Place Details Enterprise (live re-check)
  places_details_atmos: 0.025,
  places_details_pro: 0.017,
  places_details_essentials: 0.005, // a typed area's location
  places_autocomplete: 0.00283, // free when the session ends in a details call
  places_photo: 0.007,
  gemini_rank: 0.001, // ranking and reasons (tokens, roughly)
  gemini_maps: 0.025, // Grounding with Google Maps (What to order)
  gemini_search: 0.035, // Grounding with Google Search, about 2 queries (events)
} as const;
export type Sku = keyof typeof PRICE_USD;

const INR_PER_USD = Number(process.env.USD_INR ?? 88);

const calls = new AsyncLocalStorage<Map<Sku, number>>();

export function track(sku: Sku, units = 1) {
  const m = calls.getStore();
  if (m) m.set(sku, (m.get(sku) ?? 0) + units);
}

// Runs a route's work and logs what it spent, as the signed-in person.
export async function withCosts<T>(db: SupabaseClient | null, route: string, work: () => Promise<T>): Promise<T> {
  const m = new Map<Sku, number>();
  try {
    return await calls.run(m, work);
  } finally {
    if (db && m.size) {
      const rows = [...m].map(([sku, units]) => ({
        route,
        sku,
        units,
        est_inr: Math.round(units * PRICE_USD[sku] * INR_PER_USD * 100) / 100,
      }));
      const { error } = await db.from("api_costs").insert(rows);
      if (error) console.error("cost log", error.message);
    }
  }
}

// Estimated spend today (India time) across everyone, for the daily cap.
export async function spentToday(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc("spend_today_inr");
  return error ? 0 : Number(data ?? 0);
}

export const DAILY_BUDGET_INR = Number(process.env.DAILY_BUDGET_INR ?? 170);
