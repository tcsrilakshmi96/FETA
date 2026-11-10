"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import styles from "./SignIn.module.css";

type Step = "phone" | "code" | "consent";

const RESEND_SECONDS = 30;

// Pretend sign-in until a real provider is connected: no text is sent,
// 000000 shows the wrong-code state, and any other 6 digits gets through.
const WRONG_CODE_FOR_TESTING = "000000";

function formatPhone(digits: string) {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

// Accepts typing or pasting with +91 or a leading 0.
function toTenDigits(value: string) {
  const digits = value.replace(/\D/g, "");
  const local = digits.length > 10 ? digits.replace(/^(91|0)/, "") : digits;
  return local.slice(0, 10);
}

export default function SignIn() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeWrong, setCodeWrong] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [codeFocused, setCodeFocused] = useState(false);
  const [consent, setConsent] = useState({ location: true, publicReviews: false });
  const codeInput = useRef<HTMLInputElement>(null);

  const phoneValid = /^[6-9]\d{9}$/.test(phone);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function goBack() {
    if (step === "phone") router.push("/");
    else setStep(step === "consent" ? "code" : "phone");
  }

  function sendCode() {
    setCode("");
    setCodeWrong(false);
    setStep("code");
  }

  function verify() {
    if (code === WRONG_CODE_FOR_TESTING) {
      setCodeWrong(true);
      setCode("");
      codeInput.current?.focus();
      return;
    }
    setStep("consent");
  }

  function resend() {
    setCodeWrong(false);
    setCode("");
    setResendIn(RESEND_SECONDS);
  }

  function finish() {
    // Consent is saved with the account once the database is connected.
    router.push("/questions");
  }

  function notNow() {
    router.push("/questions");
    toast("No problem. Sign in later from You.");
  }

  return (
    <main className={styles.screen}>
      <button type="button" className={styles.back} onClick={goBack} aria-label="Back">
        ‹
      </button>

      {step === "phone" && (
        <div className={styles.step}>
          <h1 className={styles.title}>
            First, <strong>your number.</strong>
          </h1>
          <p className={styles.sub}>
            So your saves and lists follow you to any phone. No password, no spam.
          </p>
          <label className={styles.phoneField}>
            <span className={styles.prefix}>+91</span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98765 43210"
              aria-label="Mobile number"
              value={formatPhone(phone)}
              onChange={(e) => setPhone(toTenDigits(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && phoneValid && sendCode()}
            />
          </label>
        </div>
      )}

      {step === "code" && (
        <div className={styles.step}>
          <h1 className={styles.title}>
            Enter the <strong>6-digit code</strong>
          </h1>
          <p className={styles.sub}>Sent to +91 {formatPhone(phone)}</p>
          <div className={styles.codeWrap}>
            {Array.from({ length: 6 }, (_, i) => (
              <span
                key={i}
                className={[
                  styles.box,
                  codeWrong ? styles.boxWrong : "",
                  codeFocused && i === Math.min(code.length, 5) ? styles.boxActive : "",
                ].join(" ")}
              >
                {code[i] ?? ""}
              </span>
            ))}
            <input
              ref={codeInput}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="6-digit code"
              autoFocus
              value={code}
              onFocus={() => setCodeFocused(true)}
              onBlur={() => setCodeFocused(false)}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                setCodeWrong(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && code.length === 6 && verify()}
            />
          </div>
          {codeWrong && (
            <p className={styles.error}>That code didn&apos;t match. Check it and try again.</p>
          )}
          <button
            type="button"
            className={styles.resend}
            disabled={resendIn > 0}
            onClick={resend}
          >
            {resendIn > 0
              ? `Code sent again · resend in 0:${String(resendIn).padStart(2, "0")}`
              : "Resend code"}
          </button>
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
            Nothing is public unless you turn it on. Turning anything off is just as easy, in You.
          </p>
        </div>
      )}

      <div className={styles.actions}>
        {step === "phone" && (
          <>
            <button type="button" className={styles.primary} disabled={!phoneValid} onClick={sendCode}>
              Send code
            </button>
            <button type="button" className={styles.secondary} onClick={notNow}>
              Not now
            </button>
          </>
        )}
        {step === "code" && (
          <button type="button" className={styles.primary} disabled={code.length < 6} onClick={verify}>
            Verify
          </button>
        )}
        {step === "consent" && (
          <button type="button" className={styles.primary} onClick={finish}>
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
      <span className={`${styles.switch} ${props.on ? styles.switchOn : ""}`} />
    </button>
  );
}
