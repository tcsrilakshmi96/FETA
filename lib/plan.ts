import { distanceKm } from "@/lib/cities";
import type { Pick, When } from "@/lib/picks-client";

// Plan my evening: a dinner (or drinks) pick plus something to do after,
// close to each other, with times that respect opening hours and an
// event's start time. Built from the picks already on screen, in code.

export type PlanStop = { pick: Pick; time: Date };
export type Plan = { stops: [PlanStop, PlanStop]; km: number; minutes: number; mode: "walk" | "ride"; day: string };

const DINNER_MINUTES = 75;
const MAX_KM = 3;
// The second stop only needs to be open this long after you arrive.
const AFTER_MINUTES = 45;

function travel(km: number) {
  return km <= 1.5 ? { mode: "walk" as const, minutes: Math.max(3, Math.round(km * 13)) } : { mode: "ride" as const, minutes: Math.round(8 + km * 3) };
}

// Rounds up to the next quarter hour.
function quarter(d: Date) {
  const q = 15 * 60000;
  return new Date(Math.ceil(d.getTime() / q) * q);
}

function eventStart(p: Pick): Date | null {
  if (!p.event?.date || !p.event.time) return null;
  return new Date(`${p.event.date}T${p.event.time}:00`);
}

// Open from "at" for at least "minutes", by the place's weekly hours when
// known (right for a Saturday plan), else by tonight's closing time.
function openUntil(p: Pick, at: Date, minutes: number) {
  if (p.event) return true;
  if (p.hours?.length) {
    const day = at.getDay();
    const start = at.getHours() * 60 + at.getMinutes();
    const end = start + minutes;
    return p.hours.some(([d, open, close]) => (d === day && open <= start && close >= end) || (d === (day + 6) % 7 && close - 24 * 60 >= end));
  }
  if (!p.closesAt) return true;
  return new Date(p.closesAt).getTime() >= at.getTime() + minutes * 60000;
}

const VERDICT_SCORE: Record<string, number> = { "Worth a detour": 0, "Good if you're nearby": 1, "Skip unless": 3 };

export function planEvening(food: Pick[], experiences: Pick[], when: When, now = new Date()): Plan | null {
  const firsts = food.filter((p) => p.kind === "EAT" || p.kind === "DRINK");
  const afters = [...experiences, ...food.filter((p) => p.kind === "DRINK")];
  const found: { best: { plan: Plan; score: number } | null } = { best: null };

  // Tonight starts soon; the weekend plan is for Saturday (or Sunday) evening.
  const day = new Date(now);
  if (when === "weekend") day.setDate(day.getDate() + ((6 - day.getDay() + 7) % 7));
  // Dinner at 7:30 pm, or as soon as possible if that has passed tonight.
  // Late in the evening it starts sooner and dinner is quicker, so there is
  // still time for a second stop before places close.
  const usual = new Date(day);
  usual.setHours(19, 30, 0, 0);
  const late = when === "tonight" && now.getHours() >= 21;
  const earliest = when === "tonight" ? quarter(new Date(now.getTime() + (late ? 20 : 40) * 60000)) : usual;
  const dinnerMinutes = late ? 60 : DINNER_MINUTES;

  const consider = (first: Pick, second: Pick, firstAt: Date, secondAt: Date, km: number, t: ReturnType<typeof travel>, bonus: number) => {
    if (firstAt < earliest) return;
    if (!openUntil(first, firstAt, 60) || !openUntil(second, secondAt, AFTER_MINUTES)) return;
    const score = km + bonus + (VERDICT_SCORE[first.verdict] ?? 1) + (VERDICT_SCORE[second.verdict] ?? 1) + (first.fetaNote !== undefined || second.fetaNote !== undefined ? -1 : 0);
    if (found.best && score >= found.best.score) return;
    found.best = {
      score,
      plan: {
        stops: [
          { pick: first, time: firstAt },
          { pick: second, time: secondAt },
        ],
        km: Math.round(km * 10) / 10,
        minutes: t.minutes,
        mode: t.mode,
        day: when === "tonight" ? "Tonight" : new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(firstAt),
      },
    };
  };

  for (const a of firsts) {
    for (const b of afters) {
      if (a.placeId === b.placeId || a.lat === undefined || b.lat === undefined || a.lng === undefined || b.lng === undefined) continue;
      const km = distanceKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
      if (km > MAX_KM) continue;
      const t = travel(km);
      const fixed = eventStart(b);
      if (fixed) {
        // An event fixes the time: dinner before it, or straight after.
        consider(a, b, quarter(new Date(fixed.getTime() - (dinnerMinutes + t.minutes + 10) * 60000)), fixed, km, t, 0);
        consider(b, a, fixed, quarter(new Date(fixed.getTime() + (120 + t.minutes) * 60000)), km, t, 0.5);
        continue;
      }
      // Dinner, then something after (open late enough)…
      const dinner = usual < earliest ? earliest : usual;
      consider(a, b, dinner, quarter(new Date(dinner.getTime() + (dinnerMinutes + t.minutes) * 60000)), km, t, 0);
      // …or something first in the early evening, then dinner.
      const visit = 90;
      const before = quarter(new Date(dinner.getTime() - (visit + t.minutes) * 60000));
      consider(b, a, before, dinner, km, t, 0.5);
    }
  }
  return found.best?.plan ?? null;
}

export function clock(d: Date) {
  return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}
