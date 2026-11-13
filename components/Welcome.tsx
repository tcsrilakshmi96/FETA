"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { restoreFromAccount, saveAgeConfirmed, setUpOnThisPhone } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import styles from "./Welcome.module.css";

// Three swipeable intro cards that say what Feta is (testers: "explain the
// concept first"; wording B, founder, 14 Nov 2026), then the 18+ check on
// the last one. Back with ‹, a dot, or a swipe right.
const SLIDES = [
  { kick: "Meet Feta", head: "Where should we go tonight?", em: "Ask Feta.", sub: "Where to eat, what to do and what to wear. Picked for you.", photo: "/welcome.jpg" },
  { kick: "Feta does the homework", head: "Reviews, opening hours,", em: "your budget.", sub: "Feta checks it all, so you only choose between places that already fit you.", photo: "/swipes/night.jpg" },
  { kick: "Your travel planner", head: "Trips,", em: "planned for you.", sub: "Any city, day by day, to your taste.", photo: "/swipes/local.jpg" },
];

export default function Welcome() {
  const [slide, setSlide] = useState(0);
  const [isAdult, setIsAdult] = useState(false);
  const touchX = useRef<number | null>(null);
  const router = useRouter();
  const last = slide === SLIDES.length - 1;

  // Returning people skip the setup: straight to their picks, from this
  // phone's copy or, if this phone is already signed in, from their account.
  useEffect(() => {
    if (setUpOnThisPhone()) {
      router.replace("/home");
      return;
    }
    supabase()
      .auth.getSession()
      .then(({ data }) => (data.session ? restoreFromAccount() : false))
      .then((restored) => restored && router.replace("/home"));
  }, [router]);

  function go(i: number) {
    setSlide(Math.max(0, Math.min(SLIDES.length - 1, i)));
  }

  function start() {
    saveAgeConfirmed();
    router.push("/start");
  }

  const s = SLIDES[slide];
  return (
    <main
      className={styles.screen}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (dx > 50) go(slide - 1);
        if (dx < -50) go(slide + 1);
      }}
    >
      <div className={styles.photo}>
        {SLIDES.map((x, i) => (
          <Image
            key={x.photo}
            src={x.photo}
            alt=""
            fill
            priority={i === 0}
            sizes="(max-width: 430px) 100vw, 430px"
            className={`kenburns ${i === slide ? styles.photoOn : ""}`}
          />
        ))}
        <div className={styles.scrim} />
        {/* Light or dark from the very first screen. */}
        <span className={styles.look}>
          <ThemeToggle onPhoto />
        </span>
        {!last && (
          <button type="button" className={styles.skip} onClick={() => go(SLIDES.length - 1)}>
            Skip
          </button>
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.text} key={slide}>
          <p className={styles.kick}>{s.kick}</p>
          <h1 className={styles.headline}>
            {s.head} <em>{s.em}</em>
          </h1>
          <p className={styles.sub}>{s.sub}</p>
        </div>
        {last && (
          <button type="button" role="checkbox" aria-checked={isAdult} className={styles.ageRow} onClick={() => setIsAdult(!isAdult)}>
            <span className={`${styles.tick} ${isAdult ? styles.tickOn : ""}`}>{isAdult ? "✓" : ""}</span>
            I&apos;m 18 or older
          </button>
        )}
        <div className={styles.nav}>
          <div className={styles.dots} role="tablist" aria-label="Intro">
            {SLIDES.map((_, i) => (
              <button key={i} type="button" role="tab" aria-selected={i === slide} aria-label={`Card ${i + 1}`} className={i === slide ? styles.dotOn : ""} onClick={() => go(i)} />
            ))}
          </div>
          {slide > 0 && (
            <button type="button" className={styles.back} onClick={() => go(slide - 1)}>
              ‹ Back
            </button>
          )}
        </div>
        <button type="button" className="btn-primary" disabled={last && !isAdult} onClick={() => (last ? start() : go(slide + 1))}>
          {last ? "Let's start" : "Next"}
        </button>
      </div>
    </main>
  );
}
