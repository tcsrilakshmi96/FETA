"use client";

import { useSyncExternalStore } from "react";
import { firstSlotName } from "@/lib/slot-label";
import type { Origin } from "@/lib/origin";
import { originKey } from "@/lib/origin";
import { fetchPicks, forgetFetaPicks, savingTaste, type Ask, type Category, type Pick, type When } from "@/lib/picks-client";

// The one owner of the lists on the phone (founder, 25 Nov 2026: every
// screen used to keep its own copy next to the phone's, and audit after
// audit found the copies disagreeing). Home and the picks list only read
// from here (usePicks) and change lists through the functions below, so a
// save, a skip, a tweak or late events change the one list every screen shows.
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
  // Made as "Today" or "Tonight" in this city: looked up again when that
  // changes at 5 pm (audit, 24 Nov 2026).
  slotName?: string;
  timeZone?: string;
  madeAt?: number; // which search made it, so late events join only that list
  taste?: number; // tasteVersion it was made with
};

// A Cheaper, Fancier or noted list shown over the everyday one, which stays
// underneath as it was, so undoing the tweak brings it back with no search.
export type Tweaked = { tweaks: string[]; note?: string; slot: Slot; origin: Origin; when: When; category: Category };

type State = { lists: Record<string, Slot>; tweaked: Record<string, Tweaked> };
let state: State = { lists: {}, tweaked: {} };
const EMPTY: State = { lists: {}, tweaked: {} };
const listeners = new Set<() => void>();
function set(next: Partial<State>) {
  state = { ...state, ...next };
  persist();
  for (const l of listeners) l();
}

// Goes up whenever their taste changes: lists made before stay on screen,
// and are looked up again the next time a screen opens them (a skip reason
// never pays for every list at once; audit, 24 Nov 2026).
let tasteVersion = 0;

// Kept for an hour from when each list was made, on the phone too, so a list
// they've seen comes back free after a reload or past the day's limit
// (founder, 24 Nov 2026); never longer, as Google allows. Only finished
// everyday lists with the taste they have now.
const KEEP_MS = 60 * 60000;
const STORE = "feta.picks.kept";
const stillOpen = (p: Pick) => !p.closesAt || new Date(p.closesAt).getTime() > Date.now();
const fresh = (s: Slot) => s.madeAt !== undefined && Date.now() - s.madeAt <= KEEP_MS;
const sameSlotName = (s: Slot) => !s.slotName || s.slotName === firstSlotName(s.timeZone);
function keepable(s: Slot) {
  return !s.loading && !s.failed && !s.limited && s.picks.length > 0 && s.taste === tasteVersion && fresh(s) && sameSlotName(s);
}
// Whose lists these are (feta.owner when read from the phone): another
// account taking over the phone (claimPhone) never gets them written back
// (security audit, 25 Nov 2026).
let ownerAtRead: string | null | undefined;
function owner() {
  try {
    return localStorage.getItem("feta.owner");
  } catch {
    return null;
  }
}
function persist() {
  if (ownerAtRead && owner() !== ownerAtRead) return;
  try {
    const keep = Object.fromEntries(Object.entries(state.lists).filter(([, s]) => keepable(s)).map(([k, s]) => [k, { ...s, more: false }]));
    if (Object.keys(keep).length) localStorage.setItem(STORE, JSON.stringify({ slots: keep, at: Date.now() }));
    else localStorage.removeItem(STORE);
  } catch {
    // Kept in memory only.
  }
}
// After a reload: the lists kept on the phone join memory, once.
let readPhone = false;
function fromPhone() {
  if (readPhone || typeof window === "undefined") return;
  readPhone = true;
  ownerAtRead = owner();
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null") as { slots: Record<string, Slot>; at: number } | null;
    if (!v) return;
    const found = Object.fromEntries(
      Object.entries(v.slots)
        .map(([k, s]) => [k, { ...s, madeAt: s.madeAt ?? v.at, taste: tasteVersion, picks: s.picks.filter(stillOpen), spares: s.spares.filter(stillOpen) }] as const)
        .filter(([k, s]) => !state.lists[k] && keepable(s)),
    );
    if (Object.keys(found).length) set({ lists: { ...found, ...state.lists } });
    else persist();
  } catch {
    // Nothing kept.
  }
}

// What a screen shows for a list: the tweaked one when there is one.
export function shown(s: State, key: string): Slot | undefined {
  return s.tweaked[key]?.slot ?? s.lists[key];
}

let sweeping = false;
function subscribe(l: () => void) {
  listeners.add(l);
  if (!sweeping && typeof window !== "undefined") {
    sweeping = true;
    // A list past its hour, or made as "Today" when it's now "Tonight", is
    // looked up again while it's on screen (one rule for every screen).
    document.addEventListener("visibilitychange", sweep);
    setInterval(sweep, 60000);
  }
  return () => {
    listeners.delete(l);
  };
}
export function usePicks(): State {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

// A list that should be looked up again: past its hour, or made as "Today"
// when it's now "Tonight" (audit, 24 Nov 2026). A taste change isn't one.
export function outOfDate(s: Slot) {
  if (s.loading) return false;
  return !sameSlotName(s) || (s.madeAt !== undefined && Date.now() - s.madeAt > KEEP_MS);
}
const told = new WeakSet<Slot>();
function sweep() {
  if (document.visibilityState !== "visible") return;
  const lists = Object.fromEntries(Object.entries(state.lists).filter(([, s]) => !outOfDate(s)));
  // A tweaked list out of date is looked up again with its tweak only by a
  // screen showing it (openList), never in the background (cost audit, 25
  // Nov 2026): the screens hear of it here.
  // Told once per tweaked list, not every minute (re-audit, 25 Nov 2026).
  const stale = Object.values(state.tweaked).filter((t) => outOfDate(t.slot) && !told.has(t.slot));
  for (const t of stale) told.add(t.slot);
  if (Object.keys(lists).length !== Object.keys(state.lists).length || stale.length) set({ lists });
  // A list past its hour leaves the phone too, not only at the next reload.
  else persist();
}

// Their taste changed (a new line, new answers): the next open searches again.
// A change being saved: the kept copy goes at once, and every search waits
// for the save.
export function changingTaste<T>(write: PromiseLike<T>): Promise<T> {
  forgetPicks();
  return savingTaste(write);
}
export function forgetPicks() {
  tasteVersion++;
  shownBefore.clear();
  try {
    localStorage.removeItem(STORE);
  } catch {
    // Nothing kept.
  }
  forgetFetaPicks();
}

export function slotKey(origin: Origin, when: When, category: Category) {
  return `${originKey(origin)}|${when}:${category}`;
}
export function searchKey(origin: Origin, when: When, category: Category, typed: string) {
  return `${slotKey(origin, when, category)}|search:${typed.trim().toLowerCase()}`;
}
const searchAsk = (typed: string): Ask => ({ tweaks: [], note: typed, search: true });
const omit = <T,>(all: Record<string, T>, key: string) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key));

// Looks a list up and puts it in its place. Two screens asking at once share
// it: while it's loading, nobody asks again. A list replaced meanwhile (a
// newer ask) is never overwritten by an older reply.
function load(key: string, origin: Origin, when: When, category: Category, ask: Ask | undefined, tweak: boolean) {
  const version = tasteVersion;
  const waiting: Slot = { loading: true, picks: [], spares: [], saved: [] };
  if (tweak) set({ tweaked: { ...state.tweaked, [key]: { tweaks: ask?.tweaks ?? [], note: ask?.note, slot: waiting, origin, when, category } } });
  else set({ lists: { ...state.lists, [key]: waiting } });
  return fetchPicks(category, when, origin, false, ask).then((reply) => {
    const slot: Slot = {
      loading: false,
      picks: reply.picks ?? [],
      spares: reply.spares ?? [],
      saved: [],
      banner: reply.banner,
      notice: reply.notice ?? reply.error,
      failed: !!reply.error,
      limited: reply.limited,
      ...(when === "tonight" ? { slotName: firstSlotName(origin.city.timeZone), timeZone: origin.city.timeZone } : {}),
      madeAt: Date.now(),
      taste: version,
    };
    if (tweak) {
      const t = state.tweaked[key];
      if (t?.slot === waiting) set({ tweaked: { ...state.tweaked, [key]: { ...t, slot } } });
    } else if (state.lists[key] === waiting) {
      set({ lists: { ...state.lists, [key]: slot } });
      // A typed search's late events would come from the everyday list
      // (tech audit, 25 Nov 2026): only the everyday list waits for them.
      if (reply.eventsComing && !ask) eventsLater(key, origin, when, category, version, slot.madeAt!);
    }
  });
}

// A screen opens a list: kept and up to date, it's used as it is; else it's
// looked up (a list made before their taste changed is looked up now).
export function openList(origin: Origin, when: When, category: Category, typed?: string | null) {
  fromPhone();
  const key = typed ? searchKey(origin, when, category, typed) : slotKey(origin, when, category);
  const t = state.tweaked[key];
  if (t) {
    if (!t.slot.loading && (outOfDate(t.slot) || t.slot.taste !== tasteVersion)) load(key, origin, when, category, { tweaks: t.tweaks, note: t.note }, true);
    return;
  }
  const s = state.lists[key];
  if (s && (s.loading || (!outOfDate(s) && s.taste === tasteVersion))) return;
  load(key, origin, when, category, typed ? searchAsk(typed) : undefined, false);
}

// Looks the everyday list up again now (after the first-time questions, or
// something added to their taste on the list itself).
export function reloadList(origin: Origin, when: When, category: Category) {
  const key = slotKey(origin, when, category);
  set({ tweaked: omit(state.tweaked, key) });
  return load(key, origin, when, category, undefined, false);
}

// Cheaper, Fancier, a note: the tweaked list shows over the everyday one.
export function tweakList(origin: Origin, when: When, category: Category, tweaks: string[], note?: string) {
  const key = slotKey(origin, when, category);
  if (tweaks.length === 0 && !note) return undoTweaks(key);
  return load(key, origin, when, category, { tweaks, note }, true);
}
// Back to the everyday list as it was; one out of date by now is looked up
// again by the screen showing it.
export function undoTweaks(key: string) {
  if (!state.tweaked[key]) return;
  const s = state.lists[key];
  set({ tweaked: omit(state.tweaked, key), ...(s && outOfDate(s) ? { lists: omit(state.lists, key) } : {}) });
}

// Every list, everyday and tweaked, changed the same way.
function everyList(change: (key: string, s: Slot) => Slot) {
  set({
    lists: Object.fromEntries(Object.entries(state.lists).map(([k, s]) => [k, change(k, s)])),
    tweaked: Object.fromEntries(Object.entries(state.tweaked).map(([k, t]) => [k, { ...t, slot: change(k, t.slot) }])),
  });
}
const without = (s: Slot, placeId: string): Slot => ({ ...s, picks: s.picks.filter((p) => p.placeId !== placeId), spares: s.spares.filter((p) => p.placeId !== placeId) });

// Saved on a list: ticked there (the big one moves to the end, so the next
// pick takes the big card) and gone from every other list (tester, 23 Nov
// 2026: a café saved in Food & drinks stayed in Things to do).
export function savedOn(key: string, placeId: string) {
  everyList((k, s) => {
    if (k !== key) return without(s, placeId);
    if (s.saved.includes(placeId)) return s;
    const picks = s.picks[0]?.placeId === placeId ? [...s.picks.slice(1), s.picks[0]] : s.picks;
    return { ...s, picks, saved: [...s.saved, placeId] };
  });
}
// Skipped, been there, or saved elsewhere (Let's go, Ask Feta): off every
// list, the everyday one under a tweak included, so Undo never brings it back.
export function leaveLists(placeId: string) {
  everyList((_, s) => without(s, placeId));
}

// The next places for a list: the next 8 from the backup, or a new search
// once the backup has run out. replace: the pull for a fresh set (they take
// the list's place); else "Show me more" (they go below).
export const SHOW = 8;
// Every place a list has shown on this phone (this session), so the next
// places never go round the same backup again (audit, 24 Nov 2026).
const shownBefore = new Map<string, Set<string>>();
function markShown(listKey: string, ids: string[]) {
  const seen = shownBefore.get(listKey) ?? new Set<string>();
  for (const id of ids) seen.add(id);
  shownBefore.set(listKey, seen);
}
function changeShown(key: string, change: (s: Slot) => Slot) {
  const t = state.tweaked[key];
  if (t) set({ tweaked: { ...state.tweaked, [key]: { ...t, slot: change(t.slot) } } });
  else if (state.lists[key]) set({ lists: { ...state.lists, [key]: change(state.lists[key]) } });
}
function listToken(key: string) {
  const t = state.tweaked[key];
  return t ? `tweak:${t.tweaks.join(",")}|${t.note ?? ""}|${t.slot.madeAt ?? "loading"}` : `list:${state.lists[key]?.madeAt ?? "none"}`;
}
export async function morePicks(origin: Origin, when: When, category: Category, typed: string | null | undefined, replace: boolean): Promise<{ fresh: Pick[]; notice?: string }> {
  const key = typed ? searchKey(origin, when, category, typed) : slotKey(origin, when, category);
  const slot = shown(state, key);
  if (!slot || slot.loading || slot.more) return { fresh: [] };
  // More of the same list: a search's or a tweak's, never the everyday one
  // (backend audit, 23 Nov 2026).
  const t = state.tweaked[key];
  const ask = typed ? searchAsk(typed) : t ? { tweaks: t.tweaks, note: t.note } : undefined;
  const listKey = `${slotKey(origin, when, category)}|${ask?.note ?? ""}|${(ask?.tweaks ?? []).join(",")}`;
  markShown(listKey, slot.picks.map((p) => p.placeId));
  const seen = shownBefore.get(listKey)!;
  changeShown(key, (s) => ({ ...s, more: true }));
  // Which list asked for more: by the search that made it, not the object,
  // since a save, a skip or late events copy it (re-audit, 25 Nov 2026). A
  // different list there by the reply (a tweak, Undo, a reload) is left
  // alone, and nothing is left saying "Finding more…".
  const asked = listToken(key);
  let found: Pick[];
  let spares: Pick[];
  let notice: string | undefined;
  const backup = slot.spares.filter((p) => !seen.has(p.placeId));
  if (backup.length) {
    found = backup.slice(0, SHOW);
    spares = backup.slice(SHOW);
  } else {
    const reply = await fetchPicks(category, when, origin, true, ask, { shown: [...seen, ...slot.saved].slice(-200) });
    found = (reply.picks ?? []).filter((p) => !slot.picks.some((q) => q.placeId === p.placeId));
    spares = reply.spares ?? [];
    notice = reply.notice;
  }
  if (listToken(key) !== asked) {
    const t2 = state.tweaked[key];
    set({
      ...(state.lists[key] ? { lists: { ...state.lists, [key]: { ...state.lists[key], more: false } } } : {}),
      ...(t2 ? { tweaked: { ...state.tweaked, [key]: { ...t2, slot: { ...t2.slot, more: false } } } } : {}),
    });
    return { fresh: [] };
  }
  changeShown(key, (s) => (found.length === 0 ? { ...s, more: false } : { ...s, more: false, picks: replace ? found : [...s.picks, ...found], spares }));
  return { fresh: found, notice };
}

// Events still being found when the list came (they take up to ~20 s, live
// check 23 Nov 2026): ask once more a little later and add them to that
// same list, never a different one made since.
function eventsLater(key: string, origin: Origin, when: When, category: Category, version: number, madeAt: number) {
  setTimeout(async () => {
    const had = state.lists[key];
    if (version !== tasteVersion || had?.madeAt !== madeAt) return;
    // Only events it doesn't have yet are checked (audit, 24 Nov 2026).
    const reply = await fetchPicks(category, when, origin, false, undefined, { eventsOnly: true, shown: had.picks.filter((p) => p.event).map((p) => p.placeId) });
    const was = state.lists[key];
    if (version !== tasteVersion || was?.madeAt !== madeAt || !reply.picks?.some((p) => p.event)) return;
    // The new events lead, then the ones already shown; the places follow,
    // and the ones pushed out become backup, never "new" again.
    const found = reply.picks.filter((p) => p.event);
    const events = [...found, ...was.picks.filter((p) => p.event && !found.some((e) => e.placeId === p.placeId))];
    const all = [...events, ...[...was.picks, ...was.spares].filter((p) => !p.event)];
    markShown(`${key}||`, was.picks.map((p) => p.placeId));
    set({ lists: { ...state.lists, [key]: { ...was, picks: all.slice(0, SHOW), spares: all.slice(SHOW) } } });
  }, 20000);
}
