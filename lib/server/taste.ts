import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_ANSWERS, type Answers } from "@/lib/onboarding";
import type { Taste } from "@/lib/server/picks";

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
  const [answersRes, linesRes, swipesRes] = await Promise.all([
    db.from("answers").select("*").maybeSingle(),
    db.from("profile_lines").select("text, trip").is("removed_at", null),
    db.from("swipes").select("card_id, verdict"),
  ]);
  const a = answersRes.data;
  const answers: Answers = a
    ? {
        diet: a.diet,
        halal: a.halal,
        distance: a.distance,
        spend: a.spend,
        spendCurrency: a.spend_currency,
        who: a.who ?? [],
        drinks: a.drinks,
        interests: a.interests ?? [],
      }
    : EMPTY_ANSWERS;
  const swipes = swipesRes.data ?? [];
  return {
    answers,
    lines: (linesRes.data ?? []).filter((l) => !l.trip || (trip && l.trip === trip)).map((l) => l.text),
    yes: swipes.filter((s) => s.verdict === "yes").map((s) => s.card_id),
    no: swipes.filter((s) => s.verdict === "no").map((s) => s.card_id),
  };
}
