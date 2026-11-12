"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PickDetails, { GoogleLine, SearchChip } from "@/components/PickDetails";
import PickPhoto from "@/components/PickPhoto";
import PlanSheet from "@/components/PlanSheet";
import TabBar from "@/components/TabBar";
import { useToast } from "@/components/Toast";
import { savePickAction, saveTweakLines } from "@/lib/db";
import { loadAnswers } from "@/lib/onboarding";
import { formatDistance } from "@/lib/cities";
import { loadOrigin, type Origin } from "@/lib/origin";
import { fetchPicks, type Category, type Pick, type When } from "@/lib/picks-client";
import { keepSlots, keptSlots, loadSlot, slotKey, type Slot } from "@/lib/picks-store";
import styles from "./Picks.module.css";

const SHOW = 8;
const CATEGORY_KEY = "feta.category";
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

const verdictText = (p: Pick) => (p.verdict === "Skip unless" ? `Skip unless ${p.skipUnless ?? "you're curious"}` : p.verdict);

export default function Picks() {
  const router = useRouter();
  const toast = useToast();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [when, setWhen] = useState<When>("tonight");
  const [category, setCategory] = useState<Category>("food_drinks");
  const [slots, setSlots] = useState<Record<string, Slot>>(keptSlots);

  useEffect(() => {
    keepSlots(slots);
  }, [slots]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [tweakNote, setTweakNote] = useState("");
  const [withKids, setWithKids] = useState(false);

  useEffect(() => {
    const saved = loadOrigin();
    if (!saved) {
      router.replace("/location");
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- origin and category are only readable in the browser */
    setOrigin(saved);
    setWithKids(loadAnswers().who.includes("family_kids"));
    // Opened from a Home cover: /picks?c=experiences&w=weekend.
    const params = new URLSearchParams(window.location.search);
    if (params.get("w") === "weekend") setWhen("weekend");
    let c = params.get("c");
    try {
      c ??= localStorage.getItem(CATEGORY_KEY);
    } catch {
      // Defaults to Food & drinks.
    }
    if (c === "experiences") setCategory("experiences");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [router]);

  // Picks are kept per place you're searching from, so a new area loads fresh.
  const key = origin ? slotKey(origin, when, category) : "";
  const slot = slots[key];

  const load = useCallback(
    async (w: When, c: Category, tweak?: { tweaks: string[]; note?: string }) => {
      if (!origin) return;
      const k = slotKey(origin, w, c);
      setSlots((s) => ({ ...s, [k]: { loading: true, picks: [], spares: [], saved: [] } }));
      const slot = await loadSlot(origin, w, c, tweak);
      setSlots((s) => ({ ...s, [k]: slot }));
    },
    [origin],
  );

  function tweak(tweaks: string[], note?: string) {
    saveTweakLines(tweaks);
    setSheet(null);
    setTweakNote("");
    load(when, category, { tweaks, note });
  }

  // "Show me more": the next 8 from the backup, or a new search once the
  // backup has run out. New ones go below the ones already shown.
  async function showMore() {
    if (!origin || !slot || slot.more) return;
    if (slot.spares.length > 0) {
      setSlots((s) => ({ ...s, [key]: { ...s[key], picks: [...s[key].picks, ...s[key].spares.slice(0, SHOW)], spares: s[key].spares.slice(SHOW) } }));
      return;
    }
    setSlots((s) => ({ ...s, [key]: { ...s[key], more: true } }));
    const reply = await fetchPicks(category, when, origin, true);
    const at = Date.now();
    const fresh = (reply.picks ?? []).filter((p) => !slot.picks.some((q) => q.placeId === p.placeId)).map((p) => ({ ...p, checkedAt: at }));
    if (fresh.length === 0) toast(reply.notice ?? "That's everything that fits right now. Try Tweak.");
    setSlots((s) => ({
      ...s,
      [key]: { ...s[key], more: false, picks: [...s[key].picks, ...fresh], spares: (reply.spares ?? []).map((p) => ({ ...p, checkedAt: at })) },
    }));
  }

  // Each tab and category loads once and then keeps its own progress.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the first load for this slot
    if (origin && !slots[key]) load(when, category);
  }, [origin, key, slots, load, when, category]);

  // Load the other category for the same tab at the same time, quietly, so
  // switching is instant (Experiences can take 10–15 s on a first search).
  const other: Category = category === "food_drinks" ? "experiences" : "food_drinks";
  const otherKey = origin ? slotKey(origin, when, other) : "";
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts a background load for the other category
    if (origin && slots[key] && !slots[otherKey]) load(when, other);
  }, [origin, key, otherKey, slots, load, when, other]);

  // Both categories for this tab, for Plan my evening.
  const foodSlot = origin ? slots[slotKey(origin, when, "food_drinks")] : undefined;
  const expSlot = origin ? slots[slotKey(origin, when, "experiences")] : undefined;

  const city = origin?.city ?? null;
  if (!origin || !city) return null;

  const picks = slot && !slot.loading ? slot.picks : [];
  const [hero, ...rest] = picks;
  const nothing = !!slot && !slot.loading && picks.length === 0;
  const eventChip = picks.find((p) => p.event)?.event?.searchHtml;

  function save(pick: Pick) {
    if (slot?.saved.includes(pick.placeId)) return;
    savePickAction(pick.placeId, "saved", { category, cityId: city!.id, because: pick.because });
    // Saving the big one moves it to the end (ticked), so the next pick
    // takes the big card, as a "Not for me" does.
    setSlots((s) => {
      const list = s[key].picks;
      const picks = list[0]?.placeId === pick.placeId ? [...list.slice(1), list[0]] : list;
      return { ...s, [key]: { ...s[key], picks, saved: [...s[key].saved, pick.placeId] } };
    });
    toast("Saved to Want to try");
  }

  // "Not for me": it leaves the list, and Feta asks why (optional).
  function skip(pick: Pick) {
    savePickAction(pick.placeId, "skipped", { category, cityId: city!.id });
    setSlots((s) => ({ ...s, [key]: { ...s[key], picks: s[key].picks.filter((p) => p.placeId !== pick.placeId) } }));
    setSheet({ type: "reason", pick });
  }

  function giveReason(pick: Pick, reason: string) {
    if (reason === "Been there") savePickAction(pick.placeId, "been", { category, cityId: city!.id });
    savePickAction(pick.placeId, "skipped", { reason, category, cityId: city!.id });
    setSheet(null);
    toast("Got it. That helps.");
  }

  const isSaved = (p: Pick) => !!slot?.saved.includes(p.placeId);
  const where = (p: Pick) => [p.area, p.distanceKm > 0 && formatDistance(p.distanceKm, city.country)].filter(Boolean).join(" · ");

  return (
    <main className={styles.screen}>
      <div className={styles.scroll}>
      <div className={styles.head}>
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
          <button type="button" className={styles.back} aria-label="Back to Home" onClick={() => router.push("/home")}>
            ‹
          </button>
          <h1 className={styles.title}>
            {category === "food_drinks" ? "Food & drinks" : "Experiences"} <strong>{when === "tonight" ? "tonight" : "this weekend"}</strong>
          </h1>
        </div>

        <div className={styles.tools}>
          <button type="button" className={styles.tool} onClick={() => setSheet({ type: "tweak" })}>
            ⚙ Tweak
          </button>
          <button type="button" className={styles.tool} onClick={() => setSheet({ type: "plan" })}>
            ✦ Plan my evening
          </button>
        </div>
      </div>

      {(!slot || slot.loading) && (
        <div className={styles.panel}>
          <div className={styles.loadBars}>
            <span />
            <span />
            <span />
          </div>
          <p className={styles.panelTitle}>
            Finding <strong>your picks</strong>…
          </p>
          <p className={styles.panelText}>Skipping the overhyped ones…</p>
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

      {hero && (
        <>
          {(slot?.banner || slot?.notice) && <div className={styles.banner}>{slot.banner ?? slot.notice}</div>}

          {/* The best fit, big. */}
          <div className={styles.hero} key={hero.placeId}>
            <button type="button" className={styles.photo} onClick={() => setSheet({ type: "details", pick: hero })} aria-label={`${hero.name}: details`}>
              <PickPhoto photo={hero.photo} className="kenburns" />
              <span className={styles.scrim} />
              <span className={styles.kind}>{hero.kind}</span>
              {hero.fetaNote !== undefined && <span className={styles.fetaBadge}>★ FETA PICK</span>}
              {hero.photo && (
                <span className={styles.credit}>
                  Photo: {hero.photo.credit} · <span translate="no">Google Maps</span>
                </span>
              )}
              <span className={styles.info}>
                <span className={styles.name}>{hero.name}</span>
                <span className={styles.meta}>
                  <span className={styles.where}>{where(hero)}</span>
                  <span className={styles.verdict}>{verdictText(hero)}</span>
                </span>
                <span className={styles.because}>{hero.because}</span>
                {hero.fetaNote && <span className={styles.fetaNote}>“{hero.fetaNote}”</span>}
                <span className={styles.chips}>
                  {hero.chips.map((chip) => (
                    <span key={chip}>{chip}</span>
                  ))}
                </span>
              </span>
            </button>
            {!hero.event && (
              <div className={styles.google}>
                <GoogleLine pick={hero} />
              </div>
            )}
            <div className={styles.actions}>
              <button type="button" aria-label="Not for me" className={`${styles.round} ${styles.skip}`} onClick={() => skip(hero)}>
                ✕
              </button>
              <button type="button" className={styles.details} onClick={() => setSheet({ type: "details", pick: hero })}>
                Details
              </button>
              <button type="button" aria-label="Save" className={`${styles.round} ${styles.save}`} onClick={() => save(hero)}>
                {isSaved(hero) ? "✓" : "♥"}
              </button>
            </div>
          </div>

          {rest.length > 0 && <p className={styles.section}>{rest.length} MORE THAT FIT</p>}
          <ul className={styles.rows}>
            {rest.map((p, i) => (
              <li key={p.placeId} className={styles.rowItem} style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}>
                <div
                  role="button"
                  tabIndex={0}
                  className={styles.row}
                  onClick={() => setSheet({ type: "details", pick: p })}
                  onKeyDown={(e) => e.key === "Enter" && setSheet({ type: "details", pick: p })}
                >
                  <span className={styles.pic}>
                    <PickPhoto photo={p.photo} />
                    {p.fetaNote !== undefined && <span className={styles.picStar}>★</span>}
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{p.name}</span>
                    <span className={styles.rowWhy}>{p.because}</span>
                    <span className={styles.rowMeta}>
                      {[where(p), p.event ? p.chips[0] : null].filter(Boolean).join(" · ")}
                      {p.verdict === "Worth a detour" && <span className={styles.rowDetour}>Worth a detour</span>}
                    </span>
                    {/* Google's credit, short; opening hours and the full verdict are in Details. */}
                    {!p.event && (
                      <span className={styles.rowGoogle}>
                        <a href={p.mapsUri} target="_blank" rel="noopener noreferrer" translate="no" onClick={(e) => e.stopPropagation()}>
                          Google Maps
                        </a>
                        {p.photo && ` · Photo: ${p.photo.credit}`}
                      </span>
                    )}
                  </span>
                </div>
                <button type="button" aria-label={`Save ${p.name}`} className={`${styles.rowSave} ${isSaved(p) ? styles.rowSaved : ""}`} onClick={() => save(p)}>
                  {isSaved(p) ? "✓" : "♥"}
                </button>
              </li>
            ))}
          </ul>

          {eventChip && <SearchChip html={eventChip} />}

          <button type="button" className={styles.more} disabled={slot?.more} onClick={showMore}>
            {slot?.more ? "Finding more…" : "Show me more"}
          </button>
        </>
      )}
      </div>

      <TabBar active="home" />

      {sheet?.type === "details" && (
        <PickDetails
          pick={sheet.pick}
          onClose={() => setSheet(null)}
          onSave={() => save(sheet.pick)}
          onSkip={() => skip(sheet.pick)}
        />
      )}

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
          <div className={styles.sheet} role="dialog" aria-label={sheet.type === "tweak" ? "Tweak these" : "Why not?"}>
            {sheet.type === "tweak" ? (
              <>
                <h2 className={styles.sheetTitle}>
                  Tweak <strong>these</strong>
                </h2>
                <p className={styles.sheetSub}>Pick one and I&apos;ll find new ones.</p>
                <div className={styles.reasons}>
                  {TWEAK_OPTIONS.filter((t) => t.id !== "kids" || withKids).map((t) => (
                    <button key={t.id} type="button" onClick={() => tweak([t.id])}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <form
                  className={styles.sayIt}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (tweakNote.trim()) tweak([], tweakNote.trim());
                  }}
                >
                  <input value={tweakNote} onChange={(e) => setTweakNote(e.target.value)} placeholder='Or say it, e.g. "rooftop with a view"' aria-label="Say what you want" maxLength={200} />
                  <button type="submit" aria-label="Find new ones" disabled={!tweakNote.trim()}>
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
