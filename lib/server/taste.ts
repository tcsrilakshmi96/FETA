import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_ANSWERS, withSpendRange, type Answers } from "@/lib/onboarding";
import { scopeCounts } from "@/lib/profile-scope";
import type { Category, Taste } from "@/lib/server/picks";

// A database client that acts as the signed-in user, so row-level
// security applies to every query.
export function userDb(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function userIdFor(db: SupabaseClient, token: string) {
  const { data } = await db.auth.getUser(token);
  return data.user?.id ?? null;
}

// What Feta knows about the user: answers, swipes and profile lines.
// Trip-only lines are included only for that trip.
export async function loadTaste(db: SupabaseClient, trip?: string | null): Promise<Taste> {
  const [answersRes, linesRes, swipesRes, actionsRes, beenRes] = await Promise.all([
    db.from("answers").select("*").maybeSingle(),
    db.from("profile_lines").select("text, trip, source, line_key, removed_at"),
    db.from("swipes").select("card_id, verdict"),
    db.from("pick_actions").select("action, reason, because").order("created_at", { ascending: false }).limit(20),
    // Places they've been, how it was and in their own words (My places and check-in).
    db.from("pick_actions").select("place_id, verdict, visits, note, category").eq("action", "been").not("verdict", "is", null).order("created_at", { ascending: false }).limit(40),
  ]);
  const been = beenRes.error ? [] : (beenRes.data ?? []);
  // The "because" column arrives with a later migration; without it this
  // query fails and Feta simply goes without these hints.
  const actions = actionsRes.error ? [] : (actionsRes.data ?? []);
  const a = answersRes.data;
  const answers: Answers = a
    ? withSpendRange({
        diet: a.diet,
        halal: a.halal,
        distance: a.distance,
        spend: a.spend,
        spendCurrency: a.spend_currency,
        who: a.who ?? [],
        drinks: a.drinks,
        interests: a.interests ?? [],
        avoid: a.avoid ?? [],
      })
    : EMPTY_ANSWERS;
  const swipes = swipesRes.data ?? [];
  // Removed lines are read too, only so what they took out of "Learned
  // from places you love" is never searched for again.
  const all = linesRes.data ?? [];
  const live = all.filter((l) => !l.removed_at);
  // Lines about the people they go out with ("parents are Jain") reach only
  // Ask Feta's brief, which uses them when those people come along; they
  // never shape everyday picks (Round 6: they reached Lisbon picks).
  const lines = live.filter((l) => scopeCounts(l.trip, trip) && l.source !== "loved" && !String(l.line_key ?? "").startsWith("people:"));
  // Their own words: typed at setup ("Something else", "Anything else"),
  // added in You, or learned in chat. Lines about the people they go out
  // with only count when those people come along (chat says so).
  const own = lines.filter((l) => (["food_other", "loves_other"].includes(l.line_key) || ["you", "chat"].includes(l.source)));
  return {
    answers,
    lines: lines.map((l) => l.text),
    lineKeys: lines.map((l) => String(l.line_key ?? "")),
    own: own.map((l) => l.text).slice(0, 12),
    yes: swipes.filter((s) => s.verdict === "yes").map((s) => s.card_id),
    no: swipes.filter((s) => s.verdict === "no").map((s) => s.card_id),
    saved: actions.filter((a) => a.action === "saved" && a.because).slice(0, 5).map((a) => a.because as string),
    skipped: actions.filter((a) => a.action === "skipped" && a.reason).slice(0, 8).map((a) => a.reason as string),
    notInto: live.filter((l) => String(l.line_key ?? "").startsWith("notinto:")).map((l) => String(l.line_key).slice(8)),
    unlearned: all.filter((l) => l.removed_at && String(l.line_key ?? "").startsWith("loved:")).map((l) => String(l.line_key)),
    places: {
      loved: been.filter((b) => b.verdict === "loved").length,
      regulars: been.filter((b) => b.visits === "regular" && b.verdict !== "not_for_me").length,
      notForThem: been.filter((b) => b.verdict === "not_for_me").length,
      lovedNotes: been.filter((b) => b.verdict === "loved" && b.note).slice(0, 6).map((b) => b.note as string),
      dislikedNotes: been.filter((b) => b.verdict === "not_for_me" && b.note).slice(0, 4).map((b) => b.note as string),
    },
    loved: been.filter((b) => b.verdict === "loved").slice(0, 30).map((b) => ({ id: b.place_id as string, category: (b.category as string | null) ?? null })),
  };
}

// A short hash of everything that shapes one category's search, so a set is
// searched again only when its own side changed (tester, 23 Nov 2026: a new
// cuisine in You used a search for Things to do too). Cuisines, diet and
// food words are food's; interests and to-do words are things to do's;
// budget, distance, drinks, who and everything else count for both.
const FOOD_KEYS = /^(cuisines|diet|avoid|food_other|you:food:|loved:food:)/;
const DO_KEYS = /^(interests|loves_other|you:do:|loved:do:)/;

export function tasteFingerprint(t: Taste, category: Category) {
  const a = t.answers;
  const food = category === "food_drinks";
  const other = food ? DO_KEYS : FOOD_KEYS;
  const keys = t.lineKeys ?? [];
  const lines = t.lines.filter((_, i) => !other.test(keys[i] ?? ""));
  const text = JSON.stringify([
    food ? [a.diet, a.halal, a.avoid] : a.interests,
    a.spend,
    a.distance,
    a.drinks,
    a.who,
    t.yes.filter((y) => food || !y.startsWith("cuisine_")).sort(),
    (t.loved ?? []).filter((l) => !l.category || l.category === category).map((l) => l.id),
    lines.sort(),
    t.notInto ?? [],
    (t.unlearned ?? []).filter((k) => !other.test(k)).sort(),
  ]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
