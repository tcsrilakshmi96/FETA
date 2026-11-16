"use client";

import type { Ref } from "react";
import styles from "./TopPill.module.css";

// The small black pill at the top of the screen (founder, 16 Nov 2026):
// it says what just happened ("8 new picks · ★ 1 Feta Pick"), the Feta
// Picks star flies out of it, and the cheese pull hangs from it.
// hidden: not there. dot: a small pill. open: wide, with the words.
export type PillPart = { text: string; tone?: "count" | "star" };

export default function TopPill({ state, parts = [], width = 220, pillRef }: { state: "hidden" | "dot" | "open"; parts?: PillPart[]; width?: number; pillRef?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={pillRef}
      className={`${styles.pill} ${state === "dot" ? styles.dot : state === "open" ? styles.open : ""}`}
      style={state === "open" ? { width } : undefined}
      role="status"
      aria-live="polite"
    >
      <span className={styles.text}>
        {state === "open" &&
          parts.map((p, i) => (
            <span key={i} className={p.tone === "count" ? styles.count : p.tone === "star" ? styles.star : undefined} data-part={i}>
              {i > 0 && <span className={styles.dotSep}>·</span>}
              {p.text}
            </span>
          ))}
      </span>
    </div>
  );
}

// A width that fits these words (the pill can't grow to fit on its own
// and still spring open).
export function pillWidth(parts: PillPart[]) {
  const chars = parts.reduce((n, p) => n + p.text.length, 0) + (parts.length - 1) * 3;
  return Math.min(320, Math.max(150, 40 + chars * 7.1));
}
