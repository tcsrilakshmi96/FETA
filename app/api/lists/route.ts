import { createClient } from "@supabase/supabase-js";
import { distanceKm } from "@/lib/cities";
import { askIs, limitNoticeHere, overBudget, withCosts } from "@/lib/server/costs";
import { userIdFor } from "@/lib/server/taste";
import { eventOver } from "@/lib/server/events";
import { bestPhoto, photoUri, placeDetails, type Place } from "@/lib/server/places";
import type { StoredPick } from "@/lib/server/picks";

// Search, AI and photos can take a while; the default cut-off is shorter.
export const maxDuration = 60;

// My lists: saved ("Want to try") and been places, with live Google
// details fetched now (only place IDs are stored).

export type ListItem = {
  placeId: string;
  list: "want" | "been";
  name: string;
  area: string;
  distanceKm: number | null;
  lat: number | null; // live, for planning a night; never stored
  lng: number | null;
  note: string;
  savedAt: string;
  weekendFor: string | null; // the Saturday it is ticked for
  visits: string | null; // been: once, few, regular
  verdict: string | null; // been: loved, fine, not_for_me
  mapsUri: string;
  photo: string | null;
  event?: { when: string; url: string; site: string };
  // The phone already has this place's live details (only what's saved about
  // it is sent); or it couldn't be checked just now (shown plainly, not dropped).
  cached?: true;
  unchecked?: true;
};

const MAX_ITEMS = 30;
const MAX_PHOTOS = 8; // Google charges per photo, so only the top of the list gets one

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return Response.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const here = Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? { lat, lng } : null;
  // Places whose live details the phone already has (audit, 24 Nov 2026:
  // every save or skip made Saved look up all 30 again, about ₹45).
  const have = new Set((request.headers.get("x-feta-have") ?? "").split(",").filter(Boolean).slice(0, MAX_ITEMS * 2));

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!(await userIdFor(db, token))) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { data: actions, error } = await db
    .from("pick_actions")
    .select("place_id, action, note, created_at, weekend_for, visits, verdict")
    .in("action", ["saved", "been"])
    .order("created_at", { ascending: false })
    .limit(MAX_ITEMS * 2);
  if (error) {
    console.error("lists", error.message);
    return Response.json({ error: "Couldn't load your lists just now." }, { status: 500 });
  }

  // A place marked "been" leaves "Want to try".
  const been = new Set(actions.filter((a) => a.action === "been").map((a) => a.place_id));
  const rows = actions.filter((a) => a.action === "been" || !been.has(a.place_id)).slice(0, MAX_ITEMS);

  // Events were found on the web, so their listing comes from the pick set.
  const eventIds = rows.filter((r) => r.place_id.startsWith("event:")).map((r) => r.place_id);
  // An event that's over leaves Want to try (tester, 23 Nov 2026: past
  // dates shown); one they went to stays in Been.
  const events = new Map<string, NonNullable<StoredPick["event"]> & { over: boolean }>();
  // Each from the newest set that has it, however many sets came since
  // (audit, 24 Nov 2026: only the last 50 sets were read).
  await Promise.all(
    eventIds.map(async (id) => {
      const { data: sets } = await db.from("pick_sets").select("picks, time_zone").eq("category", "experiences").contains("picks", [{ placeId: id }]).order("created_at", { ascending: false }).limit(1);
      const set = sets?.[0];
      const p = (set?.picks as StoredPick[] | undefined)?.find((x) => x.placeId === id);
      if (set && p?.event) events.set(id, { ...p.event, over: eventOver(p.event, set.time_zone ?? "UTC") });
    }),
  );

  // Over today's limit (audit, 23 Nov 2026: Saved kept paying for up to 30
  // live lookups each time): nothing is looked up. The phone shows the copy
  // it already has; without one, each saved place still shows (their note,
  // Open in Google Maps), so Saved is never empty (Round 6).
  const over = await overBudget(db);
  if (over) {
    const items: ListItem[] = rows.flatMap((r) => {
      const base = { placeId: r.place_id, list: r.action === "been" ? "been" : "want", note: r.note ?? "", savedAt: r.created_at, weekendFor: r.weekend_for ?? null, visits: r.visits ?? null, verdict: r.verdict ?? null } as const;
      const event = events.get(r.place_id);
      if (r.place_id.startsWith("event:")) return event && !(event.over && r.action !== "been") ? [{ ...base, name: event.title, area: event.venueName, distanceKm: null, lat: null, lng: null, mapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venueName)}`, photo: null, event: { when: [event.date, event.time].filter(Boolean).join(" "), url: event.url, site: event.site } }] : [];
      return [{ ...base, name: "A place you saved", area: "Open in Google Maps", distanceKm: null, lat: null, lng: null, mapsUri: `https://www.google.com/maps/place/?q=place_id:${r.place_id}`, photo: null }];
    });
    return Response.json({ items, notice: await limitNoticeHere("kept") });
  }
  const items = await withCosts(db, "lists", () => (askIs({ key: [rows.map((r) => r.place_id).sort(), lat.toFixed(2), lng.toFixed(2)], label: `saved list · ${rows.length} places` }), Promise.all(
    rows.map(async (r, i): Promise<ListItem | null> => {
      const base = { placeId: r.place_id, list: r.action === "been" ? "been" : "want", note: r.note ?? "", savedAt: r.created_at, weekendFor: r.weekend_for ?? null, visits: r.visits ?? null, verdict: r.verdict ?? null } as const;
      const event = events.get(r.place_id);
      if (r.place_id.startsWith("event:")) {
        if (!event || (event.over && r.action !== "been")) return null;
        return {
          ...base,
          name: event.title,
          area: event.venueName,
          distanceKm: null,
          lat: null,
          lng: null,
          mapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venueName)}`,
          photo: null,
          event: { when: [event.date, event.time].filter(Boolean).join(" "), url: event.url, site: event.site },
        };
      }
      if (have.has(r.place_id)) return { ...base, cached: true, name: "", area: "", distanceKm: null, lat: null, lng: null, mapsUri: "", photo: null };
      const place = await placeDetails(r.place_id, false, true);
      // A Google hiccup never hides a saved place (audit, 24 Nov 2026).
      if (!place) return { ...base, unchecked: true, name: "A place you saved", area: "Open in Google Maps", distanceKm: null, lat: null, lng: null, mapsUri: `https://www.google.com/maps/place/?q=place_id:${r.place_id}`, photo: null };
      return {
        ...base,
        name: place.displayName?.text ?? "A saved place",
        area: areaOf(place),
        distanceKm: here && place.location ? Math.round(distanceKm(here, { lat: place.location.latitude, lng: place.location.longitude }) * 10) / 10 : null,
        lat: place.location?.latitude ?? null,
        lng: place.location?.longitude ?? null,
        mapsUri: place.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${place.id}`,
        photo: i < MAX_PHOTOS && bestPhoto(place)?.name ? await photoUri(bestPhoto(place)!.name) : null,
      };
    }),
  )));
  return Response.json({ items: items.filter(Boolean) });
}

function areaOf(place: Place) {
  const parts = place.addressComponents ?? [];
  const pick = (type: string) => parts.find((p) => p.types?.includes(type))?.longText;
  return pick("sublocality_level_1") ?? pick("neighborhood") ?? pick("locality") ?? "";
}
