"use client";

import { currentUserId, supabase } from "@/lib/supabase";

// The You screen: plain profile lines, privacy choices and the account.

export type Line = { id: string; text: string; source: string; trip: string | null; key: string };

// Who a line is about: "people:partner:…" lines come from chat or You.
export const PEOPLE = [
  { id: "partner", label: "Partner" },
  { id: "family", label: "Family" },
  { id: "friends", label: "Friends" },
  { id: "kids", label: "Kids" },
] as const;
export type Person = (typeof PEOPLE)[number]["id"];

export function aboutOf(line: Line): Person | null {
  const who = line.key.startsWith("people:") ? line.key.split(":")[1] : null;
  return PEOPLE.some((p) => p.id === who) ? (who as Person) : null;
}

export type Profile = {
  lines: Line[];
  consent: { location: boolean; publicReviews: boolean };
  places: { want: number; been: number };
  whatsapp: string | null;
  email: string | null; // null while not signed in with Google
};

// The last profile loaded, so You opens instantly when you come back to it
// (it refreshes straight after).
let lastProfile: Profile | null = null;
export const cachedProfile = () => lastProfile;

export async function loadProfile(): Promise<Profile | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const db = supabase();
  // The session is read on the phone, not asked of the server.
  const [{ data: lines }, { data: profile }, { data: auth }, { data: actions }] = await Promise.all([
    db.from("profile_lines").select("id, text, source, trip, line_key").is("removed_at", null).order("created_at"),
    db.from("profiles").select("consent_location, consent_public_reviews, whatsapp_number").eq("id", userId).maybeSingle(),
    db.auth.getSession().then(({ data }) => ({ data: { user: data.session?.user ?? null } })),
    db.from("pick_actions").select("place_id, action").in("action", ["saved", "been"]),
  ]);
  const been = new Set((actions ?? []).filter((a) => a.action === "been").map((a) => a.place_id));
  lastProfile = {
    lines: (lines ?? []).map(({ line_key, ...l }) => ({ ...l, key: line_key })) as Line[],
    consent: { location: !!profile?.consent_location, publicReviews: !!profile?.consent_public_reviews },
    places: {
      want: (actions ?? []).filter((a) => a.action === "saved" && !been.has(a.place_id)).length,
      been: been.size,
    },
    whatsapp: profile?.whatsapp_number ?? null,
    email: auth.user && !auth.user.is_anonymous ? (auth.user.email ?? null) : null,
  };
  return lastProfile;
}

// Removing a line stops picks using it (it is kept, marked removed).
export async function removeLine(id: string) {
  const { error } = await supabase().from("profile_lines").update({ removed_at: new Date().toISOString() }).eq("id", id);
  if (error) console.error("Removing line failed", error.message);
}

// Editing a line: picks and chat use the new words from now on.
export async function editLine(id: string, text: string) {
  const { error } = await supabase().from("profile_lines").update({ text: text.trim().slice(0, 80) }).eq("id", id);
  if (error) console.error("Editing line failed", error.message);
}

// "Add something" on You, about them or about someone they go out with.
export async function addLine(text: string, about: Person | null): Promise<Line | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const key = `${about ? `people:${about}` : "you"}:${crypto.randomUUID()}`;
  const { data, error } = await supabase()
    .from("profile_lines")
    .insert({ user_id: userId, line_key: key, text: text.trim().slice(0, 80), source: "you" })
    .select("id, text, source, trip")
    .single();
  if (error) console.error("Adding line failed", error.message);
  return data ? ({ ...data, key } as Line) : null;
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

// Ask Feta's "ADDED TO YOUR PROFILE" card: Undo, and "Only for this trip".
export async function undoLines(ids: string[]) {
  const { error } = await supabase().from("profile_lines").update({ removed_at: new Date().toISOString() }).in("id", ids);
  if (error) console.error("Undo failed", error.message);
}

export async function setLinesTrip(ids: string[], trip: string | null) {
  const { error } = await supabase().from("profile_lines").update({ trip }).in("id", ids);
  if (error) console.error("Saving trip lines failed", error.message);
}
