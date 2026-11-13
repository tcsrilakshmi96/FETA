"use client";

import PickPhoto from "@/components/PickPhoto";
import { logEvent } from "@/lib/db";
import { useEffect, useState } from "react";
import SendToGroup from "@/components/SendToGroup";
import { formatDistance } from "@/lib/cities";
import { fetchNotes, type Pick, type PlaceNotes } from "@/lib/picks-client";
import styles from "./PickDetails.module.css";

// Details for one pick, from Picks home or from a chat card: photo, verdict,
// the live Google line, why it's yours, what to order or highlights (from
// Google Maps reviews, with the sources Google requires), and the actions.

// Plain words for the kind of pick (testers: "EAT" and "DO" meant nothing).
const KIND_LABELS: Record<string, string> = { EAT: "Food", DRINK: "Drinks", DO: "To do", EVENT: "Event" };
export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;

export default function PickDetails({
  pick,
  onClose,
  onSave,
  onSkip,
  onGo,
  onBeen,
}: {
  pick: Pick;
  onClose: () => void;
  onSave: () => void;
  onSkip?: () => void;
  onGo?: () => void;
  onBeen?: () => void;
}) {
  const [notes, setNotes] = useState<PlaceNotes | null>(null);

  useEffect(() => {
    if (pick.event) return;
    let live = true;
    fetchNotes(pick).then((n) => live && setNotes(n));
    return () => {
      live = false;
    };
  }, [pick]);

  const verdict = pick.verdict === "Skip unless" ? `Skip unless ${pick.skipUnless ?? "you're curious"}` : pick.verdict;

  return (
    <>
      <div className={styles.dim} onClick={onClose} />
      <div className={styles.sheet} role="dialog" aria-label={pick.name}>
        <div className={styles.hero}>
          <PickPhoto photo={pick.photo} />
          <span className={styles.kind}>{kindLabel(pick.kind)}</span>
          {pick.fetaNote !== undefined && <span className={styles.fetaBadge}>★ FETA PICK</span>}
          {pick.photo && (
            <span className={styles.credit}>
              Photo: {pick.photo.credit} · <span translate="no">Google Maps</span>
            </span>
          )}
        </div>

        <p className={styles.meta}>
          {[pick.area, pick.distanceKm ? formatDistance(pick.distanceKm, pick.country) : null, pick.event && pick.chips[0]].filter(Boolean).join(" · ")}
        </p>
        <h2 className={styles.name}>{pick.name}</h2>
        <p className={styles.verdict}>{verdict}</p>

        {pick.event ? <SearchChip html={pick.event.searchHtml} /> : <div className={styles.google}><GoogleLine pick={pick} /></div>}

        {pick.fetaNote && (
          <>
            <p className={styles.label}>FETA PICK</p>
            <p className={styles.fetaNote}>“{pick.fetaNote}”</p>
          </>
        )}
        <p className={styles.label}>WHY IT&apos;S YOURS</p>
        <p className={styles.because}>{pick.because}</p>
        <div className={styles.chips}>
          {pick.chips.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>

        {pick.event ? (
          pick.event.priceText && (
            <>
              <p className={styles.label}>TICKETS</p>
              <p className={styles.because}>{pick.event.priceText}, on {pick.event.site}.</p>
            </>
          )
        ) : (
          <>
            <p className={styles.label}>{pick.kind === "DO" ? "HIGHLIGHTS" : "WHAT TO ORDER"}</p>
            {notes === null ? (
              <p className={styles.loading}>Reading what people say…</p>
            ) : notes.items.length === 0 ? (
              <p className={styles.loading}>Nothing clear from reviews yet.</p>
            ) : (
              <>
                <ol className={styles.notes}>
                  {notes.items.map((item, i) => (
                    <li key={item}>
                      <span>{i + 1}</span>
                      {item}
                    </li>
                  ))}
                </ol>
                {/* What reviews say about halal or Jain food: a signal, never a promise. */}
                {notes.dietSignal && (
                  <p className={styles.dietSignal}>
                    {notes.dietSignal.replace(/\.$/, "")}. Not confirmed, check with staff.
                  </p>
                )}
                <p className={styles.sources}>
                  From reviews on{" "}
                  {notes.sources.length > 0 ? (
                    notes.sources.map((s, i) => (
                      <span key={s.uri}>
                        {i > 0 && ", "}
                        <a href={s.uri} target="_blank" rel="noopener noreferrer">
                          {s.title}
                        </a>
                      </span>
                    ))
                  ) : (
                    <a href={pick.mapsUri} target="_blank" rel="noopener noreferrer">
                      {pick.name}
                    </a>
                  )}{" "}
                  · <span translate="no">Google Maps</span>
                </p>
              </>
            )}
          </>
        )}

        {onGo && (
          <button type="button" className={`btn-primary ${styles.go}`} onClick={onGo}>
            Let&apos;s go
          </button>
        )}
        <div className={styles.actions}>
          {/* Booking (India) or tickets lead; else Naver in Korea, else Google Maps. */}
          <a className={`${styles.primary} ${onGo ? styles.quiet : ""}`} href={pick.book?.url ?? pick.naverUri ?? pick.mapsUri} target="_blank" rel="noopener noreferrer" onClick={() => logEvent(pick.book ? "book" : "maps", pick.placeId)}>
            {pick.book?.label ?? (pick.naverUri ? "Open in Naver Map" : "Open in Google Maps")}
          </a>
          <a href={pick.directionsUri} target="_blank" rel="noopener noreferrer" onClick={() => logEvent("directions", pick.placeId)}>
            Directions
          </a>
          <button type="button" onClick={onSave}>
            ♥ Save
          </button>
          {(pick.book || pick.naverUri) && (
            <a className={pick.website && !pick.event ? "" : styles.wide} href={pick.mapsUri} target="_blank" rel="noopener noreferrer" onClick={() => logEvent("maps", pick.placeId)}>
              <span translate="no">Google Maps</span>
            </a>
          )}
          {pick.website && !pick.event && (
            <a className={pick.book || pick.naverUri ? "" : styles.wide} href={pick.website} target="_blank" rel="noopener noreferrer" onClick={() => logEvent("website", pick.placeId)}>
              Website
            </a>
          )}
        </div>
        <div className={styles.group}>
          {/* Shares never include the personal reason (it can mention diet). */}
          <SendToGroup
            kind="pick"
            message={`${pick.name}, ${pick.area}. Picked by Feta.`}
            payload={{
              title: pick.event ? pick.chips[0] ?? "Soon" : "A pick",
              stops: [
                {
                  placeId: pick.placeId,
                  kind: pick.kind,
                  ...(pick.fetaNote !== undefined ? { fetaNote: pick.fetaNote } : {}),
                  ...(pick.event
                    ? { event: { title: pick.event.title, venueName: pick.event.venueName, date: pick.event.date, time: pick.event.time, url: pick.event.url, site: pick.event.site } }
                    : {}),
                },
              ],
            }}
          />
        </div>
        {onBeen && (
          <button type="button" className={styles.close} onClick={onBeen}>
            Been there
          </button>
        )}
        {onSkip && (
          <button type="button" className={styles.close} onClick={onSkip}>
            Not for me
          </button>
        )}
        <button type="button" className={styles.close} onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}

// Google's "Search Suggestions" chip for an event found by web search.
// Google requires it shown unaltered, next to and as wide as the result.
export function SearchChip({ html }: { html: string }) {
  return (
    <div className={styles.searchWrap}>
      <span className={styles.searchLabel}>Events found with Google Search:</span>
      <div className={styles.searchChip} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// "Open now · closes 23:30 · checked just now · Google Maps", with the
// words "Google Maps" linked to the place and never translated.
export function GoogleLine({ pick }: { pick: Pick }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const mins = pick.checkedAt ? Math.floor((now - pick.checkedAt) / 60000) : 0;
  const text = pick.googleLine.replace(/ · Google Maps$/, "").replace("checked just now", mins >= 2 ? `checked ${mins} min ago` : "checked just now");
  return (
    <>
      {text} ·{" "}
      <a href={pick.mapsUri} target="_blank" rel="noopener noreferrer" translate="no">
        Google Maps
      </a>
    </>
  );
}
