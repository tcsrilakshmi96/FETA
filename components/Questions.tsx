"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { locateArea, newAreaSession, suggestAreas, type AreaSuggestion } from "@/lib/area-client";
import { loadCity, type City } from "@/lib/cities";
import { currencyForTimeZone } from "@/lib/currency";
import { saveAnswersToDb, saveProfileLinesToDb, saveSwipesToDb } from "@/lib/db";
import { categoryOf, saveBeen } from "@/lib/my-places";
import { AVOID_OPTIONS, EMPTY_ANSWERS, QUESTIONS, loadAnswers, optionsFor, saveAnswers, type Answers } from "@/lib/onboarding";
import { loadWants, type Want } from "@/lib/profile";
import {
  MAX_CUISINES,
  cuisinesFor,
  loadSwipes,
  pairSwipes,
  pickedUpLines,
  saveProfileLines,
  saveSwipes,
  swipeCards,
  type PairCard,
  type ProfileLine,
  type Swipe,
} from "@/lib/swipes";
import styles from "./Setup.module.css";

// Your preferences: at most 4 screens (Anj's flow, 14 Nov 2026), and only
// what applies to what they want from Feta. 1) the basics (diet, spend,
// distance, drinks), 2) places they love (Feta learns from real places),
// 3) what they love (cuisines, things to do, their own words), 4) one vibe
// card. Who they go out with and the other taste cards are asked later.

type Step = "basics" | "loves" | "taste" | "vibe";
type Loved = { placeId: string; name: string; detail: string };

const VEG_DIETS = ["vegetarian", "vegetarian_eggs", "jain", "vegan"];
const q = (id: string) => QUESTIONS.find((x) => x.id === id)!;

export default function Questions() {
  const router = useRouter();
  const [wants, setWants] = useState<Want[]>(["food", "do"]);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [swipes, setSwipes] = useState<Swipe[]>([]);
  const [city, setCity] = useState<City | null>(null);
  const [fromYou, setFromYou] = useState(false);
  const [loved, setLoved] = useState<Loved[]>([]);
  const [typed, setTyped] = useState("");
  const [suggestions, setSuggestions] = useState<AreaSuggestion[]>([]);
  const [otherFood, setOtherFood] = useState("");
  const [showOther, setShowOther] = useState(false);
  const [anythingElse, setAnythingElse] = useState("");
  const session = useRef("");

  // Answers from an earlier visit, and a city to work with: theirs, or a
  // guess from the phone's time zone (prices and search suggestions only;
  // they say where they are at the end).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- saved on this phone, only readable in the browser */
    setWants(loadWants());
    setAnswers(loadAnswers());
    setSwipes(loadSwipes());
    setFromYou(new URLSearchParams(window.location.search).get("from") === "you");
    /* eslint-enable react-hooks/set-state-in-effect */
    const saved = loadCity();
    if (saved) setCity(saved);
    else
      fetch(`/api/cities?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`)
        .then((r) => r.json() as Promise<{ city: City | null }>)
        .then((r) => setCity(r.city))
        .catch(() => null);
  }, []);

  const food = wants.includes("food") || wants.includes("trip");
  const doing = wants.includes("do") || wants.includes("trip");
  const steps: Step[] = ["basics", "loves", ...(food || doing ? (["taste", "vibe"] as Step[]) : [])];
  const current = steps[Math.min(step, steps.length - 1)];
  const currency = city?.currency ?? currencyForTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const veg = VEG_DIETS.includes(answers.diet ?? "");

  // Places they love: Google suggestions as they type, a moment after they stop.
  useEffect(() => {
    if (current !== "loves" || !city || typed.trim().length < 2) return;
    let live = true;
    const t = setTimeout(async () => {
      session.current ||= newAreaSession();
      const found = await suggestAreas(typed.trim(), city, session.current, true);
      if (live) setSuggestions(found.filter((s) => !loved.some((l) => l.placeId === s.placeId)));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [typed, city, current, loved]);

  function set(next: Partial<Answers>) {
    const all = { ...answers, ...next };
    setAnswers(all);
    saveAnswers(all);
  }

  async function addLoved(s: AreaSuggestion) {
    setLoved([...loved, { placeId: s.placeId, name: s.name, detail: s.detail }]);
    setTyped("");
    setSuggestions([]);
    // Ending the suggestion session keeps it free, and says where the place
    // is, so it's saved in the right city as a place they love.
    const at = await locateArea(s.placeId, session.current);
    session.current = "";
    const placeCity = at
      ? await fetch(`/api/cities?near=${at.lat},${at.lng}`)
          .then((r) => r.json() as Promise<{ city: City | null }>)
          .then((r) => r.city)
          .catch(() => null)
      : null;
    saveBeen(s.placeId, { verdict: "loved", category: categoryOf(s.types), cityId: placeCity?.id ?? city?.id });
  }

  function toggleCuisine(id: string) {
    const key = `cuisine_${id}`;
    setSwipes((all) => {
      const chosen = all.filter((s) => s.cardId.startsWith("cuisine_") && s.verdict === "yes").length;
      const on = all.some((s) => s.cardId === key && s.verdict === "yes");
      if (!on && chosen >= MAX_CUISINES) return all;
      return [...all.filter((s) => s.cardId !== key), { cardId: key, verdict: on ? "no" : "yes" }];
    });
  }

  function toggleInterest(id: string) {
    set({ interests: answers.interests.includes(id) ? answers.interests.filter((i) => i !== id) : [...answers.interests, id] });
  }

  function chooseSide(card: PairCard, choice: "a" | "b" | "both") {
    setSwipes((all) => [...all.filter((s) => s.cardId !== card.a.id && s.cardId !== card.b.id), ...pairSwipes(card, choice)]);
  }

  function finish() {
    // Every cuisine shown counts: the chosen ones yes, the rest no.
    const cuisineIds = cuisinesFor(city?.country, veg).map((c) => c.id);
    const all = food
      ? [...swipes.filter((s) => !s.cardId.startsWith("cuisine_")), ...cuisineIds.map((id) => ({ cardId: `cuisine_${id}`, verdict: swipes.some((s) => s.cardId === `cuisine_${id}` && s.verdict === "yes") ? ("yes" as const) : ("no" as const) }))]
      : swipes;
    saveSwipes(all);
    saveSwipesToDb(all);
    saveAnswersToDb(answers);
    // Plain lines for You, plus anything they typed in their own words.
    const own: ProfileLine[] = [
      otherFood.trim() && { id: "food_other", text: `Also loves ${otherFood.trim().slice(0, 60)}`, source: "answers" as const },
      anythingElse.trim() && { id: "loves_other", text: `Loves ${anythingElse.trim().slice(0, 100)}`, source: "answers" as const },
    ].filter(Boolean) as ProfileLine[];
    const lines = [...pickedUpLines(answers, all, currency, city?.country), ...own];
    saveProfileLines(lines);
    saveProfileLinesToDb(lines, []);
    router.push(fromYou ? "/you" : "/location");
  }

  function next() {
    saveAnswersToDb(answers);
    if (step >= steps.length - 1) finish();
    else setStep(step + 1);
  }

  function back() {
    if (step === 0) router.push(fromYou ? "/you" : "/start");
    else setStep(step - 1);
  }

  const style = swipeCards(answers, city?.country).find((c) => c.id === "style") as PairCard;
  const styleChoice = (id: string) => swipes.some((s) => s.cardId === id && s.verdict === "yes");
  const cuisines = cuisinesFor(city?.country, veg).slice(0, 8);

  return (
    <main className={styles.screen} key={current}>
      <div className={styles.top}>
        <button type="button" onClick={back} aria-label="Back">
          ‹ Back
        </button>
        <span>
          Your preferences · {step + 1} of {steps.length}
        </span>
      </div>
      <div className={styles.progress} aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s} className={i <= step ? styles.done : ""} />
        ))}
      </div>

      {current === "basics" && (
        <>
          <h1 className={styles.title}>
            Just <strong>the basics</strong>
          </h1>
          <p className={styles.sub}>So Feta never shows you a place you can&apos;t eat at or don&apos;t want to pay for.</p>
          {food && (
            <>
              <p className={styles.label}>What do you eat?</p>
              <div className={styles.chips}>
                {q("diet").options.map((o) => (
                  <button key={o.id} type="button" className={answers.diet === o.id ? styles.on : ""} onClick={() => set({ diet: answers.diet === o.id ? null : o.id, avoid: o.id === "everything" || o.id === "pescatarian" ? answers.avoid : [] })}>
                    {o.label}
                  </button>
                ))}
              </div>
              <div className={`${styles.chips} ${styles.small}`} style={{ marginTop: 10 }}>
                {(answers.diet === "everything" || answers.diet === "pescatarian") &&
                  AVOID_OPTIONS.map((o) => (
                    <button key={o.id} type="button" className={answers.avoid.includes(o.id) ? styles.on : ""} onClick={() => set({ avoid: answers.avoid.includes(o.id) ? answers.avoid.filter((x) => x !== o.id) : [...answers.avoid, o.id] })}>
                      {o.label}
                    </button>
                  ))}
                <button type="button" className={answers.halal ? styles.on : ""} onClick={() => set({ halal: !answers.halal })}>
                  Halal only
                </button>
              </div>
            </>
          )}
          <p className={styles.label}>Spend per person, usually</p>
          <div className={styles.chips}>
            {optionsFor(q("spend"), currency, city?.country).map((o) => (
              <button key={o.id} type="button" className={answers.spend === o.id ? styles.on : ""} onClick={() => set({ spend: answers.spend === o.id ? null : o.id, spendCurrency: currency })}>
                {o.label}
              </button>
            ))}
          </div>
          <p className={styles.label}>How far will you go?</p>
          <div className={styles.chips}>
            {optionsFor(q("distance"), currency, city?.country).map((o) => (
              <button key={o.id} type="button" className={answers.distance === o.id ? styles.on : ""} onClick={() => set({ distance: answers.distance === o.id ? null : o.id })}>
                {o.label}
              </button>
            ))}
          </div>
          {(food || doing) && (
            <>
              <p className={styles.label}>Do you drink alcohol?</p>
              <div className={styles.chips}>
                {q("drinks").options.map((o) => (
                  <button key={o.id} type="button" className={answers.drinks === o.id ? styles.on : ""} onClick={() => set({ drinks: answers.drinks === o.id ? null : o.id })}>
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {current === "loves" && (
        <>
          <h1 className={styles.title}>
            Name a few places <strong>you love</strong>
          </h1>
          <p className={styles.sub}>Feta looks at what they&apos;re like (the price, the vibe, the food) and finds new places in the same spirit.</p>
          <p className={styles.hint}>Type a name, tap it to add, then add the next one. Up to 3.</p>
          {loved.length > 0 && (
            <ul className={styles.loved}>
              {loved.map((l) => (
                <li key={l.placeId}>
                  <span>
                    <strong>{l.name}</strong> <small>{l.detail}</small>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {loved.length > 0 && <p className={styles.count}>{loved.length >= 3 ? "3 of 3 added. That's plenty." : `${loved.length} of 3 added. Add another?`}</p>}
          {loved.length < 3 && (
            <input
              className={styles.field}
              type="search"
              autoComplete="off"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                if (e.target.value.trim().length < 2) setSuggestions([]);
              }}
              placeholder={loved.length ? "Add another place" : "A café, bar or restaurant"}
              aria-label="A place you love"
            />
          )}
          {suggestions.length > 0 && typed.trim().length >= 2 && (
            <>
              <ul className={styles.suggestions}>
                {suggestions.slice(0, 5).map((s) => (
                  <li key={s.placeId}>
                    <button type="button" onClick={() => addLoved(s)}>
                      {s.name}
                      <small>{s.detail}</small>
                    </button>
                  </li>
                ))}
              </ul>
              <p className={styles.powered}>Suggestions from Google</p>
            </>
          )}
          <p className={styles.hint}>{loved.length ? "Feta won't show these as new picks. Add more any time in Saved → Been." : "Optional, but it helps Feta a lot."}</p>
        </>
      )}

      {current === "taste" && (
        <>
          <h1 className={styles.title}>
            What do you <strong>love?</strong>
          </h1>
          {food && (
            <>
              <p className={styles.label}>To eat · up to {MAX_CUISINES}</p>
              <div className={styles.cuisines}>
                {cuisines.map((c) => {
                  const on = swipes.some((s) => s.cardId === `cuisine_${c.id}` && s.verdict === "yes");
                  return (
                    <button key={c.id} type="button" aria-pressed={on} className={`${styles.cuisine} ${on ? styles.cuisineOn : ""}`} onClick={() => toggleCuisine(c.id)}>
                      <Image src={c.image} alt="" fill sizes="130px" />
                      <span>{c.label}</span>
                    </button>
                  );
                })}
                <button type="button" className={`${styles.cuisine} ${styles.other}`} onClick={() => setShowOther(true)}>
                  <span>＋ Something else</span>
                </button>
              </div>
              {showOther && <input className={styles.field} value={otherFood} onChange={(e) => setOtherFood(e.target.value)} placeholder="e.g. Burmese, Parsi, Goan" aria-label="Another cuisine" maxLength={60} autoFocus />}
            </>
          )}
          {doing && (
            <>
              <p className={styles.label}>To do</p>
              <div className={`${styles.chips} ${styles.small}`}>
                {q("interests").options.map((o) => (
                  <button key={o.id} type="button" className={answers.interests.includes(o.id) ? styles.on : ""} onClick={() => toggleInterest(o.id)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <input className={styles.field} value={anythingElse} onChange={(e) => setAnythingElse(e.target.value)} placeholder="Anything else? In your own words" aria-label="Anything else you love" maxLength={100} />
        </>
      )}

      {current === "vibe" && style && (
        <>
          <h1 className={styles.title}>
            A good night out <strong>looks like…</strong>
          </h1>
          <p className={styles.sub}>Tap one, or both.</p>
          <div className={styles.pair}>
            {[
              { side: style.b, pick: "b" as const, title: "Dressed up and polished", sub: "Great cocktails, a stylish crowd" },
              { side: style.a, pick: "a" as const, title: "Easy and casual", sub: "Come as you are, great food" },
            ].map(({ side, pick, title, sub }) => (
              <button key={side.id} type="button" aria-pressed={styleChoice(side.id)} className={`${styles.side} ${styleChoice(side.id) ? styles.sideOn : ""}`} onClick={() => chooseSide(style, pick)}>
                <Image src={side.image} alt="" fill sizes="200px" />
                <strong>{title}</strong>
                <small>{sub}</small>
              </button>
            ))}
          </div>
          <div className={`${styles.both} ${styles.chips}`}>
            <button type="button" className={styleChoice(style.a.id) && styleChoice(style.b.id) ? styles.on : ""} onClick={() => chooseSide(style, "both")}>
              Both, depends on the night
            </button>
          </div>
        </>
      )}

      <div className={styles.grow} />
      <button type="button" className="btn-primary" onClick={next}>
        {step >= steps.length - 1 ? (fromYou ? "Save" : "Next") : "Continue"}
      </button>
      {current === "loves" && loved.length === 0 && (
        <button type="button" className={styles.ghost} onClick={next}>
          I&apos;ll add some later
        </button>
      )}
    </main>
  );
}
