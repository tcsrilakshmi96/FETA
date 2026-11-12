"use client";

import { useEffect, useState } from "react";
import { loadAppearance, setAppearance } from "@/lib/profile-client";
import styles from "./ThemeToggle.module.css";

// Light / dark, as a small pill with the current look lit (founder: the
// moon button alone was hard to see). Same setting as Appearance in You.
export default function ThemeToggle({ onPhoto = false }: { onPhoto?: boolean }) {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const look = loadAppearance();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the look is only readable in the browser
    setDark(look === "dark" || (look === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches));
  }, []);

  if (dark === null) return <span className={styles.placeholder} />;
  return (
    <span className={`${styles.pill} ${onPhoto ? styles.onPhoto : ""}`} role="radiogroup" aria-label="Light or dark">
      <span className={styles.thumb} style={{ transform: dark ? "translateX(100%)" : "none" }} />
      {([false, true] as const).map((d) => (
        <button
          key={String(d)}
          type="button"
          role="radio"
          aria-checked={dark === d}
          aria-label={d ? "Dark" : "Light"}
          className={dark === d ? styles.on : ""}
          onClick={() => {
            setAppearance(d ? "dark" : "light");
            setDark(d);
          }}
        >
          {d ? "☾" : "☀︎"}
        </button>
      ))}
    </span>
  );
}
