"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { isSignedIn } from "@/lib/auth";
import { locateArea, newAreaSession, suggestAreas, type AreaSuggestion } from "@/lib/area-client";
import type { City } from "@/lib/cities";
import { categoryOf, saveBeen, VERDICTS, VISITS, type Verdict, type Visits } from "@/lib/my-places";
import styles from "./AddPlace.module.css";

// "Add a place you've been": find it (Google suggestions near the city),
// then how often and how it was, and a note in their own words. Feta learns
// from it and never suggests it as a new pick.
export type AddedPlace = { placeId: string; name: string; detail: string; visits: Visits; verdict: Verdict; note: string };

// recommending: from Favourites' "Recommend a place" (founder, 25 Nov 2026:
// "add a button where they can recommend and add a Feta pick themselves"):
// a place they love, shared with people of a similar taste, never their name.
export default function AddPlace({ city, onClose, onAdded, recommending = false }: { city: City; onClose: () => void; onAdded: (place: AddedPlace) => void; recommending?: boolean }) {
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [suggestions, setSuggestions] = useState<AreaSuggestion[]>([]);
  const [chosen, setChosen] = useState<AreaSuggestion | null>(null);
  const [visits, setVisits] = useState<Visits | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(recommending ? "loved" : null);
  const [note, setNote] = useState("");
  const [recommend, setRecommend] = useState<boolean | null>(recommending ? true : null); // Feta Favourites
  const [signedIn, setSignedIn] = useState(true);
  useEffect(() => {
    if (recommending) isSignedIn().then(setSignedIn);
  }, [recommending]);
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
    const ok = await saveBeen(chosen.placeId, { visits: visits ?? "once", verdict, note, category: categoryOf(chosen.types), cityId: city.id, ...(verdict === "loved" && recommend === true ? { recommend: true } : {}) });
    setSaving(false);
    // Never fail quietly (a missing database column once dropped these without a word).
    if (!ok) toast("Couldn't save that just now. Try again in a minute.");
    else onAdded({ placeId: chosen.placeId, name: chosen.name, detail: chosen.detail, visits: visits ?? "once", verdict, note: note.trim() });
  }

  return (
    <>
      <div className={styles.dim} onClick={onClose} />
      <div className={styles.sheet} role="dialog" aria-label={recommending ? "Recommend a place" : "Add a place you've been"}>
        <h2 className={styles.title}>
          {recommending ? (
            <>
              Recommend <strong>a place</strong>
            </>
          ) : (
            <>
              A place <strong>you&apos;ve been</strong>
            </>
          )}
        </h2>
        {!chosen ? (
          <>
            <p className={styles.sub}>
              {recommending
                ? "A place you love. Feta shows it to people with a taste like yours, never your name."
                : "Your favourites, your regulars, or ones that weren't for you. Feta learns from all of them."}
            </p>
            {recommending && !signedIn && <p className={styles.small}>It reaches other people once you&apos;re signed in with Google (You → Settings and privacy).</p>}
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
            {!recommending && (
              <>
                <p className={styles.label}>HOW WAS IT?</p>
                <div className={styles.chips}>
                  {VERDICTS.map((v) => (
                    <button key={v.id} type="button" className={verdict === v.id ? styles.on : ""} onClick={() => setVerdict(v.id)}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {verdict === "loved" && !recommending && (
              <>
                <p className={styles.label}>RECOMMEND IT TO PEOPLE LIKE YOU?</p>
                <div className={styles.chips}>
                  <button type="button" className={recommend === true ? styles.on : ""} onClick={() => setRecommend(true)}>
                    Yes, a Feta Favourite
                  </button>
                  <button type="button" className={recommend === false ? styles.on : ""} onClick={() => setRecommend(false)}>
                    Keep it to me
                  </button>
                </div>
                <p className={styles.small}>Only the place is shared with Feta users who have a similar taste, never your name.</p>
              </>
            )}
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
              placeholder={recommending ? "Why should people go? e.g. the ghee roast, sit upstairs" : verdict === "not_for_me" ? "What didn't work? e.g. too loud, pricey" : "What do you love? e.g. the ghee roast, sit upstairs"}
              aria-label="Your note"
              maxLength={300}
            />
            <button type="button" className="btn-primary" disabled={!verdict || saving} onClick={save}>
              {saving ? "Saving…" : recommending ? "Recommend it" : "Add to my places"}
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
