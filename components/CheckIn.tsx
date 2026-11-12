"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { markAsked, nextCheckin, placeName, saveBeen, VERDICTS, type Verdict } from "@/lib/my-places";
import { loadAnswers } from "@/lib/onboarding";
import styles from "./CheckIn.module.css";

// "How was it?" on Home, a day or more after saving a place: Loved it /
// It was fine / Not for me / Haven't been yet. Jain, vegan and halal users
// also get "Did it work for your diet?" (counted, never a promise).
export default function CheckIn() {
  const toast = useToast();
  const [ask, setAsk] = useState<{ placeId: string; name: string; category: string | null } | null>(null);
  const [step, setStep] = useState<"how" | "diet">("how");

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const next = await nextCheckin();
      if (!next || !live) return;
      const name = await placeName(next.placeId);
      if (name && live) setAsk({ ...next, name });
    }, 1500);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, []);

  if (!ask) return null;
  const answers = loadAnswers();
  const dietName = answers.diet === "jain" ? "Jain" : answers.diet === "vegan" ? "vegan" : answers.halal ? "halal" : null;

  function answer(verdict: Verdict) {
    saveBeen(ask!.placeId, { verdict, visits: "once", category: ask!.category ?? undefined });
    if (dietName && verdict !== "not_for_me" && ask!.category === "food_drinks") setStep("diet");
    else done("Thanks. That makes your next picks better.");
  }

  function done(message: string) {
    setAsk(null);
    toast(message);
  }

  return (
    <div className={styles.card} role="dialog" aria-label={`How was ${ask.name}?`}>
      {step === "how" ? (
        <>
          <p className={styles.q}>
            How was <strong>{ask.name}</strong>?
          </p>
          <div className={styles.row}>
            {VERDICTS.map((v) => (
              <button key={v.id} type="button" onClick={() => answer(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.later}
            onClick={() => {
              markAsked(ask.placeId);
              setAsk(null);
            }}
          >
            Haven&apos;t been yet
          </button>
        </>
      ) : (
        <>
          <p className={styles.q}>Did it work for your {dietName} diet?</p>
          <div className={styles.row}>
            <button type="button" onClick={() => (saveBeen(ask.placeId, { dietOk: true }), done("Thanks. That helps others who eat like you."))}>
              Yes
            </button>
            <button type="button" onClick={() => (saveBeen(ask.placeId, { dietOk: false }), done("Thanks for telling us."))}>
              No
            </button>
            <button type="button" onClick={() => done("Thanks. That makes your next picks better.")}>
              Not sure
            </button>
          </div>
        </>
      )}
    </div>
  );
}
