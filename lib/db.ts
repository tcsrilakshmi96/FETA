"use client";

import { loadCity, saveCity, type City } from "@/lib/cities";
import { saveAnswers, type Answers } from "@/lib/onboarding";
import { currentUserId, supabase } from "@/lib/supabase";
import { saveProfileLines, saveSwipes, type ProfileLine, type Swipe } from "@/lib/swipes";

// Someone who has done the setup on this phone goes straight to their picks.
export function setUpOnThisPhone() {
  try {
    return !!loadCity() && localStorage.getItem("feta.profileLines") !== null;
  } catch {
    return false;
  }
}

// A returning person on a new phone (or after signing in with Google):
// their city, answers, taste cards and lines come back from their account,
// so they don't answer everything again. False if they never finished setup.
export async function restoreFromAccount(): Promise<boolean> {
  const userId = await currentUserId();
  if (!userId) return false;
  const db = supabase();
  const [{ data: profile }, { data: a }, { data: swipes }, { data: lines }] = await Promise.all([
    db.from("profiles").select("city_id").eq("id", userId).maybeSingle(),
    db.from("answers").select("*").maybeSingle(),
    db.from("swipes").select("card_id, verdict"),
    db.from("profile_lines").select("line_key, text, source").is("removed_at", null).in("source", ["answers", "swipes"]),
  ]);
  if (!profile?.city_id || !a?.diet) return false;
  const city = await fetch(`/api/cities?id=${encodeURIComponent(profile.city_id)}`)
    .then((r) => r.json() as Promise<{ city: City | null }>)
    .then((r) => r.city)
    .catch(() => null);
  if (!city) return false;
  saveCity(city);
  saveAnswers({ diet: a.diet, halal: a.halal, distance: a.distance, spend: a.spend, spendCurrency: a.spend_currency, who: a.who ?? [], drinks: a.drinks, interests: a.interests ?? [] } as Answers);
  saveSwipes((swipes ?? []).map((s) => ({ cardId: s.card_id, verdict: s.verdict })) as Swipe[]);
  saveProfileLines((lines ?? []).map((l) => ({ id: l.line_key, text: l.text, source: l.source })) as ProfileLine[]);
  return true;
}

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

// Tapping "Use my location" turns the location consent on (and logs it).
export function saveLocationConsent(granted: boolean) {
  return run("location consent", async (userId) => {
    const { error } = await supabase()
      .from("profiles")
      .update({ consent_location: granted, updated_at: new Date().toISOString() })
      .eq("id", userId);
    return error ? { error } : logConsent(userId, "location", granted);
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

// Save (Want to try), skip (with an optional reason) or "Been there".
// Only the Google place ID is stored.
export function savePickAction(
  placeId: string,
  action: "saved" | "skipped" | "been",
  extra: { reason?: string; because?: string; category: string; cityId: string },
) {
  return run("pick action", async (userId) => {
    const row = {
      user_id: userId,
      place_id: placeId,
      action,
      reason: extra.reason ?? null,
      category: extra.category,
      city_id: extra.cityId,
    };
    const upsert = (r: object) => supabase().from("pick_actions").upsert(r, { onConflict: "user_id,place_id,action" });
    const result = await upsert(extra.because ? { ...row, because: extra.because } : row);
    // Before the "because" column exists, save without it.
    return result.error?.message.includes("because") ? upsert(row) : result;
  });
}

// ---------- Lists ----------

export function saveListNote(placeId: string, action: "saved" | "been", note: string) {
  return run("note", (userId) =>
    supabase().from("pick_actions").update({ note: note.trim() || null }).eq("user_id", userId).eq("place_id", placeId).eq("action", action),
  );
}

// "I've been": moves a place from Want to try to Been, keeping its note.
export function markBeen(placeId: string, note: string) {
  return run("been", (userId) =>
    supabase()
      .from("pick_actions")
      .upsert({ user_id: userId, place_id: placeId, action: "been", note: note.trim() || null }, { onConflict: "user_id,place_id,action" }),
  );
}

export function removeFromList(placeId: string, action: "saved" | "been") {
  return run("remove", (userId) =>
    supabase().from("pick_actions").delete().eq("user_id", userId).eq("place_id", placeId).eq("action", action),
  );
}

// Optional WhatsApp number, only for the weekend plan. null removes it.
export function saveWhatsApp(number: string | null) {
  return run("WhatsApp number", async (userId) => {
    const { error } = await supabase()
      .from("profiles")
      .update({ whatsapp_number: number, updated_at: new Date().toISOString() })
      .eq("id", userId);
    return error ? { error } : logConsent(userId, "whatsapp", number !== null);
  });
}

export async function loadWhatsApp(): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data } = await supabase().from("profiles").select("whatsapp_number").eq("id", userId).maybeSingle();
  return data?.whatsapp_number ?? null;
}

// Tweaks teach Feta: "Somewhere quieter" becomes "Likes quieter places" in
// the profile (removable in You).
const TWEAK_LINES: Record<string, string> = {
  quieter: "Likes quieter places",
  cheaper: "Keeping spend down lately",
  closer: "Prefers places close by",
  outdoors: "Likes being outdoors",
  open_later: "Often out late",
  groups: "Often out in a group",
  kids: "Often out with kids",
};

export function saveTweakLines(tweaks: string[]) {
  const rows = tweaks.filter((t) => TWEAK_LINES[t]);
  if (rows.length === 0) return Promise.resolve();
  return run("tweak lines", (userId) =>
    supabase()
      .from("profile_lines")
      .upsert(
        rows.map((t) => ({ user_id: userId, line_key: `tweak:${t}`, text: TWEAK_LINES[t], source: "tweaks", removed_at: null })),
        { onConflict: "user_id,line_key" },
      ),
  );
}
