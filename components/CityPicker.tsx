"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { loadCity, nearestCovered, saveCity, searchCities, type City } from "@/lib/cities";
import { saveCityInterest, saveCityToDb } from "@/lib/db";
import styles from "./CityPicker.module.css";

// Right after sign-in: which city the user is in. No location popup here;
// the exact spot is asked for once, just before the picks.
export default function CityPicker() {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<City | null>(null);
  const [notCovered, setNotCovered] = useState<City | null>(null);
  const [suggestion, setSuggestion] = useState<City | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable in the browser
    setCurrent(loadCity());
  }, []);

  const results = searchCities(query);

  function choose(city: City) {
    if (!city.covered) {
      setNotCovered(city);
      setSuggestion(nearestCovered(city)[0].city);
      return;
    }
    saveCity(city);
    saveCityToDb(city);
    router.push("/questions");
  }

  function goBack() {
    if (notCovered) setNotCovered(null);
    else router.push("/sign-in");
  }

  if (notCovered && suggestion) {
    return (
      <main className={styles.screen}>
        <button type="button" className="back-btn" onClick={goBack} aria-label="Back">
          ‹
        </button>
        <div className={styles.step}>
          <div className={styles.pin} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h1 className={styles.title}>
            We&apos;re not in <strong>{notCovered.name} yet.</strong>
          </h1>
          <p className={styles.sub}>I&apos;d rather say so than guess. Closest cities we cover:</p>
          <div className={styles.nearby}>
            {nearestCovered(notCovered).map(({ city, km }) => (
              <button
                key={city.id}
                type="button"
                aria-pressed={city.id === suggestion.id}
                className={`${styles.nearbyChip} ${city.id === suggestion.id ? styles.nearbyOn : ""}`}
                onClick={() => setSuggestion(city)}
              >
                {city.name} · {km} km
              </button>
            ))}
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className="btn-primary" onClick={() => choose(suggestion)}>
            Show me {suggestion.name}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              saveCityInterest(notCovered);
              toast(`Noted. We'll tell you when we're in ${notCovered.name}.`);
            }}
          >
            Tell me when you&apos;re in {notCovered.name}
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
          So prices and picks fit where you are. Your exact spot comes later, only if you want.
        </p>
        <input
          className={styles.search}
          type="search"
          placeholder="Search a city"
          aria-label="Search a city"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className={styles.list}>
          {results.map((city) => (
            <li key={city.id}>
              <button type="button" className={styles.row} onClick={() => choose(city)}>
                <span>
                  {city.name} <span className={styles.region}>· {city.region}</span>
                </span>
                {city.id === current?.id ? (
                  <span className={`${styles.note} ${styles.current}`}>Current</span>
                ) : (
                  <span className={styles.note}>{city.covered ? "›" : "Not yet"}</span>
                )}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className={styles.empty}>
              We don&apos;t know that one yet. Try the nearest big city.
            </li>
          )}
        </ul>
      </div>
    </main>
  );
}
