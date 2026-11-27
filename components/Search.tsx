"use client";

import BackArrow from "@/components/BackArrow";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadOrigin, type Origin } from "@/lib/origin";
import { guessSearch, recentSearches, rememberSearch } from "@/lib/search";
import styles from "./Search.module.css";

// Search (founder, 23 Nov 2026), opened from the round button on Home. One
// box: a piece of clothing leads with brands in their country, anything
// else with places and things to do; both are always offered. Places go to
// the picks list as a search (just what they typed, their usual rules, a
// place named there always shown); a search never changes their taste.
export default function Search() {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  // Read on the phone after the first paint, so the page the server sends matches.
  const [origin, setOrigin] = useState<Origin | null>(null);

  useEffect(() => {
    const o = loadOrigin();
    if (!o) {
      router.replace("/location");
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- where they are and recent searches live on this phone only */
    setOrigin(o);
    setRecent(recentSearches());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [router]);

  if (!origin) return null;
  const q = typed.trim();
  const guess = guessSearch(q);
  const place = (text: string) => {
    rememberSearch(text);
    const g = guessSearch(text);
    router.push(`/picks?q=${encodeURIComponent(text)}&c=${g.category}`);
  };
  const piece = (text: string) => {
    rememberSearch(text);
    router.push(`/style/brands?q=${encodeURIComponent(text)}`);
  };
  const go = (text: string) => (guessSearch(text).clothes ? piece(text) : place(text));

  const pieceRow = (
    <button key="piece" type="button" className={styles.row} onClick={() => piece(q)}>
      <span>
        <span className={styles.rowTitle}>{q}</span>
        <span className={styles.rowSub}>Brands in {origin.city.countryName} that make it</span>
      </span>
      <span aria-hidden="true">›</span>
    </button>
  );
  const placeRow = (
    <button key="place" type="button" className={styles.row} onClick={() => place(q)}>
      <span>
        <span className={styles.rowTitle}>
          “{q}” in {origin.city.name}
        </span>
        <span className={styles.rowSub}>{guess.category === "food_drinks" ? "Food & drinks" : "Places and things to do"}, in your usual rules</span>
      </span>
      <span aria-hidden="true">›</span>
    </button>
  );
  const sections = [
    { id: "piece", kick: "A piece to buy · Style", row: pieceRow },
    { id: "place", kick: "A place or something to do", row: placeRow },
  ];
  if (!guess.clothes) sections.reverse();

  return (
    <main className={styles.screen}>
      <form
        className={styles.bar}
        onSubmit={(e) => {
          e.preventDefault();
          if (q) go(q);
        }}
      >
        <BackArrow />
        <label className={styles.field}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input autoFocus type="search" enterKeyHint="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="A place, an activity or a piece" aria-label="Search" maxLength={80} />
        </label>
      </form>

      <h1 className={styles.mast}>
        What are you <i>looking for?</i>
      </h1>

      {q ? (
        sections.map((s) => (
          <section key={s.id} className={styles.section}>
            <p className={styles.kick}>{s.kick}</p>
            {s.row}
          </section>
        ))
      ) : (
        <>
          <p className={styles.hint}>A place by name, something to do tonight or this weekend, or a piece of clothing. It&apos;s just for now: your taste stays as it is.</p>
          {recent.length > 0 && (
            <section className={styles.section}>
              <p className={styles.kick}>Recent</p>
              {recent.map((r) => (
                <button key={r} type="button" className={styles.recent} onClick={() => go(r)}>
                  {r}
                </button>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
