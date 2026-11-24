"use client";

import type { Origin } from "@/lib/origin";
import { originKey } from "@/lib/origin";
import { fetchPicks, forgetFetaPicks, savingTaste, type Ask, type Category, type Pick, type When } from "@/lib/picks-client";

// Picks on the phone, shared by Home and the picks list, so opening one
// after the other makes no new search. picks: on screen, best first.
// spares: the next best from the same search, for "Show me more".
export type Slot = {
  loading: boolean;
  more?: boolean; // a new search for more is on its way
  picks: Pick[];
  spares: Pick[];
  saved: string[];
  banner?: string;
  notice?: string;
  failed?: boolean; // the search itself went wrong, not just nothing found
  limited?: boolean; // today's limit is reached
};

// Kept in memory while the app is open, never stored: a reload starts
// fresh, and nothing is kept for more than an hour. A place whose closing
// time has passed since it was checked is dropped.
const KEEP_MS = 60 * 60000;
let kept: { slots: Record<string, Slot>; at: number } | null = null;
const inflight = new Map<string, Promise<Slot>>();
// Goes up whenever their taste changes, so a search that started before
// the change is never kept (it would bring the old picks back).
let tasteVersion = 0;

const stillOpen = (p: Pick) => !p.closesAt || new Date(p.closesAt).getTime() > Date.now();

// Their taste changed (a new line, new answers): the next open searches again.
// A change to their taste is being saved: the kept picks go at once (a
// screen opened before the save finishes must not show them), and every
// search waits for the save.
export function changingTaste<T>(write: PromiseLike<T>): Promise<T> {
  forgetPicks();
  return savingTaste(write);
}

export function forgetPicks() {
  kept = null;
  shownBefore.clear();
  tasteVersion++;
  inflight.clear();
  forgetFetaPicks();
}

export function slotKey(origin: Origin, when: When, category: Category) {
  return `${originKey(origin)}|${when}:${category}`;
}

export function searchKey(origin: Origin, when: When, category: Category, typed: string) {
  return `${slotKey(origin, when, category)}|search:${typed.trim().toLowerCase()}`;
}

export function keptSlots(): Record<string, Slot> {
  if (!kept || Date.now() - kept.at > KEEP_MS) return {};
  return Object.fromEntries(
    Object.entries(kept.slots)
      .filter(([, s]) => !s.loading)
      .map(([k, s]) => [k, { ...s, picks: s.picks.filter(stillOpen), spares: s.spares.filter(stillOpen) }]),
  );
}

export function keepSlots(slots: Record<string, Slot>) {
  kept = { slots, at: kept && Object.keys(keptSlots()).length ? kept.at : Date.now() };
}

// Loads a category's picks. Two screens asking at once share one request.
// A search has its own slot (searchKey), never Home's or the everyday list's.
export function loadSlot(origin: Origin, when: When, category: Category, tweak?: Ask): Promise<Slot> {
  const key = tweak?.search && tweak.note ? searchKey(origin, when, category, tweak.note) : slotKey(origin, when, category);
  if (!tweak && inflight.has(key)) return inflight.get(key)!;
  const version = tasteVersion;
  const p = fetchPicks(category, when, origin, false, tweak).then((reply) => {
    const slot: Slot = {
      loading: false,
      picks: reply.picks ?? [],
      spares: reply.spares ?? [],
      saved: [],
      banner: reply.banner,
      notice: reply.notice ?? reply.error,
      failed: !!reply.error,
      limited: reply.limited,
    };
    if (version === tasteVersion) keepSlots({ ...keptSlots(), [key]: slot });
    if (reply.eventsComing && !tweak) eventsLater(key, origin, when, category, version);
    return slot;
  });
  if (!tweak) {
    inflight.set(key, p);
    p.finally(() => inflight.get(key) === p && inflight.delete(key));
  }
  return p;
}

// A place they saved, skipped or have been to leaves their other lists on
// the phone (tester, 23 Nov 2026: a café saved in Food & drinks stayed in
// Things to do); the list it was acted on in handles its own.
export function withoutElsewhere(slots: Record<string, Slot>, key: string, placeId: string): Record<string, Slot> {
  return Object.fromEntries(
    Object.entries(slots).map(([k, s]) => [k, k === key ? s : { ...s, picks: s.picks.filter((p) => p.placeId !== placeId), spares: s.spares.filter((p) => p.placeId !== placeId) }]),
  );
}

// Events still being found when the list came (they take up to ~20 s, live
// check 23 Nov 2026): ask once more a little later, when they've joined the
// stored set, and tell the screens showing this list.
export const SLOT_EVENT = "feta:slot";
function eventsLater(key: string, origin: Origin, when: When, category: Category, version: number) {
  setTimeout(async () => {
    if (version !== tasteVersion) return;
    const had = keptSlots()[key];
    // Only events it doesn't have yet are checked (audit, 24 Nov 2026).
    const reply = await fetchPicks(category, when, origin, false, undefined, { eventsOnly: true, shown: (had?.picks ?? []).filter((p) => p.event).map((p) => p.placeId) });
    const was = keptSlots()[key];
    if (version !== tasteVersion || !was || !reply.picks?.some((p) => p.event)) return;
    // The new events lead, then the ones already shown; the places follow,
    // and the ones pushed out become backup.
    const fresh = reply.picks.filter((p) => p.event);
    const events = [...fresh, ...was.picks.filter((p) => p.event && !fresh.some((e) => e.placeId === p.placeId))];
    const places = [...was.picks, ...was.spares].filter((p) => !p.event);
    const all = [...events, ...places];
    const slot: Slot = { ...was, loading: false, picks: all.slice(0, SHOW), spares: all.slice(SHOW) };
    keepSlots({ ...keptSlots(), [key]: slot });
    window.dispatchEvent(new CustomEvent(SLOT_EVENT, { detail: { key, slot } }));
  }, 20000);
}

// One list changed on the phone (a fresh set from Home): kept for the other
// screens too.
export function keepSlot(key: string, slot: Slot) {
  keepSlots({ ...keptSlots(), [key]: slot });
}

// The next places for a list: the next 8 from the backup, or a new search
// once the backup has run out. For "Show me more" and the pull for a fresh
// set, on the picks list and on Home.
export const SHOW = 8;

// Every place a list has shown on this phone (this session), so the next
// places never go round the same backup again (audit, 24 Nov 2026: pulling
// down alternated between two batches, about ₹14 a pull).
const shownBefore = new Map<string, Set<string>>();

// A search's next places are more of the same search (search).
export async function nextPicks(slot: Slot, origin: Origin, when: When, category: Category, search?: Ask): Promise<{ fresh: Pick[]; spares: Pick[]; notice?: string }> {
  const listKey = `${slotKey(origin, when, category)}|${search?.note ?? ""}|${(search?.tweaks ?? []).join(",")}`;
  const seen = shownBefore.get(listKey) ?? new Set<string>();
  for (const p of slot.picks) seen.add(p.placeId);
  shownBefore.set(listKey, seen);
  // Backup never brings back a place already shown (audit, 24 Nov 2026:
  // places pushed down by late events came back as "8 new picks").
  const spares = slot.spares.filter((p) => !seen.has(p.placeId));
  if (spares.length > 0) return { fresh: spares.slice(0, SHOW), spares: spares.slice(SHOW) };
  const reply = await fetchPicks(category, when, origin, true, search, { shown: [...seen, ...slot.saved].slice(-200) });
  return {
    fresh: (reply.picks ?? []).filter((p) => !slot.picks.some((q) => q.placeId === p.placeId)),
    spares: (reply.spares ?? []),
    notice: reply.notice,
  };
}
