"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AddPlace from "@/components/AddPlace";
import Mascot from "@/components/Mascot";
import SavedBrands from "@/components/SavedBrands";
import NightPlan, { type NightStart } from "@/components/NightPlan";
import TabBar from "@/components/TabBar";
import { useToast } from "@/components/Toast";
import { markBeen, removeFromList, saveListNote } from "@/lib/db";
import { fetchLists, type ListItem } from "@/lib/lists-client";
import { distanceKm, formatDistance } from "@/lib/cities";
import { dayName, loadPlans, removePlan, type SavedPlan } from "@/lib/night-client";
import { clock } from "@/lib/plan";
import { loadMyShares, newReplies, shareLink, type MyShare } from "@/lib/share-client";
import WhosComing, { initial, replySummary } from "@/components/WhosComing";
import { minuteClock } from "@/lib/night-plan";
import { loadOrigin, type Origin } from "@/lib/origin";
import { placeName, saveBeen, VERDICTS, VISITS, type Verdict, type Visits } from "@/lib/my-places";
import { loadTrips } from "@/lib/trip-client";
import { addWeekendWish, loadWishes, removeWeekendWish, thisSaturday, tickWeekend, type Wish } from "@/lib/weekend-client";
import styles from "./Lists.module.css";
import { eventLinkLabel } from "@/lib/event-links";

// "brands" is Want to try → Brands (founder, 20 Nov 2026: Style's saved brands sit beside saved places).
type Tab = "want" | "been" | "plans" | "brands";
const TABS: { id: Tab; label: string }[] = [
  { id: "want", label: "Want to try" },
  { id: "been", label: "Been" },
  { id: "plans", label: "Plans" },
];
const MAX_PLAN = 5;

type PlanCard = { key: string; title: string; when: string; stops: string[]; plan?: SavedPlan; shares: MyShare[] };

const liveNames = new Map<string, Promise<string | null>>();
function nameLive(placeId: string) {
  if (!liveNames.has(placeId)) liveNames.set(placeId, placeName(placeId));
  return liveNames.get(placeId)!;
}

function savedLabel(item: ListItem) {
  if (item.event) return "Event";
  // "Been" has no date: marking it doesn't say when they went. It shows
  // how it was and how often, when they've said.
  if (item.list === "been") {
    const parts = [VERDICTS.find((v) => v.id === item.verdict)?.label, item.visits === "regular" ? "Regular" : item.visits === "few" ? "A few times" : null];
    return parts.filter(Boolean).join(" · ") || "Been ✓";
  }
  const days = Math.floor(
    (Date.now() - new Date(item.savedAt).getTime()) / 86400000,
  );
  const verb = "Saved";
  if (days < 1) return `${verb} today`;
  if (days < 7)
    return `${verb} ${new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(new Date(item.savedAt))}`;
  return `${verb} ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(item.savedAt))}`;
}

// A want-to-try place saved more than a month ago.
const isOld = (item: ListItem) => item.list === "want" && !item.event && Date.now() - new Date(item.savedAt).getTime() > 30 * 86400000;

export default function Lists() {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("want");
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [open, setOpen] = useState<ListItem | null>(null);
  const [note, setNote] = useState("");
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [wish, setWish] = useState("");
  const [adding, setAdding] = useState(false);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [saturday, setSaturday] = useState("");
  const [trips, setTrips] = useState<{ id: string; title: string }[]>([]);
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [night, setNight] = useState<NightStart | null>(null);
  const [shares, setShares] = useState<MyShare[]>([]);
  const [whos, setWhos] = useState<PlanCard | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  // Names for shared plans' stops that aren't in their lists (read live,
  // once per open of the app).
  useEffect(() => {
    if (items === null) return;
    const known = new Set(items.map((i) => i.placeId));
    const missing = [...new Set(shares.flatMap((x) => (x.kind === "choice" ? (x.payload.options ?? []).flatMap((o) => o.stops) : (x.payload.stops ?? []))))].filter((st) => !st.event && !known.has(st.placeId));
    const events = Object.fromEntries(shares.flatMap((x) => (x.payload.stops ?? []).filter((st) => st.event).map((st) => [`event:${st.event!.title}`, st.event!.title])));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- event titles come with the share
    setNames((n) => ({ ...n, ...events }));
    let live = true;
    Promise.all(missing.slice(0, 12).map(async (st) => [st.placeId, await nameLive(st.placeId)] as const)).then((found) => live && setNames((n) => ({ ...n, ...Object.fromEntries(found.filter(([, v]) => v)) as Record<string, string> })));
    return () => {
      live = false;
    };
  }, [items, shares]);

  // Lists refresh each time the screen is shown.
  useEffect(() => {
    let live = true;
    const here = loadOrigin();
    /* eslint-disable react-hooks/set-state-in-effect -- the city is only readable in the browser */
    setOrigin(here);
    setSaturday(thisSaturday());
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchLists(here).then((list) => live && setItems(list ?? []));
    loadWishes().then((w) => live && setWishes(w));
    loadTrips().then((t) => live && setTrips(t));
    loadPlans().then((p) => live && setPlans(p));
    loadMyShares().then((s) => live && setShares(s));
    // Home's "Priya is in" pill opens Plans.
    if (window.location.hash === "#plans") setTab("plans");
    if (new URLSearchParams(window.location.search).get("show") === "brands") setTab("brands");
    return () => {
      live = false;
    };
  }, []);

  const shown = (items ?? []).filter((i) => i.list === tab);
  const plannable = (i: ListItem) => i.list === "want" && !i.event && i.lat !== null && i.lng !== null;
  const nameOf = (id: string) => (items ?? []).find((i) => i.placeId === id)?.name ?? "…";

  // Saved plans with the replies to their shares, then plans shared from
  // elsewhere (Plan my evening, a pick) on their own.
  const short = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d);
  const cards: PlanCard[] = [
    ...plans.map((p) => ({ key: p.id, title: dayName(p.day), when: `${short(new Date(`${p.day}T12:00:00`))} · ${minuteClock(p.startMinute)}`, stops: p.placeIds, plan: p, shares: shares.filter((x) => x.planId === p.id) })),
    ...shares
      .filter((x) => !x.planId || !plans.some((p) => p.id === x.planId))
      .map((x) => {
        const stops = x.kind === "choice" ? (x.payload.options ?? []).flatMap((o) => o.stops) : (x.payload.stops ?? []);
        const first = stops.find((st) => st.time)?.time;
        return {
          key: x.slug,
          title: x.kind === "choice" ? `${x.payload.options?.length ?? 2} plans for ${x.payload.title.toLowerCase()}` : x.payload.title,
          when: first ? `${short(new Date(first))} · ${clock(new Date(first))}` : short(new Date(x.createdAt)),
          stops: stops.map((st) => (st.event ? `event:${st.event.title}` : st.placeId)),
          shares: [x],
        };
      }),
  ];

  function togglePick(item: ListItem) {
    if (!plannable(item)) {
      toast(item.event ? "Events keep their own time, so they can't go in a plan yet." : "Feta can't find where this one is.");
      return;
    }
    if (!picked.includes(item.placeId) && picked.length >= MAX_PLAN) {
      toast(`Up to ${MAX_PLAN} places in one plan.`);
      return;
    }
    setPicked((p) => (p.includes(item.placeId) ? p.filter((x) => x !== item.placeId) : [...p, item.placeId]));
  }

  // The ticked places, and the nearest other saved place a short walk from
  // one of them, which Feta may suggest on the way.
  function planThese() {
    const chosen = (items ?? []).filter((i) => picked.includes(i.placeId));
    const near = (items ?? [])
      .filter((i) => plannable(i) && !picked.includes(i.placeId))
      .map((i) => ({ id: i.placeId, km: Math.min(...chosen.map((c) => distanceKm({ lat: c.lat!, lng: c.lng! }, { lat: i.lat!, lng: i.lng! }))) }))
      .filter((x) => x.km <= 1.5)
      .sort((a, b) => a.km - b.km);
    setNight({ ids: picked, extraIds: near.slice(0, 1).map((x) => x.id) });
  }

  const action = (i: ListItem) => (i.list === "been" ? "been" : "saved");

  function openItem(item: ListItem) {
    setOpen(item);
    setNote(item.note);
  }

  function update(placeId: string, list: Tab, patch: Partial<ListItem> | null) {
    setItems((all) =>
      (all ?? []).flatMap((i) =>
        i.placeId === placeId && i.list === list
          ? patch
            ? [{ ...i, ...patch }]
            : []
          : [i],
      ),
    );
  }

  function saveNote() {
    if (!open) return;
    saveListNote(open.placeId, action(open), note);
    update(open.placeId, open.list, { note: note.trim() });
    setOpen(null);
    toast("Note saved");
  }

  function been() {
    if (!open) return;
    markBeen(open.placeId, note);
    update(open.placeId, "want", {
      list: "been",
      note: note.trim(),
      savedAt: new Date().toISOString(),
    });
    setOpen(null);
    toast("Moved to Been");
  }

  function remove() {
    if (!open) return;
    removeFromList(open.placeId, action(open));
    update(open.placeId, open.list, null);
    setOpen(null);
    toast("Removed");
  }

  const ticked = (items ?? []).filter((i) => i.list === "want" && i.weekendFor === saturday);
  const isTicked = (i: ListItem) => i.list === "want" && i.weekendFor === saturday;

  function toggleWeekend(item: ListItem) {
    const on = !isTicked(item);
    tickWeekend(item.placeId, on);
    update(item.placeId, "want", { weekendFor: on ? saturday : null });
    setOpen((o) => o && { ...o, weekendFor: on ? saturday : null });
    toast(on ? "On your weekend list" : "Off your weekend list");
  }

  async function addWish(e: React.FormEvent) {
    e.preventDefault();
    const text = wish.trim();
    if (!text) return;
    setWish("");
    const saved = await addWeekendWish(text);
    if (saved) setWishes((w) => [...w, saved]);
    else toast("Couldn't add that just now. Try again.");
  }

  return (
    <>
      <main className={styles.screen}>
        <h1 className={styles.title}>
          <strong>Saved</strong>
        </h1>
        <div className={styles.segment} role="tablist">
          <span className={styles.thumb} style={{ transform: `translateX(${Math.max(0, TABS.findIndex((t) => t.id === tab)) * 100}px)` }} />
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id || (t.id === "want" && tab === "brands")}
              className={`${styles.segBtn} ${tab === t.id || (t.id === "want" && tab === "brands") ? styles.segOn : ""}`}
              onClick={() => {
                setTab(t.id);
                setPicking(false);
                setPicked([]);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className={styles.private}>Private. Only you can see these.</p>
        {(tab === "want" || tab === "brands") && <SavedBrands.Filter on={tab === "brands"} onChange={(brands) => setTab(brands ? "brands" : "want")} />}
        {tab === "brands" && <SavedBrands />}

        {/* Plan a night (founder, 17 Nov 2026): tick 2 to 5, then plan. */}
        {tab === "want" && (items ?? []).filter(plannable).length >= 2 &&
          (picking ? (
            <div className={styles.pickHint}>
              <span>Tick 2 to {MAX_PLAN} places</span>
              <button
                type="button"
                onClick={() => {
                  setPicking(false);
                  setPicked([]);
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className={styles.planNight} onClick={() => setPicking(true)}>
              <span aria-hidden="true">🧀</span>
              <span>
                <strong>Plan a night</strong>
                <span>Tick places and Feta puts them in order, with a route.</span>
              </span>
            </button>
          ))}

        {tab === "plans" && (
          <>
            {cards.length === 0 ? (
              <div className={styles.empty}>
                <Mascot pose="walk" size={100} />
                <p className={styles.emptyTitle}>
                  No plans <strong>yet.</strong>
                </p>
                <p className={styles.emptyText}>In Want to try, tap Plan a night, tick a few places, and Feta puts them in order with a route.</p>
              </div>
            ) : (
              <ul className={styles.items}>
                {cards.map((c) => {
                  const replies = c.shares.flatMap((x) => x.replies);
                  const fresh = c.shares.flatMap(newReplies).length;
                  return (
                    <li key={c.key} className={styles.planRow}>
                      <button type="button" className={`${styles.item} ${fresh ? styles.picked : ""}`} onClick={() => (replies.length || (!c.plan && c.shares.length) ? setWhos(c) : c.plan && setNight({ saved: c.plan }))}>
                        <span className={styles.planIcon} aria-hidden="true">
                          🧀
                        </span>
                        <span className={styles.text}>
                          <span className={styles.row}>
                            <span className={styles.name}>{c.title}</span>
                            <span className={styles.when}>{c.when}</span>
                          </span>
                          <span className={styles.area} style={{ display: "block" }}>
                            {c.stops.map((id) => names[id] ?? nameOf(id)).join(" → ")}
                          </span>
                          {replies.length > 0 ? (
                            <span className={styles.replies}>
                              <span className={styles.faces} aria-hidden="true">
                                {replies.slice(0, 3).map((r, i) => (
                                  <span key={i}>{initial(r)}</span>
                                ))}
                              </span>
                              {replySummary(replies)}
                              {fresh > 0 && <span className={styles.fresh}>{fresh} new</span>}
                            </span>
                          ) : (
                            <span className={styles.notShared}>{c.shares.length ? "Shared · no replies yet" : "Not shared yet"}</span>
                          )}
                        </span>
                      </button>
                      {c.plan && (
                        <button
                          type="button"
                          className={styles.planRemove}
                          aria-label="Remove this plan"
                          onClick={() => {
                            removePlan(c.plan!.id);
                            setPlans((all) => all.filter((x) => x.id !== c.plan!.id));
                            toast("Plan removed");
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {/* Trips planned in Ask Feta, to pick up again. */}
        {tab === "want" && trips.length > 0 && (
          <div className={styles.trips}>
            {trips.map((t) => (
              <button key={t.id} type="button" onClick={() => router.push(`/trip/${t.id}`)}>
                ✈ {t.title} ›
              </button>
            ))}
          </div>
        )}

        {tab === "been" && items !== null && (
          <button type="button" className={styles.addPlace} onClick={() => setAdding(true)}>
            <span>＋</span>
            <span>
              <strong>Add a place you&apos;ve been</strong>
              <span>Your favourites and regulars teach Feta most.</span>
            </span>
          </button>
        )}

        {/* This weekend shows once something is on it (testers: Lists had too much going on). */}
        {tab === "want" && !picking && items !== null && (ticked.length > 0 || wishes.length > 0) && (
          <section className={styles.weekend}>
            <p className={styles.wkLabel}>THIS WEEKEND</p>
            {(ticked.length > 0 || wishes.length > 0) && (
              <ul className={styles.wkChips}>
                {ticked.map((i) => (
                  <li key={i.placeId}>
                    <button type="button" className={styles.wkChip} onClick={() => openItem(i)}>
                      ✓ {i.name}
                    </button>
                  </li>
                ))}
                {wishes.map((w) => (
                  <li key={w.id}>
                    <span className={styles.wkChip}>
                      {w.text}
                      <button
                        type="button"
                        className={styles.wkRemove}
                        aria-label={`Remove ${w.text}`}
                        onClick={() => {
                          removeWeekendWish(w.id);
                          setWishes((all) => all.filter((x) => x.id !== w.id));
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <form className={styles.wkForm} onSubmit={addWish}>
              <input
                value={wish}
                onChange={(e) => setWish(e.target.value)}
                placeholder="e.g. pottery with my sister, brunch somewhere new"
                aria-label="Something you want to do this weekend"
                maxLength={80}
              />
              <button type="submit" disabled={!wish.trim()}>
                Add
              </button>
            </form>
          </section>
        )}

        {items === null && tab !== "brands" && (
          <p className={styles.loading}>Getting your places…</p>
        )}

        {items !== null && tab !== "plans" && tab !== "brands" && shown.length === 0 && (
          <div className={styles.empty}>
            <Mascot pose={tab === "want" ? "wave" : "bite"} size={100} />
            <p className={styles.emptyTitle}>
              Nothing here <strong>yet.</strong>
            </p>
            <p className={styles.emptyText}>
              {tab === "want"
                ? "Swipe right on a pick, or tap ♥, and it lands here with room for a note."
                : "When you've been somewhere you saved, open it and tap I've been."}
            </p>
            {tab === "want" && (
              <button
                type="button"
                className={styles.emptyBtn}
                onClick={() => router.push("/home")}
              >
                See tonight&apos;s picks
              </button>
            )}
          </div>
        )}

        {shown.length > 0 && (
          <>
            <ul className={styles.items}>
              {shown.map((item, i) => (
                <li
                  key={`${item.list}:${item.placeId}`}
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  <button
                    type="button"
                    className={`${styles.item} ${picking && picked.includes(item.placeId) ? styles.picked : ""} ${picking && !plannable(item) ? styles.unplannable : ""}`}
                    onClick={() => (picking ? togglePick(item) : openItem(item))}
                    aria-pressed={picking ? picked.includes(item.placeId) : undefined}
                  >
                    <span className={styles.pic}>
                      {item.photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.photo}
                          alt=""
                          referrerPolicy="no-referrer"
                        />
                      )}
                    </span>
                    <span className={styles.text}>
                      <span className={styles.row}>
                        <span className={styles.name}>{item.name}</span>
                        <span className={styles.when}>
                          {isTicked(item) ? "This weekend ✓" : savedLabel(item)}
                          {/* Saved over a month ago: the cheese (never the place) has gone mouldy. */}
                          {!isTicked(item) && isOld(item) && <Mascot pose="mould" size={26} limbs={false} className={styles.old} />}
                        </span>
                      </span>
                      <span
                        className={styles.area}
                        style={{ display: "block" }}
                      >
                        {[
                          item.area,
                          item.distanceKm !== null && formatDistance(item.distanceKm, origin?.city.country),
                          item.event?.when,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span
                        className={`${styles.note} ${item.note ? "" : styles.noteEmpty}`}
                        style={{ display: "block" }}
                      >
                        {item.note ? `Note: ${item.note}` : "Add a note"}
                      </span>
                    </span>
                    {picking && (
                      <span className={styles.tick} aria-hidden="true">
                        {picked.includes(item.placeId) ? "✓" : ""}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <p className={styles.end}>That&apos;s everything.</p>
          </>
        )}

        {picking && picked.length >= 2 && (
          <button type="button" className={`btn-primary ${styles.planThese}`} onClick={planThese}>
            Plan these {picked.length}
          </button>
        )}
      </main>
      <TabBar active="lists" />
      {whos && (
        <WhosComing
          title={whos.title}
          shares={whos.shares}
          onClose={() => setWhos(null)}
          onStopped={(slugs) => {
            setShares((all) => all.filter((x) => !slugs.includes(x.slug)));
            setWhos(null);
            toast("Link turned off");
          }}
          onSeen={(slugs) => setShares((all) => all.map((x) => (slugs.includes(x.slug) ? { ...x, seenAt: new Date().toISOString() } : x)))}
          onOpen={() => {
            const card = whos;
            setWhos(null);
            if (card.plan) setNight({ saved: card.plan });
            else window.open(shareLink(card.shares[0].slug), "_blank", "noopener");
          }}
        />
      )}
      {night && origin && (
        <NightPlan
          start={night}
          origin={origin}
          onClose={() => {
            setNight(null);
            setPicking(false);
            setPicked([]);
          }}
          onSaved={(plan) => setPlans((all) => [plan, ...all.filter((p) => p.id !== plan.id)])}
        />
      )}
      {adding && origin && (
        <AddPlace
          city={origin.city}
          onClose={() => setAdding(false)}
          onAdded={(p) => {
            setAdding(false);
            setItems((all) => [
              {
                placeId: p.placeId,
                list: "been",
                name: p.name,
                area: p.detail.split(",")[0],
                distanceKm: null,
                lat: null,
                lng: null,
                note: p.note,
                savedAt: new Date().toISOString(),
                weekendFor: null,
                visits: p.visits,
                verdict: p.verdict,
                mapsUri: `https://www.google.com/maps/place/?q=place_id:${p.placeId}`,
                photo: null,
              },
              ...(all ?? []).filter((i) => !(i.placeId === p.placeId && i.list === "been")),
            ]);
            toast(`${p.name} added. Feta will learn from it.`);
          }}
        />
      )}
      {open && (
        <>
          <div className={styles.dim} onClick={() => setOpen(null)} />
          <div className={styles.sheet} role="dialog" aria-label={open.name}>
            <h2 className={styles.sheetTitle}>{open.name}</h2>
            <p className={styles.sheetSub}>
              {[
                open.area,
                open.distanceKm !== null && formatDistance(open.distanceKm, origin?.city.country),
                open.event?.when,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {open.list === "been" && (
              <div className={styles.rate}>
                <div className={styles.rateRow}>
                  {VERDICTS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={open.verdict === v.id ? styles.rateOn : ""}
                      onClick={() => {
                        saveBeen(open.placeId, { verdict: v.id as Verdict });
                        update(open.placeId, "been", { verdict: v.id });
                        setOpen({ ...open, verdict: v.id });
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <div className={styles.rateRow}>
                  {VISITS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={open.visits === v.id ? styles.rateOn : ""}
                      onClick={() => {
                        saveBeen(open.placeId, { visits: v.id as Visits });
                        update(open.placeId, "been", { visits: v.id });
                        setOpen({ ...open, visits: v.id });
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {open.list === "want" && (
              <button
                type="button"
                role="switch"
                aria-checked={isTicked(open)}
                className={styles.wkSwitch}
                onClick={() => toggleWeekend(open)}
              >
                <span>Plan it for this weekend</span>
                <span className={`switch ${isTicked(open) ? "on" : ""}`} />
              </button>
            )}
            <textarea
              className={styles.noteBox}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="A note for yourself, e.g. get the filter coffee"
              aria-label="Your note"
              maxLength={300}
            />
            <div className={styles.sheetActions}>
              <button
                type="button"
                className={styles.primary}
                onClick={saveNote}
              >
                Save note
              </button>
              {open.list === "want" && (
                <button type="button" onClick={been}>
                  I&apos;ve been
                </button>
              )}
              {open.event ? (
                <a
                  href={open.event.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {eventLinkLabel(open.event.site)}
                </a>
              ) : (
                <a
                  href={open.mapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Maps
                </a>
              )}
              <button
                type="button"
                className={styles.danger}
                onClick={remove}
                style={{
                  gridColumn: open.list === "been" ? "auto" : "1 / -1",
                }}
              >
                Remove
              </button>
            </div>
            <button
              type="button"
              className={styles.close}
              onClick={() => setOpen(null)}
            >
              Close
            </button>
          </div>
        </>
      )}
    </>
  );
}
