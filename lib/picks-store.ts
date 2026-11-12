"use client";

import type { Origin } from "@/lib/origin";
import { originKey } from "@/lib/origin";
import { fetchPicks, type Category, type Pick, type When } from "@/lib/picks-client";

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
};

// Kept in memory while the app is open, never stored: a reload starts
// fresh, and nothing is kept for more than an hour. A place whose closing
// time has passed since it was checked is dropped.
const KEEP_MS = 60 * 60000;
let kept: { slots: Record<string, Slot>; at: number } | null = null;
const inflight = new Map<string, Promise<Slot>>();

const stillOpen = (p: Pick) => !p.closesAt || new Date(p.closesAt).getTime() > Date.now();

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
  const p = fetchPicks(category, when, origin, false, tweak).then((reply) => {
    const at = Date.now();
    const slot: Slot = {
      loading: false,
      picks: (reply.picks ?? []).map((x) => ({ ...x, checkedAt: at })),
      spares: (reply.spares ?? []).map((x) => ({ ...x, checkedAt: at })),
      saved: [],
      banner: reply.banner,
      notice: reply.notice ?? reply.error,
    };
    keepSlots({ ...keptSlots(), [key]: slot });
    return slot;
  });
  if (!tweak) {
    inflight.set(key, p);
    p.finally(() => inflight.delete(key));
  }
  return p;
}
