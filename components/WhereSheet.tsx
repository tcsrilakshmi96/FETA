"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LocationOff from "@/components/LocationOff";
import { useToast } from "@/components/Toast";
import { findCities, isMainlandChina, saveCity, type City } from "@/lib/cities";
import { locateArea, newAreaSession, suggestAreas, type AreaSuggestion } from "@/lib/area-client";
import { saveCityToDb } from "@/lib/db";
import { locateMe } from "@/lib/near-me";
import { originFromArea, originFromCity, saveOrigin, type Origin } from "@/lib/origin";
import sheet from "./Sheet.module.css";
import styles from "./WhereSheet.module.css";

// One "Where" sheet, from Home's area, the picks list and You → City
// (tester, 26 Nov 2026: "couldn't find where to change location; profile
// took me back to onboarding"; founder's yes, 27 Nov 2026): Near me, one
// search for any city in the world or an area in this one, and the cities
// used before. A city chosen is "Anywhere in <city>" at once, with its
// areas as an optional second step. First-time setup keeps its own screen.
const RECENT_KEY = "feta.recentCities";

function recentCities(): City[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as City[]).filter((c) => c?.id && c.timeZone);
  } catch {
    return [];
  }
}

function remember(city: City) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([city, ...recentCities().filter((c) => c.id !== city.id)].slice(0, 4)));
  } catch {
    // Just not listed next time.
  }
}

export default function WhereSheet({ origin, onChange, onClose }: { origin: Origin; onChange: (o: Origin) => void; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  // The city whose areas are searched: theirs, or one just chosen here.
  const [city, setCity] = useState<City>(origin.city);
  const [justChose, setJustChose] = useState(false);
  const [typed, setTyped] = useState("");
  const [cities, setCities] = useState<(City & { matched?: string })[]>([]);
  const [areas, setAreas] = useState<AreaSuggestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [recent] = useState(() => recentCities().filter((c) => c.id !== origin.city.id).slice(0, 3));
  const session = useRef("");
  const input = useRef<HTMLInputElement>(null);
  const [off, setOff] = useState(false);

  // Cities anywhere in the world (Feta's own list, free) and, from 3
  // letters, areas in this city (Google's suggestions).
  useEffect(() => {
    const q = typed.trim();
    if (q.length < 2) return;
    let live = true;
    const t = setTimeout(async () => {
      session.current ||= newAreaSession();
      const [c, a] = await Promise.all([justChose ? Promise.resolve([]) : findCities(q), q.length >= 3 ? suggestAreas(q, city, session.current) : Promise.resolve([])]);
      if (!live) return;
      setCities(c.slice(0, 4));
      setAreas(a.slice(0, 5));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [typed, city, justChose]);

  function done(o: Origin) {
    saveOrigin(o);
    onChange(o);
  }

  async function nearMe() {
    setBusy("near");
    const found = await locateMe(origin.city);
    setBusy(null);
    if (found === "off") return setOff(true);
    if (found === "nocity" || found === "failed") return toast(found === "nocity" ? "Couldn't work out which city you're in. Search an area instead." : "Couldn't find you just now. Try again, or search an area.");
    if ("china" in found) return router.push(`/ask?q=${encodeURIComponent(`Ideas near me in ${found.china.name}`)}`);
    remember(found.origin.city);
    if (found.movedTo) toast(`You're in ${found.movedTo}, so picks are from here.`);
    done(found.origin);
    onClose();
  }

  function chooseCity(next: City) {
    if (isMainlandChina(next)) {
      saveCity(next);
      saveCityToDb(next);
      return router.push(`/ask?q=${encodeURIComponent(`Ideas for ${next.name}`)}`);
    }
    if (next.id !== origin.city.id) {
      saveCity(next);
      saveCityToDb(next);
    }
    remember(next);
    done(originFromCity(next));
    // Anywhere in it straight away; an area is the optional next step.
    setCity(next);
    setJustChose(true);
    setTyped("");
    setCities([]);
    setAreas([]);
  }

  async function chooseArea(s: AreaSuggestion) {
    setBusy(s.placeId);
    const at = await locateArea(s.placeId, session.current);
    session.current = "";
    setBusy(null);
    if (!at) return toast("Couldn't find that spot just now. Try again, or keep anywhere in the city.");
    // "Kreuzberg, Friedrichshain-Kreuzberg" reads as "Kreuzberg" on the pill.
    remember(city);
    done(originFromArea({ placeId: s.placeId, name: s.name.split(",")[0].trim().slice(0, 40), ...at }, city));
    onClose();
  }

  function anywhereHere() {
    if (origin.source !== "city") done(originFromCity(origin.city));
    onClose();
  }

  const q = typed.trim();
  return (
    <>
      <div className={sheet.dim} onClick={onClose} />
      <div className={sheet.sheet} role="dialog" aria-label="Where are you?">
        <div className={styles.head}>
          <h2 className={sheet.title}>{justChose ? <>Anywhere in <strong>{city.name}</strong></> : <>Where <strong>are you?</strong></>}</h2>
          <button type="button" className={styles.close} onClick={onClose}>
            {justChose ? "Done" : "Close"}
          </button>
        </div>
        {justChose && <p className={sheet.sub}>Picks are from all of {city.name} now. Pick an area too, so distances make sense?</p>}

        {!justChose && (
          <button type="button" className={styles.row} disabled={!!busy} onClick={nearMe}>
            <span className={styles.icon} aria-hidden="true">◎</span>
            <span className={styles.text}>
              <strong>Near me</strong>
              <span>{busy === "near" ? "Finding you…" : "Uses your location now, never kept"}</span>
            </span>
          </button>
        )}

        <input
          ref={input}
          className={styles.input}
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder={justChose ? `An area or landmark in ${city.name}` : "Search any city, or an area here"}
          aria-label={justChose ? `An area in ${city.name}` : "Search any city or area"}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (e.target.value.trim().length < 2) {
              setCities([]);
              setAreas([]);
            }
          }}
        />

        {q.length >= 2 && (
          <ul className={styles.list}>
            {cities.map((c) => (
              <li key={c.id}>
                <button type="button" className={styles.row} disabled={!!busy} onClick={() => chooseCity(c)}>
                  <span className={styles.icon} aria-hidden="true">{c.name[0]}</span>
                  <span className={styles.text}>
                    <strong>
                      {c.name}
                      {c.matched && ` (${c.matched})`}
                    </strong>
                    <span>{[c.region !== c.name ? c.region : "", c.countryName].filter(Boolean).join(", ")} · anywhere in the city</span>
                  </span>
                </button>
              </li>
            ))}
            {areas.map((s) => (
              <li key={s.placeId}>
                <button type="button" className={styles.row} disabled={!!busy} onClick={() => chooseArea(s)}>
                  <span className={styles.icon} aria-hidden="true">📍</span>
                  <span className={styles.text}>
                    <strong>{s.name}</strong>
                    <span>{busy === s.placeId ? "Finding it…" : s.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {areas.length > 0 && q.length >= 3 && <p className={styles.powered}>Area suggestions from Google</p>}

        {!justChose && q.length < 2 && (
          <ul className={styles.list}>
            <li>
              <button type="button" className={styles.row} onClick={anywhereHere}>
                <span className={styles.icon} aria-hidden="true">{origin.city.name[0]}</span>
                <span className={styles.text}>
                  <strong>{origin.city.name}</strong>
                  <span>{origin.source === "city" ? "Anywhere in the city · now" : "Anywhere in the city"}</span>
                </span>
              </button>
            </li>
            {recent.map((c) => (
              <li key={c.id}>
                <button type="button" className={styles.row} onClick={() => chooseCity(c)}>
                  <span className={styles.icon} aria-hidden="true">{c.name[0]}</span>
                  <span className={styles.text}>
                    <strong>{c.name}</strong>
                    <span>Used before</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {off && (
        <LocationOff
          onClose={() => setOff(false)}
          onRetry={() => {
            setOff(false);
            nearMe();
          }}
          onArea={() => {
            setOff(false);
            input.current?.focus();
          }}
        />
      )}
    </>
  );
}
