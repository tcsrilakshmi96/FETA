"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { isSignedIn, readGoogleReturn, signInToExistingAccount, startGoogleSignIn } from "@/lib/auth";
import { restoreFromAccount } from "@/lib/db";
import { popUpSlot } from "@/lib/popups";
import styles from "./SaveTaste.module.css";

const ASKED_KEY = "feta.saveTasteAsked";

// Sign-in after people have seen their picks, not before (testers: asking
// first loses people). Asked once on Home; "Later" leaves it to You.
// places: they chose places to eat or things to do (else it's about Style or a trip).
export default function SaveTaste({ ready, onRestored, places = true }: { ready: boolean; onRestored: () => void; places?: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const restored = useRef(onRestored);

  // Back from Google on Home.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("google") !== "1") return;
    const google = readGoogleReturn();
    if (google.errorCode === "identity_already_exists") {
      // That Google account already has Feta: sign in to it (this phone's
      // answers stay in the account made here, as in You).
      signInToExistingAccount("/home?google=1");
      return;
    }
    if (google.error) {
      window.history.replaceState(null, "", "/home");
      toast("Google sign-in didn't finish. Try again from You.");
      return;
    }
    isSignedIn().then(async (signedIn) => {
      window.history.replaceState(null, "", "/home");
      if (!signedIn) return;
      if (await restoreFromAccount()) restored.current();
      toast("Signed in. Feta will remember you on any phone.");
    });
  }, [toast]);

  useEffect(() => {
    if (!ready) return;
    try {
      if (localStorage.getItem(ASKED_KEY)) return;
    } catch {
      return;
    }
    // A moment to see their picks first (audit, 20 Nov 2026: it covered them
    // on arrival), then only when nothing else is open: never on top of
    // Choose for me or another sheet (Round 5 review: two sheets stacked).
    let live = true;
    const slot = popUpSlot(2);
    let t = 0;
    isSignedIn().then((signedIn) => {
      if (signedIn) return slot.none();
      t = window.setTimeout(() => live && slot.ready(() => setOpen(true)), 8000);
    });
    return () => {
      live = false;
      clearTimeout(t);
      slot.cancel();
    };
  }, [ready]);

  function close() {
    try {
      localStorage.setItem(ASKED_KEY, "1");
    } catch {
      // Asked again next time, that's all.
    }
    setOpen(false);
  }

  async function google() {
    setOpening(true);
    close();
    const error = await startGoogleSignIn("/home?google=1");
    if (error) {
      setOpening(false);
      toast("Couldn't reach Google. Try again from You.");
    }
  }

  if (!open && !opening) return null;
  return (
    <>
      <div className={styles.dim} onClick={close} />
      <div className={styles.sheet} role="dialog" aria-label="Save your taste">
        <p className={styles.kick}>{places ? "Your places are ready" : "You're all set"}</p>
        <h2 className={styles.title}>
          Save your taste so <strong>Feta remembers you</strong>
        </h2>
        <p className={styles.sub}>Without it, everything lives in this phone&apos;s browser only. Clear it or change phones, and Feta forgets.</p>
        <button type="button" className={styles.google} onClick={google} disabled={opening}>
          <GoogleLogo />
          {opening ? "Opening Google…" : "Continue with Google"}
        </button>
        <button type="button" className={styles.later} onClick={close}>
          Later
        </button>
      </div>
    </>
  );
}

// Google's standard "G" mark, unchanged as its branding rules require.
function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
