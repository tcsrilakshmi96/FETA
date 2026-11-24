"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { currentUserId, supabase } from "@/lib/supabase";
import styles from "./Feedback.module.css";

// Feedback (founder, 24 Nov 2026): no button on the screens. It asks, as a
// pop-up, "How's Feta so far?" after they save, share or plan something,
// or on their third day, at most once a week and never over another
// pop-up or during setup; "Send feedback" in You opens it any time.
export const OPEN_FEEDBACK = "feta:feedback";
export function openFeedback() {
  window.dispatchEvent(new Event(OPEN_FEEDBACK));
}
const DID = "feta:did";
// Something worth asking about after: a place saved, a share, a plan.
export function didSomething() {
  window.dispatchEvent(new Event(DID));
}
const ASKED = "feta.feedbackAsked";
const DAYS = "feta.days";
const WEEK = 7 * 24 * 3600 * 1000;
const ASK_ON = /^\/(home|picks|lists|style|you|trip)/;
const FACES = ["😞", "😕", "🙂", "😀", "🤩"];
const FORM = "https://docs.google.com/forms/d/e/1FAIpQLScYVziHCVl-bIVIfBGzbNV31FTNj7AN1zU58kF05k2SFw1uQQ/viewform";

export default function Feedback() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false); // the pop-up, not opened by them
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [attach, setAttach] = useState(true);
  const [state, setState] = useState<"form" | "sending" | "sent" | "failed">("form");
  useEffect(() => {
    const show = () => {
      setAsking(false);
      setAttach(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_FEEDBACK, show);
    return () => window.removeEventListener(OPEN_FEEDBACK, show);
  }, []);
  // When to ask.
  useEffect(() => {
    const ask = (wait: number) =>
      window.setTimeout(() => {
        try {
          if (!ASK_ON.test(location.pathname)) return;
          if (Date.now() - Number(localStorage.getItem(ASKED) ?? 0) < WEEK) return;
          if (document.querySelector("[role=dialog]")) return;
          localStorage.setItem(ASKED, String(Date.now()));
        } catch {
          return;
        }
        setAsking(true);
        setAttach(false);
        setOpen(true);
      }, wait);
    const timers: number[] = [];
    const onDid = () => timers.push(ask(1500));
    window.addEventListener(DID, onDid);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const days = new Set<string>(JSON.parse(localStorage.getItem(DAYS) ?? "[]"));
      days.add(today);
      localStorage.setItem(DAYS, JSON.stringify([...days].slice(-10)));
      if (days.size >= 3) timers.push(ask(20000));
    } catch {
      // Asked only after something they did.
    }
    return () => {
      window.removeEventListener(DID, onDid);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  function close() {
    setOpen(false);
    setState("form");
    setRating(null);
  }

  async function send() {
    if ((!message.trim() && rating === null) || state === "sending") return;
    setState("sending");
    // Quick and dependable (testers: slow, and twice it didn't go): the
    // screenshot gets at most 2.5 seconds, and if the message doesn't go with
    // it, it goes again without it.
    const [screenshot, userId] = await Promise.all([
      attach ? Promise.race([captureScreen(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500))]) : null,
      currentUserId(),
    ]);
    const said = `${rating !== null ? `[How's Feta: ${rating + 1}/5 ${FACES[rating]}] ` : ""}${message.trim()}`.trim();
    const row = { user_id: userId, message: said.slice(0, 2000), screen: pathname, user_agent: navigator.userAgent.slice(0, 300) };
    let { error } = userId ? await supabase().from("feedback").insert({ ...row, screenshot }) : { error: { message: "no account" } };
    if (error && userId && screenshot) ({ error } = await supabase().from("feedback").insert(row));
    if (error) {
      console.error("Sending feedback failed", error.message);
      setState("failed");
      return;
    }
    setMessage("");
    setState("sent");
    setTimeout(close, 1800);
  }

  return (
    <>
      {open && (
        <div data-no-capture>
          <div className={styles.dim} onClick={close} />
          <div className={styles.sheet} role="dialog" aria-label="Feedback">
            {state === "sent" ? (
              <p className={styles.thanks}>
                Thanks. <strong>We read every one.</strong>
              </p>
            ) : (
              <>
                <div className={styles.head}>
                  <h2 className={styles.title}>
                    {asking ? (
                      <>
                        How&apos;s Feta <strong>so far?</strong>
                      </>
                    ) : (
                      <>
                        What&apos;s <strong>off?</strong>
                      </>
                    )}
                  </h2>
                  <button type="button" className={styles.close} onClick={close}>
                    {asking ? "Not now" : "Close"}
                  </button>
                </div>
                {asking && (
                  <div className={styles.faces} role="radiogroup" aria-label="How's Feta so far?">
                    {FACES.map((f, i) => (
                      <button key={f} type="button" role="radio" aria-checked={rating === i} aria-label={`${i + 1} of 5`} className={rating === i ? styles.faceOn : ""} onClick={() => setRating(i)}>
                        {f}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  className={styles.box}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={asking ? "Anything to tell us? (optional)" : "Tell us what felt wrong, or what you wish it did…"}
                  aria-label="Your feedback"
                  maxLength={2000}
                  autoFocus={!asking}
                />
                {!asking && (
                  <button type="button" role="checkbox" aria-checked={attach} className={styles.attach} onClick={() => setAttach(!attach)}>
                    <span>Attach a screenshot of this screen</span>
                    <span className={`${styles.tick} ${attach ? styles.tickOn : ""}`}>{attach ? "✓" : ""}</span>
                  </button>
                )}
                {/* The testers' form, for more than a line (founder, 24 Nov 2026). */}
                <a className={styles.form} href={FORM} target="_blank" rel="noopener noreferrer">
                  Got 2 minutes? Fill in our short form ›
                </a>
                {state === "failed" && <p className={styles.error}>Couldn&apos;t send just now. Try again in a moment.</p>}
                <button type="button" className={styles.send} disabled={(!message.trim() && rating === null) || state === "sending"} onClick={send}>
                  {state === "sending" ? "Sending…" : "Send"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// A small JPEG of the app as it looks behind the sheet. Images that can't be
// copied (some photos block it) are left blank rather than failing.
async function captureScreen(): Promise<string | null> {
  const app = document.querySelector<HTMLElement>(".app");
  if (!app) return null;
  try {
    const { toJpeg } = await import("html-to-image");
    return await toJpeg(app, {
      quality: 0.6,
      pixelRatio: 1,
      cacheBust: false,
      skipFonts: true,
      imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
      filter: (node) => !(node instanceof HTMLElement && node.hasAttribute("data-no-capture")),
    });
  } catch (error) {
    console.error("Screenshot failed", error);
    return null;
  }
}
