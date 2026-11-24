"use client";

import PickPhoto from "@/components/PickPhoto";
import { logEvent } from "@/lib/db";
import { useEffect, useState } from "react";
import SendToGroup from "@/components/SendToGroup";
import { formatDistance } from "@/lib/cities";
import { fetchNotes, type Pick, type PlaceNotes } from "@/lib/picks-client";
import styles from "./PickDetails.module.css";
import WearCard from "@/components/WearCard";
import { planFromStops } from "@/lib/style-client";

// Details for one pick, from Picks home or from a chat card: photo, verdict,
// the live Google line, why it's yours, what to order or highlights (from
// Google Maps reviews, with the sources Google requires), and the actions.

// Plain words for the kind of pick (testers: "EAT" and "DO" meant nothing).
const KIND_LABELS: Record<string, string> = { EAT: "Food", DRINK: "Drinks", DO: "To do", EVENT: "Event" };
export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;

// Feta Favourites: how many Feta users recommend it (never who).
// Google's stars, e.g. "★ 4.5 (1.2k)", credited with the Google Maps line.
export const stars = (p: Pick) =>
  p.rating ? `★ ${p.rating.toFixed(1)}${p.ratingCount ? ` (${p.ratingCount >= 1000 ? `${(p.ratingCount / 1000).toFixed(1).replace(/\.0$/, "")}k` : p.ratingCount})` : ""}` : null;

export function lovedLabel(n?: number) {
  return n ? `♥ Loved by ${n} Feta ${n === 1 ? "user" : "users"}` : null;
}

// Why a curated place is here, under its reason: loved by Feta users, a
// local favourite (founder, 19 Nov 2026; never says where the list came
// from), featured in a city guide (the link is in its details), or an event
// found on one of the city's sites from her list (founder, 22 Nov 2026).
export function curatedLabel(p: { lovedBy?: number; local?: boolean; featured?: { guide: string }; event?: { site: string; fromList?: boolean } }) {
  if (p.event?.fromList) return `📍 Found on ${p.event.site} · Feta's guide list`;
  return lovedLabel(p.lovedBy) ?? (p.local ? "📍 Local favourite" : p.featured ? `📰 Featured in ${p.featured.guide}` : null);
}

// The verdict in words. With "Anywhere in <city>" Feta doesn't know where
// they are, so no "detour" or "nearby" (testers: "a detour from where?").
export function verdictLabel(p: Pick) {
  if (p.verdict === "Skip unless") return `Skip unless ${p.skipUnless ?? "you're curious"}`;
  const anywhere = !p.event && !p.distanceKm;
  if (anywhere && p.verdict === "Worth a detour") return "One of the best";
  if (anywhere && p.verdict === "Good if you're nearby") return "A good pick";
  return p.verdict;
}

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

  const verdict = verdictLabel(pick);

  return (
    <>
      <div className={styles.dim} onClick={onClose} />
      <div className={styles.sheet} role="dialog" aria-label={pick.name}>
        <div className={styles.hero}>
          {/* Swipe for more of the place's photos (tester, 19 Nov 2026: "to understand the ambience and food", and the menu when it's there). */}
          <div className={styles.photos}>
            {[pick.photo, ...(pick.morePhotos ?? [])].map(
              (photo, i) =>
                photo && (
                  <div key={i} className={styles.slide}>
                    <PickPhoto photo={photo} />
                    <span className={styles.credit}>
                      Photo: {photo.credit} · <span translate="no">Google Maps</span>
                    </span>
                  </div>
                ),
            )}
          </div>
          <span className={styles.kind}>{kindLabel(pick.kind)}</span>
          {pick.fetaNote !== undefined && <span className={styles.fetaBadge}>★ FETA PICK</span>}
          {!!pick.morePhotos?.length && <span className={styles.count}>{pick.morePhotos.length + 1} photos ›</span>}
        </div>

        <p className={styles.meta}>
          {[stars(pick), pick.area, pick.distanceKm ? formatDistance(pick.distanceKm, pick.country) : null, pick.event && pick.chips[0]].filter(Boolean).join(" · ")}
        </p>
        <h2 className={styles.name}>{pick.name}</h2>
        <p className={styles.verdict}>{verdict}</p>

        {pick.event ? <SearchChip html={pick.event.searchHtml} /> : <div className={styles.google}><GoogleLine pick={pick} /></div>}
        {pick.featured && (
          <>
            <a className={styles.loved} href={pick.featured.url} target="_blank" rel="noopener noreferrer">
              📰 Featured in {pick.featured.guide} ↗
            </a>
            <SearchChip html={pick.featured.searchHtml} found="guides" />
          </>
        )}

        {pick.fetaNote && (
          <>
            <p className={styles.label}>FETA PICK</p>
            <p className={styles.fetaNote}>“{pick.fetaNote}”</p>
          </>
        )}
        {!pick.featured && curatedLabel(pick) && <p className={styles.loved}>{curatedLabel(pick)}</p>}
        {/* Only when there's something real to say (reasons can be empty by design). */}
        {(pick.because || pick.chips.length > 0) && (
          <>
            <p className={styles.label}>WHY IT&apos;S YOURS</p>
            {pick.because && <p className={styles.because}>{pick.because}</p>}
            {pick.chips.length > 0 && (
              <div className={styles.chips}>
                {pick.chips.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            )}
          </>
        )}
        {/* What to wear here, from their styles (founder, 20 Nov 2026). */}
        <div style={{ marginTop: 12 }}>
          <WearCard here plan={planFromStops([{ name: pick.name, kind: pick.kind }], null)} />
        </div>

        {pick.event ? (
          pick.event.priceText && (
            <>
              <p className={styles.label}>TICKETS</p>
              <p className={styles.because}>{pick.event.priceText}, on {pick.event.site}.</p>
            </>
          )
        ) : notes && notes.items.length === 0 ? null : (
          // Nothing found: the section goes, rather than a wait then nothing (Round 5 review).
          <>
            <p className={styles.label}>{pick.kind === "DO" ? "HIGHLIGHTS" : "WHAT TO ORDER"}</p>
            {notes === null ? (
              <p className={styles.loading}>Reading what people say…</p>
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
                  {/* Sources' own titles ("Review of …"), so not "From reviews on Review of…" (Round 6). */}
                  Sources:{" "}
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
// Google's Search suggestions, shown as Google gives them, next to what
// they found: events, or the guides a "Featured in" place came from (Round 5
// review: on the food list it said "Events found" above a guide search).
export function SearchChip({ html, found = "events" }: { html: string; found?: "events" | "guides" }) {
  // An event from a city's free open-data feed was found without Google Search: no chip.
  if (!html) return null;
  return (
    <div className={styles.searchWrap}>
      <span className={styles.searchLabel}>{found === "events" ? "Events" : "City guides"} found with Google Search:</span>
      {/* In a sealed frame: shown exactly as Google gives it, and nothing in
          it can run (security audit, 24 Nov 2026: it comes from the shared
          events cache, so a planted chip would have run on every phone).
          Its links open in a new tab. */}
      <iframe
        className={styles.searchChip}
        title="Google Search suggestions"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;background:transparent}</style>${html}`}
      />
    </div>
  );
}

// "Open now · closes 23:30 · checked on Google Maps", with the words
// "Google Maps" linked to the place and never translated (founder, 22 Nov
// 2026: the hours are Google's, so it says so; "checked just now" read as
// Feta's own check when Google's hours were wrong).
export function GoogleLine({ pick }: { pick: Pick }) {
  const text = pick.googleLine.replace(/ ?Google Maps$/, "");
  return (
    <>
      {text}{" "}
      <a href={pick.mapsUri} target="_blank" rel="noopener noreferrer" translate="no">
        Google Maps
      </a>
    </>
  );
}
