"use client";

import { useEffect, useState } from "react";
import Mascot from "@/components/Mascot";
import sheet from "./Sheet.module.css";
import styles from "./IphoneInstall.module.css";

// Getting Feta on an iPhone's home screen (founder, 18 Nov 2026: "I don't
// think my 100 testers or the VCs are going to like this process"). Apple
// lets no website offer an install button, so Home shows a small row on an
// iPhone, and "How" opens the three steps with pictures. Gone once Feta is
// opened from the home screen, or after ✕.
const HIDDEN_KEY = "feta.installHidden";

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
    <path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" />
  </svg>
);
const AddIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M12 8.5v7M8.5 12h7" />
  </svg>
);

export default function IphoneInstall() {
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    let hidden = false;
    try {
      hidden = !!localStorage.getItem(HIDDEN_KEY);
    } catch {
      // Shown, that's all.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the phone is only known in the browser
    if (!installed && !hidden && /iPhone|iPad/.test(navigator.userAgent)) setShown(true);
  }, []);

  function hide() {
    setShown(false);
    setOpen(false);
    try {
      localStorage.setItem(HIDDEN_KEY, "1");
    } catch {
      // Back next visit.
    }
  }

  if (!shown) return null;
  return (
    <>
      <div className={styles.row}>
        <button type="button" className={styles.how} onClick={() => setOpen(true)}>
          <Mascot size={30} limbs={false} />
          <span>
            Put Feta on your home screen <b>How?</b>
          </span>
        </button>
        <button type="button" className={styles.x} aria-label="Hide" onClick={hide}>
          ✕
        </button>
      </div>
      {open && (
        <>
          <div className={sheet.dim} onClick={() => setOpen(false)} />
          <div className={sheet.sheet} role="dialog" aria-label="Put Feta on your home screen">
            <Mascot pose="wave" size={84} pop />
            <h2 className={sheet.title}>
              Feta on your <strong>home screen</strong>
            </h2>
            <p className={sheet.sub}>Three taps, once. Then it opens like an app.</p>
            <ol className={styles.steps}>
              <li>
                <span className={styles.icon}>
                  <ShareIcon />
                </span>
                <span>
                  Tap <b>Share</b> in Safari&apos;s bar
                  <small>On newer iPhones, tap ••• first</small>
                </span>
              </li>
              <li>
                <span className={styles.icon}>
                  <AddIcon />
                </span>
                <span>
                  Scroll down, tap <b>Add to Home Screen</b>
                </span>
              </li>
              <li>
                <span className={styles.icon}>
                  <Mascot size={26} limbs={false} />
                </span>
                <span>
                  Tap <b>Add</b>. The cheese is on your home screen.
                </span>
              </li>
            </ol>
            <button type="button" className={`btn-primary ${sheet.go}`} onClick={() => setOpen(false)}>
              Got it
            </button>
            <button type="button" className={sheet.ghost} onClick={hide}>
              Don&apos;t show this again
            </button>
          </div>
          <span className={styles.arrow} aria-hidden="true">
            ↓
          </span>
        </>
      )}
    </>
  );
}
