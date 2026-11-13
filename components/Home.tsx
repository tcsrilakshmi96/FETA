"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CheckIn from "@/components/CheckIn";
import FirstTime from "@/components/FirstTime";
import LetsGo from "@/components/LetsGo";
import PickPhoto from "@/components/PickPhoto";
import PlanSheet from "@/components/PlanSheet";
import SaveTaste from "@/components/SaveTaste";
import TabBar from "@/components/TabBar";
import { formatDistance } from "@/lib/cities";
import { nearMeIfAllowed, newCityName } from "@/lib/near-me";
import { loadOrigin, type Origin } from "@/lib/origin";
import type { Category, Pick, When } from "@/lib/picks-client";
import { keptSlots, loadSlot, slotKey, type Slot } from "@/lib/picks-store";
import { clock, planEvenings } from "@/lib/plan";
import { loadName, loadWants, type Want } from "@/lib/profile";
import styles from "./Home.module.css";
import sheet from "./Sheet.module.css";

// Home (founder's design, 12 Nov 2026; redesign 14 Nov 2026): a magazine
// headline, "Choose for me" (one answer for tonight, after "something new or
// your usual?" once per visit), then tiles. What they want from Feta leads
// as the big tile; a category they didn't pick asks its questions the first
// time it's opened. Preferences and account open from the round button.
// The picks are the same ones the lists show, loaded once and shared, so
// Home costs no extra searches.

type Mood = "new" | "usual" | "surprise";
const MOODS: { id: Mood; icon: string; label: string; sub: string; kick: string }[] = [
  { id: "new", icon: "✦", label: "Something new", sub: "A place or food you haven't tried", kick: "SOMETHING NEW" },
  { id: "usual", icon: "♥", label: "My usual, done really well", sub: "The kind of place you already love", kick: "AN OLD FAVOURITE STYLE" },
  { id: "surprise", icon: "🎲", label: "Surprise me", sub: "Feta decides", kick: "SURPRISE" },
];

// Asked once per visit (kept in this tab only).
const MOOD_KEY = "feta.mood";

function cityDay(timeZone: string) {
  const now = new Date();
  const label = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }).format(now).replace(",", "").toUpperCase();
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  return { label, weekend: weekday === "Sat" || weekday === "Sun", hour };
}

function eventBadge(p: Pick, timeZone: string) {
  if (!p.event?.date) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const day = p.event.date === today ? "TODAY" : new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${p.event.date}T12:00:00Z`)).toUpperCase();
  const [h, m] = (p.event.time ?? "").split(":").map(Number);
  // "8:30", not "8", for a show at 20:30 (testers, 13 Nov 2026).
  const hour = Number.isFinite(h) ? `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}` : "";
  return { day, hour, half: Number.isFinite(h) ? (h < 12 ? "AM" : "PM") : "" };
}

// The order "Choose for me" offers places in, for the mood: lesser-known
// first for something new, well-loved first for the usual, shuffled for a
// surprise. Only the best few of each list are considered.
function byMood(picks: Pick[], mood: Mood) {
  const top = picks.filter((p) => p.verdict !== "Skip unless").slice(0, 5);
  if (mood === "surprise") return [...top].sort(() => Math.random() - 0.5);
  const known = (p: Pick) => p.ratingCount ?? 500;
  return [...top].sort((a, b) => (mood === "new" ? known(a) - known(b) : known(b) * (b.rating ?? 4) - known(a) * (a.rating ?? 4)));
}

export default function Home() {
  const router = useRouter();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [when, setWhen] = useState<When>("tonight");
  const [slots, setSlots] = useState<Record<string, Slot>>(keptSlots);
  const [planOpen, setPlanOpen] = useState(false);
  const [wants, setWants] = useState<Want[]>(["food", "do"]);
  const [name, setName] = useState("");
  const [moodOpen, setMoodOpen] = useState(false);
  const [mood, setMood] = useState<Mood | null>(null);
  const [answerAt, setAnswerAt] = useState<number | null>(null);
  const [going, setGoing] = useState<Pick | null>(null);
  const [firstTime, setFirstTime] = useState<"food" | "do" | null>(null);

  useEffect(() => {
    const saved = loadOrigin();
    if (!saved) {
      router.replace("/location");
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- the origin and answers are only readable in the browser */
    if (cityDay(saved.city.timeZone).weekend) setWhen("weekend");
    setWants(loadWants());
    setName(loadName());
    try {
      const m = sessionStorage.getItem(MOOD_KEY);
      if (m) setMood(m as Mood);
    } catch {
      // Asked again, that's all.
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // Picks near where they are, not the city centre, when location is
    // allowed; decided before loading, so picks load once.
    nearMeIfAllowed(saved).then((here) => setOrigin(here ?? saved));
  }, [router]);

  // Both categories for the chosen time, shared with the picks list.
  useEffect(() => {
    if (!origin) return;
    for (const c of ["food_drinks", "experiences"] as Category[]) {
      const k = slotKey(origin, when, c);
      if (slots[k]) continue;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the slot as loading before the request
      setSlots((s) => ({ ...s, [k]: { loading: true, picks: [], spares: [], saved: [] } }));
      loadSlot(origin, when, c).then((slot) => setSlots((s) => ({ ...s, [k]: slot })));
    }
  }, [origin, when, slots]);

  const food = origin ? slots[slotKey(origin, when, "food_drinks")] : undefined;
  const exp = origin ? slots[slotKey(origin, when, "experiences")] : undefined;
  const plans = useMemo(
    () => (food && exp && !food.loading && !exp.loading ? planEvenings(food.picks, exp.picks, when) : []),
    [food, exp, when],
  );

  const wantsFood = wants.includes("food") || wants.includes("trip");
  const wantsDo = wants.includes("do") || wants.includes("trip");
  // What they want leads as the big tile; the other stays, smaller.
  const lead: Category = wantsFood || !wantsDo ? "food_drinks" : "experiences";
  const options = useMemo(() => {
    if (!mood) return [];
    const first = lead === "food_drinks" ? food : exp;
    const second = lead === "food_drinks" ? exp : food;
    const otherWanted = lead === "food_drinks" ? wantsDo : wantsFood;
    return [...byMood(first?.picks ?? [], mood), ...(otherWanted ? byMood(second?.picks ?? [], mood) : [])];
  }, [mood, lead, food, exp, wantsDo, wantsFood]);

  if (!origin) return null;
  const city = origin.city;
  const day = cityDay(city.timeZone);
  // On a Saturday or Sunday morning the weekend tab is about today.
  const today = when === "weekend" && day.weekend && day.hour < 16;
  // Just arrived in a new city: the first evening there.
  const arrived = when === "tonight" && newCityName() === city.name;
  const where = (p: Pick) => [p.rating ? `★ ${p.rating.toFixed(1)}` : null, p.area, p.distanceKm > 0 && formatDistance(p.distanceKm, city.country)].filter(Boolean).join(" · ");
  const plan = plans[0];
  const answer = answerAt !== null && options.length ? options[answerAt % options.length] : null;
  const leadSlot = lead === "food_drinks" ? food : exp;
  const nothingYet = !leadSlot || leadSlot.loading;

  function open(c: Category) {
    const asked = c === "food_drinks" ? wantsFood : wantsDo;
    if (!asked) setFirstTime(c === "food_drinks" ? "food" : "do");
    else router.push(`/picks?c=${c}${when === "weekend" ? "&w=weekend" : ""}`);
  }

  function chooseForMe() {
    if (mood) setAnswerAt(0);
    else setMoodOpen(true);
  }

  function pickMood(m: Mood) {
    setMood(m);
    try {
      sessionStorage.setItem(MOOD_KEY, m);
    } catch {
      // Asked again next time.
    }
    setMoodOpen(false);
    setAnswerAt(0);
  }

  // After the first-time questions their answers count, so that category
  // searches again.
  function firstTimeDone(c: "food" | "do") {
    setFirstTime(null);
    setWants(loadWants());
    if (!origin) return;
    const category: Category = c === "food" ? "food_drinks" : "experiences";
    const k = slotKey(origin, when, category);
    setSlots((s) => ({ ...s, [k]: { loading: true, picks: [], spares: [], saved: [] } }));
    loadSlot(origin, when, category).then((slot) => setSlots((s) => ({ ...s, [k]: slot })));
    router.push(`/picks?c=${category}${when === "weekend" ? "&w=weekend" : ""}`);
  }

  function cover(c: Category, slot: Slot | undefined, wide: boolean) {
    const top = slot?.picks[0];
    const label = c === "food_drinks" ? "FOOD & DRINKS" : "THINGS TO DO";
    const badge = top ? eventBadge(top, city.timeZone) : null;
    return (
      <button type="button" className={`${styles.tile} ${styles.cover} ${wide ? styles.lead : styles.second}`} onClick={() => open(c)} aria-label={`${label.toLowerCase()}: see all`}>
        {!slot || slot.loading ? (
          <>
            <span className={styles.shimmer} />
            <span className={styles.coverText}>
              <span className={styles.kick}>{label}</span>
              <span className={styles.loadingText}>Finding your picks…</span>
            </span>
          </>
        ) : !top ? (
          <span className={styles.coverText} style={{ color: "var(--ink)" }}>
            <span className={styles.kick} style={{ color: "var(--roseText)" }}>{label}</span>
            <span className={styles.coverName}>Nothing fits right now</span>
            <span className={styles.coverSub}>Tap to see why</span>
          </span>
        ) : (
          <>
            <PickPhoto photo={top.photo} className="kenburns" />
            <span className={styles.shade} />
            <span className={styles.count}>See all ›</span>
            {badge && (
              <span className={styles.date}>
                {badge.day}
                <b>{badge.hour}</b>
                {badge.half}
              </span>
            )}
            <span className={styles.coverText}>
              <span className={styles.kick}>
                {label}
                {wide && top.fetaNote !== undefined ? " · ★ FETA PICK" : ""}
              </span>
              <span className={styles.coverName}>{top.name}</span>
              {wide && <span className={styles.coverSub}>{where(top)}</span>}
            </span>
          </>
        )}
      </button>
    );
  }

  const areaLabel = origin.source === "area" ? origin.label : origin.source === "gps" ? "Near you" : `All of ${city.name}`;
  return (
    <>
      <main className={styles.screen}>
        <div className={styles.page}>
          <div className={styles.dateline}>
            <span className={styles.left}>
              <span>{day.label}</span>
              <span aria-hidden="true">·</span>
              <button type="button" className={styles.area} onClick={() => router.push("/location")}>
                {areaLabel.toUpperCase()} ▾
              </button>
            </span>
            <button type="button" className={styles.acct} onClick={() => router.push("/you")} aria-label="You: your preferences and account">
              {name ? name[0].toUpperCase() : "◯"}
            </button>
          </div>
          <h1 className={styles.mast}>
            {arrived ? (
              <>
                First night in {city.name}, <i key={when}>sorted.</i>
              </>
            ) : (
              <>
                {today ? "Today" : when === "tonight" ? "Tonight" : "This weekend"}, <i key={when}>made for you.</i>
              </>
            )}
          </h1>
          {name && <p className={styles.hello}>Hi {name}!</p>}
          <div className={styles.seg} role="tablist" aria-label="When">
            {(["tonight", "weekend"] as const).map((w) => (
              <button
                key={w}
                type="button"
                role="tab"
                aria-selected={when === w}
                className={when === w ? styles.segOn : ""}
                onClick={() => {
                  setWhen(w);
                  setAnswerAt(null);
                }}
              >
                {w === "tonight" ? "Tonight" : "This weekend"}
              </button>
            ))}
          </div>

          <button type="button" className={styles.choose} onClick={chooseForMe} disabled={nothingYet}>
            <span>
              <strong>Choose for me</strong>
              <small>{nothingYet ? "Finding places first…" : `One answer for ${when === "tonight" ? "tonight" : "this weekend"}. No scrolling.`}</small>
            </span>
            <span className={styles.cheese} aria-hidden="true">
              🧀
            </span>
          </button>

          {answer && mood && (
            <div className={styles.answer} key={answer.placeId}>
              <div className={styles.answerPhoto}>
                <PickPhoto photo={answer.photo} />
                <b>FETA&apos;S CHOICE · {MOODS.find((m) => m.id === mood)!.kick}</b>
              </div>
              <div className={styles.answerText}>
                <h2>{answer.name}</h2>
                <p className={styles.answerWhy}>{answer.because}</p>
                <p className={styles.answerMeta}>
                  {where(answer)}
                  {" · "}
                  {answer.event ? (
                    answer.chips[0]
                  ) : (
                    <a href={answer.mapsUri} target="_blank" rel="noopener noreferrer" translate="no">
                      Google Maps
                    </a>
                  )}
                </p>
                <div className={styles.answerActs}>
                  <button type="button" onClick={() => setAnswerAt((answerAt ?? 0) + 1)}>
                    Not this one
                  </button>
                  <button type="button" className={styles.answerGo} onClick={() => setGoing(answer)}>
                    Let&apos;s go
                  </button>
                </div>
                <p className={styles.answerMore}>
                  <button type="button" onClick={() => open(answer.kind === "EAT" || answer.kind === "DRINK" ? "food_drinks" : "experiences")}>
                    See all options
                  </button>
                  {" · "}
                  <button type="button" onClick={() => setMoodOpen(true)}>
                    Change mood
                  </button>
                </p>
              </div>
            </div>
          )}

          <div className={styles.grid} key={when}>
            {cover(lead, leadSlot, true)}
            {cover(lead === "food_drinks" ? "experiences" : "food_drinks", lead === "food_drinks" ? exp : food, false)}

            <button
              type="button"
              className={`${styles.tile} ${styles.plan}`}
              onClick={() => (today ? router.push(`/ask?q=${encodeURIComponent(`Plan my whole day today in ${origin.source === "area" ? origin.label : city.name}`)}`) : setPlanOpen(true))}
            >
              <span className={styles.kick}>✦ {today ? "YOUR DAY" : arrived ? "YOUR FIRST EVENING" : when === "tonight" ? "YOUR EVENING" : "YOUR WEEKEND"}</span>
              <span className={styles.tileTitle}>
                {today
                  ? "Plan my whole day"
                  : plan
                    ? `${plan.stops[0].pick.kind === "EAT" ? "Dinner" : plan.stops[0].pick.kind === "DRINK" ? "Drinks" : plan.stops[0].pick.name} ${clock(plan.stops[0].time).replace(/ ?[ap]m/i, "")}, then ${plan.stops[1].pick.name}`
                    : "Dinner and something nearby"}
              </span>
              <span className={styles.tileSub}>{today ? "Breakfast to drinks ›" : plans.length > 1 ? `${plans.length} plans ›` : "Plan it ›"}</span>
            </button>

            <button type="button" className={`${styles.tile} ${styles.style}`} onClick={() => router.push("/style")}>
              <span className={styles.kick}>STYLE</span>
              <span className={styles.tileTitle}>Looks for your plans</span>
              <span className={styles.tileSub}>Have a look ›</span>
            </button>
          </div>

          {wants.includes("trip") && (
            <button type="button" className={`${styles.tile} ${styles.trip}`} onClick={() => router.push(`/ask?q=${encodeURIComponent("Plan a trip for me")}`)}>
              <span className={styles.kick}>✈ PLAN A TRIP</span>
              <span className={styles.tileTitle}>Where to next? Feta plans it day by day</span>
              <span className={styles.tileSub}>Start a trip ›</span>
            </button>
          )}
        </div>
      </main>
      <CheckIn />
      <SaveTaste ready={!!food && !food.loading} onRestored={() => window.location.reload()} />
      <TabBar active="home" />
      {planOpen && (
        <PlanSheet when={when} cityId={city.id} loading={!food || food.loading || !exp || exp.loading} food={food?.picks ?? []} experiences={exp?.picks ?? []} onClose={() => setPlanOpen(false)} />
      )}
      {moodOpen && (
        <>
          <div className={sheet.dim} onClick={() => setMoodOpen(false)} />
          <div className={sheet.sheet} role="dialog" aria-label="Something new or your usual?">
            <p className={sheet.kick}>Choose for me</p>
            <h2 className={sheet.title}>
              Craving something <strong>new, or your usual?</strong>
            </h2>
            <div className={sheet.steps}>
              {MOODS.map((m) => (
                <button key={m.id} type="button" onClick={() => pickMood(m.id)}>
                  <span className={sheet.icon}>{m.icon}</span>
                  <span>
                    {m.label}
                    <small>{m.sub}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {going && (
        <LetsGo
          pick={going}
          cityId={city.id}
          onClose={() => setGoing(null)}
          onWhatsAfter={() => {
            setGoing(null);
            setPlanOpen(true);
          }}
        />
      )}
      {firstTime && <FirstTime want={firstTime} onClose={() => setFirstTime(null)} onDone={() => firstTimeDone(firstTime)} />}
    </>
  );
}
