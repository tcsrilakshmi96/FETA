"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { loadCity } from "@/lib/cities";
import { detectCurrency } from "@/lib/currency";
import { loadAnswers } from "@/lib/onboarding";
import {
  loadSwipes,
  pickedUpLines,
  saveProfileLines,
  chosenImages,
  type ProfileLine,
} from "@/lib/swipes";
import { saveProfileLinesToDb } from "@/lib/db";
import styles from "./PickedUp.module.css";

// Where each yes-photo comes from and where it lands: [x, y, rotation].
const FROM = [[-420, -260, -40], [420, -200, 35], [-380, 320, 25], [400, 300, -30], [0, -500, 10]];
const LAND = [[-62, -8, -9], [58, 4, 8], [-14, 22, -3], [28, -14, 5], [0, 12, 1]];

export default function PickedUp() {
  const router = useRouter();
  const [photos, setPhotos] = useState<string[]>([]);
  const [lines, setLines] = useState<ProfileLine[]>([]);
  const [removed, setRemoved] = useState<ProfileLine[]>([]);
  // The screen shows the first few; the rest are saved too, and live in You.
  const SHOWN = 5;
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const answers = loadAnswers();
    const swipes = loadSwipes();
    const city = loadCity();
    const currency = city?.currency ?? detectCurrency();
    /* eslint-disable react-hooks/set-state-in-effect -- answers and swipes are only readable in the browser */
    setPhotos(chosenImages(answers, swipes, city?.country).slice(0, 5));
    setLines(pickedUpLines(answers, swipes, currency, city?.country));
    /* eslint-enable react-hooks/set-state-in-effect */
    const t = setTimeout(() => setSettled(true), 80);
    return () => clearTimeout(t);
  }, []);

  function showPicks() {
    saveProfileLines(lines);
    saveProfileLinesToDb(lines, removed);
    router.push("/location");
  }

  return (
    <main className={`${styles.screen} ${settled ? styles.in : ""}`}>
      <div className={styles.collage} aria-hidden="true">
        {photos.map((src, i) => {
          const [x, y, r] = settled ? LAND[i] : FROM[i];
          return (
            <div
              key={src}
              className={styles.tile}
              style={{
                transform: `translate(${x}px, ${y}px) rotate(${r}deg)`,
                opacity: settled ? 1 : 0,
                transitionDelay: `${i * 0.12}s`,
                zIndex: i,
              }}
            >
              <Image src={src} alt="" fill sizes="150px" />
            </div>
          );
        })}
      </div>

      <div className={styles.bottom}>
        <h1 className={`${styles.fade} ${styles.title}`}>
          Here&apos;s what <strong>I picked up.</strong>
        </h1>
        <p className={`${styles.fade} ${styles.sub}`}>
          Not a label, just a starting point. Remove anything that&apos;s wrong; it changes with every outing.
        </p>
        <ul className={`${styles.fade} ${styles.lines}`}>
          {lines.slice(0, SHOWN).map((line) => (
            <li key={line.id} className={styles.line}>
              {line.text}
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove "${line.text}"`}
                onClick={() => {
                  setLines(lines.filter((l) => l.id !== line.id));
                  setRemoved([...removed, line]);
                }}
              >
                ×
              </button>
            </li>
          ))}
          {lines.length === 0 && (
            <li className={styles.empty}>Nothing yet. Your first outings will teach me.</li>
          )}
        </ul>
        <button type="button" className={`btn-primary ${styles.fade} ${styles.go}`} onClick={showPicks}>
          Show my picks
        </button>
      </div>
    </main>
  );
}
