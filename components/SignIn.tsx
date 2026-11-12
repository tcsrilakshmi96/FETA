"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import {
  isSignedIn,
  readGoogleReturn,
  startGoogleSignIn,
  switchToExistingAccount,
  takeReconfirmAge,
} from "@/lib/auth";
import { restoreFromAccount, saveAgeConfirmed, saveConsent } from "@/lib/db";
import styles from "./SignIn.module.css";

type Step = "google" | "consent";

export default function SignIn() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>("google");
  const [consent, setConsent] = useState({ location: false, publicReviews: false });
  const [opening, setOpening] = useState(false);

  // Coming back from Google: move on to consent, or explain what went wrong.
  useEffect(() => {
    const google = readGoogleReturn();
    if (google.errorCode === "identity_already_exists") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the address Google sent back
      setOpening(true);
      switchToExistingAccount();
      return;
    }
    if (!google.back && !google.error) return;
    if (google.error) {
      window.history.replaceState(null, "", "/sign-in");
      toast("Google sign-in didn't finish. Try again, or tap Not now.");
      return;
    }
    // Supabase reads Google's one-time code from the address first, so tidy
    // the address only after that.
    isSignedIn().then(async (signedIn) => {
      window.history.replaceState(null, "", "/sign-in");
      if (!signedIn) return;
      if (takeReconfirmAge()) saveAgeConfirmed();
      // Someone who already set Feta up gets their answers back and goes
      // straight to their picks; consent was given the first time.
      if (await restoreFromAccount()) router.replace("/picks");
      else setStep("consent");
    });
  }, [toast, router]);

  function goBack() {
    if (step === "google") router.push("/");
    else setStep("google");
  }

  async function continueWithGoogle() {
    setOpening(true);
    const error = await startGoogleSignIn();
    if (error) {
      setOpening(false);
      toast("Couldn't reach Google. Check your connection and try again.");
    }
  }

  function finish() {
    saveConsent(consent);
    router.push("/city");
  }

  function notNow() {
    router.push("/city");
    toast("No problem. Sign in later from You.");
  }

  return (
    <main className={styles.screen}>
      <button type="button" className="back-btn" onClick={goBack} aria-label="Back">
        ‹
      </button>

      {step === "google" && (
        <div className={styles.step}>
          <h1 className={styles.title}>
            First, <strong>sign in.</strong>
          </h1>
          <p className={styles.sub}>
            So your saves and lists follow you to any phone. No password, no spam.
          </p>
        </div>
      )}

      {step === "consent" && (
        <div className={`${styles.step} ${styles.consentStep}`}>
          <h1 className={styles.title}>
            You&apos;re in. <strong>Your choices:</strong>
          </h1>
          <ConsentToggle
            title="Use my location"
            sub="To find places near you. Never shown to anyone."
            on={consent.location}
            onToggle={() => setConsent({ ...consent, location: !consent.location })}
          />
          <ConsentToggle
            title="Show my reviews to others"
            sub="Off by default. Only your first name is shown."
            on={consent.publicReviews}
            onToggle={() => setConsent({ ...consent, publicReviews: !consent.publicReviews })}
          />
          <p className={styles.note}>
            Nothing is public unless you turn it on. Turning anything off is just as easy, in You.{" "}
            <Link href="/privacy" className={styles.link}>
              How we use your data
            </Link>
          </p>
        </div>
      )}

      <div className={styles.actions}>
        {step === "google" && (
          <>
            <button type="button" className={styles.google} onClick={continueWithGoogle} disabled={opening}>
              <GoogleLogo />
              {opening ? "Opening Google…" : "Continue with Google"}
            </button>
            <button type="button" className={styles.secondary} onClick={notNow}>
              Not now
            </button>
          </>
        )}
        {step === "consent" && (
          <button type="button" className="btn-primary" onClick={finish}>
            Continue
          </button>
        )}
      </div>
    </main>
  );
}

function ConsentToggle(props: { title: string; sub: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      className={styles.toggleRow}
      onClick={props.onToggle}
    >
      <span>
        <span className={styles.toggleTitle}>{props.title}</span>
        <span className={styles.toggleSub}>{props.sub}</span>
      </span>
      <span className={`switch ${props.on ? "on" : ""}`} />
    </button>
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
