import { distanceKm } from "@/lib/cities";
import { travel } from "@/lib/plan";

// Plan a night from Saved (founder, 17 Nov 2026): the places they ticked,
// in the order that works for that day: each stop open for its whole visit
// by its weekly hours, places that close early first, the main meal last
// in the evening, and the shortest way between them. In code, on the phone,
// so changing the day, the time or the order costs nothing.

export type NightPlace = {
  placeId: string;
  name: string;
  area: string;
  kind: "EAT" | "DRINK" | "DO";
  light: boolean; // a café, bakery or dessert place: a short stop, fine after dinner
  lat: number;
  lng: number;
  hours?: [number, number, number][]; // weekly, [day 0–6, open minute, close minute]
  mapsUri: string;
  gone?: boolean; // closed for good on Google Maps
};

export type Leg = { km: number; minutes: number; mode: "walk" | "ride" };
export type NightStop = { place: NightPlace; at: number; leg?: Leg }; // at: minutes from that day's midnight
export type Night = { stops: NightStop[]; problems: { place: NightPlace; why: string }[]; end: number };

const DINNER = 19 * 60;
const MAX_WAIT = 90; // minutes they'd wait for a place to open
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const visitMinutes = (p: NightPlace) => (p.light ? 45 : p.kind === "DO" ? 90 : 75);
const mainMeal = (p: NightPlace) => p.kind === "EAT" && !p.light;
const quarter = (m: number) => Math.ceil(m / 15) * 15;

export function legBetween(a: NightPlace, b: NightPlace): Leg {
  const km = Math.round(distanceKm(a, b) * 10) / 10;
  return { km, ...travel(km) };
}

// The first time from "at" (waiting up to MAX_WAIT) that the place is open
// for the whole visit on that weekday, or null. No hours on Google: it
// can't be checked, so it counts as open.
function arrival(p: NightPlace, weekday: number, at: number): number | null {
  if (!p.hours?.length) return at;
  const stay = visitMinutes(p);
  let best: number | null = null;
  for (const [d, open, close] of p.hours) {
    // A period from the day before that runs past midnight counts too.
    const shift = d === weekday ? 0 : d === (weekday + 6) % 7 ? -24 * 60 : null;
    if (shift === null) continue;
    const start = Math.max(at, quarter(open + shift));
    if (start - at <= MAX_WAIT && start + stay <= close + shift && (best === null || start < best)) best = start;
  }
  return best;
}

// Why a place doesn't fit that day, in plain words.
export function whyNot(p: NightPlace, weekday: number): string {
  const today = (p.hours ?? []).filter(([d]) => d === weekday);
  if (today.length === 0) return `closed on ${DAY_NAMES[weekday]}s`;
  return `open ${today.map(([, o, c]) => `${minuteClock(o)}–${minuteClock(c)}`).join(", ")} that day`;
}

// Times along one order. A stop that can't fit is left out and said why.
// In an order they chose themselves, dinner is when they put it.
export function timeOrder(order: NightPlace[], weekday: number, start: number, theirs = false): Night & { wait: number } {
  const stops: NightStop[] = [];
  const problems: Night["problems"] = [];
  let now = start;
  let wait = 0;
  for (const place of order) {
    const last = stops[stops.length - 1];
    // One dinner a night: a second main meal in the evening is said plainly,
    // with Drop it, never stacked (persona re-test, 23 Nov 2026: Koriken at
    // 7, then Vilva Bhavan at 8:45 as "dinner last").
    const dinner = stops.find((s) => mainMeal(s.place) && s.at + visitMinutes(s.place) > 17 * 60);
    if (mainMeal(place) && dinner && now >= 17 * 60) {
      problems.push({ place, why: `a second dinner, after ${dinner.place.name}` });
      continue;
    }
    const leg = last ? legBetween(last.place, place) : undefined;
    // Feta never puts an evening dinner before 7 pm.
    const ready = Math.max(quarter(now + (leg?.minutes ?? 0)), !theirs && mainMeal(place) && now >= 16 * 60 ? DINNER : 0);
    const at = place.gone ? null : arrival(place, weekday, ready);
    if (at === null) {
      problems.push({ place, why: place.gone ? "closed for good" : whyNot(place, weekday) });
      continue;
    }
    wait += at - ready;
    stops.push({ place, at, ...(leg ? { leg } : {}) });
    now = at + visitMinutes(place);
  }
  return { stops, problems, end: now, wait };
}

// When it shuts that day (the latest close), for "early closers first".
function closesOn(p: NightPlace, weekday: number) {
  const today = (p.hours ?? []).filter(([d]) => d === weekday).map(([, , c]) => c);
  return today.length ? Math.max(...today) : 48 * 60;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

// The best order: as many stops as fit, then the least travel and waiting;
// in the evening the main meal comes after everything but drinks and
// dessert, and places that shut earlier come first.
export function planNight(places: NightPlace[], weekday: number, start: number): Night {
  let best: { night: Night; score: number } | null = null;
  for (const order of permutations(places.slice(0, 6))) {
    const night = timeOrder(order, weekday, start);
    const travelMinutes = night.stops.reduce((sum, s) => sum + (s.leg?.minutes ?? 0), 0);
    const meal = night.stops.findIndex((s) => mainMeal(s.place));
    const afterMeal = start >= 16 * 60 && meal >= 0 ? night.stops.slice(meal + 1).filter((s) => s.place.kind === "DO" || mainMeal(s.place)).length : 0;
    const closes = night.stops.map((s) => closesOn(s.place, weekday));
    const lateFirst = closes.filter((c, i) => closes.slice(i + 1).some((later) => later < c)).length;
    const score = night.problems.length * 1000 + travelMinutes + night.wait * 0.5 + afterMeal * 40 + lateFirst * 15;
    if (!best || score < best.score) best = { night: { stops: night.stops, problems: night.problems, end: night.end }, score };
  }
  return best?.night ?? { stops: [], problems: [], end: start };
}

// One more place from their saved list that fits on the way: a short walk
// from a stop, open then, done by 11:30 pm, and never a second main meal.
// Dessert after dinner first.
export function roomForOne(night: Night, extras: NightPlace[], weekday: number): { place: NightPlace; index: number; at: number; dessert: boolean } | null {
  const order = night.stops.map((s) => s.place);
  const options: { place: NightPlace; index: number; at: number; dessert: boolean; score: number }[] = [];
  for (const place of extras) {
    // Never a second dinner: something light, a drink or something to do.
    if (mainMeal(place) && order.some(mainMeal)) continue;
    for (let index = 1; index <= order.length; index++) {
      const near = Math.min(...[order[index - 1], order[index]].filter(Boolean).map((p) => legBetween(p, place).km));
      if (near > 1.5) continue;
      const tried = timeOrder([...order.slice(0, index), place, ...order.slice(index)], weekday, night.stops[0]?.at ?? 0);
      if (tried.problems.length > 0 || tried.end > 23 * 60 + 30) continue;
      const at = tried.stops[index].at;
      const dessert = place.light && order.slice(0, index).some(mainMeal);
      options.push({ place, index, at, dessert, score: near + (dessert ? -1 : 0) + (tried.end - night.end) / 60 });
    }
  }
  const best = options.sort((a, b) => a.score - b.score)[0];
  return best ? { place: best.place, index: best.index, at: best.at, dessert: best.dessert } : null;
}

// A few words on why a stop is where it is: "closes at 7, so first",
// "dinner last", "dessert after".
export function stopNote(night: Night, i: number, weekday: number): string {
  const { place, at } = night.stops[i];
  const last = i === night.stops.length - 1;
  const leave = at + visitMinutes(place);
  const close = (place.hours ?? []).flatMap(([d, open, c]) => (d === weekday && open <= at && c >= leave ? [c] : d === (weekday + 6) % 7 && c - 24 * 60 >= leave ? [c - 24 * 60] : [])).sort((a, b) => a - b)[0];
  if (close !== undefined && close - leave <= 60 && close <= 21 * 60) return `closes at ${minuteClock(close)}${i === 0 ? ", so first" : ""}`;
  const meal = at >= 18 * 60 ? "dinner" : at >= 11 * 60 + 30 && at < 15 * 60 + 30 ? "lunch" : null;
  if (mainMeal(place) && meal) return last ? `${meal} last` : meal;
  if (place.light && night.stops.slice(0, i).some((s) => mainMeal(s.place))) return "dessert after";
  if (place.light && night.stops.slice(i + 1).some((s) => mainMeal(s.place))) return "a short stop before";
  return place.area;
}

export function minuteClock(m: number) {
  const day = ((m % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(day / 60);
  const min = day % 60;
  return `${((h + 11) % 12) + 1}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

// Google Maps directions through every stop in order, by exact coordinates
// with place IDs so it can't land on another place of the same name.
export function routeUri(stops: NightStop[]) {
  const spot = (p: NightPlace) => `${p.lat},${p.lng}`;
  const first = stops[0].place;
  const last = stops[stops.length - 1].place;
  const middle = stops.slice(1, -1).map((s) => s.place);
  const ride = stops.some((s) => s.leg?.mode === "ride");
  const via = middle.length ? `&waypoints=${encodeURIComponent(middle.map(spot).join("|"))}&waypoint_place_ids=${encodeURIComponent(middle.map((p) => p.placeId).join("|"))}` : "";
  return `https://www.google.com/maps/dir/?api=1&origin=${spot(first)}&origin_place_id=${first.placeId}&destination=${spot(last)}&destination_place_id=${last.placeId}${via}&travelmode=${ride ? "driving" : "walking"}`;
}

// When "How was it?" may ask about a saved plan (founder, 25 Nov 2026: a 7:30
// plan, the app opened at 11 pm, and nothing asked): an earlier day, or today
// once 3 hours have passed since it started. now: minutes from midnight.
export const CHECK_IN_AFTER = 180;
export function planIsOver(plan: { day: string; startMinute: number }, today: string, now: number) {
  return plan.day < today || (plan.day === today && now >= plan.startMinute + CHECK_IN_AFTER);
}
