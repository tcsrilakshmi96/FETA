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

// Test runs open Feta with ?qa=<tester code> (founder, 18 Nov 2026; the
// code since the audit of 23 Nov 2026, when ?qa=1 let anyone move into the
// test budget): this browser remembers the code, and the account is marked
// as a test one only if the database accepts it (mark_test), so admin
// numbers leave it out.
const QA_KEY = "feta.qa";
const qaInLink = () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("qa"));
if (qaInLink()) {
  try {
    localStorage.setItem(QA_KEY, qaInLink()!.slice(0, 64));
  } catch {
    // Marked for this visit only.
  }
}

function qaCode(): string | null {
  try {
    return localStorage.getItem(QA_KEY) || qaInLink();
  } catch {
    return qaInLink();
  }
}
const isQa = () => !!qaCode();

async function markTest() {
  const { error } = await supabase().rpc("mark_test", { p_code: qaCode() });
  if (error) console.error("Marking test visitor failed", error.message);
}

// Everything this phone kept: settings, picks and plans, and Style's photo
// and drawings (founder, 20 Nov 2026: after "Delete my data" her old
// drawings came back; they live in IndexedDB, which clear() doesn't touch).
// keepSignIn: only Feta's own things go (the sign-in, the theme, the test
// mark and a pending 18+ re-check stay), for a phone changing accounts.
export async function forgetPhone(opts: { keepSignIn?: boolean } = {}) {
  const KEEP = ["feta.theme", QA_KEY, "feta.reconfirmAge", "feta.carry"];
  try {
    if (!opts.keepSignIn) {
      localStorage.clear();
      sessionStorage.clear();
    } else
      for (const store of [localStorage, sessionStorage])
        Object.keys(store)
          .filter((k) => k.startsWith("feta") && !KEEP.includes(k))
          .forEach((k) => store.removeItem(k));
  } catch {
    // Nothing more to clear.
  }
  // Photos on their way to the Google account (lib/carry.ts) stay through a
  // change of account, never through sign-out or delete.
  if (!opts.keepSignIn)
    try {
      indexedDB.deleteDatabase("feta-carry");
    } catch {
      // No IndexedDB here.
    }
  try {
    await new Promise<void>((done) => {
      // Wait for it to finish (photos live here), up to 3 s if something holds it open.
      const req = indexedDB.deleteDatabase("feta-style");
      req.onsuccess = req.onerror = () => done();
      setTimeout(done, 3000);
    });
  } catch {
    // No IndexedDB here.
  }
}

// Whose things this phone keeps (founder, 21 Nov 2026: "in one phone even
// after memory deletion the data gets overlapped"). An installed Feta and the
// browser keep separate copies, and switching Google accounts or sharing a
// phone changes the account, so the name, answers, plans and Style photos
// left from another account would show for this one. When the account isn't
// the one the copy belongs to, the copy goes and Feta starts again from
// Welcome, which brings back this account's own. A phone from before this
// check takes the current account as its owner, unless that account was
// only just made: a new account has no finished setup of its own.
const OWNER_KEY = "feta.owner";

async function claimPhone(userId: string, opts: { brandNew?: boolean } = {}) {
  let foreign: boolean;
  try {
    const owner = localStorage.getItem(OWNER_KEY);
    foreign = owner ? owner !== userId : !!opts.brandNew && localStorage.getItem("feta.profileLines") !== null;
    if (owner !== userId) localStorage.setItem(OWNER_KEY, userId);
  } catch {
    return; // No storage: nothing was kept.
  }
  if (!foreign) return;
  await forgetPhone({ keepSignIn: true });
  try {
    localStorage.setItem(OWNER_KEY, userId);
  } catch {
    // Cleared all the same.
  }
  window.location.replace("/");
  await new Promise(() => {}); // the page is going; nothing else runs as the old copy
}

const carrying = () => {
  try {
    return !!localStorage.getItem("feta.carry");
  } catch {
    return false;
  }
};

// Every visitor gets a private anonymous account the first time they need
// one, so answers are saved even before (or without) Google sign-in.
let pending: Promise<string | null> | null = null;

export function currentUserId(): Promise<string | null> {
  if (!pending) {
    pending = (async () => {
      const { data } = await supabase().auth.getSession();
      const existing = data.session?.user.id;
      if (existing) {
        await claimPhone(existing);
        // Inspiration photos brought from this phone's anonymous account (lib/carry.ts).
        if (!data.session?.user.is_anonymous && carrying()) await import("@/lib/carry").then((m) => m.adoptCarried(existing)).catch(() => null);
        if (isQa()) await markTest();
        return existing;
      }
      const { data: anon, error } = await supabase().auth.signInAnonymously();
      if (error) {
        console.error("Anonymous sign-in failed", error.message);
        pending = null;
        return null;
      }
      const id = anon.user?.id ?? null;
      if (id) await claimPhone(id, { brandNew: true });
      if (id && isQa()) await markTest();
      return id;
    })();
  }
  return pending;
}
