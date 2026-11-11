"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { findCities, isMainlandChina, loadCity, saveCity, type City } from "@/lib/cities";
import { saveCityToDb } from "@/lib/db";
import styles from "./CityPicker.module.css";

type Found = City & { matched?: string };

// Right after sign-in: which city the user is in, anywhere in the world.
// No location popup here; the exact spot is asked for once, before picks.
export default function CityPicker() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [current, setCurrent] = useState<City | null>(null);
  const [china, setChina] = useState<City | null>(null);
  const [fromYou, setFromYou] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- storage is only readable in the browser */
    setCurrent(loadCity());
    setFromYou(new URLSearchParams(window.location.search).get("from") === "you");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Search as they type, a moment after they stop.
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const found = await findCities(query);
      if (live) {
        setResults(found);
        setSearching(false);
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  function keep(city: City) {
    saveCity(city);
    saveCityToDb(city);
    try {
      // A new city means distances start from that city, not an old area.
      sessionStorage.removeItem("feta.origin");
    } catch {
      // Nothing to clear.
    }
  }

  function choose(city: City) {
    if (isMainlandChina(city)) {
      setChina(city);
      return;
    }
    keep(city);
    router.push(fromYou ? "/you" : "/questions");
  }

  function goBack() {
    if (china) setChina(null);
    else router.push(fromYou ? "/you" : "/sign-in");
  }

  if (china) {
    return (
      <main className={styles.screen}>
        <button type="button" className="back-btn" onClick={goBack} aria-label="Back">
          ‹
        </button>
        <div className={styles.step}>
          <div className="pulse-pin" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h1 className={styles.title}>
            {china.name} is <strong>chat only, for now.</strong>
          </h1>
          <p className={styles.sub}>
            Google Maps has very little in mainland China, so I can&apos;t check places properly and won&apos;t pretend to. You can still ask me in
            chat for ideas there; they&apos;ll be less reliable than usual. Hong Kong works as normal.
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              keep(china);
              router.push(`/ask?q=${encodeURIComponent(`Ideas for ${china.name}`)}`);
            }}
          >
            Ask Feta about {china.name}
          </button>
          <button type="button" className={styles.secondary} onClick={() => setChina(null)}>
            Choose another city
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <button type="button" className="back-btn" onClick={goBack} aria-label="Back">
        ‹
      </button>
      <div className={styles.step}>
        <h1 className={styles.title}>
          Which <strong>city?</strong>
        </h1>
        <p className={styles.sub}>
          Anywhere in the world. So prices and picks fit where you are; your exact spot comes later, only if you want.
        </p>
        <input
          className={styles.search}
          type="search"
          placeholder="Type a city, e.g. Lisbon"
          aria-label="Type a city"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearching(e.target.value.trim().length >= 2);
          }}
        />
        <ul className={styles.list}>
          {!query.trim() && current && (
            <li>
              <button type="button" className={styles.row} onClick={() => choose(current)}>
                <span>
                  {current.name} <span className={styles.region}>· {current.countryName}</span>
                </span>
                <span className={`${styles.note} ${styles.current}`}>Current</span>
              </button>
            </li>
          )}
          {results.map((city) => (
            <li key={city.id}>
              <button type="button" className={styles.row} onClick={() => choose(city)}>
                <span>
                  {city.name}
                  {city.matched && <span className={styles.region}> ({city.matched})</span>}{" "}
                  <span className={styles.region}>· {[city.region !== city.name ? city.region : "", city.countryName].filter(Boolean).join(", ")}</span>
                </span>
                <span className={styles.note}>{city.id === current?.id ? "Current" : "›"}</span>
              </button>
            </li>
          ))}
          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <li className={styles.empty}>No city by that name. Try the nearest bigger town, or check the spelling.</li>
          )}
        </ul>
      </div>
    </main>
  );
}
