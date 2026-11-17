"use client";

import { useEffect, useMemo, useState } from "react";
import NightTrail from "@/components/NightTrail";
import SendToGroup from "@/components/SendToGroup";
import { useToast } from "@/components/Toast";
import { logEvent } from "@/lib/db";
import { dayName, fetchNightPlaces, localDay, savePlan, type SavedPlan } from "@/lib/night-client";
import { minuteClock, planNight, roomForOne, routeUri, timeOrder, type Night, type NightPlace } from "@/lib/night-plan";
import type { Origin } from "@/lib/origin";
import sheet from "./Sheet.module.css";
import styles from "./NightPlan.module.css";

// Plan a night from Saved (founder, 17 Nov 2026, mock-up "plan-flow"):
// the day and a start time, the cheese rolls, then the trail with each stop
// in the order that works. Edit: drag to reorder, swipe to remove, and the
// times redo themselves. A place that doesn't fit that day is said plainly.
// One more place from their saved list may be suggested on the way. Then
// the route in Google Maps, Save (Saved → Plans) and Share (places and
// times only, never diet).

export type NightStart = { ids: string[]; extraIds: string[] } | { saved: SavedPlan };

const STARTS = [12 * 60, 16 * 60, 18 * 60, 20 * 60];
const ROLL_MS = 1400;
const ROW = 78; // a ticket and the walk or ride under it

const nowMinute = () => {
  const d = new Date();
  return Math.ceil((d.getHours() * 60 + d.getMinutes() + 15) / 15) * 15;
};

// Today (unless it's late), then the next weekend days.
function dayOptions() {
  const now = new Date();
  const out = nowMinute() <= 22 * 60 ? [localDay(now)] : [];
  for (let i = 1; out.length < 3 && i <= 8; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) out.push(localDay(d));
  }
  return out;
}

function startOptions(day: string): { minute: number; label: string }[] {
  if (day !== localDay(new Date())) return STARTS.map((m) => ({ minute: m, label: minuteClock(m) }));
  return [{ minute: nowMinute(), label: "Now" }, ...STARTS.filter((m) => m > nowMinute()).map((m) => ({ minute: m, label: minuteClock(m) }))];
}

const weekdayOf = (day: string) => new Date(`${day}T12:00:00`).getDay();

export default function NightPlan({ start, origin, onClose, onSaved }: { start: NightStart; origin: Origin; onClose: () => void; onSaved: (plan: SavedPlan) => void }) {
  const toast = useToast();
  const saved = "saved" in start ? start.saved : null;
  const [phase, setPhase] = useState<"when" | "rolling" | "trail" | "edit">(saved ? "rolling" : "when");
  const [day, setDay] = useState(saved?.day ?? dayOptions()[0]);
  const [startAt, setStartAt] = useState(saved?.startMinute ?? startOptions(dayOptions()[0])[0]?.minute ?? 16 * 60);
  const [places, setPlaces] = useState<NightPlace[] | null>(null);
  const [notice, setNotice] = useState("");
  const [order, setOrder] = useState<string[] | null>(saved?.placeIds ?? null); // null: Feta's order
  const [dropped, setDropped] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [noIdea, setNoIdea] = useState(false);
  const [ready, setReady] = useState(false);
  const [planId, setPlanId] = useState(saved?.id ?? null);
  const [savedAs, setSavedAs] = useState(saved ? JSON.stringify([saved.day, saved.startMinute, saved.placeIds]) : "");
  const [whenOpen, setWhenOpen] = useState(!saved);
  const ticked = useMemo(() => ("saved" in start ? start.saved.placeIds : start.ids), [start]);
  const extraIds = "saved" in start ? [] : start.extraIds;

  async function load() {
    setPhase("rolling");
    setNotice("");
    const rolled = new Promise((r) => setTimeout(r, ROLL_MS));
    const reply = await fetchNightPlaces([...ticked, ...extraIds]);
    await rolled;
    const found = reply?.places ?? [];
    if (found.filter((p) => ticked.includes(p.placeId)).length < 2) {
      setNotice(reply?.notice ?? "Couldn't get these places from Google Maps just now. Try again in a bit.");
      return;
    }
    setPlaces(found);
    setPhase("trail");
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a saved plan opens straight onto its trail
    if (saved) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, []);

  const weekday = weekdayOf(day);
  const active = (places ?? []).filter((p) => (ticked.includes(p.placeId) || added.includes(p.placeId)) && !dropped.includes(p.placeId));
  const extras = (places ?? []).filter((p) => !ticked.includes(p.placeId) && !added.includes(p.placeId));
  const byId = new Map(active.map((p) => [p.placeId, p]));
  const night: Night = order
    ? timeOrder([...order.flatMap((id) => byId.get(id) ?? []), ...active.filter((p) => !order.includes(p.placeId))], weekday, startAt, true)
    : planNight(active, weekday, startAt);
  const idea = !noIdea && night.problems.length === 0 && night.stops.length > 0 ? roomForOne(night, extras, weekday) : null;
  const ids = [...night.stops, ...night.problems.map((p) => ({ place: p.place }))].map((s) => s.place.placeId);
  const signature = JSON.stringify([day, startAt, ids]);
  const isSaved = !!planId && savedAs === signature;
  // An earlier start the same day, else another day, where everything fits.
  const fitsAll = (d: string, m: number) => planNight(active, weekdayOf(d), m).problems.length === 0;
  const betterStart = night.problems.length ? startOptions(day).map((o) => o.minute).filter((m) => m < startAt).reverse().find((m) => fitsAll(day, m)) : undefined;
  const betterDay = night.problems.length && betterStart === undefined ? dayOptions().find((d) => d !== day && fitsAll(d, startAt)) : undefined;
  const first = night.stops[0];
  const areas = [...new Set(night.stops.map((s) => s.place.area).filter(Boolean))];

  async function save(quiet = false) {
    if (isSaved) return planId;
    const id = await savePlan({ id: planId ?? undefined, day, startMinute: startAt, placeIds: ids }, origin.city);
    if (!id) {
      if (!quiet) toast("Couldn't save it just now. Try again.");
      return null;
    }
    setPlanId(id);
    setSavedAs(signature);
    onSaved({ id, day, startMinute: startAt, placeIds: ids, cityId: origin.city.id, checkedAt: null });
    if (!quiet) toast("Saved to Plans");
    return id;
  }

  function changeOrder(next: string[]) {
    setOrder(next);
    toast("Times updated");
  }

  function drop(id: string) {
    if (ids.length <= 2) {
      toast("A plan needs at least two places.");
      return;
    }
    setDropped((d) => [...d, id]);
    if (order) setOrder(order.filter((x) => x !== id));
  }

  function addIdea() {
    if (!idea) return;
    setAdded((a) => [...a, idea.place.placeId]);
    const now = night.stops.map((s) => s.place.placeId);
    setOrder([...now.slice(0, idea.index), idea.place.placeId, ...now.slice(idea.index)]);
    toast(`${idea.place.name} added`);
  }

  const share = () => ({
    title: dayName(day),
    country: origin.city.country,
    stops: night.stops.map((s) => {
      const at = new Date(`${day}T00:00:00`);
      at.setMinutes(s.at);
      return { placeId: s.place.placeId, kind: s.place.kind, time: at.toISOString() };
    }),
  });

  // ---------- Day and time ----------
  if (whenOpen) {
    const days = dayOptions();
    const starts = startOptions(day);
    return (
      <>
        <div className={sheet.dim} onClick={phase === "when" ? onClose : () => setWhenOpen(false)} />
        <div className={sheet.sheet} role="dialog" aria-label="When are you going?">
          <h2 className={sheet.title}>
            When are you <strong>going?</strong>
          </h2>
          <p className={sheet.label}>Day</p>
          <div className={sheet.chips}>
            {days.map((d) => (
              <button
                key={d}
                type="button"
                className={d === day ? sheet.on : ""}
                aria-pressed={d === day}
                onClick={() => {
                  setDay(d);
                  const s = startOptions(d);
                  if (!s.some((o) => o.minute === startAt)) setStartAt(s[0].minute);
                }}
              >
                {d === localDay(new Date()) ? dayName(d) : dayName(d, false)}
              </button>
            ))}
          </div>
          <p className={sheet.label}>Starting around</p>
          <div className={sheet.chips}>
            {starts.map((s) => (
              <button key={s.label} type="button" className={s.minute === startAt ? sheet.on : ""} aria-pressed={s.minute === startAt} onClick={() => setStartAt(s.minute)}>
                {s.label}
              </button>
            ))}
          </div>
          <p className={sheet.sub}>Feta checks each place&apos;s hours for that day.</p>
          <button
            type="button"
            className={`btn-primary ${sheet.go}`}
            onClick={() => {
              setWhenOpen(false);
              if (!places) load();
            }}
          >
            {places ? "Done" : "Plan it"}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className={styles.screen} role="dialog" aria-label="Your plan">
      {phase === "rolling" && (
        <div className={styles.rolling}>
          {notice ? (
            <>
              <p>{notice}</p>
              <span className={styles.row}>
                <button type="button" className={styles.dark} onClick={load}>
                  Try again
                </button>
                <button type="button" className={styles.quiet} onClick={onClose}>
                  Back
                </button>
              </span>
            </>
          ) : (
            <>
              <span className={styles.die} aria-hidden="true">
                🧀
              </span>
              <p>Plotting your {dayName(day) === "Tonight" ? "night" : dayName(day)}…</p>
              <span className={styles.checks}>
                <span>✓ {dayName(day)}&apos;s hours checked</span>
                <span>✓ Early closers first, dinner last</span>
                <span>✓ Shortest way between them</span>
              </span>
            </>
          )}
        </div>
      )}

      {phase === "trail" && (
        <>
          <header className={styles.head}>
            <h1>
              {dayName(day)}, <i>{night.problems.length ? "almost." : "sorted."}</i>
            </h1>
            <button type="button" className={styles.when} onClick={() => setWhenOpen(true)}>
              {night.stops.length} stops · {first ? `${minuteClock(first.at)} to ${minuteClock(night.end)}` : ""} · change
            </button>
            {areas.length > 1 && <small>{areas[0]} → {areas[areas.length - 1]}</small>}
            <span className={styles.tools}>
              <button type="button" onClick={() => setPhase("edit")}>
                Edit
              </button>
              <button type="button" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </span>
          </header>
          <div className={styles.mapArea}>
            <NightTrail night={night} weekday={weekday} country={origin.city.country} closed={night.problems.map((p) => p.place)} room={night.problems.length ? 100 : 0} />
            {night.problems[0] && (
              <div className={styles.warn} role="alert">
                <b>
                  {night.problems[0].place.name} is {night.problems[0].why}.
                </b>
                <span className={styles.row}>
                  <button type="button" onClick={() => drop(night.problems[0].place.placeId)}>
                    Drop it
                  </button>
                  {betterStart !== undefined ? (
                    <button type="button" className={styles.yes} onClick={() => setStartAt(betterStart)}>
                      Start at {minuteClock(betterStart)}
                    </button>
                  ) : betterDay ? (
                    <button type="button" className={styles.yes} onClick={() => setDay(betterDay)}>
                      Make it {dayName(betterDay)}
                    </button>
                  ) : (
                    <button type="button" className={styles.yes} onClick={() => setWhenOpen(true)}>
                      Another day or time
                    </button>
                  )}
                </span>
              </div>
            )}
          </div>
          {idea && <Idea idea={idea} onAdd={addIdea} onNo={() => setNoIdea(true)} />}
          <p className={styles.credit}>
            Places: <span translate="no">Google Maps</span> · times are rough
          </p>
          <div className={styles.bottom}>
            <button type="button" className={styles.quiet} onClick={() => setReady(true)}>
              Save &amp; share
            </button>
            <a
              className={styles.go}
              href={night.stops.length ? routeUri(night.stops) : undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                logEvent("plan_directions", first?.place.placeId, origin.city.id);
                void save(true);
                setReady(true);
              }}
            >
              Route in Google Maps
            </a>
          </div>
        </>
      )}

      {phase === "edit" && (
        <EditList
          night={night}
          onOrder={changeOrder}
          onDrop={drop}
          idea={idea}
          onAdd={addIdea}
          onNo={() => setNoIdea(true)}
          onWhen={() => setWhenOpen(true)}
          whenLabel={`${dayName(day, false)} · from ${minuteClock(startAt)}`}
          country={origin.city.country}
          onDone={() => setPhase("trail")}
        />
      )}

      {ready && (
        <>
          <div className={sheet.dim} onClick={() => setReady(false)} />
          <div className={sheet.sheet} role="dialog" aria-label="Ready to go">
            <h2 className={sheet.title}>
              Ready to <strong>go</strong>
            </h2>
            <div className={styles.preview}>
              <p>
                {dayName(day)}, <i>sorted.</i>
              </p>
              {night.stops.map((s) => (
                <span key={s.place.placeId}>
                  <b>{minuteClock(s.at)}</b>
                  {s.place.name}
                </span>
              ))}
            </div>
            {night.stops.length > 0 && (
              <a className={`btn-primary ${sheet.go} ${styles.link}`} href={routeUri(night.stops)} target="_blank" rel="noopener noreferrer" onClick={() => void save(true)}>
                Open the route in Google Maps
              </a>
            )}
            <button type="button" className={styles.saveBtn} onClick={() => save()} disabled={isSaved}>
              {isSaved ? "✓ Saved in Plans" : planId ? "Save changes" : "Save to Plans"}
            </button>
            {night.stops.length >= 2 && (
              <SendToGroup
                kind="plan"
                label="Share with friends"
                message={`${dayName(day)}: ${night.stops.map((s) => `${s.place.name} at ${minuteClock(s.at)}`).join(", then ")}. Planned with Feta.`}
                payload={share()}
              />
            )}
            <p className={sheet.sub}>Friends see the places, times and route. Nothing about your diet or taste.</p>
            <button type="button" className={sheet.ghost} onClick={() => setReady(false)}>
              Back to the plan
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Idea({ idea, onAdd, onNo }: { idea: NonNullable<ReturnType<typeof roomForOne>>; onAdd: () => void; onNo: () => void }) {
  return (
    <div className={styles.idea}>
      <span>
        <em>{idea.dessert ? "Room for dessert?" : "One more on the way?"}</em>
        <strong>{idea.place.name}</strong>
        <small>From your saved · {minuteClock(idea.at)}</small>
      </span>
      <button type="button" className={styles.add} onClick={onAdd}>
        Add
      </button>
      <button type="button" className={styles.no} onClick={onNo} aria-label="No thanks">
        ✕
      </button>
    </div>
  );
}

// Drag a ticket by its handle to move it; swipe one left to remove it.
function EditList({
  night,
  onOrder,
  onDrop,
  idea,
  onAdd,
  onNo,
  onWhen,
  whenLabel,
  country,
  onDone,
}: {
  night: Night;
  onOrder: (ids: string[]) => void;
  onDrop: (id: string) => void;
  idea: ReturnType<typeof roomForOne>;
  onAdd: () => void;
  onNo: () => void;
  onWhen: () => void;
  whenLabel: string;
  country: string;
  onDone: () => void;
}) {
  const rows = [...night.stops.map((s, i) => ({ place: s.place, at: s.at as number | null, leg: night.stops[i + 1]?.leg })), ...night.problems.map((p) => ({ place: p.place, at: null, leg: undefined, why: p.why }))] as {
    place: NightPlace;
    at: number | null;
    leg?: Night["stops"][number]["leg"];
    why?: string;
  }[];
  const [drag, setDrag] = useState<{ from: number; y0: number; dy: number } | null>(null);
  const [swipe, setSwipe] = useState<{ id: string; x0: number; dx: number } | null>(null);
  const to = drag ? Math.max(0, Math.min(rows.length - 1, drag.from + Math.round(drag.dy / ROW))) : -1;

  function shift(i: number) {
    if (!drag || i === drag.from) return 0;
    if (drag.from < to && i > drag.from && i <= to) return -ROW;
    if (to < drag.from && i >= to && i < drag.from) return ROW;
    return 0;
  }

  function endDrag() {
    if (drag && to !== drag.from) {
      const ids = rows.map((r) => r.place.placeId);
      const [moved] = ids.splice(drag.from, 1);
      ids.splice(to, 0, moved);
      onOrder(ids);
    }
    setDrag(null);
  }

  function endSwipe() {
    if (swipe && swipe.dx < -90) onDrop(swipe.id);
    setSwipe(null);
  }

  return (
    <>
      <header className={styles.head}>
        <h1>
          Edit your <i>night</i>
        </h1>
        <small>Drag ⋮⋮ to reorder · swipe left to remove</small>
        <span className={styles.tools}>
          <button type="button" className={styles.done} onClick={onDone}>
            Done
          </button>
        </span>
      </header>
      <div className={styles.editScroll}>
        <button type="button" className={styles.whenChip} onClick={onWhen}>
          {whenLabel} · change
        </button>
        <ol className={styles.tickets}>
          {rows.map((r, i) => {
            const moving = drag?.from === i;
            const dx = swipe?.id === r.place.placeId ? Math.min(0, swipe.dx) : 0;
            return (
              <li key={r.place.placeId} className={moving ? styles.lifted : ""} style={{ transform: `translateY(${moving ? drag!.dy : shift(i)}px)` }}>
                <span className={styles.remove}>Remove</span>
                <div
                  className={`${styles.ticket} ${r.at === null ? styles.bad : ""}`}
                  style={{ transform: `translateX(${dx}px)` }}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("button")) return;
                    setSwipe({ id: r.place.placeId, x0: e.clientX, dx: 0 });
                  }}
                  onPointerMove={(e) => swipe?.id === r.place.placeId && setSwipe({ ...swipe, dx: e.clientX - swipe.x0 })}
                  onPointerUp={endSwipe}
                  onPointerCancel={() => setSwipe(null)}
                >
                  <span className={styles.stub}>
                    {r.at === null ? "—" : minuteClock(r.at).replace(/ (am|pm)/, "")}
                    <small>{r.at === null ? "DOESN'T FIT" : `${minuteClock(r.at).slice(-2).toUpperCase()} · ${i + 1}`}</small>
                  </span>
                  <span className={styles.info}>
                    <strong>{r.place.name}</strong>
                    <small>{r.why ?? r.place.area}</small>
                  </span>
                  <button
                    type="button"
                    className={styles.grip}
                    aria-label={`Move ${r.place.name}`}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDrag({ from: i, y0: e.clientY, dy: 0 });
                    }}
                    onPointerMove={(e) => drag && setDrag({ ...drag, dy: e.clientY - drag.y0 })}
                    onPointerUp={endDrag}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(e) => {
                      // Arrow keys move it too.
                      const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
                      if (!step || i + step < 0 || i + step >= rows.length) return;
                      e.preventDefault();
                      const ids = rows.map((x) => x.place.placeId);
                      [ids[i], ids[i + step]] = [ids[i + step], ids[i]];
                      onOrder(ids);
                    }}
                  >
                    ⋮⋮
                  </button>
                </div>
                <span className={styles.hop}>{r.leg ? `${r.leg.mode === "walk" ? "🚶" : country === "IN" ? "🛺" : "🚕"} ${r.leg.minutes} min ${r.leg.mode}` : ""}</span>
              </li>
            );
          })}
        </ol>
        {idea && <Idea idea={idea} onAdd={onAdd} onNo={onNo} />}
      </div>
      <div className={styles.bottom}>
        <button type="button" className={styles.go} onClick={onDone}>
          Done
        </button>
      </div>
    </>
  );
}
