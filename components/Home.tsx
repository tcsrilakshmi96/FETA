"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import LetsGo from "@/components/LetsGo";
import Mascot from "@/components/Mascot";
import PickPhoto from "@/components/PickPhoto";
import PlanSheet from "@/components/PlanSheet";
import SaveTaste from "@/components/SaveTaste";
import TabBar from "@/components/TabBar";
import TesterForm from "@/components/TesterForm";
import WaitFun from "@/components/WaitFun";
import WearCard from "@/components/WearCard";
import type { PillPart } from "@/components/TopPill";
import { formatDistance } from "@/lib/cities";
import { nearMeIfAllowed, newCityName } from "@/lib/near-me";
import { loadOrigin, type Origin } from "@/lib/origin";
import type { Category, Pick, When } from "@/lib/picks-client";
import { keepSlot, keptSlots, loadSlot, nextPicks, slotKey, type Slot } from "@/lib/picks-store";
import { clock, planEvenings } from "@/lib/plan";
import { loadName, loadWants, WANTS, type Want } from "@/lib/profile";
import { tonightPlan, type TonightPlan } from "@/lib/style-client";
import ThemeToggle from "@/components/ThemeToggle";
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
  const [slots, setSlots] = useState<Record<string, Slot>>(keptSlots);
  const [planOpen, setPlanOpen] = useState(false);
  const [wants, setWants] = useState<Want[]>(["food", "do"]);
  const [name, setName] = useState("");
  const [moodOpen, setMoodOpen] = useState(false);
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
  useEffect(() => {
    if (!origin) return;
    const chosen: Category[] = [...(wants.includes("food") ? ["food_drinks" as const] : []), ...(wants.includes("do") ? ["experiences" as const] : [])];
    for (const c of chosen) {
      const k = slotKey(origin, when, c);
      if (slots[k]) continue;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- marks the slot as loading before the request
      setSlots((s) => ({ ...s, [k]: { loading: true, picks: [], spares: [], saved: [] } }));
      loadSlot(origin, when, c).then((slot) => setSlots((s) => ({ ...s, [k]: slot })));
    }
  }, [origin, when, slots, wants]);

  const food = origin ? slots[slotKey(origin, when, "food_drinks")] : undefined;
  const exp = origin ? slots[slotKey(origin, when, "experiences")] : undefined;
  // Only from places they asked for: picks kept on the phone from before
  // (another account, or food they no longer want) never make a plan
  // (founder, 20 Nov 2026: "it has set up a random plan which I never set").
  const planFood = wants.includes("food") ? food : undefined;
  const planDo = wants.includes("do") ? exp : undefined;
  const plans = useMemo(
    () => ((planFood || planDo) && !planFood?.loading && !planDo?.loading ? planEvenings(planFood?.picks ?? [], planDo?.picks ?? [], when) : []),
    [planFood, planDo, when],
  );
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
  const today = when === "weekend" && day.weekend && day.hour < 16;
  // Just arrived in a new city: the first evening there.
  const arrived = when === "tonight" && newCityName() === city.name;
  const where = (p: Pick) => [p.rating ? `★ ${p.rating.toFixed(1)}` : null, p.area, p.distanceKm > 0 && formatDistance(p.distanceKm, city.country)].filter(Boolean).join(" · ");
  const plan = plans[0];
  const leadSlot = lead === "food_drinks" ? food : exp;
  const nothingYet = !leadSlot || leadSlot.loading;
  // Only Style (or a trip) chosen: Style leads, places wait until asked for.
  const noPlaces = !wantsFood && !wantsDo;
  const styleLeads = noPlaces && wants.includes("style");

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
    const lists = (["food_drinks", "experiences"] as Category[]).map((c) => ({ c, k: slotKey(origin, when, c) })).filter(({ k }) => slots[k] && !slots[k].loading);
    const next = await Promise.all(lists.map(async ({ c, k }) => ({ k, next: await nextPicks(slots[k], origin, when, c) })));
    setSlots((s) => {
      const out = { ...s };
      for (const { k, next: n } of next) {
        if (n.fresh.length === 0) continue;
        out[k] = { ...s[k], picks: n.fresh, spares: n.spares };
        keepSlot(k, out[k]);
      }
      return out;
    });
    scroller.current?.scrollTo({ top: 0 });
    return whatsNew(next.flatMap((n) => n.next.fresh));
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
              <Mascot pose="walk" size={wide ? 72 : 56} />
              <span className={styles.kick}>{label}</span>
              {wide ? <WaitFun kind="picks" compact /> : <span className={styles.loadingText}>Finding your picks…</span>}
            </span>
          </>
        ) : !top ? (
          <span className={styles.coverText} style={{ color: "var(--ink)" }}>
            <Mascot pose={slot.failed ? "melt" : "sorry"} size={wide ? 72 : 56} />
            <span className={styles.kick} style={{ color: "var(--roseText)" }}>{label}</span>
            <span className={styles.coverName}>{slot.failed ? "Feta melted. Try again" : "Nothing fits right now"}</span>
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

  // A category they didn't choose: its questions first, no picks yet. The
  // same photo as its tile in setup (audit, 20 Nov 2026: it was a blank card).
  function askTile(c: Category, className: string) {
    const want = WANTS.find((w) => w.id === (c === "food_drinks" ? "food" : "do"))!;
    return (
      <button type="button" className={`${styles.tile} ${styles.cover} ${className}`} onClick={() => open(c)}>
        <Image src={want.image!} alt="" fill sizes="(max-width: 430px) 50vw, 215px" className="kenburns" />
        <span className={styles.shade} />
        <span className={styles.coverText}>
          <span className={styles.kick}>{c === "food_drinks" ? "FOOD & DRINKS" : "THINGS TO DO"}</span>
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
            </span>
            <span className={styles.buttons}>
              <FetaStar cityId={city.id} cityName={city.name} onOpen={() => setFetaOpen(true)} />
              <button type="button" className="labelled" onClick={() => router.push("/you")} aria-label="You: your preferences and account">
                <span className={styles.acct}>{name ? name[0].toUpperCase() : "◯"}</span>
                <small aria-hidden="true">You</small>
              </button>
            </span>
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
          {/* Light or dark from Home (founder, 21 Nov 2026), the same setting as in You. */}
          <div className={styles.helloRow}>
            {name ? <p className={styles.hello}>Hi {name}!</p> : <span />}
            <ThemeToggle />
          </div>
          <IphoneInstall />
          {/* Choose for me sits beside Tonight · This weekend, small, so the
              tiles below (Things to do, Style) are on screen without
              scrolling (founder, 23 Nov 2026: "can't see style and todos"). */}
          <div className={styles.whenRow}>
            <div className={styles.seg} role="tablist" aria-label="When">
              {(["tonight", "weekend"] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  role="tab"
                  aria-selected={when === w}
                  className={when === w ? styles.segOn : ""}
                  onClick={() => setWhen(w)}
                >
                  {w === "tonight" ? "Tonight" : "This weekend"}
                </button>
              ))}
            </div>

            {!noPlaces && (
              <button type="button" className={styles.choose} onClick={() => setMoodOpen(true)} disabled={nothingYet} aria-label={nothingYet ? "Choose for me: finding places first" : `Choose for me: one answer for ${when === "tonight" ? "tonight" : "this weekend"}`}>
                <Mascot pose={late ? "sleep" : "think"} size={30} className={styles.cheese} />
                <strong>Choose for me</strong>
              </button>
            )}
          </div>

          <div className={styles.grid} key={when}>
            {styleLeads ? (
              // Today's chosen look once there is one (founder, 22 Nov 2026).
              <WearCard
                tile
                big
                className={`${styles.tile} ${styles.style} ${styles.styleLead}`}
                plan={chosenPlan}
                fallback={
                  <button type="button" className={`${styles.tile} ${styles.style} ${styles.styleLead}`} onClick={() => router.push("/style")}>
                    <span className={styles.kick}>STYLE · BETA</span>
                    <span className={styles.tileTitle}>What to wear today</span>
                    <Mascot prop="shades" size={84} className={styles.tileCheese} />
                    <span className={styles.tileSub}>And brands for your style ›</span>
                  </button>
                }
              />
            ) : (
              cover(lead, leadSlot, true)
            )}
            {noPlaces ? (
              <>
                {askTile("food_drinks", styles.second)}
                {askTile("experiences", styles.planArea)}
              </>
            ) : (lead === "food_drinks" ? wantsDo : wantsFood) ? (
              cover(lead === "food_drinks" ? "experiences" : "food_drinks", lead === "food_drinks" ? exp : food, false)
            ) : (
              askTile(lead === "food_drinks" ? "experiences" : "food_drinks", styles.second)
            )}

            {/* Always Plan my evening (testers: a weekend-morning "Plan my whole
                day" jumped to chat, and Plan my evening seemed missing). */}
            {!noPlaces && (
              <button type="button" className={`${styles.tile} ${styles.plan}`} onClick={() => setPlanOpen(true)}>
                <span className={styles.kick}>✦ {arrived ? "YOUR FIRST EVENING" : "PLAN MY EVENING"}</span>
                <span className={styles.tileTitle}>
                  {plan
                    ? `${plan.stops[0].pick.kind === "EAT" ? "Dinner" : plan.stops[0].pick.kind === "DRINK" ? "Drinks" : plan.stops[0].pick.name} ${clock(plan.stops[0].time).replace(/ ?[ap]m/i, "")}, then ${plan.stops[1].pick.name}`
                    : wantsFood ? "Dinner and something nearby" : "Two things to do nearby"}
                </span>
                <span className={styles.tileSub}>{plans.length > 1 ? `${plans.length} plans ›` : "Plan it ›"}</span>
              </button>
            )}

            {!styleLeads &&
              (() => {
                const plain = (
                  <button type="button" className={`${styles.tile} ${styles.style}`} onClick={() => router.push("/style")}>
                    <span className={styles.kick}>STYLE · BETA</span>
                    <span className={styles.tileTitle}>Looks for your plans</span>
                    <Mascot prop="shades" size={44} className={styles.tileCheese} />
                    <span className={styles.tileSub}>Have a look ›</span>
                  </button>
                );
                // Today's chosen look, or What to wear for the plan they chose;
                // the plain tile otherwise, or for someone without Style.
                return <WearCard tile className={`${styles.tile} ${styles.style}`} plan={chosenPlan} fallback={plain} />;
              })()}
          </div>

          {/* Always there: trips are part of what Feta is (founder, 14 Nov 2026). */}
          <button type="button" className={`${styles.tile} ${styles.trip}`} onClick={() => router.push(`/ask?q=${encodeURIComponent("Plan a trip for me")}`)}>
            <span className={styles.kick}>✈ PLAN A TRIP</span>
            <span className={styles.tileTitle}>Where to next? Feta plans it day by day</span>
            <span className={styles.tileSub}>Start a trip ›</span>
            <Mascot pose="walk" prop="suitcase" size={84} className={styles.tripCheese} />
          </button>
        </div>
      </main>
      <CheckIn />
      <RepliesPill />
      <TesterForm />
      <SaveTaste ready={noPlaces || (!!leadSlot && !leadSlot.loading)} onRestored={() => window.location.reload()} />
      <TabBar active="home" />
      <CheesePull scroller={scroller} onRefresh={freshSet} enabled={!nothingYet} />
      {planOpen && (
        <PlanSheet when={when} cityId={city.id} loading={(!planFood && !planDo) || !!planFood?.loading || !!planDo?.loading} food={planFood?.picks ?? []} experiences={planDo?.picks ?? []} onClose={() => setPlanOpen(false)} />
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
      {fetaOpen && <FetaPicksSheet origin={origin} when={when} onClose={() => setFetaOpen(false)} />}
      {firstTime && <FirstTime want={firstTime} onClose={() => setFirstTime(null)} onDone={() => firstTimeDone(firstTime)} />}
    </>
  );
}
