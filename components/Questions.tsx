"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EMPTY_ANSWERS,
  QUESTIONS,
  loadAnswers,
  optionsFor,
  saveAnswers,
  type Answers,
  type Question,
} from "@/lib/onboarding";
import { loadCity } from "@/lib/cities";
import { detectCurrency, type Currency } from "@/lib/currency";
import { saveAnswersToDb } from "@/lib/db";
import styles from "./Questions.module.css";

function isAnswered(q: Question, answers: Answers) {
  const value = answers[q.id];
  return Array.isArray(value) ? value.length > 0 : value !== null;
}

export default function Questions() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [currency, setCurrency] = useState<Currency>("INR");
  const [fromYou, setFromYou] = useState(false);

  // Bring back answers from an earlier visit on this phone, and use the
  // chosen city's currency (or a guess from the time zone if none yet).
  // Both are only readable in the browser.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setAnswers(loadAnswers());
    setCurrency(loadCity()?.currency ?? detectCurrency());
    setFromYou(new URLSearchParams(window.location.search).get("from") === "you");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const question = QUESTIONS[index];
  const answered = isAnswered(question, answers);
  const isLast = index === QUESTIONS.length - 1;

  function update(next: Answers) {
    setAnswers(next);
    saveAnswers(next);
  }

  function toggle(q: Question, optionId: string) {
    const value = answers[q.id];
    if (!q.multi) {
      const picked = value === optionId ? null : optionId;
      const spendCurrency = q.id === "spend" ? (picked ? currency : null) : answers.spendCurrency;
      update({ ...answers, [q.id]: picked, spendCurrency });
      return;
    }
    const current = value as string[];
    if (current.includes(optionId)) {
      update({ ...answers, [q.id]: current.filter((id) => id !== optionId) });
    } else if (!q.max || current.length < q.max) {
      update({ ...answers, [q.id]: [...current, optionId] });
    }
  }

  function goNext() {
    saveAnswersToDb(answers);
    if (isLast) router.push(fromYou ? "/you" : "/swipes");
    else setIndex(index + 1);
  }

  function goBack() {
    if (index === 0) router.push(fromYou ? "/you" : "/city");
    else setIndex(index - 1);
  }

  return (
    <main className={styles.screen}>
      <div className={styles.header}>
        <button type="button" className="back-btn" onClick={goBack} aria-label="Back">
          ‹
        </button>
        <div className={styles.bars} aria-hidden="true">
          {QUESTIONS.map((q, i) => (
            <span key={q.id} className={styles.bar}>
              <span
                className={styles.barFill}
                style={{ width: i < index ? "100%" : i === index ? (answered ? "100%" : "30%") : "0%" }}
              />
            </span>
          ))}
        </div>
        <button type="button" className={styles.skip} onClick={goNext}>
          Skip
        </button>
      </div>

      {QUESTIONS.map((q, i) => {
        const offset = i - index;
        const value = answers[q.id];
        const selectedCount = Array.isArray(value) ? value.length : 0;
        return (
          <section
            key={q.id}
            className={styles.pane}
            aria-hidden={offset !== 0}
            inert={offset !== 0}
            style={{
              transform: `translateX(${offset * 100}%)`,
              opacity: offset === 0 ? 1 : 0,
            }}
          >
            <div className={styles.counter}>
              {String(i + 1).padStart(2, "0")} / {String(QUESTIONS.length).padStart(2, "0")}
            </div>
            <h1 className={styles.title}>{q.title}</h1>
            <p className={styles.why}>{q.why}</p>

            <div className={styles.chips} role="group" aria-label={q.title}>
              {optionsFor(q, currency).map((option) => {
                const on = Array.isArray(value) ? value.includes(option.id) : value === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={on}
                    className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                    onClick={() => toggle(q, option.id)}
                  >
                    <span className={styles.check} aria-hidden="true">
                      ✓
                    </span>
                    {option.label}
                  </button>
                );
              })}
            </div>

            {q.halal && (
              <button
                type="button"
                role="switch"
                aria-checked={answers.halal}
                className={styles.halal}
                onClick={() => update({ ...answers, halal: !answers.halal })}
              >
                Halal only
                <span className={`switch ${answers.halal ? "on" : ""}`} />
              </button>
            )}

            {(q.multi || q.max) && (
              <p className={styles.hint}>
                {q.max ? `${selectedCount} of ${q.max} picked` : "Pick as many as you like."}
              </p>
            )}
          </section>
        );
      })}

      <button
        type="button"
        className={`btn-primary ${styles.next}`}
        disabled={!answered}
        onClick={goNext}
      >
        {isLast ? (fromYou ? "Save my answers" : "Start swiping") : "Continue"}
      </button>
    </main>
  );
}
