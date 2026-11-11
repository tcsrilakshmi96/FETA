"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { loadCity } from "@/lib/cities";
import { EMPTY_ANSWERS, loadAnswers } from "@/lib/onboarding";
import { saveSwipes, swipeCards, type Swipe, type Verdict } from "@/lib/swipes";
import { saveSwipesToDb } from "@/lib/db";
import styles from "./Swipes.module.css";

const THROW_PX = 80;

export default function Swipes() {
  const router = useRouter();
  const [cards, setCards] = useState(() => swipeCards(EMPTY_ANSWERS));
  const [index, setIndex] = useState(0);
  const [swipes, setSwipes] = useState<Swipe[]>([]);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const busy = useRef(false);

  // The night-out card depends on the drinks answer, the food photos on the city's region.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- answers are only readable in the browser
    setCards(swipeCards(loadAnswers(), loadCity()?.country));
  }, []);

  function decide(verdict: Verdict) {
    if (busy.current || index >= cards.length) return;
    busy.current = true;
    const next = [...swipes, { cardId: cards[index].id, verdict }];
    setSwipes(next);
    saveSwipes(next);
    setDragging(false);
    setDx(0);
    setIndex(index + 1);
    setTimeout(() => {
      busy.current = false;
      if (index + 1 >= cards.length) {
        saveSwipesToDb(next);
        router.push("/picked-up");
      }
    }, index + 1 >= cards.length ? 450 : 50);
  }

  function skip() {
    saveSwipes(swipes);
    saveSwipesToDb(swipes);
    router.push("/picked-up");
  }

  // Drag strength from -1 (Not me) to 1 (Yes, me), for the stamps.
  const pull = Math.max(-1, Math.min(1, dx / 100));

  return (
    <main className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          Yes, me <span>or not me?</span>
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

      <div className={styles.deck}>
        {cards.map((card, i) => {
          const pos = i - index;
          const verdict = swipes[i]?.verdict;
          let transform = "scale(.85)";
          let opacity = 0;
          let transition = "none";
          if (verdict === "unsure") {
            transform = "translateY(60px) scale(.88)";
            transition = "transform .5s, opacity .4s";
          } else if (verdict) {
            const dir = verdict === "yes" ? 1 : -1;
            transform = `translateX(${dir * 130}%) rotate(${dir * 14}deg)`;
            transition = "transform .55s cubic-bezier(.4,0,.2,1), opacity .45s .1s";
          } else if (pos === 0) {
            transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
            opacity = 1;
            transition = dragging ? "none" : "transform .8s var(--ease-spring)";
          } else if (pos > 0 && pos < 3) {
            transform = `translateY(${-12 * pos}px) scale(${1 - 0.05 * pos})`;
            opacity = pos === 1 ? 0.6 : 0.3;
            transition = "transform .6s var(--ease-enter), opacity .4s";
          }
          const active = pos === 0;
          return (
            <div
              key={card.id}
              className={styles.card}
              aria-hidden={!active}
              style={{ transform, opacity, transition, zIndex: 20 - Math.max(pos, -5) }}
              onPointerDown={(e) => {
                if (!active || busy.current) return;
                setDragging(true);
                startX.current = e.clientX;
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => dragging && active && setDx(e.clientX - startX.current)}
              onPointerUp={() => {
                if (!dragging || !active) return;
                setDragging(false);
                if (Math.abs(dx) > THROW_PX) decide(dx > 0 ? "yes" : "no");
                else setDx(0);
              }}
              onPointerCancel={() => {
                setDragging(false);
                setDx(0);
              }}
            >
              <div className={styles.photo}>
                <Image
                  src={card.image}
                  alt=""
                  fill
                  draggable={false}
                  priority={i < 2}
                  sizes="(max-width: 430px) 100vw, 430px"
                  className="kenburns"
                />
                <div className={styles.scrim} />
                <span
                  className={`${styles.stamp} ${styles.stampYes}`}
                  style={{
                    opacity: active ? Math.max(0, pull) : 0,
                    transform: `rotate(-8deg) scale(${0.75 + 0.25 * (active ? Math.max(0, pull) : 0)})`,
                  }}
                >
                  Yes, me
                </span>
                <span
                  className={`${styles.stamp} ${styles.stampNo}`}
                  style={{
                    opacity: active ? Math.max(0, -pull) : 0,
                    transform: `rotate(8deg) scale(${0.75 + 0.25 * (active ? Math.max(0, -pull) : 0)})`,
                  }}
                >
                  Not me
                </span>
                <p className={styles.label}>{card.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.buttons}>
        <button type="button" aria-label="Not me" className={`${styles.round} ${styles.no}`} onClick={() => decide("no")}>
          ✕
        </button>
        <button type="button" className={styles.unsure} onClick={() => decide("unsure")}>
          Not sure
        </button>
        <button type="button" aria-label="Yes, me" className={`${styles.round} ${styles.yes}`} onClick={() => decide("yes")}>
          ♥
        </button>
      </div>
    </main>
  );
}
