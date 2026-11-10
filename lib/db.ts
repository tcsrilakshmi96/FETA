"use client";

import type { City } from "@/lib/cities";
import type { Answers } from "@/lib/onboarding";
import { currentUserId, supabase } from "@/lib/supabase";
import type { ProfileLine, Swipe } from "@/lib/swipes";

// Saves to the database. The screens never wait on these: if a save fails
// (say, on a bad connection) the copy on the phone still lets the flow
// continue, and the error is logged.

async function run(label: string, write: (userId: string) => PromiseLike<{ error: { message: string } | null }>) {
  const userId = await currentUserId();
  if (!userId) return;
  const { error } = await write(userId);
  if (error) console.error(`Saving ${label} failed`, error.message);
}

function logConsent(userId: string, kind: string, granted: boolean) {
  return supabase().from("consent_log").insert({ user_id: userId, kind, granted });
}

export function saveAgeConfirmed() {
  return run("18+ check", async (userId) => {
    const { error } = await supabase()
      .from("profiles")
      .update({ age_confirmed_at: new Date().toISOString() })
      .eq("id", userId);
    return error ? { error } : logConsent(userId, "age_18_plus", true);
  });
}

export function saveConsent(consent: { location: boolean; publicReviews: boolean }) {
  return run("consent", async (userId) => {
    const { error } = await supabase()
      .from("profiles")
      .update({
        consent_location: consent.location,
        consent_public_reviews: consent.publicReviews,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    if (error) return { error };
    return supabase()
      .from("consent_log")
      .insert([
        { user_id: userId, kind: "location", granted: consent.location },
        { user_id: userId, kind: "public_reviews", granted: consent.publicReviews },
      ]);
  });
}

export function saveCityToDb(city: City) {
  return run("city", (userId) =>
    supabase()
      .from("profiles")
      .update({
        city_id: city.id,
        country: city.country,
        time_zone: city.timeZone,
        currency: city.currency,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId),
  );
}

export function saveCityInterest(city: City) {
  return run("city interest", (userId) =>
    supabase()
      .from("city_interest")
      .upsert({ user_id: userId, city_id: city.id }, { onConflict: "user_id,city_id", ignoreDuplicates: true }),
  );
}

export function saveAnswersToDb(answers: Answers) {
  return run("answers", (userId) =>
    supabase().from("answers").upsert({
      user_id: userId,
      diet: answers.diet,
      halal: answers.halal,
      distance: answers.distance,
      spend: answers.spend,
      spend_currency: answers.spendCurrency,
      who: answers.who,
      drinks: answers.drinks,
      interests: answers.interests,
      updated_at: new Date().toISOString(),
    }),
  );
}

export function saveSwipesToDb(swipes: Swipe[]) {
  if (swipes.length === 0) return Promise.resolve();
  return run("swipes", (userId) =>
    supabase()
      .from("swipes")
      .upsert(swipes.map((s) => ({ user_id: userId, card_id: s.cardId, verdict: s.verdict }))),
  );
}

// Keeps the lines the user left, and marks the ones they removed.
export function saveProfileLinesToDb(kept: ProfileLine[], removed: ProfileLine[]) {
  const now = new Date().toISOString();
  const rows = [
    ...kept.map((l) => ({ line_key: l.id, text: l.text, source: l.source, removed_at: null })),
    ...removed.map((l) => ({ line_key: l.id, text: l.text, source: l.source, removed_at: now })),
  ];
  if (rows.length === 0) return Promise.resolve();
  return run("profile lines", (userId) =>
    supabase()
      .from("profile_lines")
      .upsert(rows.map((r) => ({ ...r, user_id: userId })), { onConflict: "user_id,line_key" }),
  );
}
