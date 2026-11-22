import "server-only";
import { FAKE } from "@/lib/server/fake-places";

import eventSites from "@/data/event-sites.json";
import { distanceKm, type City } from "@/lib/cities";
import { trackGemini } from "@/lib/server/costs";
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
  fromList?: boolean; // found on one of the city's sites from her list (eventSources)
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
  const week = Array.from({ length: 7 }, (_, i) => (i === 0 ? today : dayAt(i)));
  return { today, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, weekend, week };
}

function readable(date: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

// Searches the city's events of one kind (founder, 19 Nov 2026: things to
// do are led by what's on, searched for what each person is into), shared
// by everyone there into the same thing for a few hours; personalizeEvents
// then chooses. With no kind, any kind (someone who hasn't shared any yet).
// "week": the coming 7 days, for things booked ahead (a class, a tasting, a
// hike; founder, 21 Nov 2026).
export type EventSpan = "tonight" | "weekend" | "week";

export async function findEvents(opts: {
  city: City;
  when: EventSpan;
  kind?: string; // "Stand-up comedy (stand-up comedy club)", in plain words
}): Promise<EventSearch> {
  if (FAKE) return { events: [], searchHtml: "" };
  const cal = cityCalendar(opts.city.timeZone);
  const window =
    opts.when === "tonight"
      ? `tonight, ${readable(cal.today)}, starting after ${cal.time}`
      : opts.when === "week"
        ? `in the next 7 days, from ${readable(cal.today)} (after ${cal.time}) to ${readable(cal.week[6])}`
        : `this weekend: ${cal.weekend.map(readable).join(" or ")}`;
  const input = `Today is ${readable(cal.today)} and it is ${cal.time} in ${opts.city.name}, ${opts.city.countryName}. All dates and times are local to ${opts.city.name}.
Search the web for up to 8 real public events ${opts.kind ? `for someone into ${opts.kind}: events, sessions, nights, workshops, meet-ups, open mics, classes, walks or trips of that kind` : "of different kinds (gigs, comedy, theatre, art, talks, workshops, food pop-ups, markets, experiences, sport)"} happening ${window} in ${opts.city.name}.
Use at most 2 searches. Your first search looks only on these sites, which locals use for ${opts.city.name}: ${eventSources(opts.city)} (search them with site: and their web addresses). Search more widely (other listings, the organiser's own site) only if they have nothing of this kind. Only events that really are of that kind; none is a fine answer. Only include events whose listing page you actually found.

Reply with only a JSON array. Each item:
{"title": string, "venueName": string (venue and neighbourhood), "date": "YYYY-MM-DD", "time": "HH:MM" 24h or "", "priceText": string, "minPrice": number in ${opts.city.currency} or null, "url": the real event page (not a redirect), "fromList": true if you found it on one of those sites, else false}.`;

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
  trackGemini("gemini_search", data);
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
  // A listing with only a date comes back as midnight; that's "no time"
  // (Round 6: "Today 12 AM" on a pottery class).
  events = events.map((e) => (e.time === "00:00" ? { ...e, time: "" } : e));
  return { events, searchHtml };
}

// Hard filters for events, in code: real link, right date and time, within
// distance (venue found on Google Maps), within budget.
export function eventPasses(
  e: FoundEvent,
  opts: { when: EventSpan; timeZone: string; maxSpend: number | null },
) {
  let url: URL;
  try {
    url = new URL(e.url);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname.includes("vertexaisearch") || url.hostname.includes("google.")) return false;
  const cal = cityCalendar(opts.timeZone);
  if (!(opts.when === "tonight" ? [cal.today] : opts.when === "week" ? cal.week : cal.weekend).includes(e.date)) return false;
  // Today's: still to come, or started within the last hour.
  if (e.date === cal.today && e.time && minutes(e.time) < minutes(cal.time) - 60) return false;
  return e.minPrice === null || e.minPrice === undefined || opts.maxSpend === null || e.minPrice <= opts.maxSpend;
}

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

// Finds the venue on Google Maps (place ID, location, photo) for distance
// and directions. Uses the cheaper "Pro" fields.
export async function findVenue(e: FoundEvent, city: City, origin: { lat: number; lng: number }, radiusKm = 30): Promise<{ place: Place; km: number } | null> {
  const [place] = await searchPlaces({
    query: `${e.venueName}, ${city.name}`,
    lat: origin.lat,
    lng: origin.lng,
    radiusKm,
    openNow: false,
    needsDiet: false,
    regionCode: city.country,
    lite: true,
  }).catch(() => [] as Place[]);
  if (!place?.location) return null;
  return { place, km: distanceKm(origin, { lat: place.location.latitude, lng: place.location.longitude }) };
}

// Where to look for events, by city, then by country (founder, 18 Nov
// 2026: Feta shows what's on and links out to book; found through Google
// Search, never scraped). The first search looks only on these; a wider one
// only when they have nothing of that kind (founder, 22 Nov 2026). Her list (Notion → 🌍 Event sites by city, 19 Nov
// 2026) is in data/event-sites.json: by city, by region ("California",
// "Kerala") and by country; the closest come first.
const LOCAL_TICKETS: Record<string, string> = {
  IN: "Urbanaut (urbanaut.app), Luma (lu.ma), District, BookMyShow, Skillboxes",
  GB: "Ticketmaster UK, DICE, Resident Advisor, Eventbrite, Time Out",
  US: "Ticketmaster, Eventbrite, DICE, Resident Advisor, Time Out",
  DE: "Eventim, Resident Advisor, Eventbrite, DICE",
  FR: "Fnac Spectacles, Shotgun, Resident Advisor, Eventbrite",
  CZ: "GoOut, Ticketportal, Resident Advisor",
  PT: "BOL, Ticketline, Resident Advisor, Eventbrite",
  AE: "Platinumlist, Virgin Megastore Tickets, Time Out Dubai",
  SG: "SISTIC, Eventbrite, Peatix, Time Out",
  HK: "Cityline, URBTIX, Klook, Time Out",
  KR: "Interpark Tickets, Melon Ticket, Yes24",
  AU: "Ticketek, Ticketmaster, Moshtix, Eventbrite",
};

const SITES = eventSites as { cities: Record<string, string>; regions: Record<string, string>; countries: Record<string, string> };

export function eventSources(city: City) {
  const lists = [SITES.cities[city.id], SITES.regions[`${city.country}|${city.region}`], SITES.countries[city.country], LOCAL_TICKETS[city.country]];
  const sites = [...new Set(lists.filter(Boolean).flatMap((l) => l!.split(", ")))];
  return sites.length ? sites.slice(0, 15).join(", ") : "Eventbrite, Luma (lu.ma), Ticketmaster, Resident Advisor, Time Out and local ticket sites";
}

export function siteName(url: string) {
  const host = new URL(url).hostname.replace(/^www\.|^in\./, "");
  const known: Record<string, string> = {
    "bookmyshow.com": "BookMyShow",
    "district.in": "District",
    "skillboxes.com": "Skillboxes",
    "insider.in": "District",
    "eventbrite.com": "Eventbrite",
    "eventbrite.co.uk": "Eventbrite",
    "eventbrite.de": "Eventbrite",
    "ticketmaster.com": "Ticketmaster",
    "ticketmaster.co.uk": "Ticketmaster",
    "dice.fm": "DICE",
    "ra.co": "Resident Advisor",
    "eventim.de": "Eventim",
    "goout.net": "GoOut",
    "platinumlist.net": "Platinumlist",
    "sistic.com.sg": "SISTIC",
    "timeout.com": "Time Out",
    "ticketek.com.au": "Ticketek",
    "klook.com": "Klook",
    "shotgun.live": "Shotgun",
    "urbanaut.app": "Urbanaut",
    "liveyourcity.com": "Live Your City",
    "feverup.com": "Fever",
    "lu.ma": "Luma",
    "luma.com": "Luma",
    "meetup.com": "Meetup",
    "allevents.in": "AllEvents",
    "lbb.in": "LBB",
    "whatshot.in": "WhatsHot",
  };
  return known[host] ?? host;
}

// Chooses which events suit this person and writes their reasons (about 2 s,
// no search). Returns indexes into the list, best first, at most 2.
export async function personalizeEvents(
  events: FoundEvent[],
  tasteSummary: string,
  when: "tonight" | "weekend",
  max = 2,
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

Choose up to ${max} that genuinely suit them (none if nothing fits), best first. For each: "because" (one line, at most 110 characters, starting "Because you", naming the thing they're into that it was found for; never a this-or-that card pick), "verdict" ("Good if you're nearby" normally, "Worth a detour" only for an exceptional match, "Skip unless" for a compromise with "skipUnless" finishing the sentence). No hype words.` }] }],
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
  trackGemini("gemini_rank", data);
  const text: string = data.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text ?? "{}";
  const chosen = (JSON.parse(text).chosen ?? []) as { index: number; because: string; verdict: FoundEvent["verdict"]; skipUnless?: string }[];
  return chosen.filter((c, i, all) => Number.isInteger(c.index) && c.index >= 0 && c.index < events.length && all.findIndex((x) => x.index === c.index) === i).slice(0, max);
}
