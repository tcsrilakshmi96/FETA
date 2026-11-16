import "server-only";

import type { City } from "@/lib/cities";
import { runPicks } from "@/lib/server/engine";
import { buildItinerary, type Itinerary } from "@/lib/server/itinerary";
import type { Pick } from "@/lib/server/picks";

// Day plans, one way for everyone: a day plan from Ask Feta and the days of
// a trip city (trip.ts) both find food and things to do with the picks
// engine (same hard filters and taste), then arrange them in code
// (itinerary.ts). Venice never sees the places.

export type PlanOrigin = { lat: number; lng: number; label: string; source: "gps" | "area" | "city"; areaId?: string; city: City };

export async function planDays(
  token: string,
  opts: { origin: PlanOrigin; start: string; days: number; who?: string | null; focus?: string | null; trip?: string; place: string },
): Promise<Itinerary | null> {
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
      (r) => r.json().catch(() => ({})) as Promise<{ picks?: Pick[]; spares?: Pick[] }>,
    );
  const [food, doing] = await Promise.all([ask("food_drinks"), ask("experiences")]);
  const all = [...(food.picks ?? []), ...(doing.picks ?? []), ...(food.spares ?? []), ...(doing.spares ?? [])];
  const itinerary = buildItinerary(all, { start: opts.start, days: Math.min(3, Math.max(1, Math.round(opts.days))), place: opts.place });
  return itinerary.days.some((d) => d.stops.length > 0) ? itinerary : null;
}
