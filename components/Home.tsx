"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PickPhoto from "@/components/PickPhoto";
import PlanSheet from "@/components/PlanSheet";
import TabBar from "@/components/TabBar";
import ThemeToggle from "@/components/ThemeToggle";
import { formatDistance } from "@/lib/cities";
import { nearMeIfAllowed } from "@/lib/near-me";
import { loadOrigin, type Origin } from "@/lib/origin";
import type { Category, Pick, When } from "@/lib/picks-client";
import { keptSlots, loadSlot, slotKey, type Slot } from "@/lib/picks-store";
import { clock, planEvenings } from "@/lib/plan";
import { weekendSummary } from "@/lib/weekend-client";
import styles from "./Home.module.css";

// Home (founder's design, 12 Nov 2026): a magazine headline, then tiles.
// Food & drinks and Experiences show their top pick; Your evening and This
// weekend lead to plans and Lists (Ask and Style are in the tab bar). The picks are the same ones the
// lists show, loaded once and shared, so Home costs no extra searches.

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
  const [h] = (p.event.time ?? "").split(":").map(Number);
  return { day, hour: Number.isFinite(h) ? String(((h + 11) % 12) + 1) : "", half: Number.isFinite(h) ? (h < 12 ? "AM" : "PM") : "" };
}

export default function Home() {
  const router = useRouter();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [when, setWhen] = useState<When>("tonight");
  const [slots, setSlots] = useState<Record<string, Slot>>(keptSlots);
  const [weekend, setWeekend] = useState<{ ticked: number; wishes: string[] } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);

  useEffect(() => {
    const saved = loadOrigin();
    if (!saved) {
      router.replace("/location");
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- the origin is only readable in the browser */
    if (cityDay(saved.city.timeZone).weekend) setWhen("weekend");
    /* eslint-enable react-hooks/set-state-in-effect */
    weekendSummary().then(setWeekend);
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

  if (!origin) return null;
  const city = origin.city;
  const day = cityDay(city.timeZone);
  // On a Saturday or Sunday morning the weekend tab is about today.
  const today = when === "weekend" && day.weekend && day.hour < 16;
  const open = (c: Category) => router.push(`/picks?c=${c}${when === "weekend" ? "&w=weekend" : ""}`);
  const where = (p: Pick) => [p.rating ? `★ ${p.rating.toFixed(1)}` : null, p.area, p.distanceKm > 0 && formatDistance(p.distanceKm, city.country)].filter(Boolean).join(" · ");
  const plan = plans[0];
  const wish = weekend?.wishes[0];

  function cover(c: Category, slot: Slot | undefined, wide: boolean) {
    const top = slot?.picks[0];
    const label = c === "food_drinks" ? "FOOD & DRINKS" : "EXPERIENCES";
    const badge = top ? eventBadge(top, city.timeZone) : null;
    return (
      <button type="button" className={`${styles.tile} ${styles.cover} ${wide ? styles.food : styles.exp}`} onClick={() => open(c)} aria-label={`${label.toLowerCase()}: see all`}>
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
            <span className={styles.count}>{wide ? `${slot.picks.length} picks ›` : `${slot.picks.length} ›`}</span>
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

  return (
    <>
      <main className={styles.screen}>
        <div className={styles.page}>
          <p className={styles.dateline}>
            <span>{day.label}</span>
            <span className={styles.right}>
              <button type="button" className={styles.area} onClick={() => router.push("/location")}>
                {(origin.source === "area" ? origin.label : origin.source === "gps" ? "Near you" : `All of ${city.name}`).toUpperCase()} ▾
              </button>
              <ThemeToggle />
            </span>
          </p>
          <h1 className={styles.mast}>
            {today ? "Today" : when === "tonight" ? "Tonight" : "This weekend"}, <i key={when}>made for you.</i>
          </h1>
          <div className={styles.seg} role="tablist" aria-label="When">
            {(["tonight", "weekend"] as const).map((w) => (
              <button key={w} type="button" role="tab" aria-selected={when === w} className={when === w ? styles.segOn : ""} onClick={() => setWhen(w)}>
                {w === "tonight" ? "Tonight" : "This weekend"}
              </button>
            ))}
          </div>

          <div className={styles.grid} key={when}>
            {cover("food_drinks", food, true)}
            {cover("experiences", exp, false)}

            <button
              type="button"
              className={`${styles.tile} ${styles.plan}`}
              onClick={() => (today ? router.push(`/ask?q=${encodeURIComponent(`Plan my whole day today in ${origin.source === "area" ? origin.label : city.name}`)}`) : setPlanOpen(true))}
            >
              <span className={styles.kick}>✦ {today ? "YOUR DAY" : when === "tonight" ? "YOUR EVENING" : "YOUR WEEKEND"}</span>
              <span className={styles.tileTitle}>
                {today
                  ? "Plan my whole day"
                  : plan
                    ? `${plan.stops[0].pick.kind === "EAT" ? "Dinner" : plan.stops[0].pick.kind === "DRINK" ? "Drinks" : plan.stops[0].pick.name} ${clock(plan.stops[0].time).replace(/ ?[ap]m/i, "")}, then ${plan.stops[1].pick.name}`
                    : "Dinner and something nearby"}
              </span>
              <span className={styles.tileSub}>{today ? "Breakfast to drinks ›" : plans.length > 1 ? `${plans.length} plans ›` : "Plan it ›"}</span>
            </button>

            <button type="button" className={`${styles.tile} ${styles.weekend}`} onClick={() => router.push("/lists")}>
              <span className={styles.kick}>THIS WEEKEND</span>
              <span className={styles.tileTitle}>
                {weekend && weekend.ticked > 0 ? `${weekend.ticked} ticked${wish ? ` + ${wish}` : ""}` : wish ? wish : "Tick places for Saturday"}
              </span>
            </button>

          </div>
        </div>
      </main>
      <TabBar active="home" />
      {planOpen && (
        <PlanSheet when={when} cityId={city.id} loading={!food || food.loading || !exp || exp.loading} food={food?.picks ?? []} experiences={exp?.picks ?? []} onClose={() => setPlanOpen(false)} />
      )}
    </>
  );
}
