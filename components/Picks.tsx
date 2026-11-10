"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TabBar from "@/components/TabBar";
import { useToast } from "@/components/Toast";
import { savePickAction } from "@/lib/db";
import { cityById, loadOrigin, type Origin } from "@/lib/origin";
import { fetchPicks, type Category, type Pick, type When } from "@/lib/picks-client";
import styles from "./Picks.module.css";

function originKey(o: Origin) {
  return `${o.source}:${o.label}:${o.lat.toFixed(3)},${o.lng.toFixed(3)}`;
}

type Slot = { loading: boolean; picks: Pick[]; index: number; banner?: string; notice?: string };

const CATEGORY_KEY = "feta.category";
const THROW_PX = 80;
const SKIP_REASONS = ["Too far", "Too pricey", "Not my vibe", "Been there"];

type Sheet = { type: "details"; pick: Pick } | { type: "reason"; pick: Pick } | null;

export default function Picks() {
  const router = useRouter();
  const toast = useToast();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [when, setWhen] = useState<When>("tonight");
  const [category, setCategory] = useState<Category>("food_drinks");
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const startX = useRef(0);

  useEffect(() => {
    const saved = loadOrigin();
    if (!saved) {
      router.replace("/location");
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- origin and category are only readable in the browser */
    setOrigin(saved);
    try {
      if (localStorage.getItem(CATEGORY_KEY) === "experiences") setCategory("experiences");
    } catch {
      // Defaults to Food & drinks.
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [router]);

  // Picks are kept per place you're searching from, so a new area loads fresh.
  const key = `${origin ? originKey(origin) : ""}|${when}:${category}`;
  const slot = slots[key];

  const load = useCallback(
    async (w: When, c: Category, more = false) => {
      if (!origin) return;
      const k = `${originKey(origin)}|${w}:${c}`;
      setSlots((s) => ({ ...s, [k]: { loading: true, picks: [], index: 0 } }));
      const reply = await fetchPicks(c, w, origin, more);
      setSlots((s) => ({
        ...s,
        [k]: { loading: false, picks: reply.picks ?? [], index: 0, banner: reply.banner, notice: reply.notice ?? reply.error },
      }));
    },
    [origin],
  );

  // Each tab and category loads once and then keeps its own progress.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the first load for this slot
    if (origin && !slots[key]) load(when, category);
  }, [origin, key, slots, load, when, category]);

  const city = origin ? cityById(origin.cityId) : null;
  if (!origin || !city) return null;

  const picks = slot?.picks ?? [];
  const index = slot?.index ?? 0;
  const current = !slot?.loading ? picks[index] : undefined;
  const allSwiped = !!slot && !slot.loading && picks.length > 0 && index >= picks.length;
  const nothing = !!slot && !slot.loading && picks.length === 0;

  function chooseCategory(c: Category) {
    setCategory(c);
    try {
      localStorage.setItem(CATEGORY_KEY, c);
    } catch {
      // Remembering is a nicety.
    }
  }

  function advance() {
    setDragging(false);
    setDx(0);
    setSlots((s) => ({ ...s, [key]: { ...s[key], index: s[key].index + 1 } }));
  }

  function save(pick: Pick) {
    savePickAction(pick.placeId, "saved", { category, cityId: city!.id });
    toast("Saved to Want to try");
  }

  function decide(dir: 1 | -1) {
    if (!current) return;
    if (dir > 0) save(current);
    else {
      savePickAction(current.placeId, "skipped", { category, cityId: city!.id });
      setSheet({ type: "reason", pick: current });
    }
    advance();
  }

  function giveReason(pick: Pick, reason: string) {
    if (reason === "Been there") savePickAction(pick.placeId, "been", { category, cityId: city!.id });
    savePickAction(pick.placeId, "skipped", { reason, category, cityId: city!.id });
    setSheet(null);
    toast("Got it. That helps.");
  }

  const verb = category === "food_drinks" ? "eat" : "do";
  const pull = Math.max(-1, Math.min(1, dx / 100));

  return (
    <main className={styles.screen}>
      <div className={styles.top}>
        <div className={styles.segment} role="tablist" aria-label="When">
          <span className={styles.thumb} style={{ width: when === "tonight" ? 76 : 106, transform: when === "tonight" ? "none" : "translateX(76px)" }} />
          <button type="button" role="tab" aria-selected={when === "tonight"} className={`${styles.segBtn} ${when === "tonight" ? styles.segOn : ""}`} style={{ width: 76 }} onClick={() => setWhen("tonight")}>
            Tonight
          </button>
          <button type="button" role="tab" aria-selected={when === "weekend"} className={`${styles.segBtn} ${when === "weekend" ? styles.segOn : ""}`} style={{ width: 106 }} onClick={() => setWhen("weekend")}>
            This weekend
          </button>
        </div>
        <button type="button" className={styles.cityPill} onClick={() => router.push("/location")}>
          {origin.source === "area" ? origin.label : city.name} ▾
        </button>
      </div>

      <div className={styles.titleRow}>
        <h1 className={styles.title}>
          Your 3 to {verb} <strong>{when === "tonight" ? "tonight" : "this weekend"}</strong>
        </h1>
        <span className={styles.dots} aria-hidden="true">
          {Array.from({ length: picks.length > 0 ? picks.length : 3 }, (_, i) => (
            <span key={i} className={allSwiped ? styles.dotDone : i === index ? styles.dotOn : ""} />
          ))}
        </span>
      </div>

      <div className={styles.cats}>
        <button type="button" className={`${styles.cat} ${category === "food_drinks" ? styles.catOn : ""}`} onClick={() => chooseCategory("food_drinks")}>
          Food &amp; drinks
        </button>
        <button type="button" className={`${styles.cat} ${category === "experiences" ? styles.catOn : ""}`} onClick={() => chooseCategory("experiences")}>
          Experiences
        </button>
        <button type="button" className={`${styles.cat} ${styles.catSoon}`} onClick={() => toast("Style is coming soon.")}>
          Style · soon
        </button>
      </div>

      <div className={styles.deck}>
        {(!slot || slot.loading) && (
          <div className={styles.panel}>
            <div className={styles.loadBars}>
              <span />
              <span />
              <span />
            </div>
            <p className={styles.panelTitle}>
              Finding <strong>your 3</strong>…
            </p>
            <p className={styles.panelText}>Skipping the overhyped ones…</p>
          </div>
        )}

        {slot &&
          !slot.loading &&
          picks.map((pick, i) => {
            const pos = i - index;
            if (pos < 0 || pos > 1) return null;
            const active = pos === 0;
            const style = active
              ? { transform: `translateX(${dx}px) rotate(${dx / 18}deg)`, transition: dragging ? "none" : "transform .8s var(--ease-spring)", zIndex: 2 }
              : { opacity: dragging ? Math.min(1, Math.abs(dx) / 120) : 0, transform: "scale(.96)", zIndex: 1 };
            return (
              <div
                key={pick.placeId}
                className={styles.card}
                style={style}
                aria-hidden={!active}
                onPointerDown={(e) => {
                  if (!active) return;
                  setDragging(true);
                  startX.current = e.clientX;
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => dragging && active && setDx(e.clientX - startX.current)}
                onPointerUp={() => {
                  if (!dragging || !active) return;
                  setDragging(false);
                  if (Math.abs(dx) > THROW_PX) decide(dx > 0 ? 1 : -1);
                  else if (Math.abs(dx) < 6) {
                    setDx(0);
                    setSheet({ type: "details", pick });
                  } else setDx(0);
                }}
                onPointerCancel={() => {
                  setDragging(false);
                  setDx(0);
                }}
              >
                <div className={styles.photo}>
                  {pick.photo && (
                    // Google's photo address is short-lived, so it is shown as is.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pick.photo.uri} alt="" referrerPolicy="no-referrer" draggable={false} className="kenburns" />
                  )}
                  <div className={styles.scrim} />
                  {active && (
                    <>
                      <div className={styles.tint} style={{ background: "linear-gradient(270deg,rgba(255,79,123,.7),rgba(255,79,123,0) 55%)", opacity: Math.max(0, pull) }} />
                      <div className={styles.tint} style={{ background: "linear-gradient(90deg,rgba(255,243,238,.55),rgba(255,243,238,0) 55%)", opacity: Math.max(0, -pull) }} />
                    </>
                  )}
                  <span className={styles.kind}>{pick.kind}</span>
                  {pick.photo && (
                    <span className={styles.credit}>
                      Photo: {pick.photo.credit} · <span translate="no">Google Maps</span>
                    </span>
                  )}
                  {active && (
                    <>
                      <span className={`${styles.stamp} ${styles.stampSave}`} style={{ opacity: Math.max(0, pull) }}>
                        Save ♥
                      </span>
                      <span className={`${styles.stamp} ${styles.stampSkip}`} style={{ opacity: Math.max(0, -pull) }}>
                        Not for me
                      </span>
                    </>
                  )}
                  <div className={styles.info}>
                    <p className={styles.name}>{pick.name}</p>
                    <div className={styles.meta}>
                      <span className={styles.where}>
                        {pick.area} · {pick.distanceKm} km
                      </span>
                      <span className={styles.verdict}>
                        {pick.verdict === "Skip unless" ? `Skip unless ${pick.skipUnless ?? "you're curious"}` : pick.verdict}
                      </span>
                    </div>
                    <p className={styles.because}>{pick.because}</p>
                    <div className={styles.chips}>
                      {pick.chips.map((chip) => (
                        <span key={chip}>{chip}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

        {slot && !slot.loading && (slot.banner || (slot.notice && picks.length > 0)) && current && (
          <div className={styles.banner}>{slot.banner ?? slot.notice}</div>
        )}

        {allSwiped && (
          <div className={styles.panel} style={{ animation: "fa-up .5s ease-out" }}>
            <p className={styles.panelTitle}>
              That&apos;s <strong>your 3.</strong>
            </p>
            <p className={styles.panelText}>Want different ones? Tap Tweak these, or Ask below.</p>
            <button type="button" className={styles.panelBtn} onClick={() => load(when, category, true)}>
              Show me 3 more
            </button>
          </div>
        )}

        {nothing && (
          <div className={styles.panel}>
            <p className={styles.panelTitle}>
              Nothing <strong>yet.</strong>
            </p>
            <p className={styles.panelText}>{slot?.notice ?? "Nothing fits right now."}</p>
            <button type="button" className={styles.panelBtn} onClick={() => router.push("/location")}>
              Try another area
            </button>
          </div>
        )}
      </div>

      <div className={`${styles.google} ${current ? "" : styles.hidden}`}>
        {current && <GoogleLine pick={current} />}
      </div>

      <div className={`${styles.actions} ${current ? "" : styles.hidden}`}>
        <button type="button" aria-label="Not for me" className={`${styles.round} ${styles.skip}`} onClick={() => decide(-1)}>
          ✕
        </button>
        <button type="button" className={styles.details} onClick={() => current && setSheet({ type: "details", pick: current })}>
          Details
        </button>
        <button type="button" aria-label="Save" className={`${styles.round} ${styles.save}`} onClick={() => decide(1)}>
          ♥
        </button>
      </div>

      <button type="button" className={styles.tweak} onClick={() => toast("Tweaks are coming next.")}>
        <strong>Tweak these</strong>
        <span>quieter, cheaper…</span>
      </button>

      <TabBar active="picks" />

      {sheet && (
        <>
          <div className={styles.dim} onClick={() => setSheet(null)} />
          <div className={styles.sheet} role="dialog" aria-label={sheet.type === "details" ? sheet.pick.name : "Why not?"}>
            {sheet.type === "details" ? (
              <Details pick={sheet.pick} onSave={() => save(sheet.pick)} />
            ) : (
              <>
                <h2 className={styles.sheetTitle}>
                  Not for you? <strong>Why?</strong>
                </h2>
                <p className={styles.sheetSub}>Optional. It helps the next picks.</p>
                <div className={styles.reasons}>
                  {SKIP_REASONS.map((r) => (
                    <button key={r} type="button" onClick={() => giveReason(sheet.pick, r)}>
                      {r}
                    </button>
                  ))}
                </div>
              </>
            )}
            <button type="button" className={styles.sheetClose} onClick={() => setSheet(null)}>
              Close
            </button>
          </div>
        </>
      )}
    </main>
  );
}

// "Open now · closes 23:30 · checked just now · Google Maps", with the
// words "Google Maps" linked to the place and never translated.
function GoogleLine({ pick }: { pick: Pick }) {
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

function Details({ pick, onSave }: { pick: Pick; onSave: () => void }) {
  // Shareable text never includes diet or chips.
  const share = `https://wa.me/?text=${encodeURIComponent(`${pick.name}, ${pick.area}. Picked for me by Feta.\n${pick.mapsUri}`)}`;
  return (
    <>
      <h2 className={styles.sheetTitle}>{pick.name}</h2>
      <p className={styles.sheetSub}>
        {pick.kind} · {pick.area} · {pick.distanceKm} km
      </p>
      <p className={styles.sheetBecause}>{pick.because}</p>
      <div className={`${styles.google} ${styles.sheetGoogle}`}>
        <GoogleLine pick={pick} />
      </div>
      <div className={styles.sheetActions}>
        {pick.book ? (
          <a className={styles.primaryAction} href={pick.book.url} target="_blank" rel="noopener noreferrer">
            {pick.book.label}
          </a>
        ) : (
          <a className={styles.primaryAction} href={pick.mapsUri} target="_blank" rel="noopener noreferrer">
            Open in Google Maps
          </a>
        )}
        <a href={pick.directionsUri} target="_blank" rel="noopener noreferrer">
          Directions
        </a>
        <button type="button" onClick={onSave}>
          ♥ Save
        </button>
        <a href={share} target="_blank" rel="noopener noreferrer" style={{ gridColumn: "1 / -1" }}>
          Share to WhatsApp
        </a>
      </div>
    </>
  );
}
