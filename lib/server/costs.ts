import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { headers } from "next/headers";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { limitNotice, type LimitWhat } from "@/lib/limits";

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
  places_text_ids: 0, // Text Search Essentials (IDs only): free
  places_autocomplete: 0.00283, // free when the session ends in a details call
  places_photo: 0.007,
  gemini_rank: 0.001, // ranking and reasons (tokens, roughly)
  gemini_maps: 0.025, // Grounding with Google Maps (What to order)
  gemini_search: 0.035, // Grounding with Google Search, about 2 queries (events)
  gemini_vision: 0.004, // reading up to 8 inspiration photos into styles (tokens, roughly)
  gemini_image: 0.045, // one drawing of a person in a style (Gemini image model)
  venice_chat: 0.006, // one Ask Feta reply (Venice, tokens, roughly)
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
      const write = async () => {
        const { error } = await db.from("api_costs").insert(rows);
        if (error) console.error("cost log", error.message);
      };
      // Written after the reply, so no one waits for it (every photo and
      // search did); outside a request, straight away.
      try {
        after(write);
      } catch {
        await write();
      }
    }
  }
}

export const DAILY_BUDGET_INR = Number(process.env.DAILY_BUDGET_INR ?? 1500);
// What one person can spend in a day, so no one uses up everyone's (audit,
// 20 Nov 2026). Admins don't count.
export const USER_BUDGET_INR = Number(process.env.USER_DAILY_BUDGET_INR ?? 250);
// Test accounts (?qa=1) have their own pool and never use real people's
// (founder, 21 Nov 2026: ₹300 each, ₹2,700 for all of them together).
export const TEST_BUDGET_INR = Number(process.env.TEST_DAILY_BUDGET_INR ?? 2700);
export const TEST_USER_BUDGET_INR = Number(process.env.TEST_USER_DAILY_BUDGET_INR ?? 300);
// New searches for picks a day: everyone's (real people, or test accounts
// together) and one person's.
const DAILY_LIMIT = Number(process.env.PICKS_DAILY_LIMIT ?? 600);
const USER_DAILY_LIMIT = Number(process.env.PICKS_USER_DAILY_LIMIT ?? 60);
// Roughly what one new set of picks costs, to turn money left into searches left.
const SET_INR = 15;

// How many new searches this person has left today (India time), from
// whichever runs out first: their searches, their spend, or their pool's
// (real people's, or test accounts'). If it can't be read, paid work stops
// rather than running with no limit.
export async function budgetToday(db: SupabaseClient): Promise<{ over: boolean; left: number }> {
  const { data, error } = await db.rpc("budget_today");
  if (error || !data) {
    console.error("budget check", error?.message);
    return { over: true, left: 0 };
  }
  const b = data as { is_test: boolean; pool: number; mine: number; searches: number; searches_mine: number };
  const [pool, mine] = b.is_test ? [TEST_BUDGET_INR, TEST_USER_BUDGET_INR] : [DAILY_BUDGET_INR, USER_BUDGET_INR];
  const left = Math.max(
    0,
    Math.min(USER_DAILY_LIMIT - b.searches_mine, DAILY_LIMIT - b.searches, Math.floor((mine - Number(b.mine)) / SET_INR), Math.floor((pool - Number(b.pool)) / SET_INR)),
  );
  return { over: Number(b.pool) >= pool || Number(b.mine) >= mine, left };
}

export async function overBudget(db: SupabaseClient): Promise<boolean> {
  return (await budgetToday(db)).over;
}

// The person's time zone, from where Vercel sees the request come from
// (none when running locally: India time).
export async function requestTimeZone(): Promise<string | undefined> {
  return (await headers()).get("x-vercel-ip-timezone") ?? undefined;
}

// What a screen says when today's limit is reached, in their own time.
export async function limitNoticeHere(what: LimitWhat): Promise<string> {
  return limitNotice(what, await requestTimeZone());
}

// Building the style brand library (Feta's research, brand lookups) has its
// own daily cap and doesn't count toward the one above (founder, 20 Nov 2026).
export const LIBRARY_BUDGET_INR = Number(process.env.LIBRARY_BUDGET_INR ?? 1500);

export async function librarySpentToday(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc("library_spend_today_inr");
  return error ? 0 : Number(data ?? 0);
}
