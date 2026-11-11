"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PickDetails, { GoogleLine, SearchChip } from "@/components/PickDetails";
import PlanSheet from "@/components/PlanSheet";
import TabBar from "@/components/TabBar";
import { useToast } from "@/components/Toast";
import { savePickAction, saveTweakLines } from "@/lib/db";
import { loadAnswers } from "@/lib/onboarding";
import { formatDistance } from "@/lib/cities";
import { loadOrigin, originKey, type Origin } from "@/lib/origin";
import { fetchPicks, type Category, type Pick, type When } from "@/lib/picks-client";
import styles from "./Picks.module.css";

type Slot = { loading: boolean; picks: Pick[]; index: number; banner?: string; notice?: string };

const CATEGORY_KEY = "feta.category";
const THROW_PX = 80;
const SKIP_REASONS = ["Too far", "Too pricey", "Not my vibe", "Been there"];

// The Tweak sheet. Ids match TWEAKS on the server.
const TWEAK_OPTIONS = [
  { id: "quieter", label: "Somewhere quieter" },
  { id: "cheaper", label: "Cheaper" },
  { id: "closer", label: "Closer" },
  { id: "outdoors", label: "Outdoors" },
  { id: "open_later", label: "Open later" },
  { id: "groups", label: "Better for groups" },
  { id: "kids", label: "Good with kids" },
];

type Sheet = { type: "details"; pick: Pick } | { type: "reason"; pick: Pick } | { type: "tweak" } | { type: "plan" } | null;

// Picks stay in the phone's memory while the app is open, so going to Lists
// and back doesn't pay Google to check the same places again. Never stored:
// a reload starts fresh, and nothing is kept for more than 20 minutes.
const KEEP_MS = 20 * 60000;
let kept: { slots: Record<string, Slot>; at: number } | null = null;

function keptSlots() {
  if (!kept || Date.now() - kept.at > KEEP_MS) return {};
  return Object.fromEntries(Object.entries(kept.slots).filter(([, s]) => !s.loading));
}

export default function Picks() {
  const router = useRouter();
  const toast = useToast();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [when, setWhen] = useState<When>("tonight");
  const [category, setCategory] = useState<Category>("food_drinks");
  const [slots, setSlots] = useState<Record<string, Slot>>(keptSlots);

  useEffect(() => {
    kept = { slots, at: kept && Object.keys(keptSlots()).length ? kept.at : Date.now() };
  }, [slots]);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [tweakNote, setTweakNote] = useState("");
  const [withKids, setWithKids] = useState(false);
  const startX = useRef(0);

  useEffect(() => {
    const saved = loadOrigin();
    if (!saved) {
      router.replace("/location");
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- origin and category are only readable in the browser */
    setOrigin(saved);
    setWithKids(loadAnswers().who.includes("family_kids"));
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
    async (w: When, c: Category, more = false, tweak?: { tweaks: string[]; note?: string; label: string }) => {
      if (!origin) return;
      const k = `${originKey(origin)}|${w}:${c}`;
      setSlots((s) => ({ ...s, [k]: { loading: true, picks: [], index: 0 } }));
      const reply = await fetchPicks(c, w, origin, more, tweak && { tweaks: tweak.tweaks, note: tweak.note });
      const tweakBanner = tweak && reply.picks?.length ? `${tweak.label}: here are ${reply.picks.length} new ones.` : undefined;
      setSlots((s) => ({
        ...s,
        [k]: { loading: false, picks: (reply.picks ?? []).map((p) => ({ ...p, checkedAt: Date.now() })), index: 0, banner: reply.banner ?? tweakBanner, notice: reply.notice ?? reply.error },
      }));
    },
    [origin],
  );

  function tweak(tweaks: string[], label: string, note?: string) {
    saveTweakLines(tweaks);
    setSheet(null);
    setTweakNote("");
    load(when, category, false, { tweaks, note, label });
  }

  // Each tab and category loads once and then keeps its own progress.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the first load for this slot
    if (origin && !slots[key]) load(when, category);
  }, [origin, key, slots, load, when, category]);

  // Load the other category for the same tab at the same time, quietly, so
  // switching is instant (Experiences can take 10–15 s on a first search).
  const other: Category = category === "food_drinks" ? "experiences" : "food_drinks";
  const otherKey = `${origin ? originKey(origin) : ""}|${when}:${other}`;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts a background load for the other category
    if (origin && slots[key] && !slots[otherKey]) load(when, other);
  }, [origin, key, otherKey, slots, load, when, other]);

  // Both categories for this tab, for Plan my evening.
  const foodSlot = slots[`${origin ? originKey(origin) : ""}|${when}:food_drinks`];
  const expSlot = slots[`${origin ? originKey(origin) : ""}|${when}:experiences`];

  const city = origin?.city ?? null;
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
    savePickAction(pick.placeId, "saved", { category, cityId: city!.id, because: pick.because });
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
          Your {picks.length > 0 && picks.length < 3 ? picks.length : 3} to {verb} <strong>{when === "tonight" ? "tonight" : "this weekend"}</strong>
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
        <button type="button" className={`${styles.cat} ${styles.catSoon}`} onClick={() => router.push("/style")}>
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
                  {pick.fetaNote && <span className={styles.fetaBadge}>★ FETA PICK</span>}
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
                        {pick.area} · {formatDistance(pick.distanceKm, city.country)}
                      </span>
                      <span className={styles.verdict}>
                        {pick.verdict === "Skip unless" ? `Skip unless ${pick.skipUnless ?? "you're curious"}` : pick.verdict}
                      </span>
                    </div>
                    <p className={styles.because}>{pick.because}</p>
                    {pick.fetaNote && <p className={styles.fetaNote}>“{pick.fetaNote}”</p>}
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

      {current?.event ? (
        <SearchChip html={current.event.searchHtml} />
      ) : (
        <div className={`${styles.google} ${current ? "" : styles.hidden}`}>{current && <GoogleLine pick={current} />}</div>
      )}

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

      <div className={styles.bottomRow}>
        <button type="button" className={styles.planBtn} onClick={() => setSheet({ type: "plan" })}>
          ✦ Plan my evening
        </button>
        <button type="button" className={styles.tweak} onClick={() => setSheet({ type: "tweak" })}>
          <strong>Tweak these</strong>
        </button>
      </div>

      <TabBar active="picks" />

      {sheet?.type === "details" && <PickDetails pick={sheet.pick} onClose={() => setSheet(null)} onSave={() => save(sheet.pick)} />}

      {sheet?.type === "plan" && (
        <PlanSheet
          when={when}
          cityId={city.id}
          loading={!foodSlot || foodSlot.loading || !expSlot || expSlot.loading}
          food={foodSlot?.picks ?? []}
          experiences={expSlot?.picks ?? []}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet && sheet.type !== "details" && sheet.type !== "plan" && (
        <>
          <div className={styles.dim} onClick={() => setSheet(null)} />
          <div
            className={styles.sheet}
            role="dialog"
            aria-label={sheet.type === "tweak" ? "Tweak these" : "Why not?"}
          >
            {sheet.type === "tweak" ? (
              <>
                <h2 className={styles.sheetTitle}>
                  Tweak <strong>these</strong>
                </h2>
                <p className={styles.sheetSub}>Pick one and I&apos;ll find 3 new ones.</p>
                <div className={styles.reasons}>
                  {TWEAK_OPTIONS.filter((t) => t.id !== "kids" || withKids).map((t) => (
                    <button key={t.id} type="button" onClick={() => tweak([t.id], t.label)}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <form
                  className={styles.sayIt}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (tweakNote.trim()) tweak([], `"${tweakNote.trim()}"`, tweakNote.trim());
                  }}
                >
                  <input
                    value={tweakNote}
                    onChange={(e) => setTweakNote(e.target.value)}
                    placeholder='Or say it, e.g. "rooftop with a view"'
                    aria-label="Say what you want"
                    maxLength={200}
                  />
                  <button type="submit" aria-label="Find 3 new ones" disabled={!tweakNote.trim()}>
                    ↑
                  </button>
                </form>
              </>
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
