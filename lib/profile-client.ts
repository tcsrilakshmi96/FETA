"use client";

import { currentUserId, supabase } from "@/lib/supabase";

// The You screen: plain profile lines, privacy choices and the account.

export type Line = { id: string; text: string; source: string; trip: string | null };

export type Profile = {
  lines: Line[];
  consent: { location: boolean; publicReviews: boolean };
  email: string | null; // null while not signed in with Google
};

export async function loadProfile(): Promise<Profile | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const db = supabase();
  const [{ data: lines }, { data: profile }, { data: auth }] = await Promise.all([
    db.from("profile_lines").select("id, text, source, trip").is("removed_at", null).order("created_at"),
    db.from("profiles").select("consent_location, consent_public_reviews").eq("id", userId).maybeSingle(),
    db.auth.getUser(),
  ]);
  return {
    lines: (lines ?? []) as Line[],
    consent: { location: !!profile?.consent_location, publicReviews: !!profile?.consent_public_reviews },
    email: auth.user && !auth.user.is_anonymous ? (auth.user.email ?? null) : null,
  };
}

// Removing a line stops picks using it (it is kept, marked removed).
export async function removeLine(id: string) {
  const { error } = await supabase().from("profile_lines").update({ removed_at: new Date().toISOString() }).eq("id", id);
  if (error) console.error("Removing line failed", error.message);
}

// "Use these every day instead": trip-only lines become everyday lines.
export async function makeEveryday(trip: string) {
  const { error } = await supabase().from("profile_lines").update({ trip: null }).eq("trip", trip).is("removed_at", null);
  if (error) console.error("Moving trip lines failed", error.message);
}

export async function setConsent(kind: "location" | "public_reviews", granted: boolean) {
  const userId = await currentUserId();
  if (!userId) return;
  const column = kind === "location" ? "consent_location" : "consent_public_reviews";
  const db = supabase();
  const { error } = await db.from("profiles").update({ [column]: granted, updated_at: new Date().toISOString() }).eq("id", userId);
  if (!error) await db.from("consent_log").insert({ user_id: userId, kind, granted });
  else console.error("Saving consent failed", error.message);
}

// One tap: deletes the account and every row tied to it, then clears this
// phone. Returns false if the delete did not go through.
export async function deleteMyData(): Promise<boolean> {
  const { error } = await supabase().rpc("delete_my_data");
  if (error) {
    console.error("Delete failed", error.message);
    return false;
  }
  await supabase().auth.signOut({ scope: "local" });
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // Nothing more to clear.
  }
  return true;
}

// Appearance: Auto follows the phone; Light or Dark is remembered here.
export type Appearance = "auto" | "light" | "dark";
const THEME_KEY = "feta.theme";

export function loadAppearance(): Appearance {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setAppearance(a: Appearance) {
  try {
    if (a === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, a);
  } catch {
    // Still applies for this visit.
  }
  if (a === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", a);
}
