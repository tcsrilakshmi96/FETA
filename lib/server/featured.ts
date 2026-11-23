import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { City } from "@/lib/cities";
import { later, trackGemini } from "@/lib/server/costs";
import { eventSources, neverSourceUrl, PLAIN_SEARCHES, searchChip, siteName, type Step } from "@/lib/server/events";
import { FAKE } from "@/lib/server/fake-places";
import { placeIdFor } from "@/lib/server/places";
import type { Category } from "@/lib/server/picks";

// "Featured in" (founder, 19 Nov 2026): places the city's guides recommend
// (Time Out, LBB… from her list, data/event-sites.json), found once a day per
// city and category with Grounding with Google Search, shared by everyone
// there (about ₹3). Only the place ID, the guide's name and the article's
// link are kept: never the guide's words or photos, never scraped. Google's
// Search chip travels with them.

export type Featured = { placeId: string; name: string; guide: string; url: string };
export type FeaturedSet = { places: Featured[]; searchHtml: string };

// Review sites and social media are not guides; the sites never to be used
// (CLAUDE.md) are checked in events.ts.
const NOT_GUIDES = /tripadvisor|yelp|google\.|vertexaisearch|facebook|instagram|reddit/;

// The day's set for this city and category, or nothing yet: the first
// person of the day starts the search after their reply and doesn't wait.
export async function featuredFor(db: SupabaseClient, city: City, category: Category, today: string): Promise<FeaturedSet | null> {
  if (FAKE) return null;
  const key = [city.id, "featured", category, today].join("|");
  const { data } = await db.from("events_cache").select("events, search_html").eq("key", key).maybeSingle();
  if (data) return { places: data.events as Featured[], searchHtml: data.search_html };
  later(async () => {
    const found = await findFeatured(city, category).catch((error) => {
      console.error(error);
      return null;
    });
    if (found?.searchHtml && found.places.length) {
      await db.from("events_cache").upsert({ key, events: found.places, search_html: found.searchHtml, expires_at: new Date(Date.now() + 20 * 3600 * 1000).toISOString() });
    }
  });
  return null;
}

async function findFeatured(city: City, category: Category): Promise<FeaturedSet> {
  const what = category === "food_drinks" ? "places to eat and drink (restaurants, cafés, bars, bakeries)" : "things to do (museums, galleries, parks, walks, markets, experiences; not restaurants or bars)";
  const input = `Search the web for specific ${what} in ${city.name}, ${city.countryName} that local guides and editorial lists recommend now, from the last two years. Look first on ${eventSources(city)}, then other reputable local guides and magazines. Not review sites (Tripadvisor, Yelp, Google) and not ticket sites; never Zomato, Swiggy, District, BookMyShow or Meetup.
Use at most 3 searches. ${PLAIN_SEARCHES} Up to 20 different places, each a single named place you could find on Google Maps, featured in an article or list you actually found.

Reply with only a JSON array. Each item: {"name": string (the place, with its neighbourhood if given), "guide": string (the publication, e.g. "Time Out"), "url": the article's real URL (not a redirect)}.`;
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY!, "Api-Revision": "2026-05-20" },
    body: JSON.stringify({ model: "gemini-3.5-flash", input, tools: [{ type: "google_search" }], generation_config: { thinking_level: "low" } }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Featured search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { steps?: Step[] };
  trackGemini("gemini_search", data);
  const steps = data.steps ?? [];
  const searchHtml = searchChip(steps);
  const text = steps.filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []).map((c) => c.text ?? "").join("");
  let items: { name?: string; guide?: string; url?: string }[] = [];
  try {
    items = JSON.parse(/\[[\s\S]*\]/.exec(text)?.[0] ?? "[]");
  } catch {
    items = [];
  }
  const real = items.filter((i) => {
    try {
      const u = new URL(i.url ?? "");
      return !!i.name && u.protocol === "https:" && !NOT_GUIDES.test(u.hostname) && !neverSourceUrl(i.url!);
    } catch {
      return false;
    }
  });
  // Each name becomes a Google place ID inside the city's area (an IDs-only
  // search, which Google doesn't charge for).
  const places = await Promise.all(
    real.slice(0, 20).map(async (i) => {
      const placeId = await placeIdFor(`${i.name}, ${city.name}`, city).catch(() => null);
      return placeId ? { placeId, name: i.name!.slice(0, 120), guide: (i.guide || siteName(i.url!)).slice(0, 60), url: i.url! } : null;
    }),
  );
  const seen = new Set<string>();
  return { places: places.filter((p): p is Featured => !!p && !seen.has(p.placeId) && !!seen.add(p.placeId)), searchHtml };
}
