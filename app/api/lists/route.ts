import { createClient } from "@supabase/supabase-js";
import { distanceKm } from "@/lib/cities";
import { photoUri, placeDetails, type Place } from "@/lib/server/places";
import type { StoredPick } from "@/lib/server/picks";

// My lists: saved ("Want to try") and been places, with live Google
// details fetched now (only place IDs are stored).

export type ListItem = {
  placeId: string;
  list: "want" | "been";
  name: string;
  area: string;
  distanceKm: number | null;
  note: string;
  savedAt: string;
  mapsUri: string;
  photo: string | null;
  event?: { when: string; url: string; site: string };
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

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: actions, error } = await db
    .from("pick_actions")
    .select("place_id, action, note, created_at")
    .in("action", ["saved", "been"])
    .order("created_at", { ascending: false })
    .limit(MAX_ITEMS * 2);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // A place marked "been" leaves "Want to try".
  const been = new Set(actions.filter((a) => a.action === "been").map((a) => a.place_id));
  const rows = actions.filter((a) => a.action === "been" || !been.has(a.place_id)).slice(0, MAX_ITEMS);

  // Events were found on the web, so their listing comes from the pick set.
  const eventIds = rows.filter((r) => r.place_id.startsWith("event:")).map((r) => r.place_id);
  const events = new Map<string, NonNullable<StoredPick["event"]>>();
  if (eventIds.length > 0) {
    const { data: sets } = await db.from("pick_sets").select("picks").eq("category", "experiences").order("created_at", { ascending: false }).limit(50);
    for (const set of sets ?? []) for (const p of set.picks as StoredPick[]) if (p.event && eventIds.includes(p.placeId)) events.set(p.placeId, p.event);
  }

  const items = await Promise.all(
    rows.map(async (r, i): Promise<ListItem | null> => {
      const base = { placeId: r.place_id, list: r.action === "been" ? "been" : "want", note: r.note ?? "", savedAt: r.created_at } as const;
      const event = events.get(r.place_id);
      if (r.place_id.startsWith("event:")) {
        if (!event) return null;
        return {
          ...base,
          name: event.title,
          area: event.venueName,
          distanceKm: null,
          mapsUri: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venueName)}`,
          photo: null,
          event: { when: [event.date, event.time].filter(Boolean).join(" "), url: event.url, site: event.site },
        };
      }
      const place = await placeDetails(r.place_id, false, true);
      if (!place) return null;
      return {
        ...base,
        name: place.displayName?.text ?? "A saved place",
        area: areaOf(place),
        distanceKm: here && place.location ? Math.round(distanceKm(here, { lat: place.location.latitude, lng: place.location.longitude }) * 10) / 10 : null,
        mapsUri: place.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${place.id}`,
        photo: i < MAX_PHOTOS && place.photos?.[0]?.name ? await photoUri(place.photos[0].name) : null,
      };
    }),
  );
  return Response.json({ items: items.filter(Boolean) });
}

function areaOf(place: Place) {
  const parts = place.addressComponents ?? [];
  const pick = (type: string) => parts.find((p) => p.types?.includes(type))?.longText;
  return pick("sublocality_level_1") ?? pick("neighborhood") ?? pick("locality") ?? "";
}
