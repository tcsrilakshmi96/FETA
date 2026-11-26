"use client";

import { carryInspiration } from "@/lib/carry";
import { currentUserId, forgetPhone, supabase } from "@/lib/supabase";

// After Google, people come back to the consent step of sign-in, unless
// they signed in from somewhere else (like You).
const SIGN_IN_RETURN = "/sign-in?step=consent";

function returnUrl(path = SIGN_IN_RETURN) {
  return `${window.location.origin}${path}`;
}

const RECONFIRM_AGE_KEY = "feta.reconfirmAge";

// Attach Google to this phone's anonymous account, so everything already
// answered stays. Leaves the page for Google; returns an error message if
// it could not start.
export async function startGoogleSignIn(returnPath = SIGN_IN_RETURN): Promise<string | null> {
  await currentUserId();
  const { data } = await supabase().auth.getSession();
  if (data.session?.user.is_anonymous) {
    const { error } = await supabase().auth.linkIdentity({
      provider: "google",
      options: { redirectTo: returnUrl(returnPath) },
    });
    if (!error) return null;
  }
  const { error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: returnUrl(returnPath) },
  });
  return error?.message ?? null;
}

// This Google account already belongs to a Feta account (say, from another
// phone). Sign in to that one instead and drop the anonymous account made on
// this phone; at this point in the flow it only holds the 18+ check, which
// is logged again on the real account when the user comes back. Style
// photos hung up before signing in come along (lib/carry.ts).
export async function switchToExistingAccount() {
  await carryInspiration({ alsoDelete: false });
  await supabase().rpc("delete_my_data");
  await supabase().auth.signOut({ scope: "local" });
  try {
    sessionStorage.setItem(RECONFIRM_AGE_KEY, "1");
  } catch {
    // Without storage the 18+ check is simply not logged twice.
  }
  await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnUrl() } });
}

// "Already use Feta? Sign in" on Welcome (founder, 18 Nov 2026: signing in
// on a new phone asked three times): straight to Google and back to
// Welcome, which brings their account to this phone, with no setup and no
// account made here first.
export async function signInReturning() {
  const { error } = await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnUrl("/") } });
  return error?.message ?? null;
}

export function takeReconfirmAge() {
  try {
    const needed = sessionStorage.getItem(RECONFIRM_AGE_KEY) === "1";
    sessionStorage.removeItem(RECONFIRM_AGE_KEY);
    return needed;
  } catch {
    return false;
  }
}

// What Google sent back in the address, if anything.
export function readGoogleReturn() {
  const params = new URLSearchParams(window.location.search);
  new URLSearchParams(window.location.hash.slice(1)).forEach((value, key) => params.set(key, value));
  return {
    back: params.get("step") === "consent",
    errorCode: params.get("error_code"),
    error: params.get("error"),
  };
}

export async function isSignedIn() {
  const { data } = await supabase().auth.getSession();
  return !!data.session && !data.session.user.is_anonymous;
}

// From You: the anonymous account may already hold answers and lists, so it
// is kept (not deleted); the phone simply signs in to the existing account.
// Its Style photos come along and leave it (lib/carry.ts).
export async function signInToExistingAccount(returnPath: string) {
  await carryInspiration({ alsoDelete: true });
  await supabase().auth.signOut({ scope: "local" });
  await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnUrl(returnPath) } });
}

// "Sign out" in You (founder, 19 Nov 2026), only for Google accounts: the
// account stays and comes back with "Already use Feta? Sign in" on Welcome.
// This phone forgets everything it kept for it.
export async function signOut() {
  await supabase().auth.signOut({ scope: "local" });
  await forgetPhone();
}
