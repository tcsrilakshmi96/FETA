"use client";

import { currentUserId, supabase } from "@/lib/supabase";

// After Google, people come back to the consent step of sign-in.
function returnUrl() {
  return `${window.location.origin}/sign-in?step=consent`;
}

const RECONFIRM_AGE_KEY = "feta.reconfirmAge";

// Attach Google to this phone's anonymous account, so everything already
// answered stays. Leaves the page for Google; returns an error message if
// it could not start.
export async function startGoogleSignIn(): Promise<string | null> {
  await currentUserId();
  const { data } = await supabase().auth.getSession();
  if (data.session?.user.is_anonymous) {
    const { error } = await supabase().auth.linkIdentity({
      provider: "google",
      options: { redirectTo: returnUrl() },
    });
    if (!error) return null;
  }
  const { error } = await supabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: returnUrl() },
  });
  return error?.message ?? null;
}

// This Google account already belongs to a Feta account (say, from another
// phone). Sign in to that one instead and drop the anonymous account made on
// this phone; at this point in the flow it only holds the 18+ check, which
// is logged again on the real account when the user comes back.
export async function switchToExistingAccount() {
  await supabase().rpc("delete_my_data");
  await supabase().auth.signOut({ scope: "local" });
  try {
    sessionStorage.setItem(RECONFIRM_AGE_KEY, "1");
  } catch {
    // Without storage the 18+ check is simply not logged twice.
  }
  await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnUrl() } });
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
