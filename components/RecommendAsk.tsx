"use client";

import styles from "./Sheet.module.css";

// After someone names places they love: "Make them Feta Favourites?"
// (founder, 15 Nov 2026). Yes means other Feta users with a similar taste
// see them, with "Loved by N Feta users"; only the places and a count are
// shared, never their name or anything about them.
export default function RecommendAsk({ count, onAnswer }: { count: number; onAnswer: (yes: boolean) => void }) {
  const them = count === 1 ? "it" : "them";
  return (
    <>
      <div className={styles.dim} onClick={() => onAnswer(false)} />
      <div className={styles.sheet} role="dialog" aria-label="Recommend to other Feta users">
        <p className={styles.kick}>Feta Favourites</p>
        <h2 className={styles.title}>
          Recommend {them} to <strong>people like you?</strong>
        </h2>
        <p className={styles.sub}>
          Feta users with a similar taste will see {count === 1 ? "this place" : "these places"} as Feta Favourites. Only the {count === 1 ? "place is" : "places are"} shared, never your name or anything about you.
        </p>
        <button type="button" className={`btn-primary ${styles.go}`} onClick={() => onAnswer(true)}>
          Yes, recommend {them}
        </button>
        <button type="button" className={styles.ghost} onClick={() => onAnswer(false)}>
          Keep {them} to me
        </button>
      </div>
    </>
  );
}
