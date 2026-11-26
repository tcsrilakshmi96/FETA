"use client";

import { firstSlotName } from "@/lib/slot-label";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CheesePull, { whatsNew } from "@/components/CheesePull";
import LetsGo from "@/components/LetsGo";
import Mascot from "@/components/Mascot";
import PickDetails, { curatedLabel, GoogleLine, kindLabel, SearchChip, stars, verdictLabel } from "@/components/PickDetails";
import PickPhoto from "@/components/PickPhoto";
import PlanSheet from "@/components/PlanSheet";
import TabBar from "@/components/TabBar";
import TellFeta from "@/components/TellFeta";
import type { PillPart } from "@/components/TopPill";
import { useToast } from "@/components/Toast";
import WaitFun from "@/components/WaitFun";
import { removeTweakLines, savePickAction, saveTweakLines } from "@/lib/db";
import { loadAnswers, type Answers } from "@/lib/onboarding";
import { loadWants } from "@/lib/profile";
import { removeLine } from "@/lib/profile-client";
import { loadSwipes } from "@/lib/swipes";
import { kindOfPlace } from "@/lib/place-words";
import { learnFromSkip, saveTaste } from "@/lib/taste-client";
import { formatDistance } from "@/lib/cities";
import { loadOrigin, type Origin } from "@/lib/origin";
import type { Category, Pick, When } from "@/lib/picks-client";
import { leaveLists, morePicks, openList, outOfDate, reloadList, savedOn, searchKey, shown, slotKey, tweakList, undoTweaks, usePicks } from "@/lib/picks-store";
import styles from "./Picks.module.css";
import { isNew, markSeen } from "@/lib/seen";

const CATEGORY_KEY = "feta.category";
// Not my vibe (founder, 18 Nov 2026, mock-up https://claude.ai/artifact/NxTQsfZQQQk63TYVz5BcF5):
// reasons written from the place itself, and each one changes what Feta
// finds from then on (with Undo), instead of a loose word for the ranking.
type Reason = { label: string; sub: string; learn?: () => Promise<{ said: string; undo: () => void } | null> };
const DISTANCES: [string, number][] = [["closer_1km", 1], ["walk_2km", 2], ["ride_5km", 5], ["city", 15]];

// One level cheaper: the top of their range comes down ("Depends" becomes up to the middle).
function cheaper(spend: string[]): string[] {
  const levels = spend.map((s) => Number(/^level_(\d)$/.exec(s)?.[1])).filter(Boolean).sort();
  if (levels.length === 0) return ["level_1", "level_2", "level_3"];
  if (levels.length > 1) return levels.slice(0, -1).map((l) => `level_${l}`);
  return levels[0] > 1 ? [`level_${levels[0] - 1}`] : spend;
}

function reasonsFor(pick: Pick, distanceText: string): Reason[] {
  const kind = kindOfPlace(pick.type);
  const answers = loadAnswers();
  const change = (next: Answers, said: string) => async () => {
    const swipes = loadSwipes();
    if (!(await saveTaste(next, swipes))) return null;
    return { said, undo: () => void saveTaste(answers, swipes) };
  };
  const line = (key: string, text: string, said: string) => async () => {
    const id = await learnFromSkip(key, text);
    return id ? { said, undo: () => void removeLine(id) } : null;
  };
  const limit = DISTANCES.find(([id]) => id === answers.distance)?.[1] ?? 5;
  const closer = [...DISTANCES].reverse().find(([, km]) => km < Math.min(limit, pick.distanceKm));
  const all: (Reason | null)[] = [
    kind && pick.type ? { label: `Not into ${kind}`, sub: "never shown again", learn: line(`notinto:${pick.type}`, `Not into ${kind}`, `no more ${kind}`) } : null,
    pick.kind === "DRINK" || (pick.ratingCount ?? 0) > 3000 ? { label: "Too loud and crowded", sub: "quieter places first", learn: line("skip:quiet", "Prefers quieter places", "quieter places") } : null,
    (pick.priceLevel ?? 0) >= 3 ? { label: "Too fancy for me", sub: "easier places first", learn: line("skip:casual", "Prefers easy, casual places", "easier places") } : null,
    (pick.priceLevel ?? 0) >= 2 || answers.spend.length ? { label: "Too pricey", sub: "your budget comes down a level", learn: change({ ...answers, spend: cheaper(answers.spend) }, "cheaper places") } : null,
    closer && pick.distanceKm > 0 ? { label: `Too far (${distanceText})`, sub: `up to ${closer[1]} km from now on`, learn: change({ ...answers, distance: closer[0] }, `up to ${closer[1]} km`) } : null,
    { label: "Been there", sub: "moves it to Been" },
  ];
  return all.filter((r): r is Reason => !!r);
}

// The Tweak sheet: pick any, tap again to undo. Ids match TWEAKS on the server.
const TWEAK_OPTIONS = [
  { id: "quieter", label: "Somewhere quieter" },
  { id: "cheaper", label: "Cheaper" },
  { id: "fancier", label: "Fancier" },
  { id: "closer", label: "Closer" },
  { id: "outdoors", label: "Outdoors" },
  { id: "open_later", label: "Open later" },
  { id: "groups", label: "Better for groups" },
  { id: "kids", label: "Good with kids" },
];

type Sheet =
  | { type: "details"; pick: Pick }
  | { type: "reason"; pick: Pick }
  | { type: "tweak" }
  | { type: "plan" }
  | { type: "go"; pick: Pick }
  | null;

// Cheaper and Fancier pull opposite ways, so only one at a time.
const OPPOSITE: Record<string, string> = { cheaper: "fancier", fancier: "cheaper" };



export default function Picks() {
  const router = useRouter();
  const toast = useToast();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [when, setWhen] = useState<When>("tonight");
  const [category, setCategory] = useState<Category>("food_drinks");
  // A search from the Search screen (/picks?q=…): the same list, for just
  // what they typed; no Tweak, Plan my evening or taste box (founder, 23 Nov 2026).
  const [search, setSearch] = useState<string | null>(null);
  // Every list is held by the picks store, shared with Home (founder, 25
  // Nov 2026: one owner, no copies to disagree).
  const lists = usePicks();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [tweakNote, setTweakNote] = useState("");
  const [tweakPick, setTweakPick] = useState<string[]>([]);
  const [withKids, setWithKids] = useState(false);
  const [compact, setCompact] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  // State, not a ref: the header first appears after loading, and must be
  // measured then (founder, 21 Nov 2026: it covered half the top photo).
  const [head, setHead] = useState<HTMLDivElement | null>(null);
  const [headSpace, setHeadSpace] = useState(0);

  // The header sits above the list, not in it, and the list keeps room for
  // the full header, so shrinking it never moves the list. When it was part
  // of the list, shrinking pulled the list back above the point where it
  // shrinks, and it flickered between big and small (tester video, 19 Nov 2026).
  // Measured when the header's size changes, not on every render (audit, 20 Nov 2026).
  useLayoutEffect(() => {
    const el = head;
    if (!el || compact) return;
    const measure = () => setHeadSpace(el.offsetHeight);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [head, compact]);

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
    // Both ways, every time: Next.js can bring this screen back as it was
    // left (testers: Food & drinks kept opening Things to do).
    const params = new URLSearchParams(window.location.search);
    setWhen(params.get("w") === "weekend" ? "weekend" : "tonight");
    setSearch(params.get("q")?.trim().slice(0, 80) || null);
    let c = params.get("c");
    try {
      c ??= localStorage.getItem(CATEGORY_KEY);
    } catch {
      // Defaults to Food & drinks.
    }
    setCategory(c === "experiences" ? "experiences" : "food_drinks");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [router]);

  // Picks are kept per place you're searching from, so a new area loads fresh.
  const keyOf = useCallback((o: Origin, w: When, c: Category) => (search ? searchKey(o, w, c, search) : slotKey(o, w, c)), [search]);
  const key = origin ? keyOf(origin, when, category) : "";
  const slot = key ? shown(lists, key) : undefined;
  const active = key ? lists.tweaked[key] : undefined;

  function tweak(tweaks: string[], note?: string) {
    if (!origin) return;
    setSheet(null);
    setTweakNote("");
    if (tweaks.length === 0 && !note) {
      undoAll();
      return;
    }
    const before = active?.tweaks ?? [];
    saveTweakLines(tweaks.filter((t) => !before.includes(t)));
    removeTweakLines(before.filter((t) => !tweaks.includes(t)));
    tweakList(origin, when, category, tweaks, note);
  }

  // Back to the everyday list, as it was.
  function undoAll() {
    if (!active) return;
    removeTweakLines(active.tweaks);
    undoTweaks(key);
  }

  function undoOne(id: string | null) {
    if (!active) return;
    const tweaks = id ? active.tweaks.filter((x) => x !== id) : active.tweaks;
    const note = id ? active.note : undefined;
    if (tweaks.length === 0 && !note) undoAll();
    else tweak(tweaks, note);
  }

  // "Show me more": new ones go below the ones already shown.
  async function showMore() {
    if (!origin) return;
    const next = await morePicks(origin, when, category, search, false);
    if (next.fresh.length === 0) toast(next.notice ?? "That's everything that fits right now. Try Tweak.");
  }

  // Pull down for a fresh set (founder, 16 Nov 2026): the next places
  // replace the ones on screen, and the pill says what's new.
  async function freshSet(): Promise<PillPart[]> {
    if (!origin || !slot || slot.loading || slot.more) return [];
    const next = await morePicks(origin, when, category, search, true);
    if (next.fresh.length === 0) return [{ text: next.notice ? "Nothing new just now" : "That's everything that fits" }];
    scroller.current?.scrollTo({ top: 0 });
    return whatsNew(next.fresh);
  }

  // Each list is opened once it's on screen, and again if it goes (past
  // its hour, or Today becoming Tonight).
  const missing = !slot || outOfDate(slot);
  useEffect(() => {
    if (origin) openList(origin, when, category, search);
  }, [origin, when, category, search, missing]);

  // Load the other category for the same tab at the same time, quietly, so
  // switching is instant (Experiences can take 10–15 s on a first search).
  // Only a category they chose (audit, 20 Nov 2026), and not for a search:
  // the other list is one tap away and searches only then.
  const other: Category = category === "food_drinks" ? "experiences" : "food_drinks";
  const otherMissing = origin ? !shown(lists, keyOf(origin, when, other)) : false;
  const ready = !!slot && !slot.loading;
  useEffect(() => {
    if (origin && !search && ready && otherMissing && loadWants().includes(other === "food_drinks" ? "food" : "do")) openList(origin, when, other);
  }, [origin, when, other, search, ready, otherMissing]);

  // Both categories for this tab, for Plan my evening.
  const foodSlot = origin ? shown(lists, slotKey(origin, when, "food_drinks")) : undefined;
  const expSlot = origin ? shown(lists, slotKey(origin, when, "experiences")) : undefined;

  // What's shown is remembered on the phone, so the next visit marks what's new.
  const shownIds = slot && !slot.loading ? slot.picks.map((p) => p.placeId).join("\n") : "";
  useEffect(() => {
    if (shownIds) markSeen(shownIds.split("\n"));
  }, [shownIds]);

  const city = origin?.city ?? null;
  if (!origin || !city) return null;

  const picks = slot && !slot.loading ? slot.picks : [];
  const [hero, ...rest] = picks;
  const nothing = !!slot && !slot.loading && picks.length === 0;
  // Google's Search chip, for events and places featured in a city guide (both found with Google Search).
  const eventHtml = picks.find((p) => p.event)?.event?.searchHtml;
  const eventChip = eventHtml ? { html: eventHtml, found: "events" as const } : picks.find((p) => p.featured)?.featured?.searchHtml ? { html: picks.find((p) => p.featured)!.featured!.searchHtml, found: "guides" as const } : null;

  function save(pick: Pick) {
    if (slot?.saved.includes(pick.placeId)) return;
    savePickAction(pick.placeId, "saved", { category, cityId: city!.id, because: pick.because });
    // Ticked here (the big one moves to the end, so the next pick takes the
    // big card) and gone from every other list.
    savedOn(key, pick.placeId);
    toast("Saved to Want to try");
  }

  // "Not for me": it leaves the list, and Feta asks why (optional).
  function skip(pick: Pick) {
    savePickAction(pick.placeId, "skipped", { category, cityId: city!.id });
    // Off every list, the everyday one under a Cheaper or Fancier list
    // included, so Undo never brings it back (audit, 24 Nov 2026).
    leaveLists(pick.placeId);
    setSheet({ type: "reason", pick });
  }

  // "Been there": off the list, into Been, and Feta leans towards places
  // they don't know yet (testers: "I know Bombay, show me others").
  function been(pick: Pick) {
    savePickAction(pick.placeId, "been", { category, cityId: city!.id });
    // Off every list, the everyday one under a Cheaper or Fancier list
    // included, so Undo never brings it back (audit, 24 Nov 2026).
    leaveLists(pick.placeId);
    setSheet(null);
    toast("Moved to Been. Feta will show you places you don't know yet.");
  }

  async function giveReason(pick: Pick, reason: Reason) {
    setSheet(null);
    savePickAction(pick.placeId, "skipped", { reason: reason.label, category, cityId: city!.id });
    if (!reason.learn) {
      savePickAction(pick.placeId, "been", { category, cityId: city!.id });
      toast("Moved to Been");
      return;
    }
    const learned = await reason.learn();
    if (!learned) return toast("Couldn't save that just now. It's still skipped.");
    toast(`Got it: ${learned.said}`, { label: "Undo", run: learned.undo });
  }

  const isSaved = (p: Pick) => !!slot?.saved.includes(p.placeId);
  const where = (p: Pick) => [stars(p), p.area, p.distanceKm > 0 && formatDistance(p.distanceKm, city.country)].filter(Boolean).join(" · ");

  return (
    <main className={styles.screen}>
      {/* The header shrinks to one line once the list scrolls (testers: it took 40% of the screen). */}
      <div ref={setHead} className={`${styles.head} ${compact ? styles.compact : ""}`}>
        <div className={styles.top}>
          <div className={styles.segment} role="tablist" aria-label="When">
            <span className={styles.thumb} style={{ width: when === "tonight" ? 76 : 106, transform: when === "tonight" ? "none" : "translateX(76px)" }} />
            <button type="button" role="tab" aria-selected={when === "tonight"} className={`${styles.segBtn} ${when === "tonight" ? styles.segOn : ""}`} style={{ width: 76 }} onClick={() => setWhen("tonight")}>
              {firstSlotName(origin?.city.timeZone)}
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
          <button type="button" className={styles.back} aria-label={search ? "Back to Search" : "Back to Home"} onClick={() => (search ? router.push("/search") : router.push("/home"))}>
            ‹
          </button>
          <h1 className={styles.title}>
            {search ? (
              <>“{search}”</>
            ) : (
              <>
                {category === "food_drinks" ? "Food & drinks" : "Things to do"} <strong>{when === "tonight" ? firstSlotName(origin?.city.timeZone).toLowerCase() : "this weekend"}</strong>
              </>
            )}
          </h1>
        </div>

        {search ? (
          // A search shows one list at a time; the other is a tap away.
          <div className={styles.tools}>
            {(["food_drinks", "experiences"] as Category[]).map((c) => (
              <button key={c} type="button" className={`${styles.tool} ${category === c ? styles.toolOn : ""}`} aria-pressed={category === c} onClick={() => setCategory(c)}>
                {c === "food_drinks" ? "Food & drinks" : "Things to do"}
              </button>
            ))}
          </div>
        ) : (
        // Tweak and Plan my evening read as a quiet line under the title, not
        // a third row of buttons (founder, 25 Nov 2026: "make it simpler").
        <div className={styles.tools}>
          <button
            type="button"
            className={styles.quiet}
            onClick={() => {
              setTweakPick(active?.tweaks ?? []);
              setTweakNote(active?.note ?? "");
              setSheet({ type: "tweak" });
            }}
          >
            ⚙ Tweak
          </button>
          <button type="button" className={styles.quiet} onClick={() => setSheet({ type: "plan" })}>
            ✦ Plan my evening
          </button>
          {/* Tweaks in force: tap ✕ to undo one. */}
          {active?.tweaks.map((t) => (
            <button key={t} type="button" className={`${styles.tool} ${styles.toolOn}`} onClick={() => undoOne(t)} aria-label={`Undo ${t}`}>
              {TWEAK_OPTIONS.find((o) => o.id === t)?.label ?? t} ✕
            </button>
          ))}
          {active?.note && (
            <button type="button" className={`${styles.tool} ${styles.toolOn}`} onClick={() => undoOne(null)} aria-label="Undo">
              “{active.note.slice(0, 24)}” ✕
            </button>
          )}
        </div>
        )}
      </div>
      <div ref={scroller} className={styles.scroll} style={{ paddingTop: headSpace }} onScroll={(e) => setCompact(e.currentTarget.scrollTop > 60)}>

      {(!slot || slot.loading) && (
        <div className={styles.panel}>
          <Mascot pose="walk" size={120} />
          <WaitFun kind="picks" game />
        </div>
      )}

      {nothing && (
        <div className={styles.panel}>
          {/* Melted when the search went wrong, sorry when nothing fits. */}
          <Mascot pose={slot?.failed ? "melt" : "sorry"} size={120} />
          <p className={styles.panelTitle}>
            {slot?.failed ? (
              <>
                Feta <strong>melted.</strong>
              </>
            ) : slot?.limited ? (
              <>
                That&apos;s all for <strong>today.</strong>
              </>
            ) : (
              <>
                Nothing <strong>yet.</strong>
              </>
            )}
          </p>
          <p className={styles.panelText}>{slot?.notice ?? "Nothing fits right now."}</p>
          {slot?.failed ? (
            <button type="button" className={styles.panelBtn} onClick={() => window.location.reload()}>
              Try again
            </button>
          ) : slot?.limited ? (
            <button type="button" className={styles.panelBtn} onClick={() => router.push("/lists")}>
              See Saved
            </button>
          ) : (
            <button type="button" className={styles.panelBtn} onClick={() => router.push("/location")}>
              Try another area
            </button>
          )}
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
              <span className={styles.kind}>{kindLabel(hero.kind)}</span>
              {hero.fetaNote !== undefined && <span className={styles.fetaBadge}>★ FETA PICK</span>}
              {hero.photo && (
                <span className={styles.credit}>
                  Photo: {hero.photo.credit} · <span translate="no">Google Maps</span>
                </span>
              )}
              <span className={styles.info}>
                <span className={styles.name}>{hero.name}</span>
                <span className={styles.meta}>
                  <span className={styles.where}>
                    {isNew(hero.placeId) && <span className={styles.newTag}>New</span>}
                    {where(hero)}
                  </span>
                  <span className={styles.verdict}>{verdictLabel(hero)}</span>
                </span>
                {hero.because && <span className={styles.because}>{hero.because}</span>}
                {hero.fetaNote && <span className={styles.fetaNote}>“{hero.fetaNote}”</span>}
                {curatedLabel(hero) && <span className={styles.loved}>{curatedLabel(hero)}</span>}
                <span className={styles.chips}>
                  {hero.chips.map((chip) => (
                    <span key={chip}>{chip.replace(/ ✓$/, "\u00a0✓")}</span>
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
                  <span className={`${styles.pic} ${p.photo ? "" : styles.picNone}`}>
                    {p.photo ? <PickPhoto photo={p.photo} /> : <span aria-hidden="true">{p.event ? "🎟" : "📍"}</span>}
                    {p.fetaNote !== undefined && <span className={styles.picStar}>★</span>}
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{p.name}</span>
                    {p.because && <span className={styles.rowWhy}>{p.because}</span>}
                    {curatedLabel(p) && <span className={styles.rowLoved}>{curatedLabel(p)}</span>}
                    <span className={styles.rowMeta}>
                      {isNew(p.placeId) && <span className={styles.newTag}>New</span>}
                      {[where(p), p.event ? p.chips[0] : null].filter(Boolean).join(" · ")}
                      {p.verdict === "Worth a detour" && <span className={styles.rowDetour}>{verdictLabel(p)}</span>}
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
                    {!p.event && (
                      <button
                        type="button"
                        className={styles.rowBeen}
                        onClick={(e) => {
                          e.stopPropagation();
                          been(p);
                        }}
                      >
                        Been there
                      </button>
                    )}
                  </span>
                </div>
                <button type="button" aria-label={`Save ${p.name}`} className={`${styles.rowSave} ${isSaved(p) ? styles.rowSaved : ""}`} onClick={() => save(p)}>
                  {isSaved(p) ? "✓" : "♥"}
                </button>
              </li>
            ))}
          </ul>

          {eventChip && <SearchChip html={eventChip.html} found={eventChip.found} />}

          <button type="button" className={styles.more} disabled={slot?.more} onClick={showMore}>
            {slot?.more ? "Finding more…" : "Show me more"}
          </button>

          {/* At the end, after the places (founder, 25 Nov 2026). */}
          {!search && <TellFeta hint={category === "food_drinks" ? "e.g. Burmese, rooftops" : "e.g. pickleball, open mics"} onAdded={() => reloadList(origin, when, category)} />}
        </>
      )}
      </div>

      <TabBar active="home" />
      <CheesePull scroller={scroller} onRefresh={freshSet} enabled={!!slot && !slot.loading && !slot.more && picks.length > 0} />

      {sheet?.type === "details" && (
        <PickDetails
          pick={sheet.pick}
          onClose={() => setSheet(null)}
          onSave={() => save(sheet.pick)}
          onSkip={() => skip(sheet.pick)}
          onGo={() => setSheet({ type: "go", pick: sheet.pick })}
        />
      )}

      {sheet?.type === "go" && (
        <LetsGo
          pick={sheet.pick}
          cityId={city.id}
          listKey={key}
          saved={slot?.saved.includes(sheet.pick.placeId)}
          onClose={() => setSheet(null)}
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

      {(sheet?.type === "tweak" || sheet?.type === "reason") && (
        <>
          <div className={styles.dim} onClick={() => setSheet(null)} />
          <div className={styles.sheet} role="dialog" aria-label={sheet.type === "tweak" ? "Tweak these" : "Why not?"}>
            {sheet.type === "tweak" ? (
              <>
                <h2 className={styles.sheetTitle}>
                  Tweak <strong>these</strong>
                </h2>
                <p className={styles.sheetSub}>Tap as many as you like. Tap again to undo.</p>
                <div className={styles.reasons}>
                  {TWEAK_OPTIONS.filter((t) => t.id !== "kids" || withKids).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={tweakPick.includes(t.id)}
                      className={tweakPick.includes(t.id) ? styles.reasonOn : ""}
                      onClick={() =>
                        setTweakPick(tweakPick.includes(t.id) ? tweakPick.filter((x) => x !== t.id) : [...tweakPick.filter((x) => x !== OPPOSITE[t.id]), t.id])
                      }
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <form
                  className={styles.sayIt}
                  onSubmit={(e) => {
                    e.preventDefault();
                    tweak(tweakPick, tweakNote.trim() || undefined);
                  }}
                >
                  <input value={tweakNote} onChange={(e) => setTweakNote(e.target.value)} placeholder='Or say it, e.g. "rooftop with a view"' aria-label="Say what you want" maxLength={200} />
                </form>
                <button
                  type="button"
                  className={`btn-primary ${styles.tweakGo}`}
                  disabled={tweakPick.length === 0 && !tweakNote.trim() && !active}
                  onClick={() => tweak(tweakPick, tweakNote.trim() || undefined)}
                >
                  {tweakPick.length === 0 && !tweakNote.trim() && active ? "Back to my usual picks" : "Show new places"}
                </button>
              </>
            ) : (
              <>
                <h2 className={styles.sheetTitle}>
                  Not for you? <strong>Why?</strong>
                </h2>
                <p className={styles.sheetSub}>Optional. Feta uses it from now on.</p>
                <div className={styles.why}>
                  {reasonsFor(sheet.pick, formatDistance(sheet.pick.distanceKm, city.country)).map((r) => (
                    <button key={r.label} type="button" onClick={() => giveReason(sheet.pick, r)}>
                      <span>{r.label}</span>
                      <small>{r.sub}</small>
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
