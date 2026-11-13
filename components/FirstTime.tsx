"use client";

import { useState } from "react";
import { loadCity } from "@/lib/cities";
import { detectCurrency } from "@/lib/currency";
import { saveAnswersToDb, saveProfileBasicsToDb, saveProfileLinesToDb, saveSwipesToDb } from "@/lib/db";
import { QUESTIONS, loadAnswers, saveAnswers } from "@/lib/onboarding";
import { loadName, loadWants, saveWants, type Want } from "@/lib/profile";
import { MAX_CUISINES, cuisinesFor, loadSwipes, pickedUpLines, saveProfileLines, saveSwipes, type ProfileLine } from "@/lib/swipes";
import styles from "./Sheet.module.css";

// The first time someone opens a category they didn't pick at setup, its
// few questions, once (founder, 14 Nov 2026). Then it counts as one they
// want, and Home and the picks follow their answers.
export default function FirstTime({ want, onDone, onClose }: { want: "food" | "do"; onDone: () => void; onClose: () => void }) {
  const food = want === "food";
  const [answers, setAnswers] = useState(loadAnswers);
  const [cuisines, setCuisines] = useState<string[]>(() => loadSwipes().filter((s) => s.cardId.startsWith("cuisine_") && s.verdict === "yes").map((s) => s.cardId.slice(8)));
  const [own, setOwn] = useState("");
  const city = loadCity();
  const veg = ["vegetarian", "vegetarian_eggs", "jain", "vegan"].includes(answers.diet ?? "");
  const options = cuisinesFor(city?.country, veg);

  function save() {
    saveAnswers(answers);
    saveAnswersToDb(answers);
    const swipes = food
      ? [...loadSwipes().filter((s) => !s.cardId.startsWith("cuisine_")), ...options.map((c) => ({ cardId: `cuisine_${c.id}`, verdict: cuisines.includes(c.id) ? ("yes" as const) : ("no" as const) }))]
      : loadSwipes();
    if (food) {
      saveSwipes(swipes);
      saveSwipesToDb(swipes);
    }
    const lines: ProfileLine[] = [
      ...pickedUpLines(answers, swipes, city?.currency ?? detectCurrency(), city?.country),
      ...(own.trim() ? [{ id: food ? "food_other" : "loves_other", text: `${food ? "Also loves" : "Loves"} ${own.trim().slice(0, 100)}`, source: "answers" as const }] : []),
    ];
    saveProfileLines(lines);
    saveProfileLinesToDb(lines, []);
    const wants = [...new Set<Want>([...loadWants(), want])];
    saveWants(wants);
    saveProfileBasicsToDb(loadName(), wants);
    onDone();
  }

  const diet = QUESTIONS.find((q) => q.id === "diet")!;
  const interests = QUESTIONS.find((q) => q.id === "interests")!;
  return (
    <>
      <div className={styles.dim} onClick={onClose} />
      <div className={styles.sheet} role="dialog" aria-label={food ? "Food questions" : "Things to do questions"}>
        <p className={styles.kick}>First time here</p>
        <h2 className={styles.title}>{food ? <>Two quick ones, <strong>so the food fits</strong></> : <>What are <strong>you into?</strong></>}</h2>
        <p className={styles.sub}>Only this once. Feta remembers.</p>
        {food ? (
          <>
            <p className={styles.label}>What do you eat?</p>
            <div className={styles.chips}>
              {diet.options.map((o) => (
                <button key={o.id} type="button" className={answers.diet === o.id ? styles.on : ""} onClick={() => setAnswers({ ...answers, diet: o.id })}>
                  {o.label}
                </button>
              ))}
            </div>
            <p className={styles.label}>Favourite food · up to {MAX_CUISINES}</p>
            <div className={styles.chips}>
              {options.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={cuisines.includes(c.id) ? styles.on : ""}
                  onClick={() => setCuisines(cuisines.includes(c.id) ? cuisines.filter((x) => x !== c.id) : cuisines.length < MAX_CUISINES ? [...cuisines, c.id] : cuisines)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className={styles.chips} style={{ marginTop: 16 }}>
            {interests.options.map((o) => (
              <button
                key={o.id}
                type="button"
                className={answers.interests.includes(o.id) ? styles.on : ""}
                onClick={() => setAnswers({ ...answers, interests: answers.interests.includes(o.id) ? answers.interests.filter((x) => x !== o.id) : [...answers.interests, o.id] })}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        <input className={styles.field} value={own} onChange={(e) => setOwn(e.target.value)} placeholder={food ? "Anything else? e.g. Burmese, Parsi" : "Anything else? In your own words"} aria-label="Anything else" maxLength={100} />
        <button type="button" className={`btn-primary ${styles.go}`} onClick={save}>
          Show me places
        </button>
      </div>
    </>
  );
}
