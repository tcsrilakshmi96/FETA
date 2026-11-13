"use client";

import { useEffect } from "react";
import SendToGroup from "@/components/SendToGroup";
import { logEvent, savePickAction } from "@/lib/db";
import type { Pick } from "@/lib/picks-client";
import styles from "./Sheet.module.css";

// "Let's go": everything needed to actually go, in one place. The place is
// saved, so a day later Home asks "How was it?" and moves it to Been.
export default function LetsGo({ pick, cityId, onClose, onWhatsAfter }: { pick: Pick; cityId: string; onClose: () => void; onWhatsAfter?: () => void }) {
  useEffect(() => {
    if (pick.event) return;
    savePickAction(pick.placeId, "saved", { because: pick.because, category: pick.kind === "EAT" || pick.kind === "DRINK" ? "food_drinks" : "experiences", cityId });
  }, [pick, cityId]);

  return (
    <>
      <div className={styles.dim} onClick={onClose} />
      <div className={styles.sheet} role="dialog" aria-label={`Going to ${pick.name}`}>
        <p className={styles.kick}>{pick.event ? pick.chips[0] ?? "Soon" : "Have a great time"}</p>
        <h2 className={styles.title}>
          Enjoy <strong>{pick.name}!</strong>
        </h2>
        <div className={styles.steps}>
          <a href={pick.directionsUri} target="_blank" rel="noopener noreferrer" onClick={() => logEvent("directions", pick.placeId, cityId)}>
            <span className={styles.icon}>➜</span>
            <span>
              Directions
              <small>{pick.area} · Google Maps</small>
            </span>
          </a>
          {pick.book && (
            <a href={pick.book.url} target="_blank" rel="noopener noreferrer" onClick={() => logEvent("book", pick.placeId, cityId)}>
              <span className={styles.icon}>{pick.event ? "🎟" : "🍽"}</span>
              <span>
                {pick.book.label}
                <small>{pick.event ? "The ticket page" : "Book a table"}</small>
              </span>
            </a>
          )}
          {onWhatsAfter && (
            <button type="button" onClick={onWhatsAfter}>
              <span className={styles.icon}>✦</span>
              <span>
                What&apos;s after?
                <small>Something nearby for later</small>
              </span>
            </button>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          {/* Shares never include the personal reason (it can mention diet). */}
          <SendToGroup
            kind="pick"
            label="Tell your friends"
            message={`${pick.name}, ${pick.area}. Picked by Feta.`}
            payload={{
              title: pick.event ? pick.chips[0] ?? "Soon" : "A pick",
              stops: [
                {
                  placeId: pick.placeId,
                  kind: pick.kind,
                  ...(pick.fetaNote !== undefined ? { fetaNote: pick.fetaNote } : {}),
                  ...(pick.event ? { event: { title: pick.event.title, venueName: pick.event.venueName, date: pick.event.date, time: pick.event.time, url: pick.event.url, site: pick.event.site } } : {}),
                },
              ],
            }}
          />
        </div>
        {!pick.event && <p className={styles.note}>Saved in Saved. Tomorrow Feta asks how it was, and adds it to Been if you went.</p>}
        <button type="button" className={`btn-primary ${styles.go}`} onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}
