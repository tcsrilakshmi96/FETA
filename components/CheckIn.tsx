"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { loadCity } from "@/lib/cities";
import { logEvent } from "@/lib/db";
import { markAsked, nextCheckin, placeName, saveBeen, type Verdict } from "@/lib/my-places";
import { loadAnswers } from "@/lib/onboarding";
import styles from "./Sheet.module.css";
import own from "./CheckIn.module.css";

// "How was it?" a day or more after saving a place, as a pop-up on Home
// (founder, 14 Nov 2026), so Home itself stays clean. Any answer but "Didn't
// go" moves it to Been. Jain, vegan and halal users also get "Did it work for
// your diet?" (counted, never a promise). "Ask me later" asks next visit.
const ANSWERS: { id: Verdict | "no"; face: string; label: string }[] = [
  { id: "loved", face: "😍", label: "Loved it" },
  { id: "fine", face: "🙂", label: "It was fine" },
  { id: "not_for_me", face: "😕", label: "Not for me" },
  { id: "no", face: "🗓", label: "Didn't go" },
];

export default function CheckIn({ onDone }: { onDone?: () => void }) {
  const toast = useToast();
  const [ask, setAsk] = useState<{ placeId: string; name: string; category: string | null } | null>(null);
  const [step, setStep] = useState<"how" | "diet" | "loved">("how");

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const next = await nextCheckin(loadCity()?.id);
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

  function answer(id: Verdict | "no") {
    if (id === "no") {
      markAsked(ask!.placeId);
      done("No problem. It stays in Saved, and Feta asks again next week.");
      return;
    }
    saveBeen(ask!.placeId, { verdict: id, visits: "once", category: ask!.category ?? undefined });
    logEvent("checkin", ask!.placeId);
    if (dietName && id !== "not_for_me" && ask!.category === "food_drinks") setStep("diet");
    else if (id === "loved") setStep("loved");
    else done("Added to Been. That makes your next picks better.");
  }

  function done(message?: string) {
    setAsk(null);
    if (message) toast(message);
    onDone?.();
  }

  return (
    <>
      <div className={styles.dim} onClick={() => done()} />
      <div className={styles.sheet} role="dialog" aria-label={`How was ${ask.name}?`}>
        {step === "how" ? (
          <>
            <p className={styles.kick}>You saved it lately</p>
            <h2 className={styles.title}>
              How was <strong>{ask.name}?</strong>
            </h2>
            <div className={own.grid}>
              {ANSWERS.map((a) => (
                <button key={a.id} type="button" onClick={() => answer(a.id)}>
                  <span aria-hidden="true">{a.face}</span>
                  {a.label}
                </button>
              ))}
            </div>
            <button type="button" className={styles.ghost} onClick={() => done()}>
              Ask me later
            </button>
          </>
        ) : step === "loved" ? (
          <>
            <p className={styles.kick}>Added to Been</p>
            <h2 className={styles.title}>
              Glad you <strong>loved it!</strong>
            </h2>
            <p className={styles.sub}>Tell people where you went? It shares the place, never anything about you.</p>
            {/* A share on X (founder, 13 Nov 2026): the public place page, nothing personal. */}
            <a
              className={`btn-primary ${styles.go}`}
              style={{ display: "grid", placeItems: "center", textDecoration: "none" }}
              href={`https://x.com/intent/post?text=${encodeURIComponent(`Loved ${ask.name}. Found it with Feta.`)}&url=${encodeURIComponent(`${window.location.origin}/p/${ask.placeId}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => done()}
            >
              Share on X
            </a>
            <button type="button" className={styles.ghost} onClick={() => done()}>
              Done
            </button>
          </>
        ) : (
          <>
            <h2 className={styles.title}>
              Did it work for your <strong>{dietName} diet?</strong>
            </h2>
            <p className={styles.sub}>Counted to help others who eat like you. Never a promise.</p>
            <div className={own.grid}>
              <button type="button" onClick={() => (saveBeen(ask.placeId, { dietOk: true }), done("Thanks. That helps others who eat like you."))}>
                <span aria-hidden="true">👍</span>Yes
              </button>
              <button type="button" onClick={() => (saveBeen(ask.placeId, { dietOk: false }), done("Thanks for telling us."))}>
                <span aria-hidden="true">👎</span>No
              </button>
            </div>
            <button type="button" className={styles.ghost} onClick={() => done("Thanks. That makes your next picks better.")}>
              Not sure
            </button>
          </>
        )}
      </div>
    </>
  );
}
