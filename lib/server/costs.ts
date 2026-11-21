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

// Gemini is counted from what each reply says it used (founder, 21 Nov
// 2026: ₹2,100 of Gemini went in a day while flat guesses logged ₹480;
// thinking hard on brand research is far dearer than a guess). Google's
// list prices, US dollars per million tokens (thinking is billed as
// output), by the model the reply says served it; each web search the
// model runs is $14 per 1,000 (Gemini 3, after 5,000 free a month).
const GEMINI_USD_PER_M: Record<string, { input: number; output: number }> = {
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-3.6-flash": { input: 1.5, output: 7.5 },
};
const SEARCH_USD = 0.014;

type Tally = { units: number; usd: number };
type Store = { tally: Map<Sku, Tally>; later: Promise<unknown>[] };
const calls = new AsyncLocalStorage<Store>();

function add(sku: Sku, units: number, usd: number) {
  const t = calls.getStore()?.tally;
  if (!t) return;
  const was = t.get(sku) ?? { units: 0, usd: 0 };
  t.set(sku, { units: was.units + units, usd: was.usd + usd });
}

export function track(sku: Sku, units = 1) {
  add(sku, units, units * PRICE_USD[sku]);
}

type Usage = { input: number; output: number; searches: number; model?: string };

// generateContent replies: usageMetadata and the searches in groundingMetadata.
function usageOfContent(data: Record<string, unknown>): Usage | null {
  const u = data.usageMetadata as Record<string, number> | undefined;
  if (!u) return null;
  const cand = (data.candidates as { groundingMetadata?: { webSearchQueries?: string[] } }[] | undefined)?.[0];
  return {
    input: (u.promptTokenCount ?? 0) + (u.toolUsePromptTokenCount ?? 0),
    output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    searches: cand?.groundingMetadata?.webSearchQueries?.length ?? 0,
    model: data.modelVersion as string | undefined,
  };
}

// Interactions replies: usage, and a step per search.
function usageOfInteraction(data: Record<string, unknown>): Usage | null {
  const u = data.usage as Record<string, number> | undefined;
  if (!u) return null;
  const steps = (data.steps as { type?: string; arguments?: { queries?: unknown[] } }[] | undefined) ?? [];
  return {
    input: (u.total_input_tokens ?? 0) + (u.total_tool_use_tokens ?? 0),
    output: (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0),
    searches: steps.filter((st) => st.type === "google_search_call").reduce((n, st) => n + (st.arguments?.queries?.length || 1), 0),
    model: data.model as string | undefined,
  };
}

// One Gemini reply, at what it really used; a reply without usage (or a
// model with no known price) falls back to the flat guess for its kind.
export function trackGemini(sku: Sku, data: unknown) {
  const d = (data ?? {}) as Record<string, unknown>;
  const u = usageOfContent(d) ?? usageOfInteraction(d);
  const rate = u && GEMINI_USD_PER_M[(u.model ?? "gemini-3.5-flash").replace(/^models\//, "").replace(/-preview.*$/, "")];
  if (!u || !rate) return track(sku);
  add(sku, 1, (u.input * rate.input + u.output * rate.output) / 1e6 + u.searches * SEARCH_USD);
}

// Work that keeps going after the reply (a slow events search, the day's
// "Featured in" search) is counted with the request that started it: its
// costs are written once it has finished too. Before 21 Nov 2026 they were
// never written.
export function later(work: Promise<unknown> | (() => Promise<unknown>)) {
  const p = (typeof work === "function" ? work() : work).catch((error) => console.error(error));
  calls.getStore()?.later.push(p);
  after(() => p);
}

// Runs a route's work and logs what it spent, as the signed-in person.
export async function withCosts<T>(db: SupabaseClient | null, route: string, work: () => Promise<T>): Promise<T> {
  const store: Store = { tally: new Map(), later: [] };
  try {
    return await calls.run(store, work);
  } finally {
    const write = async () => {
      await Promise.allSettled(store.later);
      if (!db || !store.tally.size) return;
      const rows = [...store.tally].map(([sku, t]) => ({ route, sku, units: t.units, est_inr: Math.round(t.usd * INR_PER_USD * 100) / 100 }));
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

export const DAILY_BUDGET_INR = Number(process.env.DAILY_BUDGET_INR ?? 1500);
// What one person can spend in a day, so no one uses up everyone's (audit,
// 20 Nov 2026; raised to about 10 fresh lists for the testing phase, founder
// 21 Nov 2026). Admins don't count.
export const USER_BUDGET_INR = Number(process.env.USER_DAILY_BUDGET_INR ?? 1000);
// Test accounts (?qa=1) have their own pool and never use real people's
// (founder, 21 Nov 2026; raised the same day for the testing phase, when a
// tester was stopped after two lists).
export const TEST_BUDGET_INR = Number(process.env.TEST_DAILY_BUDGET_INR ?? 5000);
export const TEST_USER_BUDGET_INR = Number(process.env.TEST_USER_DAILY_BUDGET_INR ?? 1000);
// New searches for picks a day: everyone's (real people, or test accounts
// together) and one person's.
const DAILY_LIMIT = Number(process.env.PICKS_DAILY_LIMIT ?? 600);
const USER_DAILY_LIMIT = Number(process.env.PICKS_USER_DAILY_LIMIT ?? 60);
// What one new set of picks costs, to turn money left into searches left:
// their own average today, else about ₹100 (21 Nov 2026: live checks of
// curated places, event venues and photos; ₹15 was a guess and the count
// ran out without warning).
const SET_INR = 100;

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
  const perSet = b.searches_mine > 0 && Number(b.mine) > 0 ? Math.max(20, Number(b.mine) / b.searches_mine) : SET_INR;
  const left = Math.max(
    0,
    Math.min(USER_DAILY_LIMIT - b.searches_mine, DAILY_LIMIT - b.searches, Math.floor((mine - Number(b.mine)) / perSet), Math.floor((pool - Number(b.pool)) / SET_INR)),
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
