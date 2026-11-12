"use client";

import { useEffect, useRef, useState } from "react";
import { locateArea, newAreaSession, suggestAreas, type AreaSuggestion } from "@/lib/area-client";
import type { City } from "@/lib/cities";
import { categoryOf, saveBeen, VERDICTS, VISITS, type Verdict, type Visits } from "@/lib/my-places";
import styles from "./AddPlace.module.css";

// "Add a place you've been": find it (Google suggestions near the city),
// then how often and how it was, and a note in their own words. Feta learns
// from it and never suggests it as a new pick.
export type AddedPlace = { placeId: string; name: string; detail: string; visits: Visits; verdict: Verdict; note: string };

export default function AddPlace({ city, onClose, onAdded }: { city: City; onClose: () => void; onAdded: (place: AddedPlace) => void }) {
  const [typed, setTyped] = useState("");
  const [suggestions, setSuggestions] = useState<AreaSuggestion[]>([]);
  const [chosen, setChosen] = useState<AreaSuggestion | null>(null);
  const [visits, setVisits] = useState<Visits | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const session = useRef("");

  // Suggestions as they type, a moment after they stop.
  useEffect(() => {
    if (chosen || typed.trim().length < 3) return;
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
  }, [typed, city, chosen]);

  function choose(s: AreaSuggestion) {
    setChosen(s);
    // Ends Google's suggestion session (keeps the suggestions free).
    locateArea(s.placeId, session.current);
    session.current = "";
  }

  async function save() {
    if (!chosen || !verdict) return;
    setSaving(true);
    const ok = await saveBeen(chosen.placeId, { visits: visits ?? "once", verdict, note, category: categoryOf(chosen.types), cityId: city.id });
    setSaving(false);
    if (ok) onAdded({ placeId: chosen.placeId, name: chosen.name, detail: chosen.detail, visits: visits ?? "once", verdict, note: note.trim() });
  }

  return (
    <>
      <div className={styles.dim} onClick={onClose} />
      <div className={styles.sheet} role="dialog" aria-label="Add a place you've been">
        <h2 className={styles.title}>
          A place <strong>you&apos;ve been</strong>
        </h2>
        {!chosen ? (
          <>
            <p className={styles.sub}>Your favourites, your regulars, or ones that weren&apos;t for you. Feta learns from all of them.</p>
            <input
              className={styles.search}
              type="search"
              autoFocus
              autoComplete="off"
              placeholder={`A café, bar or place in ${city.name}`}
              aria-label="Find a place"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                if (e.target.value.trim().length < 3) setSuggestions([]);
              }}
            />
            {suggestions.length > 0 && typed.trim().length >= 3 && (
              <>
                <ul className={styles.suggestions}>
                  {suggestions.map((s) => (
                    <li key={s.placeId}>
                      <button type="button" onClick={() => choose(s)}>
                        <strong>{s.name}</strong>
                        <span>{s.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className={styles.powered}>Suggestions from Google</p>
              </>
            )}
          </>
        ) : (
          <>
            <p className={styles.chosen}>
              <strong>{chosen.name}</strong>
              <button type="button" onClick={() => setChosen(null)}>
                Change
              </button>
            </p>
            <p className={styles.label}>HOW WAS IT?</p>
            <div className={styles.chips}>
              {VERDICTS.map((v) => (
                <button key={v.id} type="button" className={verdict === v.id ? styles.on : ""} onClick={() => setVerdict(v.id)}>
                  {v.label}
                </button>
              ))}
            </div>
            <p className={styles.label}>HOW OFTEN?</p>
            <div className={styles.chips}>
              {VISITS.map((v) => (
                <button key={v.id} type="button" className={visits === v.id ? styles.on : ""} onClick={() => setVisits(v.id)}>
                  {v.label}
                </button>
              ))}
            </div>
            <textarea
              className={styles.note}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={verdict === "not_for_me" ? "What didn't work? e.g. too loud, pricey" : "What do you love? e.g. the ghee roast, sit upstairs"}
              aria-label="Your note"
              maxLength={300}
            />
            <button type="button" className="btn-primary" disabled={!verdict || saving} onClick={save}>
              {saving ? "Saving…" : "Add to my places"}
            </button>
          </>
        )}
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
