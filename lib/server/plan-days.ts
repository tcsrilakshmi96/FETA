import "server-only";

import type { City } from "@/lib/cities";
import { runPicks } from "@/lib/server/engine";
import { LAST_START, buildItinerary, type Itinerary } from "@/lib/server/itinerary";
import type { Pick } from "@/lib/server/picks";

// Day plans, one way for everyone: a day plan from Ask Feta and the days of
// a trip city (trip.ts) both find food and things to do with the picks
// engine (same hard filters and taste), then arrange them in code
// (itinerary.ts). Venice never sees the places.

export type PlanOrigin = { lat: number; lng: number; label: string; source: "gps" | "area" | "city"; areaId?: string; city: City };

export async function planDays(
  token: string,
  opts: { origin: PlanOrigin; start: string; days: number; who?: string | null; focus?: string | null; trip?: string; place: string; hotel?: { lat: number; lng: number } | null },
): Promise<{ itinerary: Itinerary | null; limited?: string }> {
  const who = opts.who ?? "";
  // Friends and kids change what fits (tweaks); a partner makes dinner
  // romantic; what they'd love to do steers the things to do.
  const tweaks = who === "friends" ? ["groups"] : who === "kids" ? ["kids"] : [];
  const notes = {
    food_drinks: who === "partner" ? "romantic restaurant" : "",
    experiences: (opts.focus ?? "").slice(0, 120),
  };
  const ask = (category: "food_drinks" | "experiences") =>
    runPicks(token, { category, when: "weekend", dayPlan: true, origin: opts.origin, tweaks, note: notes[category], ...(opts.trip ? { trip: opts.trip } : {}) }).then(
      (r) => r.json().catch(() => ({})) as Promise<{ picks?: Pick[]; spares?: Pick[]; limited?: boolean; notice?: string }>,
    );
  const [food, doing] = await Promise.all([ask("food_drinks"), ask("experiences")]);
  // Today's limit reached: say so, not "couldn't find enough open places"
  // (tester, 22 Nov 2026: trips in three cities never planned a day).
  const limited = [food, doing].find((r) => r.limited)?.notice;
  const all = [...(food.picks ?? []), ...(doing.picks ?? []), ...(food.spares ?? []), ...(doing.spares ?? [])];
  // A plan for today starts from now, in the city's own time (traveller,
  // 23 Nov 2026: Lisbon's day 1 began at 9:30 am in the afternoon); once
  // the evening has gone, it starts tomorrow.
  const tz = opts.origin.city.timeZone;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":").map(Number);
  const from = opts.start === today ? Math.ceil((h * 60 + m + 30) / 15) * 15 : undefined;
  const start = from !== undefined && from > LAST_START ? nextDay(opts.start) : opts.start;
  const itinerary = buildItinerary(all, {
    start,
    days: Math.min(3, Math.max(1, Math.round(opts.days))),
    place: opts.place,
    ...(start === today && from !== undefined ? { from } : {}),
    ...(opts.hotel ? { hotel: opts.hotel } : {}),
  });
  return { itinerary: itinerary.days.some((d) => d.stops.length > 0) ? itinerary : null, ...(limited ? { limited } : {}) };
}

function nextDay(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
