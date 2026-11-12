import "server-only";
import { distanceKm } from "@/lib/cities";
import type { Pick } from "@/lib/server/picks";

// A full day (or up to 3) from Ask Feta: breakfast, something in the
// morning, lunch, the afternoon, dinner and a drink, in code. Each stop is
// open at its time by the place's weekly hours for that day (events on
// their own date and time), never repeats, and stays close to the stop
// before it.

export type ItineraryStop = { time: string; slot: string; pick: Pick; travel?: string };
export type ItineraryDay = { label: string; date: string; stops: ItineraryStop[] };
export type Itinerary = { title: string; days: ItineraryDay[] };

const SLOTS = [
  { slot: "Breakfast", at: 9 * 60 + 30, minutes: 60, kinds: ["EAT"] },
  { slot: "Morning", at: 11 * 60, minutes: 120, kinds: ["DO", "EVENT"] },
  { slot: "Lunch", at: 13 * 60 + 30, minutes: 75, kinds: ["EAT"] },
  { slot: "Afternoon", at: 15 * 60 + 30, minutes: 120, kinds: ["DO", "EVENT"] },
  { slot: "Dinner", at: 19 * 60 + 30, minutes: 90, kinds: ["EAT"] },
  { slot: "After dinner", at: 21 * 60 + 30, minutes: 60, kinds: ["DRINK", "DO", "EVENT"] },
];

const clock = (m: number) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${m < 12 * 60 ? "am" : "pm"}`;

function travel(km: number) {
  return km <= 1.5 ? `${Math.max(3, Math.round(km * 13))}-minute walk` : `${Math.round(8 + km * 3)}-minute ride`;
}

// Open on that weekday from "start" for "minutes", by weekly hours. Places
// with no hours on Google (parks, walks) only count in the daytime.
function openAt(p: Pick, weekday: number, start: number, minutes: number) {
  if (!p.hours?.length) return p.kind === "DO" && start >= 9 * 60 && start + minutes <= 18 * 60;
  const end = start + minutes;
  return p.hours.some(([d, open, close]) => (d === weekday && open <= start && close >= end) || (d === (weekday + 6) % 7 && close - 24 * 60 >= end));
}

function kmBetween(a: Pick | null, b: Pick): number | null {
  return a && a.lat !== undefined && a.lng !== undefined && b.lat !== undefined && b.lng !== undefined ? distanceKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) : null;
}

function eventMinutes(p: Pick) {
  const [h, m] = (p.event?.time ?? "").split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

export function buildItinerary(picks: Pick[], opts: { start: string; days: number; place: string }): Itinerary {
  const used = new Set<string>();
  const rank = new Map(picks.map((p, i) => [p.placeId, i]));
  const days: ItineraryDay[] = [];
  for (let d = 0; d < Math.min(3, Math.max(1, opts.days)); d++) {
    const date = new Date(`${opts.start}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + d);
    const iso = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();
    const stops: ItineraryStop[] = [];
    let last: Pick | null = null;
    for (const s of SLOTS) {
      let best: { p: Pick; at: number; score: number } | null = null;
      for (const p of picks) {
        if (used.has(p.placeId) || !s.kinds.includes(p.kind)) continue;
        let at = s.at;
        if (p.event) {
          const t = eventMinutes(p);
          if (p.event.date !== iso || t === null || Math.abs(t - s.at) > 90) continue;
          at = t;
        } else if (!openAt(p, weekday, s.at, s.minutes)) continue;
        const score: number = (kmBetween(last, p) ?? 0) + (rank.get(p.placeId) ?? 0) * 0.3 + (p.fetaNote !== undefined ? -1 : 0) + (p.event ? -1 : 0);
        if (!best || score < best.score) best = { p, at, score };
      }
      if (!best) continue;
      const km = kmBetween(last, best.p);
      used.add(best.p.placeId);
      stops.push({ time: clock(best.at), slot: s.slot, pick: best.p, ...(km !== null ? { travel: travel(km) } : {}) });
      last = best.p;
    }
    days.push({ label: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(date), date: iso, stops });
  }
  return { title: opts.days > 1 ? `${opts.days} days in ${opts.place}` : `A day in ${opts.place}`, days };
}
