"use client";

import { firstSlotName } from "@/lib/slot-label";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import CheckIn from "@/components/CheckIn";
import CheesePull, { whatsNew } from "@/components/CheesePull";
import ChooseForMe, { type Mood } from "@/components/ChooseForMe";
import FetaPicksSheet from "@/components/FetaPicksSheet";
import FetaStar from "@/components/FetaStar";
import RepliesPill from "@/components/RepliesPill";
import FirstTime from "@/components/FirstTime";
import IphoneInstall from "@/components/IphoneInstall";
import PlanSheet from "@/components/PlanSheet";
import LetsGo from "@/components/LetsGo";
import Mascot from "@/components/Mascot";
import PickPhoto from "@/components/PickPhoto";
import SaveTaste from "@/components/SaveTaste";
import TabBar from "@/components/TabBar";
import TesterForm from "@/components/TesterForm";
import WearCard from "@/components/WearCard";
import type { PillPart } from "@/components/TopPill";
import { formatDistance } from "@/lib/cities";
import { nearMeIfAllowed } from "@/lib/near-me";
import { loadOrigin, type Origin } from "@/lib/origin";
import type { Category, Pick, When } from "@/lib/picks-client";
import { morePicks, openList, outOfDate, reloadList, shown, slotKey, usePicks, type Slot } from "@/lib/picks-store";
import { loadName, loadWants, WANTS, type Want } from "@/lib/profile";
import { tonightPlan, type TonightPlan } from "@/lib/style-client";
import styles from "./Home.module.css";
import sheet from "./Sheet.module.css";

// Home (founder's design, 12 Nov 2026; redesign 14 Nov 2026): a magazine
// headline, "Choose for me" (one answer for tonight, after "something new or
// your usual?" once per visit), then tiles. What they want from Feta leads
// as the big tile; a category they didn't pick asks its questions the first
// time it's opened. Preferences and account open from the round button.
// The picks are the same ones the lists show, loaded once and shared, so
// Home costs no extra searches.

const MOODS: { id: Mood; icon: string; label: string; sub: string }[] = [
  { id: "new", icon: "✦", label: "Something new", sub: "A place you haven't been, for food you love" },
  { id: "usual", icon: "♥", label: "My usual, done really well", sub: "Most like the places you love" },
  { id: "surprise", icon: "🎲", label: "Surprise me", sub: "Something you'd love but never chose" },
];

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
  // A pop-up running several days that has started is on now.
  const day = p.event.date === today || (p.event.endDate && p.event.date < today && p.event.endDate >= today) ? (p.event.date === today ? "TODAY" : "ON NOW") :new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${p.event.date}T12:00:00Z`)).toUpperCase();
  // No time on the listing means no time on the badge ("".split gave 0, so
  // "12 AM", testers 22 Nov 2026).
  const [h, m] = p.event.time && p.event.time !== "00:00" ? p.event.time.split(":").map(Number) : [NaN, 0];
  // "8:30", not "8", for a show at 20:30 (testers, 13 Nov 2026).
  const hour = Number.isFinite(h) ? `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}` : "";
  return { day, hour, half: Number.isFinite(h) ? (h < 12 ? "AM" : "PM") : "" };
}

export default function Home() {
  const router = useRouter();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [when, setWhen] = useState<When>("tonight");
  // The lists are held by the picks store, shared with the picks list
  // (founder, 25 Nov 2026: one owner, no copies to disagree); it also looks
  // a list up again past its hour or when Today becomes Tonight.
  const lists = usePicks();
  // Unknown until read from the phone: nothing is searched before (user
  // test, 24 Nov 2026: someone who chose only Style paid for two searches,
  // made while Home still assumed food and things to do).
  const [readWants, setWants] = useState<Want[] | null>(null);
  const wants = readWants ?? [];
  const [name, setName] = useState("");
  const [moodOpen, setMoodOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false); // Plan my evening, from "What's after?" (Choose for me, Favourites)
  const [mood, setMood] = useState<Mood | null>(null); // Choose for me's answer is open
  const [going, setGoing] = useState<Pick | null>(null);
  const [fetaOpen, setFetaOpen] = useState(false); // "Feta Picks near you", from the star
  const [firstTime, setFirstTime] = useState<"food" | "do" | null>(null);
  const [late, setLate] = useState(false); // the cheese sleeps from 11 pm to 5 am
  const scroller = useRef<HTMLElement>(null);

  useEffect(() => {
    const saved = loadOrigin();
    if (!saved) {
      router.replace("/location");
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- the origin and answers are only readable in the browser */
    setWants(loadWants());
    setName(loadName());
    const hour = new Date().getHours();
    setLate(hour >= 23 || hour < 5);
    /* eslint-enable react-hooks/set-state-in-effect */
    // Picks near where they are, not the city centre, when location is
    // allowed; decided before loading, so picks load once.
    nearMeIfAllowed(saved).then((here) => setOrigin(here ?? saved));
  }, [router]);

  // The categories they chose, for the chosen time, shared with the picks
  // list. One they didn't choose isn't searched (founder, 20 Nov 2026: "I
  // chose only style, why have random food and to-do picks shown?"); its
  // tile asks its questions first.
  const foodKey = origin ? slotKey(origin, when, "food_drinks") : "";
  const expKey = origin ? slotKey(origin, when, "experiences") : "";
  const food = origin ? shown(lists, foodKey) : undefined;
  const exp = origin ? shown(lists, expKey) : undefined;
  const wantFood = !!readWants?.includes("food");
  const wantDo = !!readWants?.includes("do");
  const foodMissing = !food || outOfDate(food);
  const expMissing = !exp || outOfDate(exp);
  useEffect(() => {
    if (origin && wantFood) openList(origin, when, "food_drinks");
  }, [origin, when, wantFood, foodMissing]);
  useEffect(() => {
    if (origin && wantDo) openList(origin, when, "experiences");
  }, [origin, when, wantDo, expMissing]);

  // Only from places they asked for: picks kept on the phone from before
  // (another account, or food they no longer want) never make a plan
  // (founder, 20 Nov 2026: "it has set up a random plan which I never set").
  // What to wear only for a plan they chose (opened in Plan my evening or
  // saved for today), never this suggestion (founder, 21 Nov 2026).
  const [chosenPlan, setChosenPlan] = useState<TonightPlan | null>(null);
  useEffect(() => {
    tonightPlan().then(setChosenPlan);
  }, []);

  // A trip alone doesn't count as wanting either (founder, 15 Nov 2026:
  // "I didn't choose things to do but it asked"): those questions come the
  // first time they open that category.
  const wantsFood = wants.includes("food");
  const wantsDo = wants.includes("do");
  // What they want leads as the big tile; the other stays, smaller.
  const lead: Category = wantsFood || !wantsDo ? "food_drinks" : "experiences";
  if (!origin) return null;
  const city = origin.city;
  const day = cityDay(city.timeZone);
  // On a Saturday or Sunday morning the weekend tab is about today.
  // Just arrived in a new city: the first evening there.
  const where = (p: Pick) => [p.rating ? `★ ${p.rating.toFixed(1)}` : null, p.area, p.distanceKm > 0 && formatDistance(p.distanceKm, city.country)].filter(Boolean).join(" · ");
  const leadSlot = lead === "food_drinks" ? food : exp;
  const nothingYet = !leadSlot || leadSlot.loading;
  // Only Style (or a trip) chosen: Style leads, places wait until asked for.
  const noPlaces = !wantsFood && !wantsDo;

  function open(c: Category) {
    const asked = c === "food_drinks" ? wantsFood : wantsDo;
    if (!asked) setFirstTime(c === "food_drinks" ? "food" : "do");
    else router.push(`/picks?c=${c}${when === "weekend" ? "&w=weekend" : ""}`);
  }

  function pickMood(m: Mood) {
    setMoodOpen(false);
    setMood(m);
  }

  // Pull down for a fresh set (founder, 17 Nov 2026: "in the home section
  // it did not"): both lists move on to their next places, as on the picks
  // list, and the pill says what's new.
  async function freshSet(): Promise<PillPart[]> {
    if (!origin) return [];
    const ready = (["food_drinks", "experiences"] as Category[]).filter((c) => {
      const s = shown(lists, slotKey(origin, when, c));
      return s && !s.loading;
    });
    const next = await Promise.all(ready.map((c) => morePicks(origin, when, c, null, true)));
    scroller.current?.scrollTo({ top: 0 });
    return whatsNew(next.flatMap((n) => n.fresh));
  }

  // After the first-time questions their answers count, so that category
  // searches again.
  function firstTimeDone(c: "food" | "do") {
    setFirstTime(null);
    setWants(loadWants());
    if (!origin) return;
    const category: Category = c === "food" ? "food_drinks" : "experiences";
    reloadList(origin, when, category);
    router.push(`/picks?c=${category}${when === "weekend" ? "&w=weekend" : ""}`);
  }

  // Home is four equal squares: Eat, Do, Wear, Trip (founder, 24 Nov 2026:
  // "one category shouldn't overpower the other"; option F). No mascots on
  // Home's tiles; the cheese stays in Choose for me and Ask Feta.
  function cover(c: Category, slot: Slot | undefined) {
    const top = slot?.picks[0];
    const label = c === "food_drinks" ? "EAT" : "DO";
    const tone = c === "food_drinks" ? styles.kEat : styles.kDo;
    const badge = top ? eventBadge(top, city.timeZone) : null;
    return (
      <button type="button" className={`${styles.square} ${styles.cover}`} onClick={() => open(c)} aria-label={`${c === "food_drinks" ? "Food and drinks" : "Things to do"}: see all`}>
        {!slot || slot.loading ? (
          <>
            <span className={styles.shimmer} />
            <span className={styles.coverText}>
              <span className={`${styles.kick} ${tone}`}>{label}</span>
              <span className={styles.loadingText}>Finding your picks…</span>
            </span>
          </>
        ) : !top ? (
          <span className={styles.coverText} style={{ color: "var(--ink)" }}>
            <span className={`${styles.kick} ${tone}`}>{label}</span>
            <span className={styles.coverName}>{slot.failed ? "Couldn't load" : "Nothing fits right now"}</span>
            <span className={styles.coverSub}>Tap to see why</span>
          </span>
        ) : (
          <>
            <PickPhoto photo={top.photo} className="kenburns" />
            <span className={styles.shade} />
            {badge && (
              <span className={styles.date}>
                {badge.day}
                <b>{badge.hour}</b>
                {badge.half}
              </span>
            )}
            <span className={styles.coverText}>
              <span className={`${styles.kick} ${tone}`}>{label}</span>
              <span className={styles.coverName}>{top.name}</span>
              <span className={styles.coverSub}>{top.fetaNote !== undefined ? "★ Feta Pick" : top.event ? top.chips[0] ?? where(top) : where(top)}</span>
            </span>
          </>
        )}
      </button>
    );
  }

  function askTile(c: Category) {
    const want = WANTS.find((w) => w.id === (c === "food_drinks" ? "food" : "do"))!;
    return (
      <button type="button" className={`${styles.square} ${styles.cover}`} onClick={() => open(c)}>
        <Image src={want.image!} alt="" fill sizes="(max-width: 430px) 50vw, 215px" className="kenburns" />
        <span className={styles.shade} />
        <span className={styles.coverText}>
          <span className={`${styles.kick} ${c === "food_drinks" ? styles.kEat : styles.kDo}`}>{c === "food_drinks" ? "EAT" : "DO"}</span>
          <span className={styles.coverName}>{want.label}</span>
          <span className={styles.coverSub}>Tell Feta what you like ›</span>
        </span>
      </button>
    );
  }

  const areaLabel = origin.source === "area" ? origin.label : origin.source === "gps" ? "Near you" : `All of ${city.name}`;
  return (
    <>
      <main ref={scroller} className={styles.screen}>
        <div className={styles.page}>
          <div className={styles.dateline}>
            <span className={styles.left}>
              <span>{day.label}</span>
              <span aria-hidden="true">·</span>
              <button type="button" className={styles.area} onClick={() => router.push("/location")}>
                {areaLabel.toUpperCase()} ▾
              </button>
              <span className={styles.beta}>BETA</span>
            </span>
            <span className={styles.buttons}>
              <FetaStar cityId={city.id} cityName={city.name} onOpen={() => setFetaOpen(true)} />
              <button type="button" className="labelled" onClick={() => router.push("/you")} aria-label="You: your preferences and account">
                <span className={styles.acct}>{name ? name[0].toUpperCase() : "◯"}</span>
                <small aria-hidden="true">You</small>
              </button>
            </span>
          </div>

          {/* One search bar (founder, 24 Nov 2026), in place of the round button. */}
          <button type="button" className={styles.searchBar} onClick={() => router.push("/search")} aria-label="Search a place, an activity or a piece">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <span>Search a place, a class or a piece…</span>
          </button>

          <div className={styles.whenRow}>
            <div className={styles.seg} role="tablist" aria-label="When">
              {(["tonight", "weekend"] as const).map((w) => (
                <button key={w} type="button" role="tab" aria-selected={when === w} className={when === w ? styles.segOn : ""} onClick={() => setWhen(w)}>
                  {w === "tonight" ? firstSlotName(city.timeZone) : "This weekend"}
                </button>
              ))}
            </div>
            {!noPlaces && (
              <button type="button" className={styles.choose} onClick={() => setMoodOpen(true)} disabled={nothingYet} aria-label={nothingYet ? "Choose for me: finding places first" : `Choose for me: one answer for ${when === "tonight" ? firstSlotName(city.timeZone).toLowerCase() : "this weekend"}`}>
                <Mascot pose={late ? "sleep" : "think"} size={30} className={styles.cheese} />
                <strong>Choose for me</strong>
              </button>
            )}
          </div>

          <div className={styles.quad} key={when}>
            {wantsFood ? cover("food_drinks", food) : askTile("food_drinks")}
            {wantsDo ? cover("experiences", exp) : askTile("experiences")}
            {(() => {
              const plain = (
                <button type="button" className={`${styles.square} ${styles.cover}`} onClick={() => router.push("/style")}>
                  <Image src="/swipes/style.jpg" alt="" fill sizes="(max-width: 430px) 50vw, 215px" className="kenburns" />
                  <span className={styles.shade} />
                  <span className={styles.coverText}>
                    <span className={`${styles.kick} ${styles.kWear}`}>WEAR</span>
                    <span className={styles.coverName}>What to wear</span>
                    <span className={styles.coverSub}>Looks and brands ›</span>
                  </span>
                </button>
              );
              // Today's chosen look, or What to wear for the plan they chose.
              return <WearCard tile className={`${styles.square} ${styles.wearSquare}`} plan={chosenPlan} fallback={plain} />;
            })()}
            {/* Always there: trips are part of what Feta is (founder, 14 Nov 2026). */}
            <button type="button" className={`${styles.square} ${styles.cover}`} onClick={() => router.push(`/ask?q=${encodeURIComponent("Plan a trip for me")}`)}>
              <Image src="/swipes/trip.jpg" alt="" fill sizes="(max-width: 430px) 50vw, 215px" className="kenburns" />
              <span className={styles.shade} />
              <span className={styles.coverText}>
                <span className={`${styles.kick} ${styles.kTrip}`}>TRIP</span>
                <span className={styles.coverName}>Plan a trip</span>
                <span className={styles.coverSub}>Day by day ›</span>
              </span>
            </button>
          </div>
          <IphoneInstall />
        </div>
      </main>
      <CheckIn />
      <RepliesPill />
      <TesterForm />
      <SaveTaste ready={noPlaces || (!!leadSlot && !leadSlot.loading)} places={!noPlaces} onRestored={() => window.location.reload()} />
      <TabBar active="home" />
      <CheesePull scroller={scroller} onRefresh={freshSet} enabled={!nothingYet} />
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
      {mood && (
        <ChooseForMe
          mood={mood}
          origin={origin}
          when={when}
          lead={lead}
          lists={[
            { category: lead, slot: leadSlot },
            ...((lead === "food_drinks" ? wantsDo : wantsFood) ? [{ category: (lead === "food_drinks" ? "experiences" : "food_drinks") as Category, slot: lead === "food_drinks" ? exp : food }] : []),
          ]}
          onClose={() => setMood(null)}
          onGo={(p) => {
            setMood(null);
            setGoing(p);
          }}
        />
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
      {planOpen && (
        <PlanSheet when={when} cityId={city.id} loading={!!food?.loading || !!exp?.loading} food={wantsFood ? (food?.picks ?? []) : []} experiences={wantsDo ? (exp?.picks ?? []) : []} onClose={() => setPlanOpen(false)} />
      )}
      {fetaOpen && (
        <FetaPicksSheet
          origin={origin}
          when={when}
          onClose={() => setFetaOpen(false)}
          onPlan={() => {
            setFetaOpen(false);
            setPlanOpen(true);
          }}
        />
      )}
      {firstTime && <FirstTime want={firstTime} onClose={() => setFirstTime(null)} onDone={() => firstTimeDone(firstTime)} />}
    </>
  );
}
