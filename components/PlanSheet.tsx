"use client";

import { kindLabel } from "@/components/PickDetails";
import PickPhoto from "@/components/PickPhoto";
import { useEffect, useMemo, useState } from "react";
import SendToGroup from "@/components/SendToGroup";
import WhatsAppBox from "@/components/WhatsAppBox";
import { formatDistance } from "@/lib/cities";
import { fetchNearDinner, type Pick } from "@/lib/picks-client";
import { logEvent } from "@/lib/db";
import { clock, planEvenings, type Plan } from "@/lib/plan";
import styles from "./PlanSheet.module.css";

// Found near a dinner pick, kept while the app is open so reopening the
// sheet makes no new search.
const nearKept = new Map<string, Promise<Pick[]>>();

// "Plan my evening": up to 4 different evenings, each two stops close
// together, with times, ready to send.
// The picks on screen first; if none pair up (experiences are often across
// town), one search for something close to the best dinner.
// One plan as share data: place IDs, times, event links and Feta-pick notes
// (never diet or the personal reason).
export function sharePlan(p: Plan) {
  return {
    title: p.day,
    travel: { km: p.km, minutes: p.minutes, mode: p.mode },
    country: p.stops[0].pick.country,
    stops: p.stops.map((s) => ({
      placeId: s.pick.placeId,
      kind: s.pick.kind,
      time: s.time.toISOString(),
      ...(s.pick.fetaNote !== undefined ? { fetaNote: s.pick.fetaNote } : {}),
      ...(s.pick.event
        ? { event: { title: s.pick.event.title, venueName: s.pick.event.venueName, date: s.pick.event.date, time: s.pick.event.time, url: s.pick.event.url, site: s.pick.event.site } }
        : {}),
    })),
  };
}

// Directions to the second stop via the first, by exact coordinates (with
// place IDs), so Google Maps can't land on a different place of that name.
export function directionsForBoth(first: Pick, second: Pick) {
  const spot = (p: Pick) => (p.lat !== undefined && p.lng !== undefined ? `${p.lat},${p.lng}` : encodeURIComponent(p.event ? `${p.event.venueName}` : p.name));
  const ids = (key: string, p: Pick) => (p.event ? "" : `&${key}=${p.placeId}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${spot(second)}${ids("destination_place_id", second)}&waypoints=${spot(first)}${ids("waypoint_place_ids", first)}`;
}

export default function PlanSheet({
  food,
  experiences,
  cityId,
  loading,
  when,
  onClose,
}: {
  food: Pick[];
  experiences: Pick[];
  cityId: string;
  loading: boolean;
  when: "tonight" | "weekend";
  onClose: () => void;
}) {
  const onScreen = useMemo(() => (loading ? [] : planEvenings(food, experiences, when)), [loading, food, experiences, when]);
  const [choice, setChoice] = useState(0);
  const dinner = food.find((p) => p.kind === "EAT" && p.lat !== undefined) ?? food.find((p) => p.lat !== undefined);
  const nearKey = dinner ? `${when}|${dinner.placeId}` : "";
  const [near, setNear] = useState<{ key: string; picks: Pick[] } | null>(null);
  const searching = !loading && onScreen.length === 0 && !!dinner && near?.key !== nearKey;

  useEffect(() => {
    if (!searching || !dinner) return;
    let live = true;
    if (!nearKept.has(nearKey)) {
      const shown = [...food, ...experiences].map((p) => p.placeId);
      nearKept.set(nearKey, fetchNearDinner(dinner, when, cityId, shown));
    }
    nearKept.get(nearKey)!.then((picks) => live && setNear({ key: nearKey, picks }));
    return () => {
      live = false;
    };
  }, [searching, dinner, nearKey, food, experiences, when, cityId]);

  const plans = onScreen.length > 0 ? onScreen : near?.key === nearKey && dinner ? planEvenings(food, near.picks, when) : [];
  const plan = plans[Math.min(choice, plans.length - 1)] ?? null;
  const [a, b] = plan ? plan.stops : [null, null];
  return (
    <>
      <div className={styles.dim} onClick={onClose} />
      <div className={styles.sheet} role="dialog" aria-label="Plan my evening">
        {loading || searching ? (
          <p className={styles.title}>
            Putting your evening <strong>together…</strong>
          </p>
        ) : !plan ? (
          <>
            <p className={styles.title}>
              Nothing pairs up <strong>nicely.</strong>
            </p>
            <p className={styles.sub}>
              I couldn&apos;t find a place to eat and something to do or a drink close to it
              {when === "tonight" ? " that are open tonight at a good time" : " this weekend"}. Try {when === "tonight" ? "This weekend" : "another area"}, or Show me more.
            </p>
          </>
        ) : (
          <>
            <p className={styles.title}>
              {plan.day}, <strong>sorted.</strong>
            </p>
            {plans.length > 1 && (
              <div className={styles.options} role="tablist" aria-label="Plans">
                {plans.map((p, i) => (
                  <button key={i} type="button" role="tab" aria-selected={plan === p} className={plan === p ? styles.optionOn : ""} onClick={() => setChoice(i)}>
                    Plan {i + 1}
                  </button>
                ))}
              </div>
            )}
            <ol className={styles.stops}>
              {plan.stops.map((stop, i) => (
                <li key={stop.pick.placeId}>
                  {i === 1 && (
                    <p className={styles.travel}>
                      {plan.minutes}-minute {plan.mode} · {formatDistance(plan.km, plan.stops[0].pick.country)}
                    </p>
                  )}
                  <div className={styles.stop}>
                    <span className={styles.time}>{clock(stop.time)}</span>
                    <span className={styles.pic}>
                      <PickPhoto photo={stop.pick.photo} />
                    </span>
                    <span className={styles.text}>
                      <span className={styles.kind}>{kindLabel(stop.pick.kind)}</span>
                      <strong>{stop.pick.name}</strong>
                      <span className={styles.area}>{stop.pick.area}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            <p className={styles.attribution}>
              Places and photos: <span translate="no">Google Maps</span>
            </p>
            {plans.length > 1 && (
              <SendToGroup
                kind="choice"
                label={`Let the group choose (${Math.min(3, plans.length)} plans)`}
                message={`${plan.day}: ${Math.min(3, plans.length)} plans from Feta.`}
                payload={{
                  title: plan.day,
                  country: plan.stops[0].pick.country,
                  options: plans.slice(0, 3).map((p) => sharePlan(p)),
                }}
              />
            )}
            <SendToGroup
              kind="plan"
              message={`${plan.day}: ${a!.pick.name} at ${clock(a!.time)}, then ${b!.pick.name} at ${clock(b!.time)}.`}
              payload={{
                title: plan.day,
                travel: { km: plan.km, minutes: plan.minutes, mode: plan.mode },
                country: plan.stops[0].pick.country,
                stops: plan.stops.map((s) => ({
                  placeId: s.pick.placeId,
                  kind: s.pick.kind,
                  time: s.time.toISOString(),
                  ...(s.pick.fetaNote !== undefined ? { fetaNote: s.pick.fetaNote } : {}),
                  ...(s.pick.event
                    ? { event: { title: s.pick.event.title, venueName: s.pick.event.venueName, date: s.pick.event.date, time: s.pick.event.time, url: s.pick.event.url, site: s.pick.event.site } }
                    : {}),
                })),
              }}
            />
            {plans.length > 1 && (
              <button type="button" className={styles.another} onClick={() => setChoice((choice + 1) % plans.length)}>
                Not this one? See plan {((plans.indexOf(plan) + 1) % plans.length) + 1}
              </button>
            )}
            <a
              className={styles.directions}
              href={directionsForBoth(a!.pick, b!.pick)}
              onClick={() => logEvent("plan_directions", a!.pick.placeId)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Directions for both
            </a>
          </>
        )}
        <WhatsAppBox />
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
