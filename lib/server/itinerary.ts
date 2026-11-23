import "server-only";

import { travel } from "@/lib/plan";
import { distanceKm } from "@/lib/cities";
import { brandOf, neverAPickType, type Pick } from "@/lib/server/picks";

// A full day (or up to 3) from Ask Feta or a trip city: breakfast,
// something in the morning, lunch, the afternoon, dinner and a drink, in
// code. Each stop is open at its time by the place's weekly hours for that
// day (events on their own date and time), fits that time of day, never
// repeats (nor another branch of the same chain), and stays close to the
// stop before it. Today starts from now; a day from a hotel ends back there.

export type ItineraryStop = { time: string; slot: string; pick: Pick; travel?: string };
export type ItineraryDay = { label: string; date: string; stops: ItineraryStop[]; back?: string };
export type Itinerary = { title: string; days: ItineraryDay[] };

const SLOTS = [
  { slot: "Breakfast", at: 9 * 60 + 30, minutes: 60, kinds: ["EAT"] },
  { slot: "Morning", at: 11 * 60, minutes: 120, kinds: ["DO", "EVENT"] },
  { slot: "Lunch", at: 13 * 60 + 30, minutes: 75, kinds: ["EAT"] },
  { slot: "Afternoon", at: 15 * 60 + 30, minutes: 120, kinds: ["DO", "EVENT"] },
  { slot: "Dinner", at: 19 * 60 + 30, minutes: 90, kinds: ["EAT"] },
  { slot: "After dinner", at: 21 * 60 + 30, minutes: 60, kinds: ["DRINK", "DO", "EVENT"] },
];
// The last slot to start today.
export const LAST_START = SLOTS[SLOTS.length - 1].at;

const clock = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${m < 12 * 60 ? "am" : "pm"}`;

function travelLine(km: number) {
  const t = travel(km);
  return `${t.minutes}-minute ${t.mode}`;
}

// What a day out never stops at (travellers, 23 Nov 2026: tour-company
// offices in Lisbon): agencies and offices sell tours, they aren't sights.
const OFFICE_NAMES = /\b(tours|travels|agency|excursions|holidays|transfers|tuk[- ]?tuks?)\b/i;
const SIGHT_TYPES = /museum|historical|monument|landmark|church|cathedral|temple|mosque|palace|castle|fort|park|garden|gallery|viewpoint|observation|beach|market|aquarium|zoo/;
// Places mainly for drinking: only after dinner, never a daytime stop.
const NIGHT_TYPES = /^(bar|pub|wine_bar|cocktail_bar|night_club|brewery|brewpub|beer_hall|beer_garden|irish_pub|sports_bar|lounge_bar|hookah_bar|karaoke)$/;
// Outdoors: only in daylight, never after dinner (a park at 9:30 pm).
const OUTDOOR_TYPES = /^(park|city_park|national_park|state_park|garden|botanical_garden|beach|hiking_area|nature_preserve|playground|dog_park|picnic_ground|campground|lake|wildlife_park|zoo)$/;

export function isOffice(p: Pick) {
  const type = p.type ?? "";
  return neverAPickType(type) || (OFFICE_NAMES.test(p.name) && !SIGHT_TYPES.test(type));
}

// Whether a place suits a slot's time of day (beyond its opening hours).
export function suitsSlot(p: Pick, start: number) {
  if (isOffice(p)) return false;
  const type = p.type ?? "";
  if (NIGHT_TYPES.test(type) && start < 18 * 60) return false;
  if (OUTDOOR_TYPES.test(type) && start >= 17 * 60) return false;
  return true;
}

// Open on that weekday from "start" for "minutes", by weekly hours. Places
// with no hours on Google (parks, walks) only count in the daytime.
function openAt(p: Pick, weekday: number, start: number, minutes: number) {
  if (!p.hours?.length) return p.kind === "DO" && start >= 9 * 60 && start + minutes <= 18 * 60;
  const end = start + minutes;
  return p.hours.some(([d, open, close]) => (d === weekday && open <= start && close >= end) || (d === (weekday + 6) % 7 && close - 24 * 60 >= end));
}

type Point = { lat?: number; lng?: number };
function kmBetween(a: Point | null, b: Point): number | null {
  return a && a.lat !== undefined && a.lng !== undefined && b.lat !== undefined && b.lng !== undefined ? distanceKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) : null;
}

function eventMinutes(p: Pick) {
  const [h, m] = (p.event?.time ?? "").split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

// The sights of a place (the day-plan searches for its top attractions and
// its history and culture, intents.ts): each day leads with one when it can.
const SIGHTS = ["plan_sights", "plan_heritage"];

// from: on the first day, the earliest a stop may start (now, when the plan
// starts today). hotel: where they're staying, so the day starts and ends there.
export function buildItinerary(picks: Pick[], opts: { start: string; days: number; place: string; from?: number; hotel?: { lat: number; lng: number } | null }): Itinerary {
  const used = new Set<string>();
  const chains = new Set<string>();
  const rank = new Map(picks.map((p, i) => [p.placeId, i]));
  const days: ItineraryDay[] = [];
  for (let d = 0; d < Math.min(3, Math.max(1, opts.days)); d++) {
    const date = new Date(`${opts.start}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + d);
    const iso = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();
    const stops: ItineraryStop[] = [];
    let last: Point | null = opts.hotel ?? null;
    let sightToday = false;
    for (const s of SLOTS) {
      if (d === 0 && opts.from !== undefined && s.at < opts.from) continue;
      let best: { p: Pick; at: number; score: number } | null = null;
      for (const p of picks) {
        if (used.has(p.placeId) || chains.has(brandOf(p.name)) || !s.kinds.includes(p.kind)) continue;
        let at = s.at;
        if (p.event) {
          const t = eventMinutes(p);
          if (p.event.date !== iso || t === null || Math.abs(t - s.at) > 90 || (d === 0 && opts.from !== undefined && t < opts.from)) continue;
          at = t;
        } else if (!openAt(p, weekday, s.at, s.minutes)) continue;
        if (!suitsSlot(p, at)) continue;
        const sight = !sightToday && (p.serves ?? []).some((id) => SIGHTS.includes(id));
        const score: number = (kmBetween(last, p) ?? 0) + (rank.get(p.placeId) ?? 0) * 0.3 + (p.fetaNote !== undefined ? -1 : 0) + (p.event ? -1 : 0) + (sight ? -3 : 0);
        if (!best || score < best.score) best = { p, at, score };
      }
      if (!best) continue;
      const km = kmBetween(last, best.p);
      used.add(best.p.placeId);
      chains.add(brandOf(best.p.name));
      if ((best.p.serves ?? []).some((id) => SIGHTS.includes(id))) sightToday = true;
      stops.push({ time: clock(best.at), slot: s.slot, pick: best.p, ...(km !== null ? { travel: travelLine(km) } : {}) });
      last = best.p;
    }
    // Back to the hotel at the end of the day.
    const home = opts.hotel && stops.length ? kmBetween(last, opts.hotel) : null;
    days.push({ label: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(date), date: iso, stops, ...(home !== null ? { back: `${travelLine(home)} back to your hotel` } : {}) });
  }
  return { title: opts.days > 1 ? `${opts.days} days in ${opts.place}` : `A day in ${opts.place}`, days };
}
