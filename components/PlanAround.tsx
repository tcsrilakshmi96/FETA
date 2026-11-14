"use client";

import { useEffect, useState } from "react";
import { directionsForBoth, sharePlan } from "@/components/PlanSheet";
import SendToGroup from "@/components/SendToGroup";
import { formatDistance } from "@/lib/cities";
import { logEvent } from "@/lib/db";
import { fetchNearDinner, type Pick, type When } from "@/lib/picks-client";
import { clock, planEvening, type Plan } from "@/lib/plan";
import styles from "./Sheet.module.css";

// "Plan around this" (testers, 12 Nov 2026: "let me pick, then Feta builds
// the rest"): they choose the dinner or drinks, Feta offers up to 3 things
// close by for before or after, with times, and they choose. Things to do
// on screen first; one search near the place only if none pair up.
export default function PlanAround({ anchor, experiences, when, cityId, onClose }: { anchor: Pick; experiences: Pick[]; when: When; cityId: string; onClose: () => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [chosen, setChosen] = useState<Plan | null>(null);

  useEffect(() => {
    let live = true;
    const pair = (afters: Pick[]) =>
      afters
        .filter((b) => b.placeId !== anchor.placeId)
        .map((b) => planEvening([anchor], [b], when))
        .filter((p): p is Plan => !!p)
        .sort((x, y) => x.km - y.km)
        .slice(0, 3);
    const onScreen = pair(experiences);
    if (onScreen.length >= 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- plans from the picks already on screen
      setPlans(onScreen);
      return;
    }
    fetchNearDinner(anchor, when, cityId, experiences.map((p) => p.placeId)).then((near) => {
      if (live) setPlans([...onScreen, ...pair(near)].slice(0, 3));
    });
    return () => {
      live = false;
    };
  }, [anchor, experiences, when, cityId]);

  const other = (p: Plan) => p.stops.find((s) => s.pick.placeId !== anchor.placeId)!;
  return (
    <>
      <div className={styles.dim} onClick={onClose} />
      <div className={styles.sheet} role="dialog" aria-label={`Plan around ${anchor.name}`}>
        <p className={styles.kick}>✦ Plan around {anchor.name}</p>
        {!chosen ? (
          <>
            <h2 className={styles.title}>
              {anchor.kind === "DRINK" ? "Drinks" : "Dinner"}, <strong>and what else?</strong>
            </h2>
            <p className={styles.sub}>Close by, open at the right time. You choose.</p>
            {plans === null && <p className={styles.note}>Finding something nearby…</p>}
            {plans?.length === 0 && <p className={styles.note}>Nothing close enough is open at the right time. Try Plan my evening for other pairs.</p>}
            <div className={styles.steps}>
              {plans?.map((p) => {
                const o = other(p);
                return (
                  <button key={o.pick.placeId} type="button" onClick={() => setChosen(p)}>
                    <span className={styles.icon}>{p.stops[0].pick.placeId === anchor.placeId ? "→" : "←"}</span>
                    <span>
                      {o.pick.name}
                      <small>
                        {p.stops[0].pick.placeId === anchor.placeId ? "After" : "Before"}, {clock(o.time)} · {p.minutes}-minute {p.mode} ({formatDistance(p.km, anchor.country)})
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.title}>
              Your <strong>{chosen.day.toLowerCase() === "tonight" ? "evening" : chosen.day}</strong>
            </h2>
            <div className={styles.steps}>
              {chosen.stops.map((s, i) => (
                <a key={s.pick.placeId} href={s.pick.directionsUri} target="_blank" rel="noopener noreferrer" onClick={() => logEvent("directions", s.pick.placeId, cityId)}>
                  <span className={styles.icon}>{i + 1}</span>
                  <span>
                    {clock(s.time)} · {s.pick.name}
                    <small>{i === 1 ? `${chosen.minutes}-minute ${chosen.mode} · ` : ""}Directions</small>
                  </span>
                </a>
              ))}
            </div>
            <a
              className={`btn-primary ${styles.go}`}
              style={{ display: "grid", placeItems: "center", textDecoration: "none" }}
              href={directionsForBoth(chosen.stops[0].pick, chosen.stops[1].pick, chosen.mode)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => logEvent("plan_directions", chosen.stops[0].pick.placeId, cityId)}
            >
              Route between the two
            </a>
            <div style={{ marginTop: 10 }}>
              <SendToGroup kind="plan" message={`${chosen.day}: ${chosen.stops.map((s) => s.pick.name).join(", then ")}. Planned with Feta.`} payload={sharePlan(chosen)} />
            </div>
            <button type="button" className={styles.ghost} onClick={() => setChosen(null)}>
              See the other options
            </button>
          </>
        )}
      </div>
    </>
  );
}
