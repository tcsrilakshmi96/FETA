"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// One browser client for the whole app. The session lives on this phone.
let client: SupabaseClient | null = null;

export function supabase() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      // PKCE: Google sign-in returns a one-time code that only this phone can use.
      { auth: { flowType: "pkce" } },
    );
  }
  return client;
}

// AI QA runs open Feta with ?qa=1 (founder, 18 Nov 2026): this browser is
// remembered as a test, and its account is marked so admin numbers leave it out.
const QA_KEY = "feta.qa";
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("qa") === "1") {
  try {
    localStorage.setItem(QA_KEY, "1");
  } catch {
    // Marked for this visit only.
  }
}

function isQa() {
  try {
    return localStorage.getItem(QA_KEY) === "1" || new URLSearchParams(window.location.search).get("qa") === "1";
  } catch {
    return false;
  }
}

async function markTest(userId: string) {
  const { error } = await supabase().from("profiles").update({ is_test: true }).eq("id", userId);
  if (error) console.error("Marking test visitor failed", error.message);
}

// Every visitor gets a private anonymous account the first time they need
// one, so answers are saved even before (or without) Google sign-in.
let pending: Promise<string | null> | null = null;

export function currentUserId(): Promise<string | null> {
  if (!pending) {
    pending = (async () => {
      const { data } = await supabase().auth.getSession();
      const existing = data.session?.user.id;
      if (existing) {
        if (isQa()) await markTest(existing);
        return existing;
      }
      const { data: anon, error } = await supabase().auth.signInAnonymously();
      if (error) {
        console.error("Anonymous sign-in failed", error.message);
        pending = null;
        return null;
      }
      const id = anon.user?.id ?? null;
      if (id && isQa()) await markTest(id);
      return id;
    })();
  }
  return pending;
}
