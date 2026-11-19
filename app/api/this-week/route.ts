import { cityById } from "@/lib/server/cities";
import { DAILY_BUDGET_INR, spentToday, withCosts } from "@/lib/server/costs";
import { cityCalendar, eventPasses, findEvents, personalizeEvents, siteName, type FoundEvent } from "@/lib/server/events";
import { spendUpperBound, tasteSummary } from "@/lib/server/picks";
import { loadTaste, userDb, userIdFor } from "@/lib/server/taste";

export const maxDuration = 30;

// "This week in <city>" on Home (founder, 18 Nov 2026: "I'm absolutely okay
// being an aggregator… I only need to show them these events are
// happening"). One Google Search a day finds the city's events for the next
// 7 days (looking first on the sources the founder chose for that city),
// shared by everyone there; then Gemini picks the ones for this person and
// says why. Facts and a link to the organiser's page only: never scraped,
// never their words or photos. Google's Search chip travels with them.
const SHOW = 8;

export type WeekEvent = FoundEvent & { site: string };

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const db = token ? userDb(token) : null;
  if (!token || !db || !(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body: { cityId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const city = cityById(body.cityId);
  if (!city) return Response.json({ error: "Bad request" }, { status: 400 });

  return withCosts(db, "this_week", async () => {
    const cal = cityCalendar(city.timeZone);
    const key = [city.id, "city", "week", cal.today].join("|");
    const { data: cached } = await db.from("events_cache").select("events, search_html").eq("key", key).maybeSingle();
    let events = (cached?.events as FoundEvent[] | undefined) ?? [];
    let searchHtml: string = cached?.search_html ?? "";
    if (!cached) {
      if ((await spentToday(db)) >= DAILY_BUDGET_INR) return Response.json({ events: [], searchHtml: "" });
      ({ events, searchHtml } = await findEvents({ city, near: city.name, when: "week", distanceKm: 25 }).catch((error) => {
        console.error(error);
        return { events: [] as FoundEvent[], searchHtml: "" };
      }));
      if (searchHtml && events.length) {
        await db.from("events_cache").upsert({ key, events, search_html: searchHtml, expires_at: new Date(Date.now() + 20 * 3600 * 1000).toISOString() });
      }
    }
    // Google's chip must be shown with what its search found; without it, nothing.
    if (!searchHtml) return Response.json({ events: [], searchHtml: "" });

    const taste = await loadTaste(db);
    const rules = { when: "week" as const, timeZone: city.timeZone, maxSpend: spendUpperBound(taste.answers, city) };
    const fit = events.filter((e) => eventPasses(e, rules));
    const chosen = await personalizeEvents(fit, tasteSummary(taste, city), "week", SHOW).catch(() => []);
    // Their picks first, with reasons; if choosing failed, the soonest.
    const ordered = chosen.length
      ? chosen.map((c) => ({ ...fit[c.index], because: c.because }))
      : [...fit].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, SHOW);
    const out: WeekEvent[] = ordered.map((e) => ({ ...e, site: siteName(e.url) }));
    return Response.json({ events: out, searchHtml });
  });
}
