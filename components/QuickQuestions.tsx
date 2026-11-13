"use client";

import { useEffect, useState } from "react";
import { currentUserId, supabase } from "@/lib/supabase";
import styles from "./QuickQuestions.module.css";

// Five tap-to-answer questions for testers, once, on their second visit
// (founder, 14 Nov 2026: phones can't reliably ask as the app closes). The
// answers go into feedback like any message, so they reach the sheet.
const QUESTIONS: [string, string[]][] = [
  ["How useful were your places?", ["Spot on", "Mostly", "Not really"]],
  ["Did you go to any of them?", ["Yes", "Not yet", "No"]],
  ["What was confusing?", ["Nothing", "Setup", "The picks", "Saved"]],
  ["Would you tell a friend about Feta?", ["Yes", "Maybe", "No"]],
  ["What should Feta do next?", ["Style", "Trips", "Better picks", "Groups"]],
];

const VISITS_KEY = "feta.visits";
const DONE_KEY = "feta.quickDone";

export default function QuickQuestions() {
  const [step, setStep] = useState<number | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);

  // Counts visits (one per tab session); asks on the second.
  useEffect(() => {
    try {
      if (localStorage.getItem(DONE_KEY)) return;
      if (!sessionStorage.getItem(VISITS_KEY)) {
        sessionStorage.setItem(VISITS_KEY, "1");
        localStorage.setItem(VISITS_KEY, String(Number(localStorage.getItem(VISITS_KEY) ?? 0) + 1));
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the visit count is only readable in the browser
      if (Number(localStorage.getItem(VISITS_KEY)) >= 2) setStep(0);
    } catch {
      // Without storage, never asked.
    }
  }, []);

  async function choose(answer: string) {
    const all = [...answers, answer];
    setAnswers(all);
    if (all.length < QUESTIONS.length) {
      setStep(all.length);
      return;
    }
    setStep(QUESTIONS.length);
    try {
      localStorage.setItem(DONE_KEY, "1");
    } catch {
      // Might be asked again; that's all.
    }
    const userId = await currentUserId();
    if (!userId) return;
    await supabase()
      .from("feedback")
      .insert({
        user_id: userId,
        message: `Quick questions: ${QUESTIONS.map(([q], i) => `${q} ${all[i]}`).join(" | ")}`,
        screen: "/home (quick questions)",
        user_agent: navigator.userAgent.slice(0, 300),
      });
  }

  function skip() {
    try {
      localStorage.setItem(DONE_KEY, "1");
    } catch {
      // Fine.
    }
    setStep(null);
  }

  if (step === null) return null;
  if (step >= QUESTIONS.length)
    return (
      <div className={styles.card}>
        <p className={styles.q}>Thank you! That goes straight to the team.</p>
      </div>
    );
  const [q, options] = QUESTIONS[step];
  return (
    <div className={styles.card}>
      <p className={styles.kick}>
        Quick question {step + 1} of {QUESTIONS.length}
        <button type="button" onClick={skip}>
          Skip all
        </button>
      </p>
      <p className={styles.q}>{q}</p>
      <div className={styles.chips}>
        {options.map((o) => (
          <button key={o} type="button" onClick={() => choose(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
