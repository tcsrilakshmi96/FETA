"use client";

import { useEffect, useState } from "react";
import styles from "./You.module.css";

// "Add Feta to your home screen" on You (founder, 18 Nov 2026): the cheese
// icon and a full-screen app, before any app store. Android offers its own
// install button; on an iPhone it's Share → Add to Home Screen. Hidden once
// Feta is opened from the home screen.
type InstallPrompt = Event & { prompt: () => Promise<void> };

export default function InstallFeta() {
  const [shown, setShown] = useState<"android" | "iphone" | "other" | null>(null);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (installed) return;
    const ua = navigator.userAgent;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the phone is only known in the browser
    setShown(/iPhone|iPad/.test(ua) ? "iphone" : /Android/.test(ua) ? "android" : "other");
    const keep = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", keep);
    return () => window.removeEventListener("beforeinstallprompt", keep);
  }, []);

  if (!shown) return null;
  return (
    <div className={styles.install}>
      <strong>Add Feta to your home screen</strong>
      {prompt ? (
        <button type="button" onClick={() => prompt.prompt().then(() => setPrompt(null))}>
          Install Feta
        </button>
      ) : (
        <span>
          {shown === "iphone"
            ? "In Safari, tap Share (the square with an arrow), then Add to Home Screen."
            : shown === "android"
              ? "In Chrome, tap ⋮, then Add to Home screen."
              : "On your phone, open askfeta.com and add it to your home screen."}
        </span>
      )}
    </div>
  );
}
