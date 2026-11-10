"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// One browser client for the whole app. The session lives on this phone.
let client: SupabaseClient | null = null;

export function supabase() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
  }
  return client;
}

// Every visitor gets a private anonymous account the first time they need
// one, so answers are saved even before (or without) Google sign-in.
let pending: Promise<string | null> | null = null;

export function currentUserId(): Promise<string | null> {
  if (!pending) {
    pending = (async () => {
      const { data } = await supabase().auth.getSession();
      if (data.session) return data.session.user.id;
      const { data: anon, error } = await supabase().auth.signInAnonymously();
      if (error) {
        console.error("Anonymous sign-in failed", error.message);
        pending = null;
        return null;
      }
      return anon.user?.id ?? null;
    })();
  }
  return pending;
}
