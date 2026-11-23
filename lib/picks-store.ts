"use client";

import type { Origin } from "@/lib/origin";
import { originKey } from "@/lib/origin";
import { fetchPicks, forgetFetaPicks, savingTaste, type Category, type Pick, type When } from "@/lib/picks-client";

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
  tasteVersion++;
  inflight.clear();
  forgetFetaPicks();
}

export function slotKey(origin: Origin, when: When, category: Category) {
  return `${originKey(origin)}|${when}:${category}`;
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
export function loadSlot(origin: Origin, when: When, category: Category, tweak?: { tweaks: string[]; note?: string }): Promise<Slot> {
  const key = slotKey(origin, when, category);
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
    const reply = await fetchPicks(category, when, origin);
    if (version !== tasteVersion || !reply.picks?.some((p) => p.event)) return;
    const slot: Slot = { loading: false, picks: reply.picks, spares: reply.spares ?? [], saved: keptSlots()[key]?.saved ?? [], banner: reply.banner, notice: reply.notice };
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

export async function nextPicks(slot: Slot, origin: Origin, when: When, category: Category): Promise<{ fresh: Pick[]; spares: Pick[]; notice?: string }> {
  if (slot.spares.length > 0) return { fresh: slot.spares.slice(0, SHOW), spares: slot.spares.slice(SHOW) };
  const reply = await fetchPicks(category, when, origin, true);
  return {
    fresh: (reply.picks ?? []).filter((p) => !slot.picks.some((q) => q.placeId === p.placeId)),
    spares: (reply.spares ?? []),
    notice: reply.notice,
  };
}
