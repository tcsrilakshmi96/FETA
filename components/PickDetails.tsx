"use client";

import { useEffect, useState } from "react";
import { fetchNotes, type Pick, type PlaceNotes } from "@/lib/picks-client";
import styles from "./PickDetails.module.css";

// Details for one pick, from Picks home or from a chat card: photo, verdict,
// the live Google line, why it's yours, what to order or highlights (from
// Google Maps reviews, with the sources Google requires), and the actions.

export default function PickDetails({ pick, onClose, onSave }: { pick: Pick; onClose: () => void; onSave: () => void }) {
  const [notes, setNotes] = useState<PlaceNotes | null>(null);

  useEffect(() => {
    if (pick.event) return;
    let live = true;
    fetchNotes(pick.placeId, pick.kind).then((n) => live && setNotes(n));
    return () => {
      live = false;
    };
  }, [pick]);

  // The shared link opens Feta's page for the place (never diet or chips).
  const link = pick.event ? pick.event.url : `${window.location.origin}/p/${encodeURIComponent(pick.placeId)}`;
  const share = `https://wa.me/?text=${encodeURIComponent(`${pick.name}, ${pick.area}. Picked for me by Feta.\n${link}`)}`;
  const verdict = pick.verdict === "Skip unless" ? `Skip unless ${pick.skipUnless ?? "you're curious"}` : pick.verdict;

  return (
    <>
      <div className={styles.dim} onClick={onClose} />
      <div className={styles.sheet} role="dialog" aria-label={pick.name}>
        <div className={styles.hero}>
          {pick.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pick.photo.uri} alt="" referrerPolicy="no-referrer" />
          )}
          <span className={styles.kind}>{pick.kind}</span>
          {pick.photo && (
            <span className={styles.credit}>
              Photo: {pick.photo.credit} · <span translate="no">Google Maps</span>
            </span>
          )}
        </div>

        <p className={styles.meta}>
          {[pick.area, pick.distanceKm ? `${pick.distanceKm} km` : null, pick.event && pick.chips[0]].filter(Boolean).join(" · ")}
        </p>
        <h2 className={styles.name}>{pick.name}</h2>
        <p className={styles.verdict}>{verdict}</p>

        {pick.event ? <SearchChip html={pick.event.searchHtml} /> : <div className={styles.google}><GoogleLine pick={pick} /></div>}

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

        <div className={styles.actions}>
          <a className={styles.primary} href={pick.book?.url ?? pick.mapsUri} target="_blank" rel="noopener noreferrer">
            {pick.book?.label ?? "Open in Google Maps"}
          </a>
          <a href={pick.directionsUri} target="_blank" rel="noopener noreferrer">
            Directions
          </a>
          <button type="button" onClick={onSave}>
            ♥ Save
          </button>
          <a href={share} target="_blank" rel="noopener noreferrer" className={styles.wide}>
            Share to WhatsApp
          </a>
        </div>
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
      <span className={styles.searchLabel}>Found on the web. See more on Google:</span>
      <div className={styles.searchChip} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// "Open now · closes 23:30 · checked just now · Google Maps", with the
// words "Google Maps" linked to the place and never translated.
export function GoogleLine({ pick }: { pick: Pick }) {
  const text = pick.googleLine.replace(/ · Google Maps$/, "");
  return (
    <>
      {text} ·{" "}
      <a href={pick.mapsUri} target="_blank" rel="noopener noreferrer" translate="no">
        Google Maps
      </a>
    </>
  );
}
