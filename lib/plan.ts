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

// Rough, from the straight line: streets wind about a third further than
// the crow flies (tester, 22 Nov 2026: Lisbon 10 min vs 17 on Maps; London
// 3 min next door), at about 5 km/h on foot. One place for every screen.
const DETOUR = 1.35;
export function travel(km: number) {
  const road = km * DETOUR;
  return km <= 1.5 ? { mode: "walk" as const, minutes: Math.max(1, Math.round((road / 4.8) * 60)) } : { mode: "ride" as const, minutes: Math.round(8 + road * 2.5) };
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
  // Unknown hours are fine by day, but not in the evening (testers: a small
  // park at 9 pm).
  if (!p.closesAt) return at.getHours() < 18;
  return new Date(p.closesAt).getTime() >= at.getTime() + minutes * 60000;
}

// What each stop is for comes from what the place is (Google's type), not
// from the list it came from (persona test, 23 Nov 2026: a bakery as
// dinner, a café as "something to do").
// Somewhere for a treat or a coffee, not a dinner.
const TREAT = /^(bakery|cafe|coffee_shop|tea_house|juice_shop|dessert_shop|dessert_restaurant|ice_cream_shop|confectionery|donut_shop|cake_shop|chocolate_shop|candy_store|pastry_shop|bagel_shop|acai_shop|cafeteria)$/;
const FOOD_PLACE = /restaurant|cafe|coffee|bakery|bar$|pub|brewery|dessert|food|tea_house|juice|ice_cream|confection|donut|cake|bagel|deli|takeaway/;
// Dinner: a place to eat a meal.
export const isMeal = (p: Pick) => p.kind === "EAT" && !!p.type && !TREAT.test(p.type);
// After dinner: drinks, or dessert or a coffee.
const forAfter = (p: Pick) => p.kind === "DRINK" || (p.kind === "EAT" && TREAT.test(p.type ?? ""));
// Something to do: an event, or a place to go; a café or a bar only when
// it's where something they're into happens (board games, comedy), never
// for a vibe card alone.
const toDo = (p: Pick) => !!p.event || (p.kind === "DO" && (!FOOD_PLACE.test(p.type ?? "") || (p.serves ?? []).some((id) => !id.startsWith("side_") && id !== "popular")));

const VERDICT_SCORE: Record<string, number> = { "Worth a detour": 0, "Good if you're nearby": 1, "Skip unless": 3 };

// Up to "max" different evenings, best first, with no place in two of them,
// so "not this one" always offers something new.
export function planEvenings(food: Pick[], experiences: Pick[], when: When, now = new Date(), max = 4): Plan[] {
  // Someone who only chose things to do gets two things to do (founder,
  // 20 Nov 2026: "they might just choose an experience"); only food gets
  // dinner, then drinks or dessert.
  const things = experiences.filter(toDo);
  const firsts = food.length ? food.filter(isMeal) : things;
  const afters = [...things, ...food.filter(forAfter)];
  const found: { plan: Plan; score: number }[] = [];

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
    found.push({
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
    });
  };

  for (const a of firsts) {
    for (const b of afters) {
      if (a.placeId === b.placeId || a.lat === undefined || b.lat === undefined || a.lng === undefined || b.lng === undefined) continue;
      const km = distanceKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
      if (km > MAX_KM) continue;
      const t = travel(km);
      const fixed = eventStart(b);
      // An event with no time, or on another day (classes are found a week
      // ahead), can't be fitted into this evening (Round 6: a class with no
      // time was put after dinner).
      if (b.event && (!fixed || fixed.toDateString() !== day.toDateString())) continue;
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
  const used = new Set<string>();
  const plans: Plan[] = [];
  for (const { plan } of found.sort((x, y) => x.score - y.score)) {
    if (plans.length >= max) break;
    if (plan.stops.some((s) => used.has(s.pick.placeId))) continue;
    plan.stops.forEach((s) => used.add(s.pick.placeId));
    plans.push(plan);
  }
  return plans;
}

export function clock(d: Date) {
  return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}
