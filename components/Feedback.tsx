"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { currentUserId, supabase } from "@/lib/supabase";
import styles from "./Feedback.module.css";

// The Feedback pill on every screen, and its sheet: a note, an optional
// screenshot of the screen behind, Send.
export default function Feedback() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [attach, setAttach] = useState(true);
  const [state, setState] = useState<"form" | "sending" | "sent" | "failed">("form");

  function close() {
    setOpen(false);
    setState("form");
  }

  async function send() {
    if (!message.trim() || state === "sending") return;
    setState("sending");
    const screenshot = attach ? await captureScreen() : null;
    const userId = await currentUserId();
    const { error } = userId
      ? await supabase().from("feedback").insert({
          user_id: userId,
          message: message.trim().slice(0, 2000),
          screen: pathname,
          screenshot,
          user_agent: navigator.userAgent.slice(0, 300),
        })
      : { error: { message: "no account" } };
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
      <button type="button" className="feedback-pill" data-no-capture onClick={() => setOpen(true)}>
        Feedback
      </button>
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
                    What&apos;s <strong>off?</strong>
                  </h2>
                  <button type="button" className={styles.close} onClick={close}>
                    Close
                  </button>
                </div>
                <textarea
                  className={styles.box}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what felt wrong, or what you wish it did…"
                  aria-label="Your feedback"
                  maxLength={2000}
                  autoFocus
                />
                <button type="button" role="checkbox" aria-checked={attach} className={styles.attach} onClick={() => setAttach(!attach)}>
                  <span>Attach a screenshot of this screen</span>
                  <span className={`${styles.tick} ${attach ? styles.tickOn : ""}`}>{attach ? "✓" : ""}</span>
                </button>
                {state === "failed" && <p className={styles.error}>Couldn&apos;t send just now. Try again in a moment.</p>}
                <button type="button" className={styles.send} disabled={!message.trim() || state === "sending"} onClick={send}>
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
