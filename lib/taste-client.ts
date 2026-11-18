"use client";

import { loadCity } from "@/lib/cities";
import { currencyForTimeZone } from "@/lib/currency";
import { saveAnswersToDb, saveProfileLinesToDb } from "@/lib/db";
import { saveAnswers, type Answers } from "@/lib/onboarding";
import { forgetPicks } from "@/lib/picks-store";
import { pickedUpLines, saveProfileLines, type ProfileLine, type Swipe } from "@/lib/swipes";
import { currentUserId, supabase } from "@/lib/supabase";

// One way to change what Feta knows (founder, 18 Nov 2026: one path): You,
// and a skip that says "too pricey" or "too far", both save the answers,
// rewrite the plain lines that follow from them (marking ones that no
// longer apply as removed; their own words are never touched) and drop
// kept picks so the next set uses it. True if it all saved.
const OWN_KEYS = ["food_other", "loves_other"];

export async function saveTaste(answers: Answers, swipes: Swipe[]): Promise<boolean> {
  saveAnswers(answers);
  const city = loadCity();
  const currency = city?.currency ?? currencyForTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const fresh = pickedUpLines(answers, swipes, currency, city?.country);
  saveProfileLines(fresh);
  const { data: lines } = (await currentUserId())
    ? await supabase().from("profile_lines").select("line_key, text, source").is("removed_at", null).in("source", ["answers", "swipes"])
    : { data: [] };
  const gone: ProfileLine[] = (lines ?? [])
    .filter((l) => !OWN_KEYS.includes(l.line_key) && !fresh.some((f) => f.id === l.line_key))
    .map((l) => ({ id: l.line_key, text: l.text, source: l.source }));
  const [a, l] = await Promise.all([saveAnswersToDb(answers), saveProfileLinesToDb(fresh, gone)]);
  forgetPicks();
  return a !== false && l !== false;
}

// What a skip taught Feta, as a line in You ("Not into brewpubs"), keyed so
// the search can act on it (notinto:<Google type>). Returns the line's id for Undo.
export async function learnFromSkip(key: string, text: string): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase()
    .from("profile_lines")
    .upsert({ user_id: userId, line_key: key, text, source: "skips", removed_at: null }, { onConflict: "user_id,line_key" })
    .select("id")
    .single();
  if (error) console.error("Saving what a skip taught failed", error.message);
  forgetPicks();
  return data?.id ?? null;
}

// "south_indian_restaurant" → "South Indian restaurants"; null for types too
// broad to say no to ("restaurant", "bar").
const BROAD = ["restaurant", "bar", "cafe", "food", "point_of_interest", "establishment", "tourist_attraction", "store", "meal_takeaway"];
const CAPS = ["indian", "south", "north", "italian", "thai", "japanese", "korean", "chinese", "mexican", "middle", "eastern", "american", "french", "greek", "lebanese", "mediterranean", "asian", "vietnamese", "spanish", "turkish"];
export function kindOfPlace(type: string | undefined): string | null {
  if (!type || BROAD.includes(type)) return null;
  const words = type.split("_").map((w) => (CAPS.includes(w) ? w[0].toUpperCase() + w.slice(1) : w));
  const last = words.pop()!;
  const plural = /[^aeiou]y$/.test(last) ? `${last.slice(0, -1)}ies` : /(s|sh|ch|x)$/.test(last) ? `${last}es` : `${last}s`;
  return [...words, plural].join(" ");
}
