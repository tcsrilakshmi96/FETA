"use client";

import { useEffect, useRef, useState } from "react";
import TopPill, { pillWidth, type PillPart } from "@/components/TopPill";
import { hasFetaPicks } from "@/lib/picks-client";
import styles from "./FetaStar.module.css";

// "★ Feta Picks near you" on Home (founder, 16 Nov 2026): a star next to
// the round You button. Every time Home shows (founder, 17 Nov 2026: once a
// day "is going unnoticed"), when the city has Feta Picks, the pill at the
// top says so and the star flies out of it into its button. The star
// pulses until it's first opened. Nothing is checked on Google until it's
// tapped.
const SEEN_KEY = "feta.starSeen"; // opened at least once

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Shown again next time, that's all.
  }
}

export default function FetaStar({ cityId, cityName, onOpen }: { cityId: string; cityName: string; onOpen: () => void }) {
  const [pill, setPill] = useState<"hidden" | "open">("hidden");
  const [away, setAway] = useState(false); // the star is in the pill, not the button
  const [landed, setLanded] = useState(false);
  const [seen, setSeen] = useState(true);
  const button = useRef<HTMLSpanElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const flyer = useRef<HTMLSpanElement>(null);
  const parts: PillPart[] = [{ text: "★ Feta Picks", tone: "star" }, { text: `in ${cityName}` }];

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- only readable in the browser
    setSeen(read(SEEN_KEY) === "1");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let live = true;
    const timers: number[] = [];
    const later = (ms: number, f: () => void) => timers.push(window.setTimeout(() => live && f(), ms));
    hasFetaPicks(cityId).then((yes) => {
      if (!yes || !live) return;
      later(900, () => {
        setAway(true);
        setPill("open");
      });
      later(2300, () => {
        const from = pillRef.current?.querySelector('[data-part="0"]')?.getBoundingClientRect();
        const to = button.current?.getBoundingClientRect();
        const star = flyer.current;
        if (!from || !to || !star) {
          setAway(false);
          setPill("hidden");
          return;
        }
        const x0 = from.left, y0 = from.top + from.height / 2 - 9;
        const x1 = to.left + to.width / 2 - 8, y1 = to.top + to.height / 2 - 9;
        star.hidden = false;
        star
          .animate(
            [
              { transform: `translate(${x0}px, ${y0}px) scale(1) rotate(0deg)` },
              { transform: `translate(${(x0 + x1) / 2 + 12}px, ${Math.max(y0, y1) + 52}px) scale(1.8) rotate(160deg)`, offset: 0.5 },
              { transform: `translate(${x1}px, ${y1}px) scale(1) rotate(360deg)` },
            ],
            { duration: 750, easing: "cubic-bezier(0.45, 0, 0.3, 1)", fill: "forwards" },
          )
          .finished.then(() => {
            star.hidden = true;
            if (!live) return;
            setAway(false);
            setLanded(true);
            later(150, () => setPill("hidden"));
          })
          .catch(() => {});
      });
    });
    return () => {
      live = false;
      timers.forEach(clearTimeout);
    };
  }, [cityId]);

  function open() {
    write(SEEN_KEY, "1");
    setSeen(true);
    onOpen();
  }

  return (
    <>
      {/* Named under the star (founder, 21 Nov 2026: people miss the pill). */}
      <button type="button" className="labelled" onClick={open} aria-label="Feta Favourites near you">
        <span ref={button} className={`${styles.star} ${away ? styles.away : ""} ${landed ? styles.landed : ""} ${seen ? "" : styles.pulse}`}>
          ★
        </span>
        <small aria-hidden="true">Favourites</small>
      </button>
      <TopPill state={pill} parts={parts} width={pillWidth(parts)} pillRef={pillRef} />
      <span ref={flyer} className={styles.flyer} aria-hidden="true" hidden>
        ★
      </span>
    </>
  );
}
