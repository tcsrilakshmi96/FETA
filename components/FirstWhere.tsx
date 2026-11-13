"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { cityAt, findCities, isMainlandChina, saveCity, type City } from "@/lib/cities";
import { saveCityToDb, saveLocationConsent } from "@/lib/db";
import { originFromCity, originFromGps, saveOrigin } from "@/lib/origin";
import styles from "./Setup.module.css";

// The last setup step (Anj's flow: location once people know why): where
// Feta should look. Their location (one-time, never stored; the city
// follows it), or a city typed in, say for a trip. An exact area can be
// chosen later from the area pill on Home.
export default function FirstWhere() {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<(City & { matched?: string })[]>([]);
  const [finding, setFinding] = useState(false);
  const [china, setChina] = useState<City | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const found = await findCities(query);
      if (live) setResults(found);
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  function keep(city: City) {
    saveCity(city);
    saveCityToDb(city);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast("Location isn't available here. Type your city instead.");
      return;
    }
    setFinding(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        saveLocationConsent(true);
        const point = { lat: coords.latitude, lng: coords.longitude };
        const here = await cityAt(point);
        setFinding(false);
        if (!here) {
          toast("Couldn't work out which city you're in. Type it instead.");
          return;
        }
        keep(here);
        if (isMainlandChina(here)) {
          setChina(here);
          return;
        }
        saveOrigin(originFromGps(point.lat, point.lng, here));
        router.push("/home");
      },
      (error) => {
        setFinding(false);
        toast(error.code === error.PERMISSION_DENIED ? "Location is off. Type your city instead." : "Couldn't find you just now. Try again, or type your city.");
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    );
  }

  function choose(city: City) {
    keep(city);
    if (isMainlandChina(city)) {
      setChina(city);
      return;
    }
    saveOrigin(originFromCity(city));
    router.push("/home");
  }

  if (china) {
    return (
      <main className={styles.screen}>
        <h1 className={styles.title}>
          {china.name} is <strong>chat only, for now.</strong>
        </h1>
        <p className={styles.sub}>
          Google Maps has very little in mainland China, so I can&apos;t check places properly and won&apos;t pretend to. You can still ask me for ideas; they&apos;re marked less reliable.
        </p>
        <div className={styles.grow} />
        <button type="button" className="btn-primary" onClick={() => router.push(`/ask?q=${encodeURIComponent(`Ideas for ${china.name}`)}`)}>
          Ask Feta about {china.name}
        </button>
        <button type="button" className={styles.ghost} onClick={() => setChina(null)}>
          Choose another city
        </button>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <p className={styles.kick}>Last thing</p>
      <h1 className={styles.title} style={{ marginTop: 8 }}>
        Where should Feta <strong>look?</strong>
      </h1>
      <p className={styles.sub}>Usually right where you are. Planning a trip? Type that city instead.</p>
      <button type="button" className={styles.bigopt} onClick={useMyLocation} disabled={finding}>
        <span className={styles.pin} aria-hidden="true">
          ◎
        </span>
        <span>
          <strong>{finding ? "Finding you…" : "Use my location"}</strong>
          <small>Only while you use Feta. Never stored.</small>
        </span>
      </button>
      <p className={styles.or}>or</p>
      <input
        className={styles.field}
        type="search"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type a city, e.g. Mumbai, Lisbon"
        aria-label="A city"
      />
      {results.length > 0 && (
        <ul className={styles.suggestions}>
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => choose(c)}>
                {c.name}
                <small>
                  {[c.matched && `“${c.matched}”`, c.region, c.countryName].filter(Boolean).join(" · ")}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.hint}>You can pick an exact area later from Home.</p>
    </main>
  );
}
