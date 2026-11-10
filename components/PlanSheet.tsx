"use client";

import SendToGroup from "@/components/SendToGroup";
import { clock, type Plan } from "@/lib/plan";
import styles from "./PlanSheet.module.css";

// "Plan my evening": two stops close together, with times, ready to send.
export default function PlanSheet({ plan, loading, when, onClose }: { plan: Plan | null; loading: boolean; when: "tonight" | "weekend"; onClose: () => void }) {
  const [a, b] = plan ? plan.stops : [null, null];
  return (
    <>
      <div className={styles.dim} onClick={onClose} />
      <div className={styles.sheet} role="dialog" aria-label="Plan my evening">
        {loading ? (
          <p className={styles.title}>
            Putting your evening <strong>together…</strong>
          </p>
        ) : !plan ? (
          <>
            <p className={styles.title}>
              Nothing pairs up <strong>nicely.</strong>
            </p>
            <p className={styles.sub}>
              I couldn&apos;t find a place to eat and something to do within a short walk or ride of each other
              {when === "tonight" ? " that are still open tonight" : " this weekend"}. Try {when === "tonight" ? "This weekend" : "another area"}, or Show me 3 more.
            </p>
          </>
        ) : (
          <>
            <p className={styles.title}>
              {plan.day}, <strong>sorted.</strong>
            </p>
            <ol className={styles.stops}>
              {plan.stops.map((stop, i) => (
                <li key={stop.pick.placeId}>
                  {i === 1 && (
                    <p className={styles.travel}>
                      {plan.minutes}-minute {plan.mode} · {plan.km} km
                    </p>
                  )}
                  <div className={styles.stop}>
                    <span className={styles.time}>{clock(stop.time)}</span>
                    <span className={styles.pic}>
                      {stop.pick.photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={stop.pick.photo.uri} alt="" referrerPolicy="no-referrer" />
                      )}
                    </span>
                    <span className={styles.text}>
                      <span className={styles.kind}>{stop.pick.kind}</span>
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
            <SendToGroup
              kind="plan"
              message={`${plan.day}: ${a!.pick.name} at ${clock(a!.time)}, then ${b!.pick.name} at ${clock(b!.time)}.`}
              payload={{
                title: plan.day,
                travel: { km: plan.km, minutes: plan.minutes, mode: plan.mode },
                stops: plan.stops.map((s) => ({
                  placeId: s.pick.placeId,
                  kind: s.pick.kind,
                  time: s.time.toISOString(),
                  ...(s.pick.fetaNote ? { fetaNote: s.pick.fetaNote } : {}),
                  ...(s.pick.event
                    ? { event: { title: s.pick.event.title, venueName: s.pick.event.venueName, date: s.pick.event.date, time: s.pick.event.time, url: s.pick.event.url, site: s.pick.event.site } }
                    : {}),
                })),
              }}
            />
            <a
              className={styles.directions}
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(b!.pick.name)}${b!.pick.event ? "" : `&destination_place_id=${b!.pick.placeId}`}&waypoints=${encodeURIComponent(a!.pick.name)}${a!.pick.event ? "" : `&waypoint_place_ids=${a!.pick.placeId}`}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Directions for both
            </a>
          </>
        )}
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
