"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Mascot from "@/components/Mascot";
import { useRouter } from "next/navigation";
import { locateArea, newAreaSession, suggestAreas, type AreaSuggestion } from "@/lib/area-client";
import { loadCity, type City } from "@/lib/cities";
import { currencyForTimeZone, type Currency } from "@/lib/currency";
import { saveAnswersToDb, saveProfileLinesToDb, saveSwipesToDb } from "@/lib/db";
import { categoryOf, saveBeen } from "@/lib/my-places";
import InterestChips from "@/components/InterestChips";
import { AVOID_OPTIONS, EMPTY_ANSWERS, QUESTIONS, isVegDiet, loadAnswers, optionsFor, saveAnswers, toggleSpend, type Answers } from "@/lib/onboarding";
import { loadWants, type Want } from "@/lib/profile";
import {
  MAX_CUISINES,
  cuisinesFor,
  typedCuisines,
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
import { forgetPicks } from "@/lib/picks-store";
import RecommendAsk from "@/components/RecommendAsk";
import styles from "./Setup.module.css";

// Your preferences: at most 4 screens (Anj's flow, 14 Nov 2026), and only
// what applies to what they want from Feta. 1) the basics (diet, spend,
// distance, drinks), 2) places they love (Feta learns from real places),
// 3) what they love (cuisines, things to do, their own words), 4) one vibe
// card. Who they go out with and the other taste cards are asked later.

type Step = "basics" | "loves" | "taste" | "vibe";
type Loved = { placeId: string; name: string; detail: string };

const q = (id: string) => QUESTIONS.find((x) => x.id === id)!;

export default function Questions() {
  const router = useRouter();
  const [wants, setWants] = useState<Want[]>(["food", "do"]);
  const [step, setStep] = useState(0);
  const settling = useRef(false); // the screen just changed
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
  const [asking, setAsking] = useState(false); // "Recommend them to people like you?"
  const [asked, setAsked] = useState(false);
  // The phone's own money until their city is known. Read after the page
  // loads: the server's time zone isn't theirs, and reading it while drawing
  // gave the server ₹ and the phone £ (React error #418, tester 23 Nov 2026).
  const [phoneCurrency, setPhoneCurrency] = useState<Currency | null>(null);
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
    setPhoneCurrency(currencyForTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone));
    /* eslint-enable react-hooks/set-state-in-effect */
    const saved = loadCity();
    if (saved) setCity(saved);
    else
      fetch(`/api/cities?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`)
        .then((r) => r.json() as Promise<{ city: City | null }>)
        .then((r) => setCity(r.city))
        .catch(() => null);
  }, []);

  // Only what they chose: a trip alone asks neither (they're asked the
  // first time they open that category on Home).
  const food = wants.includes("food");
  const doing = wants.includes("do");
  const steps: Step[] = ["basics", "loves", ...(food || doing ? (["taste", "vibe"] as Step[]) : [])];
  const current = steps[Math.min(step, steps.length - 1)];
  const currency = city?.currency ?? phoneCurrency;
  const veg = isVegDiet(answers.diet);

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

  function chooseSide(card: PairCard, choice: "a" | "b" | "both") {
    setSwipes((all) => [...all.filter((s) => s.cardId !== card.a.id && s.cardId !== card.b.id), ...pairSwipes(card, choice)]);
  }

  // Saved before the next search runs, so it uses these answers.
  async function finish() {
    // Every cuisine shown counts: the chosen ones (ticked or typed) yes, the rest no.
    const options = cuisinesFor(city?.country, veg);
    const typed = typedCuisines(otherFood, options);
    const chosen = (id: string) => typed.ids.includes(id) || swipes.some((s) => s.cardId === `cuisine_${id}` && s.verdict === "yes");
    const all = food
      ? [...swipes.filter((s) => !s.cardId.startsWith("cuisine_")), ...options.map((c) => ({ cardId: `cuisine_${c.id}`, verdict: chosen(c.id) ? ("yes" as const) : ("no" as const) }))]
      : swipes;
    saveSwipes(all);
    const saving: Promise<unknown>[] = [saveSwipesToDb(all), saveAnswersToDb(answers)];
    // Plain lines for You, plus anything they typed in their own words.
    const own: ProfileLine[] = [
      typed.rest && { id: "food_other", text: `Also loves ${typed.rest.slice(0, 60)}`, source: "answers" as const },
      anythingElse.trim() && { id: "loves_other", text: `Loves ${anythingElse.trim().slice(0, 100)}`, source: "answers" as const },
    ].filter(Boolean) as ProfileLine[];
    const lines = [...pickedUpLines(answers, all, currency ?? currencyForTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone), city?.country), ...own];
    saveProfileLines(lines);
    saving.push(saveProfileLinesToDb(lines, []));
    await Promise.all(saving);
    forgetPicks();
    router.push(fromYou ? "/you" : "/home");
  }

  // Places they love: ask once whether to recommend them to others.
  function settle() {
    settling.current = true;
    setTimeout(() => (settling.current = false), 700);
  }

  function recommend(yes: boolean) {
    settle();
    setAsking(false);
    setAsked(true);
    if (yes) loved.forEach((l) => saveBeen(l.placeId, { recommend: true }));
    next(true);
  }

  function next(answered = false) {
    // A second tap right after the screen changed lands on the next screen's
    // Continue and skipped it ("2 of 4" to "4 of 4", testers, 21 Nov 2026).
    if (!answered && settling.current) return;
    settle();
    if (current === "loves" && loved.length > 0 && !asked && !answered) {
      setAsking(true);
      return;
    }
    saveAnswersToDb(answers);
    if (step >= steps.length - 1) finish();
    else setStep(step + 1);
  }

  function back() {
    if (step === 0) router.push(fromYou ? "/you" : "/location?setup=1");
    else setStep(step - 1);
  }

  const cards = swipeCards(answers, city?.country);
  // The one vibe card: about food when they chose places to eat, else about outings.
  const style = cards.find((c) => c.id === (food ? "style" : "energy")) as PairCard;
  const styleChoice = (id: string) => swipes.some((s) => s.cardId === id && s.verdict === "yes");
  const cuisines = cuisinesFor(city?.country, veg);

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
      {/* The cheese, a new pose for each screen (founder, 18 Nov 2026). */}
      <Mascot
        pose={current === "basics" ? "think" : current === "loves" ? "bite" : "idle"}
        prop={current === "taste" ? (food ? "fork" : "ticket") : current === "vibe" ? "shades" : undefined}
        size={76}
        pop
        className={styles.cheese}
      />

      {current === "basics" && (
        <>
          <h1 className={styles.title}>
            Just <strong>the basics</strong>
          </h1>
          {/* Without Places to eat, every screen speaks to things to do (founder, 20 Nov 2026: it read like a food setup). */}
          <p className={styles.sub}>{food ? "So Feta never shows you a place you can't eat at or don't want to pay for." : "So Feta never suggests something you'd rather not pay for or travel to."}</p>
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
          <p className={styles.label}>{food ? "Spend per person · tick all that are fine" : "Spend on a night out, per person · tick all that are fine"}</p>
          <div className={styles.chips}>
            {currency && optionsFor(q("spend"), currency, city?.country).map((o) => (
              <button key={o.id} type="button" aria-pressed={answers.spend.includes(o.id)} className={answers.spend.includes(o.id) ? styles.on : ""} onClick={() => set({ spend: toggleSpend(answers.spend, o.id), spendCurrency: currency })}>
                {o.label}
              </button>
            ))}
          </div>
          <p className={styles.label}>How far will you go?</p>
          <div className={styles.chips}>
            {optionsFor(q("distance"), currency ?? "USD", city?.country).map((o) => (
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
            Name a few places <strong>{food ? "you love" : "you love going"}</strong>
          </h1>
          <p className={styles.sub}>{food ? "Feta looks at what they're like (the price, the vibe, the food) and finds new places in the same spirit." : "A studio, a comedy club, a climbing gym, a park. Feta looks at what they're like (the vibe, the crowd, the price) and finds more like them."}</p>
          <p className={styles.hint}>Type a name, tap it to add, then add the next one. The more you add, the better Feta knows you.</p>
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
          {loved.length > 0 && <p className={styles.count}>{loved.length} added. Add another?</p>}
          <input
            className={styles.field}
            type="search"
            autoComplete="off"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              if (e.target.value.trim().length < 2) setSuggestions([]);
            }}
            placeholder={loved.length ? "Add another place" : food && doing ? "A café, restaurant, venue or studio" : food ? "A café, bar or restaurant" : "A venue, studio, club or park"}
            aria-label="A place you love"
          />
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
              <InterestChips
                className={`${styles.chips} ${styles.small}`}
                chosen={answers.interests}
                onChange={(interests) => set({ interests })}
                chip={(o, on, toggle) => (
                  <button key={o.id} type="button" className={on ? styles.on : ""} onClick={toggle}>
                    {o.label}
                  </button>
                )}
              />
            </>
          )}
          <input className={styles.field} value={anythingElse} onChange={(e) => setAnythingElse(e.target.value)} placeholder="Anything else? In your own words" aria-label="Anything else you love" maxLength={100} />
        </>
      )}

      {current === "vibe" && style && (
        <>
          <h1 className={styles.title}>
            {food ? (
              <>
                A good night out <strong>looks like…</strong>
              </>
            ) : (
              <>
                Your kind of <strong>outing</strong>
              </>
            )}
          </h1>
          <p className={styles.sub}>Tap one, or both.</p>
          <div className={styles.pair}>
            {(food
              ? [
                  { side: style.b, pick: "b" as const, title: "Dressed up and polished", sub: "Great cocktails, a stylish crowd" },
                  { side: style.a, pick: "a" as const, title: "Easy and casual", sub: "Come as you are, great food" },
                ]
              : [
                  { side: style.a, pick: "a" as const, title: "Get moving", sub: "A dance class, a game, a hike" },
                  { side: style.b, pick: "b" as const, title: "Slow down", sub: "Pottery, a book club, a gallery" },
                ]
            ).map(({ side, pick, title, sub }) => (
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
      {asking && <RecommendAsk count={loved.length} onAnswer={recommend} />}
      <button type="button" className="btn-primary" onClick={() => next()}>
        {step >= steps.length - 1 ? (fromYou ? "Save" : "Next") : "Continue"}
      </button>
      {current === "loves" && loved.length === 0 && (
        <button type="button" className={styles.ghost} onClick={() => next()}>
          I&apos;ll add some later
        </button>
      )}
    </main>
  );
}
