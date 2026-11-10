"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { coveredCityAt, loadCity, nearestCovered, saveCity, type Area, type City } from "@/lib/cities";
import { saveCityToDb, saveLocationConsent } from "@/lib/db";
import { originFromArea, originFromCity, originFromGps, saveOrigin } from "@/lib/origin";
import styles from "./Location.module.css";

type State = "ask" | "finding" | "denied" | "far";

// Just before the picks: one-time location while the app is open, or an
// area in the chosen city. The browser's own prompt appears only on tap.
export default function Location() {
  const router = useRouter();
  const toast = useToast();
  const [city, setCity] = useState<City | null>(null);
  const [state, setState] = useState<State>("ask");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [area, setArea] = useState<Area | null>(null);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [suggestion, setSuggestion] = useState<City | null>(null);

  useEffect(() => {
    const saved = loadCity();
    if (!saved) {
      router.replace("/city");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the city is only readable in the browser
    setCity(saved);
  }, [router]);

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
      ({ coords }) => {
        saveLocationConsent(true);
        const point = { lat: coords.latitude, lng: coords.longitude };
        const covered = coveredCityAt(point);
        if (!covered) {
          setHere(point);
          setSuggestion(nearestCovered(point)[0].city);
          setState("far");
          return;
        }
        if (covered.id !== city?.id) {
          switchCity(covered);
          toast(`You're in ${covered.name}, so picks are from here.`);
        }
        saveOrigin(originFromGps(point.lat, point.lng, covered));
        router.push("/picks");
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) setState("denied");
        else {
          setState("ask");
          toast("Couldn't find you just now. Try again, or pick an area.");
        }
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    );
  }

  function showPicksIn(target: City, chosen: Area | null) {
    if (target.id !== city?.id) switchCity(target);
    saveOrigin(chosen ? originFromArea(chosen, target) : originFromCity(target));
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

      {(state === "ask" || state === "finding") && (
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

      {state === "denied" && (
        <div className={styles.body}>
          <h1 className={styles.title}>
            Location is off. <strong>That&apos;s fine.</strong>
          </h1>
          <p className={styles.lines}>
            Pick an area in {city.name} instead. You can turn location on later in your phone&apos;s settings.
          </p>
        </div>
      )}

      {state === "far" && suggestion && here && (
        <div className={styles.body}>
          <h1 className={styles.title}>
            We&apos;re not <strong>near you yet.</strong>
          </h1>
          <p className={styles.lines}>I&apos;d rather say so than guess. Closest cities we cover:</p>
          <div className={styles.nearby}>
            {nearestCovered(here).map(({ city: c, km }) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={c.id === suggestion.id}
                className={`${styles.chip} ${c.id === suggestion.id ? styles.chipOn : ""}`}
                onClick={() => setSuggestion(c)}
              >
                {c.name} · {km} km
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.actions}>
        {state === "ask" || state === "finding" ? (
          <>
            <button type="button" className="btn-primary" disabled={state === "finding"} onClick={useMyLocation}>
              {state === "finding" ? "Finding you…" : "Use my location"}
            </button>
            <button type="button" className={styles.secondary} onClick={() => setSheetOpen(true)}>
              Pick an area instead
            </button>
          </>
        ) : state === "denied" ? (
          <>
            <button type="button" className="btn-primary" onClick={() => setSheetOpen(true)}>
              Pick an area
            </button>
            <button type="button" className={styles.secondary} onClick={useMyLocation}>
              Try location again
            </button>
          </>
        ) : (
          suggestion && (
            <>
              <button type="button" className="btn-primary" onClick={() => showPicksIn(suggestion, null)}>
                Show me {suggestion.name}
              </button>
              <button type="button" className={styles.secondary} onClick={() => setSheetOpen(true)}>
                Pick an area in {city.name}
              </button>
            </>
          )
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
            <p className={styles.sheetSub}>Pick an area so distances make sense. You can change it any time.</p>
            <div className={styles.areas}>
              {(city.areas ?? []).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={area?.id === a.id}
                  className={`${styles.area} ${area?.id === a.id ? styles.areaOn : ""}`}
                  onClick={() => setArea(area?.id === a.id ? null : a)}
                >
                  {a.name}
                </button>
              ))}
            </div>
            <div className={styles.sheetActions}>
              <button type="button" className="btn-primary" disabled={!area} onClick={() => showPicksIn(city, area)}>
                {area ? `Show picks in ${area.name}` : "Pick an area"}
              </button>
              <button type="button" className={styles.link} onClick={() => showPicksIn(city, null)}>
                Anywhere in {city.name}
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
