"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { cityAt, isMainlandChina, loadCity, saveCity, type City } from "@/lib/cities";
import { locateArea, newAreaSession, suggestAreas, type AreaSuggestion } from "@/lib/area-client";
import { saveCityToDb, saveLocationConsent } from "@/lib/db";
import { originFromArea, originFromCity, originFromGps, saveOrigin } from "@/lib/origin";
import styles from "./Location.module.css";

type State = "ask" | "finding" | "denied";

// Just before the picks: one-time location while the app is open, or a
// typed neighbourhood or landmark, or anywhere in the city. The browser's
// own prompt appears only on tap.
export default function Location() {
  const router = useRouter();
  const toast = useToast();
  const [city, setCity] = useState<City | null>(null);
  const [state, setState] = useState<State>("ask");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [suggestions, setSuggestions] = useState<AreaSuggestion[]>([]);
  const [choosing, setChoosing] = useState<string | null>(null);
  const session = useRef("");

  useEffect(() => {
    const saved = loadCity();
    if (!saved) {
      router.replace("/city");
      return;
    }
    // Next.js restores this screen as it was left when you come back to it,
    // so start fresh each time: no stuck "Finding you…", sheet closed.
    /* eslint-disable react-hooks/set-state-in-effect -- the city is only readable in the browser */
    setCity(saved);
    setState("ask");
    setSheetOpen(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [router]);

  // Suggestions as they type, a moment after they stop.
  useEffect(() => {
    if (!city || typed.trim().length < 3) return;
    let live = true;
    const t = setTimeout(async () => {
      session.current ||= newAreaSession();
      const found = await suggestAreas(typed.trim(), city, session.current);
      if (live) setSuggestions(found);
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [typed, city]);

  function switchCity(next: City) {
    saveCity(next);
    saveCityToDb(next);
    setCity(next);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setState("denied");
      return;
    }
    setState("finding");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        saveLocationConsent(true);
        const point = { lat: coords.latitude, lng: coords.longitude };
        // Wherever you are, picks come from there; the city follows you.
        const here = (await cityAt(point)) ?? city;
        if (!here) {
          setState("ask");
          toast("Couldn't work out which city you're in. Type an area instead.");
          return;
        }
        if (here.id !== city?.id) {
          switchCity(here);
          toast(`You're in ${here.name}, so picks are from here.`);
        }
        if (isMainlandChina(here)) {
          router.push(`/ask?q=${encodeURIComponent(`Ideas near me in ${here.name}`)}`);
          return;
        }
        saveOrigin(originFromGps(point.lat, point.lng, here));
        router.push("/picks");
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) setState("denied");
        else {
          setState("ask");
          toast("Couldn't find you just now. Try again, or type an area.");
        }
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    );
  }

  async function chooseArea(s: AreaSuggestion) {
    if (!city) return;
    setChoosing(s.placeId);
    const at = await locateArea(s.placeId, session.current);
    session.current = "";
    setChoosing(null);
    if (!at) {
      toast("Couldn't find that spot just now. Try again, or pick anywhere in the city.");
      return;
    }
    // "Kreuzberg, Friedrichshain-Kreuzberg" reads as "Kreuzberg" on the pill.
    saveOrigin(originFromArea({ placeId: s.placeId, name: s.name.split(",")[0].trim().slice(0, 40), ...at }, city));
    router.push("/picks");
  }

  function anywhere() {
    if (!city) return;
    saveOrigin(originFromCity(city));
    router.push("/picks");
  }

  if (!city) return null;

  return (
    <main className={styles.screen}>
      <div className="pulse-pin" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      {state === "denied" ? (
        <div className={styles.body}>
          <h1 className={styles.title}>
            Location is off. <strong>That&apos;s fine.</strong>
          </h1>
          <p className={styles.lines}>
            Type an area in {city.name} instead. You can turn location on later in your phone&apos;s settings.
          </p>
        </div>
      ) : (
        <div className={styles.body}>
          <h1 className={styles.title}>
            Picks work best when I know <strong>where you are.</strong>
          </h1>
          <div className={styles.lines}>
            <p>Only used to find places near you.</p>
            <p>Never shown to anyone, never sold.</p>
            <p>Turn it off any time in You → Privacy.</p>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        {state === "denied" ? (
          <>
            <button type="button" className="btn-primary" onClick={() => setSheetOpen(true)}>
              Type an area
            </button>
            <button type="button" className={styles.secondary} onClick={useMyLocation}>
              Try location again
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-primary" disabled={state === "finding"} onClick={useMyLocation}>
              {state === "finding" ? "Finding you…" : "Use my location"}
            </button>
            <button type="button" className={styles.secondary} onClick={() => setSheetOpen(true)}>
              Type an area instead
            </button>
          </>
        )}
      </div>

      {sheetOpen && (
        <>
          <div className={styles.dim} onClick={() => setSheetOpen(false)} />
          <div className={styles.sheet} role="dialog" aria-label={`Where in ${city.name}?`}>
            <div className={styles.sheetHead}>
              <h2 className={styles.sheetTitle}>
                Where in <strong>{city.name}?</strong>
              </h2>
              <button type="button" className={styles.close} onClick={() => setSheetOpen(false)}>
                Close
              </button>
            </div>
            <p className={styles.sheetSub}>A neighbourhood or a landmark, so distances make sense.</p>
            <input
              className={styles.areaInput}
              type="search"
              autoComplete="off"
              placeholder="e.g. a neighbourhood, a station, your office"
              aria-label={`An area or landmark in ${city.name}`}
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                if (e.target.value.trim().length < 3) setSuggestions([]);
              }}
            />
            {suggestions.length > 0 && typed.trim().length >= 3 && (
              <ul className={styles.suggestions}>
                {suggestions.map((s) => (
                  <li key={s.placeId}>
                    <button type="button" disabled={!!choosing} onClick={() => chooseArea(s)}>
                      <strong>{s.name}</strong>
                      <span>{choosing === s.placeId ? "Finding it…" : s.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {suggestions.length > 0 && typed.trim().length >= 3 && <p className={styles.powered}>Suggestions from Google</p>}
            <div className={styles.sheetActions}>
              <button type="button" className="btn-primary" onClick={anywhere}>
                Anywhere in {city.name}
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
