import "server-only";

import { distanceKm, type City } from "@/lib/cities";
import { searchPlaces, type Place } from "@/lib/server/places";

// This week's events, found by Gemini with Grounding with Google Search,
// linking out to the event page (never copying the listing). Google
// requires its "Search Suggestions" chip to be shown with the result, so
// it travels with every event pick.

export type FoundEvent = {
  title: string;
  venueName: string;
  date: string; // YYYY-MM-DD in the city's time zone
  time: string; // HH:MM or ""
  priceText: string;
  minPrice: number | null;
  url: string;
  because?: string;
  verdict?: "Worth a detour" | "Good if you're nearby" | "Skip unless";
  skipUnless?: string;
};

export type EventSearch = { events: FoundEvent[]; searchHtml: string };

type Step = {
  type: string;
  result?: { search_suggestions?: string }[];
  content?: { type: string; text?: string }[];
};

// Today's date, the time now, and this weekend's dates, in the city's zone.
export function cityCalendar(timeZone: string) {
  const parts = (d: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
        .formatToParts(d)
        .map((p) => [p.type, p.value]),
    );
  const now = new Date();
  const p = parts(now);
  const today = `${p.year}-${p.month}-${p.day}`;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  const dayAt = (offset: number) => {
    const q = parts(new Date(now.getTime() + offset * 86400000));
    return `${q.year}-${q.month}-${q.day}`;
  };
  const weekend = weekday === 6 ? [today, dayAt(1)] : weekday === 0 ? [today] : [dayAt(6 - weekday), dayAt(7 - weekday)];
  return { today, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, weekend };
}

function readable(date: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

// Searches the area's events for everyone (no one person's taste), so the
// result can be shared for a few hours; personalizeEvents then chooses.
export async function findEvents(opts: {
  city: City;
  near: string; // area or city name, never coordinates
  when: "tonight" | "weekend";
  distanceKm: number;
}): Promise<EventSearch> {
  const cal = cityCalendar(opts.city.timeZone);
  const window =
    opts.when === "tonight"
      ? `tonight, ${readable(cal.today)}, starting after ${cal.time}`
      : `this weekend: ${cal.weekend.map(readable).join(" or ")}`;
  const input = `Today is ${readable(cal.today)} and it is ${cal.time} in ${opts.city.name}, India.
Search the web for up to 8 real public events of different kinds (gigs, comedy, theatre, art, talks, workshops, markets, sport) happening ${window} in ${opts.city.name}, as close as possible to ${opts.near} (ideally within ${opts.distanceKm} km).
Use at most 2 searches. Prefer listing pages on BookMyShow, District, Skillboxes or the organiser's own site. Only include events whose listing page you actually found.

Reply with only a JSON array. Each item:
{"title": string, "venueName": string (venue and neighbourhood), "date": "YYYY-MM-DD", "time": "HH:MM" 24h or "", "priceText": string, "minPrice": number in ${opts.city.currency} or null, "url": the real event page (not a redirect)}.`;

  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY!,
      "Api-Revision": "2026-05-20",
    },
    // Low thinking halves the wait (about 11 s instead of 20 s). If events
    // take longer than 12 s, picks go ahead with places only.
    body: JSON.stringify({
      model: "gemini-3.5-flash",
      input,
      tools: [{ type: "google_search" }],
      generation_config: { thinking_level: "low" },
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Event search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { steps?: Step[] };
  const steps = data.steps ?? [];
  const searchHtml =
    steps.flatMap((s) => (s.type === "google_search_result" ? (s.result ?? []).map((r) => r.search_suggestions ?? "") : [])).find(Boolean) ?? "";
  const text = steps
    .filter((s) => s.type === "model_output")
    .flatMap((s) => s.content ?? [])
    .map((c) => c.text ?? "")
    .join("");
  const json = /\[[\s\S]*\]/.exec(text)?.[0];
  let events: FoundEvent[] = [];
  try {
    events = json ? (JSON.parse(json) as FoundEvent[]) : [];
  } catch {
    events = [];
  }
  return { events, searchHtml };
}

// Hard filters for events, in code: real link, right date and time, within
// distance (venue found on Google Maps), within budget.
export function eventPasses(
  e: FoundEvent,
  opts: { when: "tonight" | "weekend"; timeZone: string; maxSpend: number | null; unknownPriceOk: boolean },
) {
  let url: URL;
  try {
    url = new URL(e.url);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname.includes("vertexaisearch") || url.hostname.includes("google.")) return false;
  const cal = cityCalendar(opts.timeZone);
  if (opts.when === "tonight") {
    if (e.date !== cal.today) return false;
    // Still to come, or started within the last hour.
    if (e.time && minutes(e.time) < minutes(cal.time) - 60) return false;
  } else if (!cal.weekend.includes(e.date)) return false;
  if (e.minPrice === null || e.minPrice === undefined) return opts.unknownPriceOk;
  return opts.maxSpend === null || e.minPrice <= opts.maxSpend;
}

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

// Finds the venue on Google Maps (place ID, location, photo) for distance
// and directions. Uses the cheaper "Pro" fields.
export async function findVenue(e: FoundEvent, city: City, origin: { lat: number; lng: number }): Promise<{ place: Place; km: number } | null> {
  const [place] = await searchPlaces({
    query: `${e.venueName}, ${city.name}`,
    lat: origin.lat,
    lng: origin.lng,
    radiusKm: 30,
    openNow: false,
    needsDiet: false,
    regionCode: city.country,
    lite: true,
  }).catch(() => [] as Place[]);
  if (!place?.location) return null;
  return { place, km: distanceKm(origin, { lat: place.location.latitude, lng: place.location.longitude }) };
}

export function siteName(url: string) {
  const host = new URL(url).hostname.replace(/^www\.|^in\./, "");
  const known: Record<string, string> = {
    "bookmyshow.com": "BookMyShow",
    "district.in": "District",
    "skillboxes.com": "Skillboxes",
    "insider.in": "District",
  };
  return known[host] ?? host;
}

// Chooses which events suit this person and writes their reasons (about 2 s,
// no search). Returns indexes into the list, best first, at most 2.
export async function personalizeEvents(
  events: FoundEvent[],
  tasteSummary: string,
  when: "tonight" | "weekend",
): Promise<{ index: number; because: string; verdict: FoundEvent["verdict"]; skipUnless?: string }[]> {
  if (events.length === 0) return [];
  const list = events.map((e, i) => `${i}. ${e.title} · ${e.venueName} · ${e.date} ${e.time} · ${e.priceText}`).join("\n");
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `You are Feta, an honest friend picking events for one person ${when === "tonight" ? "tonight" : "this weekend"}.

About them:
${tasteSummary || "Not much yet."}

Events:
${list}

Choose up to 2 that genuinely suit them (none if nothing fits). For each: "because" (one line, at most 110 characters, starting "Because you", tied to what they like), "verdict" ("Good if you're nearby" normally, "Worth a detour" only for an exceptional match, "Skip unless" for a compromise with "skipUnless" finishing the sentence). No hype words.` }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            chosen: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  index: { type: "INTEGER" },
                  because: { type: "STRING" },
                  verdict: { type: "STRING", enum: ["Worth a detour", "Good if you're nearby", "Skip unless"] },
                  skipUnless: { type: "STRING" },
                },
                required: ["index", "because", "verdict"],
              },
            },
          },
          required: ["chosen"],
        },
        thinkingConfig: { thinkingLevel: "low" },
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Choosing events failed: ${res.status}`);
  const data = await res.json();
  const text: string = data.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text ?? "{}";
  const chosen = (JSON.parse(text).chosen ?? []) as { index: number; because: string; verdict: FoundEvent["verdict"]; skipUnless?: string }[];
  return chosen.filter((c, i, all) => Number.isInteger(c.index) && c.index >= 0 && c.index < events.length && all.findIndex((x) => x.index === c.index) === i).slice(0, 2);
}
