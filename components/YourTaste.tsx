"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadCity, type City } from "@/lib/cities";
import { currencyForTimeZone } from "@/lib/currency";
import { saveAnswersToDb, saveProfileLinesToDb, saveSwipesToDb } from "@/lib/db";
import { AVOID_OPTIONS, EMPTY_ANSWERS, QUESTIONS, isVegDiet, loadAnswers, optionsFor, saveAnswers, spendText, toggleSpend, type Answers } from "@/lib/onboarding";
import { forgetPicks } from "@/lib/picks-store";
import { addLine, removeLine, type Line } from "@/lib/profile-client";
import { cuisinesFor, loadSwipes, pickedUpLines, saveProfileLines, saveSwipes, typedCuisines, type ProfileLine, type Swipe } from "@/lib/swipes";
import styles from "./YourTaste.module.css";

// What Feta knows about their taste, on You (founder, 18 Nov 2026, mock-up
// https://claude.ai/artifact/MrDqcZgDgTNSTQeJo79bxR). One place for each
// thing, and it always applies: the rules Feta follows (diet, budget,
// distance, drinks, who) are set with a tap and can't be deleted by
// accident; cuisines and interests are chips; their own words sit in the
// section they're about. Typing a choice sets the choice ("vegetarian"
// asks to set the diet, "Mexican" turns on Mexican); other words stay as a
// note that Feta searches for. Before, a typed "vegetarian" was only a note
// and ✕ on a choice hid its words while the choice still applied.

type RuleId = "diet" | "spend" | "distance" | "drinks" | "who";
type Section = "food" | "do" | "out";

const question = (id: RuleId | "interests") => QUESTIONS.find((q) => q.id === id)!;
const OWN_KEYS = ["food_other", "loves_other"];
const NAMES: Record<RuleId, string> = { diet: "Diet", spend: "Budget", distance: "How far", drinks: "Drinks", who: "Usually with" };
const SOURCE_LABELS: Record<string, string> = { chat: "From Ask Feta", checkin: "From an outing", tweaks: "From your tweaks" };

// Typed words that mean a diet. Asked before it's set, so a near miss is harmless.
const DIET_WORDS: [RegExp, string][] = [
  [/\bnon[- ]?veg/i, "everything"],
  [/\bvegan\b/i, "vegan"],
  [/\bjain\b/i, "jain"],
  [/egg(etarian|s)?\b.*\bveg|\bveg.*\begg/i, "vegetarian_eggs"],
  [/\bvegetarian\b|\bveg\b|\bveggie\b/i, "vegetarian"],
  [/\bpesc[ae]tarian\b/i, "pescatarian"],
];

export default function YourTaste({ lines, onChange }: { lines: Line[]; onChange: () => Promise<void> }) {
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [swipes, setSwipes] = useState<Swipe[]>([]);
  const [city, setCity] = useState<City | null>(null);
  const [open, setOpen] = useState<RuleId | null>(null);
  const [typed, setTyped] = useState({ food: "", do: "" });
  const [ask, setAsk] = useState<{ diet: string; text: string } | null>(null);
  const [saved, setSaved] = useState<{ section: Section; text: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- kept on this phone, only readable in the browser */
    setAnswers(loadAnswers());
    setSwipes(loadSwipes());
    setCity(loadCity());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 4000);
    return () => clearTimeout(t);
  }, [saved]);

  const currency = city?.currency ?? currencyForTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const cuisines = cuisinesFor(city?.country, isVegDiet(answers.diet));
  const interests = question("interests").options;
  const options = (id: RuleId) => optionsFor(question(id), currency, city?.country);
  const label = (id: RuleId, value: string | null) => options(id).find((o) => o.id === value)?.label;

  function shown(id: RuleId) {
    if (id === "spend") return spendText(answers, currency) ?? "Not set";
    if (id === "who") return answers.who.map((w) => label("who", w)).filter(Boolean).join(", ") || "Not set";
    if (id === "diet") {
      const extra = [answers.halal && "halal", ...answers.avoid.map((a) => AVOID_OPTIONS.find((o) => o.id === a)?.label.toLowerCase())].filter(Boolean);
      return [label("diet", answers.diet) ?? "Not set", ...extra].join(" · ");
    }
    return label(id, answers[id]) ?? "Not set";
  }

  // The plain lines in You follow the answers and cuisines; lines that no
  // longer apply are marked removed. Their own words are never touched.
  async function syncLines(a: Answers, s: Swipe[]) {
    const fresh = pickedUpLines(a, s, currency, city?.country);
    const gone: ProfileLine[] = lines
      .filter((l) => (l.source === "answers" || l.source === "swipes") && !OWN_KEYS.includes(l.key) && !fresh.some((f) => f.id === l.key))
      .map((l) => ({ id: l.key, text: l.text, source: l.source as ProfileLine["source"] }));
    saveProfileLines(fresh);
    const ok = await saveProfileLinesToDb(fresh, gone);
    forgetPicks();
    await onChange();
    return ok !== false;
  }

  function done(section: Section, ok: boolean, what: string) {
    setSaved({ section, text: ok ? `✓ Saved · ${what}. Your next picks use it.` : "Couldn't save just now. Try again." });
  }

  async function apply(next: Answers, section: Section, what: string) {
    setAnswers(next);
    saveAnswers(next);
    const [a, l] = await Promise.all([saveAnswersToDb(next), syncLines(next, swipes)]);
    done(section, a !== false && l, what);
  }

  async function setCuisine(ids: string[], on: boolean, what: string) {
    const next = [...swipes.filter((s) => !ids.some((id) => s.cardId === `cuisine_${id}`)), ...ids.map((id) => ({ cardId: `cuisine_${id}`, verdict: on ? ("yes" as const) : ("no" as const) }))];
    setSwipes(next);
    saveSwipes(next);
    const [a, l] = await Promise.all([saveSwipesToDb(next.filter((s) => ids.some((id) => s.cardId === `cuisine_${id}`))), syncLines(answers, next)]);
    done("food", a !== false && l, what);
  }

  function pick(id: RuleId, value: string) {
    const q = question(id);
    let next: Answers;
    if (id === "spend") next = { ...answers, spend: toggleSpend(answers.spend, value), spendCurrency: currency };
    else if (q.multi) next = { ...answers, [id]: answers.who.includes(value) ? answers.who.filter((w) => w !== value) : [...answers.who, value] };
    else next = { ...answers, [id]: value };
    // A vegetarian diet makes "No beef / No pork" moot.
    if (id === "diet" && isVegDiet(value)) next.avoid = [];
    if (!q.multi) setOpen(null);
    void apply(next, id === "who" ? "out" : "food", `${NAMES[id]}: ${id === "spend" || q.multi ? "updated" : label(id, value)}`);
  }

  async function note(text: string, section: "food" | "do") {
    const line = await addLine(text, null, section);
    await onChange();
    done(section, !!line, `"${text}" added. Feta will look for it`);
  }

  // Typed in Food & drinks: a diet, drinks, halal or a cuisine Feta has a
  // tile for sets that choice; anything else is a note.
  async function typeFood(e: React.FormEvent) {
    e.preventDefault();
    const text = typed.food.trim();
    if (!text) return;
    setTyped({ ...typed, food: "" });
    const diet = DIET_WORDS.find(([re]) => re.test(text));
    if (diet && diet[1] !== answers.diet) return setAsk({ diet: diet[1], text });
    if (/no alcohol|don'?t drink|teetotal|\bsober\b/i.test(text)) return apply({ ...answers, drinks: "no_alcohol" }, "food", "Drinks: No alcohol");
    if (/\bhalal\b/i.test(text)) return apply({ ...answers, halal: true }, "food", "Halal only");
    const avoid = AVOID_OPTIONS.filter((o) => new RegExp(`no ${o.id}|don'?t eat ${o.id}`, "i").test(text)).map((o) => o.id);
    if (avoid.length) return apply({ ...answers, avoid: [...new Set([...answers.avoid, ...avoid])] }, "food", AVOID_OPTIONS.filter((o) => avoid.includes(o.id)).map((o) => o.label).join(", "));
    const found = typedCuisines(text, cuisines);
    if (found.ids.length) await setCuisine(found.ids, true, `${cuisines.filter((c) => found.ids.includes(c.id)).map((c) => c.label).join(", ")} on`);
    if (found.rest) await note(found.rest, "food");
  }

  // Typed in Things to do: an interest Feta has a chip for turns it on.
  async function typeDo(e: React.FormEvent) {
    e.preventDefault();
    const text = typed.do.trim();
    if (!text) return;
    setTyped({ ...typed, do: "" });
    const found = typedCuisines(text, interests.map((o) => ({ ...o, image: "" })));
    if (found.ids.length) {
      const into = [...new Set([...answers.interests, ...found.ids])];
      await apply({ ...answers, interests: into }, "do", `${interests.filter((o) => found.ids.includes(o.id)).map((o) => o.label).join(", ")} on`);
    }
    if (found.rest) await note(found.rest, "do");
  }

  async function remove(line: Line, section: Section) {
    await removeLine(line.id);
    await onChange();
    done(section, true, `removed "${line.text}"`);
  }

  const words = (keep: (l: Line) => boolean) => lines.filter(keep);
  const foodWords = words((l) => l.key === "food_other" || l.key.startsWith("you:food:"));
  const doWords = words((l) => l.key === "loves_other" || l.key.startsWith("you:do:"));
  const tasteCards = words((l) => l.source === "swipes" && l.key !== "cuisines");
  const otherWords = words((l) => l.source !== "answers" && l.source !== "swipes" && !foodWords.includes(l) && !doWords.includes(l));

  function rule(id: RuleId) {
    const q = question(id);
    const value = (o: string) => (id === "spend" ? answers.spend.includes(o) : id === "who" ? answers.who.includes(o) : answers[id] === o);
    return (
      <div key={id}>
        <button type="button" className={styles.rule} aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
          <span>{NAMES[id]}</span>
          <b>
            {shown(id)} <i aria-hidden="true">›</i>
          </b>
        </button>
        {open === id && (
          <div className={styles.picker}>
            <span className={styles.chips}>
              {options(id).map((o) => (
                <button key={o.id} type="button" className={styles.chip} aria-pressed={value(o.id)} onClick={() => pick(id, o.id)}>
                  {o.label}
                </button>
              ))}
            </span>
            {id === "diet" && (
              <span className={styles.chips}>
                {q.halal && (
                  <button type="button" className={styles.chip} aria-pressed={answers.halal} onClick={() => apply({ ...answers, halal: !answers.halal }, "food", answers.halal ? "Halal off" : "Halal only")}>
                    Halal only
                  </button>
                )}
                {!isVegDiet(answers.diet) &&
                  AVOID_OPTIONS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={styles.chip}
                      aria-pressed={answers.avoid.includes(o.id)}
                      onClick={() => apply({ ...answers, avoid: answers.avoid.includes(o.id) ? answers.avoid.filter((a) => a !== o.id) : [...answers.avoid, o.id] }, "food", o.label)}
                    >
                      {o.label}
                    </button>
                  ))}
              </span>
            )}
            {q.multi && (
              <button type="button" className={styles.doneBtn} onClick={() => setOpen(null)}>
                Done
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Taste-card lines follow the cards (they shape the ranking), so they're
  // changed by redoing the cards, not removed here.
  function wordList(list: Line[], section: Section, removable = true) {
    if (list.length === 0) return null;
    return (
      <ul className={styles.words}>
        {list.map((l) => (
          <li key={l.id}>
            <span>
              {l.text}
              {SOURCE_LABELS[l.source] && <small>{SOURCE_LABELS[l.source]}</small>}
            </span>
            {removable && (
              <button type="button" className={styles.x} aria-label={`Remove "${l.text}"`} onClick={() => remove(l, section)}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    );
  }

  const status = (section: Section) => (
    <p className={styles.saved} aria-live="polite">
      {saved?.section === section ? saved.text : ""}
    </p>
  );

  return (
    <>
      <section className={styles.card}>
        <h2>Food &amp; drinks</h2>
        <p className={styles.label}>Feta always follows</p>
        <div className={styles.rules}>{(["diet", "spend", "distance", "drinks"] as const).map(rule)}</div>
        <p className={styles.label}>You love</p>
        <span className={styles.chips}>
          {cuisines.map((c) => {
            const on = swipes.some((s) => s.cardId === `cuisine_${c.id}` && s.verdict === "yes");
            return (
              <button key={c.id} type="button" className={styles.chip} aria-pressed={on} onClick={() => setCuisine([c.id], !on, `${c.label} ${on ? "off" : "on"}`)}>
                {c.label}
              </button>
            );
          })}
        </span>
        {foodWords.length > 0 && <p className={styles.label}>In your words</p>}
        {wordList(foodWords, "food")}
        <form className={styles.add} onSubmit={typeFood}>
          <input value={typed.food} onChange={(e) => setTyped({ ...typed, food: e.target.value })} maxLength={80} placeholder="Add to food, e.g. Burmese, no mushrooms" aria-label="Add to food and drinks" />
          <button type="submit" disabled={!typed.food.trim()}>
            Add
          </button>
        </form>
        {ask && (
          <div className={styles.ask}>
            <span>
              Set your diet to <b>{label("diet", ask.diet)}</b>?{" "}
              {isVegDiet(ask.diet) ? "Feta then only shows places that serve it." : "Feta then shows every kind of place again."}
            </span>
            <span className={styles.askBtns}>
              <button
                type="button"
                onClick={() => {
                  setAsk(null);
                  pick("diet", ask.diet);
                }}
              >
                Yes, set it
              </button>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => {
                  setAsk(null);
                  void note(ask.text, "food");
                }}
              >
                Keep as a note
              </button>
            </span>
          </div>
        )}
        {status("food")}
      </section>

      <section className={styles.card}>
        <h2>Things to do</h2>
        <p className={styles.label}>You&apos;re into</p>
        <span className={styles.chips}>
          {interests.map((o) => {
            const on = answers.interests.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                className={styles.chip}
                aria-pressed={on}
                onClick={() => apply({ ...answers, interests: on ? answers.interests.filter((i) => i !== o.id) : [...answers.interests, o.id] }, "do", `${o.label} ${on ? "off" : "on"}`)}
              >
                {o.label}
              </button>
            );
          })}
        </span>
        {doWords.length > 0 && <p className={styles.label}>In your words</p>}
        {wordList(doWords, "do")}
        <form className={styles.add} onSubmit={typeDo}>
          <input value={typed.do} onChange={(e) => setTyped({ ...typed, do: e.target.value })} maxLength={80} placeholder="Add, e.g. pottery with friends" aria-label="Add to things to do" />
          <button type="submit" disabled={!typed.do.trim()}>
            Add
          </button>
        </form>
        {status("do")}
      </section>

      <section className={styles.card}>
        <h2>How you go out</h2>
        <div className={styles.rules}>{rule("who")}</div>
        {wordList(tasteCards, "out", false)}
        <button type="button" className={styles.link} onClick={() => router.push("/swipes?from=you")}>
          {tasteCards.length ? "Redo the taste cards ›" : "Do the taste cards ›"}
        </button>
        {otherWords.length > 0 && <p className={styles.label}>Also told Feta</p>}
        {wordList(otherWords, "out")}
        {status("out")}
      </section>
    </>
  );
}
