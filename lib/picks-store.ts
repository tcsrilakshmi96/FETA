"use client";

import { firstSlotName } from "@/lib/slot-label";
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
  // Made as "Today" or "Tonight" in this city: a list kept on the phone goes
  // when that changes at 5 pm, so the server re-checks it (audit, 24 Nov 2026).
  slotName?: string;
  timeZone?: string;
  madeAt?: number; // which search made it, so late events join only that list
  // Made with this taste (tasteVersion), and whether a tweak (Cheaper,
  // Fancier, a note) made it: only everyday lists made with the current
  // taste are kept (audit, 24 Nov 2026: a list from before a skip, or a
  // Cheaper one, came back after a reload as the everyday list).
  taste?: number;
  tweaked?: boolean;
};

// Kept for an hour, in memory and on the phone, so a list they've seen
// comes back free after a reload or past the day's limit (founder, 24 Nov
// 2026: "once they hit the daily limit can we not just keep the last
// picks?"); never longer, as Google allows. A place whose closing time has
// passed since it was checked is dropped.
const KEEP_MS = 60 * 60000;
const STORE = "feta.picks.kept";
let kept: { slots: Record<string, Slot>; at: number } | null = null;
function fromPhone(): typeof kept {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null") as typeof kept;
    // A copy on the phone is from the taste they have now: any change to
    // it clears the copy (forgetPicks).
    // Each list leaves the phone once its own hour is up (audit, 24 Nov 2026).
    const live = v ? Object.entries(v.slots).filter(([, x]) => Date.now() - (x.madeAt ?? v.at) <= KEEP_MS) : [];
    if (v && live.length) {
      if (live.length < Object.keys(v.slots).length) localStorage.setItem(STORE, JSON.stringify({ ...v, slots: Object.fromEntries(live) }));
      return { ...v, slots: Object.fromEntries(live.map(([k, x]) => [k, { ...x, taste: tasteVersion }])) };
    }
    localStorage.removeItem(STORE);
  } catch {
    // Nothing kept.
  }
  return null;
}
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
  try {
    localStorage.removeItem(STORE);
  } catch {
    // Nothing kept.
  }
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

// fromPhone: also what's kept on the phone (after a reload). Screens' first
// draw reads memory only, so it matches the server's page.
// Each list is kept an hour from when it was made (madeAt), not from the
// first list kept (audit, 24 Nov 2026).
const fresh = (s: Slot, at: number) => Date.now() - (s.madeAt ?? at) <= KEEP_MS;
export function keptSlots(fromStore = false): Record<string, Slot> {
  if (!kept && fromStore) kept = fromPhone();
  if (!kept) return {};
  const at = kept.at;
  // Past the hour nothing is left on the phone, not only ignored (audit, 24 Nov 2026).
  if (!Object.values(kept.slots).some((x) => fresh(x, at))) {
    kept = null;
    try { localStorage.removeItem(STORE); } catch { /* nothing kept */ }
    return {};
  }
  return Object.fromEntries(
    Object.entries(kept.slots)
      .filter(([, s]) => !s.loading && fresh(s, at) && (!s.slotName || s.slotName === firstSlotName(s.timeZone)))
      .map(([k, s]) => [k, { ...s, picks: s.picks.filter(stillOpen), spares: s.spares.filter(stillOpen) }]),
  );
}

export function keepSlots(slots: Record<string, Slot>) {
  // A screen's first save after a reload never wipes the phone's copy: the
  // lists kept there join what the screen has (audit, 24 Nov 2026: the picks
  // list saved its empty start over it, so the hour's copy was never used).
  if (!kept) {
    const onPhone = fromPhone();
    if (onPhone) slots = { ...Object.fromEntries(Object.entries(onPhone.slots).filter(([, s]) => fresh(s, onPhone.at))), ...slots };
  }
  const at = kept?.at ?? Date.now();
  // Only everyday lists made with the taste they have now, within their hour,
  // never half-way through finding more. Where a screen shows a tweaked list,
  // the everyday one already kept stays.
  // A list still loading never replaces a finished one (audit, 24 Nov 2026:
  // Cheaper's placeholder pushed out the everyday list).
  const keepable = (s: Slot) => !s.loading && (s.taste ?? tasteVersion) === tasteVersion && !s.tweaked && fresh(s, at);
  slots = Object.fromEntries(
    Object.entries({ ...kept?.slots, ...slots })
      .map(([k, s]) => [k, keepable(s) ? s : kept?.slots[k]] as const)
      .filter((e): e is [string, Slot] => !!e[1] && keepable(e[1]))
      .map(([k, s]) => [k, { ...s, more: false }]),
  );
  kept = { slots, at };
  try {
    // Only finished lists, never one that failed or hit the limit.
    const keep = Object.fromEntries(Object.entries(slots).filter(([, s]) => !s.loading && !s.failed && !s.limited && s.picks.length));
    localStorage.setItem(STORE, JSON.stringify({ slots: keep, at: kept.at }));
  } catch {
    // Kept in memory only.
  }
}

// Loads a category's picks. Two screens asking at once share one request.
// A search has its own slot (searchKey), never Home's or the everyday list's.
export function loadSlot(origin: Origin, when: When, category: Category, tweak?: Ask): Promise<Slot> {
  const key = tweak?.search && tweak.note ? searchKey(origin, when, category, tweak.note) : slotKey(origin, when, category);
  if (!tweak && inflight.has(key)) return inflight.get(key)!;
  // A list seen within the hour comes back from the phone, free.
  const onPhone = tweak ? null : keptSlots(true)[key];
  if (onPhone?.picks.length) return Promise.resolve(onPhone);
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
      ...(when === "tonight" ? { slotName: firstSlotName(origin.city.timeZone), timeZone: origin.city.timeZone } : {}),
      madeAt: Date.now(),
      taste: version,
      ...(tweak && !tweak.search ? { tweaked: true } : {}),
    };
    // A tweaked list is never kept, so it leaves the kept everyday one alone.
    if (version === tasteVersion && !slot.tweaked) keepSlots({ ...keptSlots(), [key]: slot });
    if (reply.eventsComing && !tweak) eventsLater(key, origin, when, category, version, slot.madeAt!);
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

// The same for every list kept in memory and on the phone, including ones
// this screen never showed (audit, 24 Nov 2026: after a reload, Home's
// weekend list kept a place they had just saved).
// key: the list it was acted on, which handles its own; "" for none (a save
// from Let's go or Ask Feta), so it leaves every kept list.
export function leaveOtherLists(key: string, placeId: string) {
  const all = kept ? kept.slots : fromPhone()?.slots;
  if (!all) return;
  kept = { slots: withoutElsewhere(all, key, placeId), at: kept?.at ?? Date.now() };
  keepSlots({});
}

// A list a screen is still showing that should be looked up again: past
// its hour, or made as "Today" when it's now "Tonight" (audit, 24 Nov 2026:
// one rule for Home and the picks list). A taste change isn't one: the new
// search waits until they next open the screen, so a skip reason never pays
// for every list at once.
export function outOfDate(s: Slot) {
  if (s.loading) return false;
  return (s.slotName !== undefined && s.slotName !== firstSlotName(s.timeZone)) || (s.madeAt !== undefined && Date.now() - s.madeAt > KEEP_MS);
}

// Late events join only the list they were found for, never a different
// one now on screen (a Cheaper list; audit, 24 Nov 2026).
export function withLateEvents(slots: Record<string, Slot>, key: string, slot: Slot) {
  return slots[key] && slots[key].madeAt === slot.madeAt && !slots[key].tweaked ? { ...slots, [key]: slot } : slots;
}

// Events still being found when the list came (they take up to ~20 s, live
// check 23 Nov 2026): ask once more a little later, when they've joined the
// stored set, and tell the screens showing this list.
export const SLOT_EVENT = "feta:slot";
function eventsLater(key: string, origin: Origin, when: When, category: Category, version: number, madeAt: number) {
  setTimeout(async () => {
    if (version !== tasteVersion) return;
    const had = keptSlots()[key];
    // A different list is there now (a Cheaper or Fancier one): the events
    // were for the first (audit, 24 Nov 2026).
    if (had?.madeAt !== madeAt) return;
    // Only events it doesn't have yet are checked (audit, 24 Nov 2026).
    const reply = await fetchPicks(category, when, origin, false, undefined, { eventsOnly: true, shown: (had?.picks ?? []).filter((p) => p.event).map((p) => p.placeId) });
    const was = keptSlots()[key];
    if (version !== tasteVersion || !was || was.madeAt !== madeAt || !reply.picks?.some((p) => p.event)) return;
    // The new events lead, then the ones already shown; the places follow,
    // and the ones pushed out become backup.
    const fresh = reply.picks.filter((p) => p.event);
    const events = [...fresh, ...was.picks.filter((p) => p.event && !fresh.some((e) => e.placeId === p.placeId))];
    const places = [...was.picks, ...was.spares].filter((p) => !p.event);
    const all = [...events, ...places];
    // Places they've already seen, pushed down by the events, never come
    // back as new (audit, 24 Nov 2026).
    markShown(`${key}||`, was.picks.map((p) => p.placeId));
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

function markShown(listKey: string, ids: string[]) {
  const seen = shownBefore.get(listKey) ?? new Set<string>();
  for (const id of ids) seen.add(id);
  shownBefore.set(listKey, seen);
}

// A search's next places are more of the same search (search).
export async function nextPicks(slot: Slot, origin: Origin, when: When, category: Category, search?: Ask): Promise<{ fresh: Pick[]; spares: Pick[]; notice?: string }> {
  const listKey = `${slotKey(origin, when, category)}|${search?.note ?? ""}|${(search?.tweaks ?? []).join(",")}`;
  markShown(listKey, slot.picks.map((p) => p.placeId));
  const seen = shownBefore.get(listKey)!;
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
