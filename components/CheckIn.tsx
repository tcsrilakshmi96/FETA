"use client";

import { useEffect, useState } from "react";
import Mascot from "@/components/Mascot";
import { useToast } from "@/components/Toast";
import { loadCity } from "@/lib/cities";
import { logEvent } from "@/lib/db";
import { markAsked, nextCheckin, placeName, saveBeen, VERDICTS, type Verdict } from "@/lib/my-places";
import { popUpSlot, shownThisVisit } from "@/lib/popups";
import { dayName, duePlan, localDay, markPlanChecked, type SavedPlan } from "@/lib/night-client";
import { loadAnswers } from "@/lib/onboarding";
import styles from "./Sheet.module.css";
import own from "./CheckIn.module.css";

// "How was it?" a day or more after saving a place, as a pop-up on Home
// (founder, 14 Nov 2026), so Home itself stays clean. Any answer but "Didn't
// go" moves it to Been. Jain, vegan and halal users also get "Did it work for
// your diet?" (counted, never a promise). "Ask me later" asks next visit.
// After a night planned from Saved, "How was Saturday?" asks about every
// stop at once, the first visit after that day (founder, 17 Nov 2026).
const ANSWERS: { id: Verdict | "no"; face: string; label: string }[] = [
  { id: "loved", face: "😍", label: "Loved it" },
  { id: "fine", face: "🙂", label: "It was fine" },
  { id: "not_for_me", face: "😕", label: "Not for me" },
  { id: "no", face: "🗓", label: "Didn't go" },
];

// "How was tonight?" (or "today" for a daytime plan) the same day, "How was Saturday?" after.
const howWas = (day: string) => (day === localDay(new Date()) ? (new Date().getHours() >= 16 ? "tonight" : "today") : dayName(day));

export default function CheckIn({ onDone }: { onDone?: () => void }) {
  const toast = useToast();
  const [ask, setAsk] = useState<{ placeId: string; name: string; category: string | null } | null>(null);
  const [step, setStep] = useState<"how" | "diet" | "loved">("how");
  const [night, setNight] = useState<{ plan: SavedPlan; names: string[] } | null>(null);

  // Takes its pop-up slot first, so a slower lookup never loses to a less
  // important pop-up; names are looked up (paid) only once it's chosen to open
  // (tech and cost audits, 26 Nov 2026).
  useEffect(() => {
    if (shownThisVisit()) return;
    let live = true;
    const slot = popUpSlot(0);
    const placeSlot = popUpSlot(1);
    const t = setTimeout(async () => {
      const plan = await duePlan(loadCity()?.id);
      if (!live) return;
      if (plan) {
        placeSlot.none();
        slot.ready(async () => {
          const names = await Promise.all(plan.placeIds.map(placeName));
          if (live) setNight({ plan, names: names.map((n) => n ?? "A place you planned") });
        });
        return;
      }
      slot.none();
      const next = await nextCheckin(loadCity()?.id);
      if (!live) return;
      if (!next) return placeSlot.none();
      placeSlot.ready(async () => {
        const name = await placeName(next.placeId);
        if (name && live) setAsk({ ...next, name });
      });
    }, 1500);
    return () => {
      live = false;
      clearTimeout(t);
      slot.cancel();
      placeSlot.cancel();
    };
  }, []);

  if (night) return <NightCheckIn plan={night.plan} names={night.names} onDone={(message) => (setNight(null), message && toast(message), onDone?.())} />;
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
        {/* Thinks while asking; takes a bite when they loved it. */}
        <Mascot key={step} pose={step === "loved" ? "bite" : "think"} size={84} pop={step === "loved"} />
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

function NightCheckIn({ plan, names, onDone }: { plan: SavedPlan; names: string[]; onDone: (message?: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, Verdict | "no">>({});
  const choices: { id: Verdict | "no"; label: string }[] = [...VERDICTS, { id: "no", label: "Didn't go" }];

  function done() {
    const been = Object.entries(answers).filter((a): a is [string, Verdict] => a[1] !== "no");
    for (const [placeId, verdict] of been) {
      saveBeen(placeId, { verdict, visits: "once" });
      logEvent("checkin", placeId);
    }
    markPlanChecked(plan.id);
    onDone(been.length ? "Added to Been. That makes your next picks better." : undefined);
  }

  // The cheese reacts to the answers: a cheer for a loved stop, sorry for one that wasn't.
  const said = Object.values(answers);
  const pose = said.includes("loved") ? "cheer" : said.includes("not_for_me") ? "sorry" : "think";

  return (
    <>
      <div className={styles.dim} onClick={() => onDone()} />
      <div className={styles.sheet} role="dialog" aria-label={`How was ${howWas(plan.day)}?`}>
        <Mascot pose={pose} size={84} />
        <p className={styles.kick}>Your plan</p>
        <h2 className={styles.title}>
          How was <strong>{howWas(plan.day)}?</strong>
        </h2>
        <ul className={own.stops}>
          {plan.placeIds.map((id, i) => (
            <li key={id}>
              <strong>{names[i]}</strong>
              <span className={styles.chips}>
                {choices.map((c) => (
                  <button key={c.id} type="button" className={answers[id] === c.id ? styles.on : ""} aria-pressed={answers[id] === c.id} onClick={() => setAnswers((a) => ({ ...a, [id]: c.id }))}>
                    {c.label}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className={styles.sub}>Feta remembers this for your next picks.</p>
        <button type="button" className={`btn-primary ${styles.go}`} onClick={done}>
          Done
        </button>
        <button type="button" className={styles.ghost} onClick={() => onDone()}>
          Ask me later
        </button>
      </div>
    </>
  );
}
