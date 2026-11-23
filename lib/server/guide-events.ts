import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { City } from "@/lib/cities";
import { later, saveEventsCache, trackGemini } from "@/lib/server/costs";
import { cityCalendar, cleanTime, eventSources, isPage, PLAIN_SEARCHES, searchChip, type FoundEvent, type Step } from "@/lib/server/events";
import { FAKE } from "@/lib/server/fake-places";

// What's on, read from her city's guides (founder, 22 Nov 2026: "if you go
// to Time Out Miami and read a post on what's happening this month, each
// post has a link where you can buy the ticket"). A search shows Gemini only
// a few lines of a roundup, so once a day per city it finds the guides'
// current "what's on" posts and opens them (URL context), and lists every
// event in them with the link the guide gives (tickets, Instagram, the
// organiser) or the post itself. About ₹2–3 a post, shared by everyone in
// the city. Facts and links only: never the guide's words or photos. Never
// District, BookMyShow, Meetup, Zomato or Swiggy (CLAUDE.md).

export type GuideEvent = FoundEvent & { kind: string; guide: string };
export type GuideSet = { events: GuideEvent[]; searchHtml: string };

const NEVER_READ = /district|bookmyshow|meetup|zomato|swiggy|insider/i;

// Today's set for this city, or nothing yet: the first search of the day
// starts the reading after its reply and doesn't wait (it takes a minute).
export async function guideEventsFor(db: SupabaseClient, city: City): Promise<GuideSet | null> {
  if (FAKE) return null;
  const key = [city.id, "guide-events", cityCalendar(city.timeZone).today].join("|");
  const { data } = await db.from("events_cache").select("events, search_html").eq("key", key).maybeSingle();
  if (data) return { events: data.events as GuideEvent[], searchHtml: data.search_html };
  // Claimed at once (empty, for 10 minutes), so a city's first searches read
  // the guides once; a reading that failed is tried again after that.
  const { error } = await saveEventsCache(db, key, [], "", 10 / 60);
  if (error) return null;
  later(async () => {
    const found = await readGuides(city).catch((e) => {
      console.error(e);
      return null;
    });
    if (found?.searchHtml) await saveEventsCache(db, key, found.events, found.searchHtml, 20);
  });
  return null;
}

// Two steps: a Google search finds the posts (and gives the Search chip
// Google requires next to what it found), then Gemini reads those posts.
export async function readGuides(city: City): Promise<GuideSet> {
  const sites = eventSources(city).split(", ").filter((s) => !NEVER_READ.test(s));
  if (!sites.length) return { events: [], searchHtml: "" };
  const cal = cityCalendar(city.timeZone);
  const found = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY!, "Api-Revision": "2026-05-20" },
    body: JSON.stringify({
      model: "gemini-3.5-flash",
      input: `Today is ${cal.today}. Find the current "what's on" posts for ${city.name}, ${city.countryName} on these local guides: ${sites.join(", ")}: roundups for this week, this weekend or this month, pop-up calendars and event listings, published in the last 3 weeks. Use at most 3 searches. ${PLAIN_SEARCHES}
Reply with only a JSON array of up to 4 of them: {"url": the post's own full address (an article or listing page, never a home page or a section page), "guide": the publication}.`,
      tools: [{ type: "google_search" }],
      generation_config: { thinking_level: "low" },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!found.ok) throw new Error(`Guide search failed: ${found.status} ${await found.text()}`);
  const search = (await found.json()) as { steps?: Step[] };
  trackGemini("gemini_search", search);
  const steps = search.steps ?? [];
  const searchHtml = searchChip(steps);
  const posts = jsonArray<{ url?: string; guide?: string }>(steps.filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []).map((c) => c.text ?? "").join(""))
    .filter((p) => isPage(p.url) && !NEVER_READ.test(p.url!))
    .slice(0, 4);
  if (!searchHtml || !posts.length) return { events: [], searchHtml: "" };

  const prompt = `Today is ${cal.today} in ${city.name}, ${city.countryName}. All dates are local to ${city.name}.
Read these posts from local guides in full:
${posts.map((p) => `- ${p.url} (${p.guide ?? ""})`).join("\n")}
List every event, pop-up, market, show, class or exhibition they mention that is on at some point in the next 14 days (from ${cal.today}). Only what the posts say; never invent one. Up to 40.

Reply with only a JSON array. Each item:
{"title": string, "venueName": string (venue and neighbourhood), "date": "YYYY-MM-DD" (the first day), "endDate": "YYYY-MM-DD" (the last day) if it runs several days, else null, "time": "HH:MM" 24h when the show itself starts (not when doors open), or "" if the post gives none, "priceText": string as the post says ("Free" if it's free), "minPrice": number in ${city.currency} (0 if free) or null, "url": the link the post gives for it (tickets, booking, the organiser's site or Instagram); if none, the address of the post it is in (from the list above), never a home page, "kind": 2 to 5 plain words for what it is (e.g. "stand-up comedy", "food pop-up", "live jazz", "pottery class"), "guide": the publication (e.g. "Time Out")}`;
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ url_context: {} }], generationConfig: { thinkingConfig: { thinkingLevel: "low" } } }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Guide reading failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  trackGemini("gemini_search", data);
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  const events = jsonArray<GuideEvent>(text)
    .filter((e) => e?.title && e.venueName && /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? "") && isPage(e.url))
    .map((e) => ({ ...e, time: cleanTime(e.time), endDate: e.endDate ?? undefined, kind: String(e.kind ?? "").slice(0, 60), guide: String(e.guide ?? "").slice(0, 60), fromList: true }))
    .slice(0, 40);
  return { events, searchHtml };
}

function jsonArray<T>(text: string): T[] {
  try {
    return JSON.parse(/\[[\s\S]*\]/.exec(text)?.[0] ?? "[]") as T[];
  } catch {
    return [];
  }
}
