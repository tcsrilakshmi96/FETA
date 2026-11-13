"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { loadCity } from "@/lib/cities";
import { EMPTY_ANSWERS, loadAnswers } from "@/lib/onboarding";
import { MAX_CUISINES, pairSwipes, saveSwipes, swipeCards, type PairCard, type Swipe } from "@/lib/swipes";
import { saveSwipesToDb } from "@/lib/db";
import styles from "./Swipes.module.css";

type Choice = "a" | "b" | "both" | "neither";

// The 6 taste cards: a cuisine grid, then five "this or that" pairs.
// Redoing the cards from You returns there.
const fromYou = () => new URLSearchParams(window.location.search).get("from") === "you";

export default function Swipes() {
  const router = useRouter();
  const [cards, setCards] = useState(() => swipeCards(EMPTY_ANSWERS));
  const [index, setIndex] = useState(0);
  const [swipes, setSwipes] = useState<Swipe[]>([]);
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Choice | null>(null);
  const busy = useRef(false);

  // The vibe card depends on the drinks answer, the photos on the city's region.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- answers are only readable in the browser
    setCards(swipeCards(loadAnswers(), loadCity()?.country));
  }, []);

  const card = cards[Math.min(index, cards.length - 1)];

  function next(rows: Swipe[]) {
    const all = [...swipes.filter((s) => !rows.some((r) => r.cardId === s.cardId)), ...rows];
    setSwipes(all);
    saveSwipes(all);
    if (index + 1 >= cards.length) {
      saveSwipesToDb(all);
      router.push(`/picked-up${fromYou() ? "?from=you" : ""}`);
      return;
    }
    setChosen(null);
    setIndex(index + 1);
  }

  function choose(pair: PairCard, choice: Choice) {
    if (busy.current) return;
    busy.current = true;
    setChosen(choice);
    // A moment to see the choice land before the next card.
    setTimeout(() => {
      busy.current = false;
      next(pairSwipes(pair, choice));
    }, 380);
  }

  function toggleCuisine(id: string) {
    setCuisines((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_CUISINES ? c : [...c, id]));
  }

  function skip() {
    saveSwipes(swipes);
    saveSwipesToDb(swipes);
    router.push(`/picked-up${fromYou() ? "?from=you" : ""}`);
  }

  const isPair = card.type === "pair";

  return (
    <main className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          {isPair ? (
            <>
              This <span>or that?</span>
            </>
          ) : (
            <>
              Your <span>favourites?</span>
            </>
          )}
        </h1>
        <div className={styles.meta}>
          <span className={styles.count}>
            {Math.min(index + 1, cards.length)} / {cards.length}
          </span>
          <button type="button" className={styles.skip} onClick={skip}>
            Skip
          </button>
        </div>
      </div>
      <div className={styles.progress}>
        <span style={{ width: `${(index / cards.length) * 100}%` }} />
      </div>

      {card.type === "cuisines" ? (
        <div key={card.id} className={styles.stage}>
          <p className={styles.sub}>Pick up to {MAX_CUISINES} you&apos;d happily eat any week.</p>
          <ul className={styles.grid}>
            {card.options.map((o) => {
              const on = cuisines.includes(o.id);
              const full = !on && cuisines.length >= MAX_CUISINES;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    className={`${styles.tile} ${on ? styles.tileOn : ""} ${full ? styles.tileFull : ""}`}
                    aria-pressed={on}
                    aria-label={o.label}
                    onClick={() => toggleCuisine(o.id)}
                  >
                    <span className={styles.tilePhoto}>
                      <Image src={o.image} alt="" fill sizes="120px" draggable={false} />
                      {on && <span className={styles.tick}>✓</span>}
                    </span>
                    <span className={styles.tileLabel}>{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className={styles.buttons}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => next(card.options.map((o) => ({ cardId: `cuisine_${o.id}`, verdict: cuisines.includes(o.id) ? ("yes" as const) : ("no" as const) })))}
            >
              {cuisines.length === 0 ? "I eat anything" : `Next · ${cuisines.length} picked`}
            </button>
          </div>
        </div>
      ) : (
        <div key={card.id} className={styles.stage}>
          <div className={styles.pair}>
            {(["a", "b"] as const).map((side) => {
              const s = card[side];
              const picked = chosen === side || chosen === "both";
              const dropped = chosen === "neither" || (chosen !== null && !picked);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`${styles.half} ${picked ? styles.picked : ""} ${dropped ? styles.dropped : ""}`}
                  onClick={() => choose(card, side)}
                >
                  <Image src={s.image} alt="" fill draggable={false} priority sizes="(max-width: 430px) 100vw, 430px" />
                  <span className={styles.scrim} />
                  <span className={styles.label}>{s.label}</span>
                  {picked && <span className={styles.stamp}>That&apos;s me</span>}
                </button>
              );
            })}
            <span className={styles.or} aria-hidden="true">
              or
            </span>
          </div>
          <div className={styles.buttons}>
            <button type="button" className={`${styles.pill} ${chosen === "neither" ? styles.pillOn : ""}`} onClick={() => choose(card, "neither")}>
              Neither
            </button>
            <button type="button" className={`${styles.pill} ${chosen === "both" ? styles.pillOn : ""}`} onClick={() => choose(card, "both")}>
              Both
            </button>
          </div>
        </div>
      )}
      {/* The next pair's photos, loaded early so each card appears at once. */}
      <div className={styles.preload} aria-hidden="true">
        {cards.slice(index + 1, index + 2).flatMap((c) =>
          c.type === "pair" ? [c.a.image, c.b.image].map((src, i) => <Image key={`${c.id}-${i}`} src={src} alt="" width={10} height={10} sizes="430px" />) : [],
        )}
      </div>
    </main>
  );
}
