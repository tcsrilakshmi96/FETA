import "server-only";
import type { City } from "@/lib/cities";
import { LimitReached, paidFetch } from "@/lib/server/costs";
import { FAKE, fakeDetails, fakeNearby, fakeSearch } from "@/lib/server/fake-places";

// Google Places API (New), called only from Feta's server so the key stays
// private. Results are used for this request and never stored, apart from
// place IDs (Google's rules).

export type Place = {
  id: string;
  displayName?: { text: string };
  primaryType?: string;
  types?: string[];
  location?: { latitude: number; longitude: number };
  priceLevel?: string;
  priceRange?: { startPrice?: { currencyCode: string; units?: string }; endPrice?: { currencyCode: string; units?: string } };
  rating?: number;
  userRatingCount?: number;
  currentOpeningHours?: { openNow?: boolean; nextCloseTime?: string; nextOpenTime?: string };
  regularOpeningHours?: {
    periods?: { open: { day: number; hour?: number; minute?: number }; close?: { day: number; hour?: number; minute?: number } }[];
  };
  businessStatus?: string;
  servesVegetarianFood?: boolean;
  addressComponents?: { longText: string; shortText?: string; types?: string[] }[];
  googleMapsUri?: string;
  websiteUri?: string;
  photos?: { name: string; authorAttributions?: { displayName: string; uri?: string }[] }[];
};

const BASE = "https://places.googleapis.com/v1";

// For lookups that already answer "none" when Google fails: past today's
// limit, they answer "none" too, so the screen says so instead of breaking.
async function orNone(...args: Parameters<typeof paidFetch>) {
  return paidFetch(...args).catch((error) => {
    if (error instanceof LimitReached) return null;
    throw error;
  });
}

// Some names use decorative Unicode letters ("𝗟𝗮 𝗧𝗮𝘃𝗲𝗿𝗻𝗲"); show them as plain text.
function plain(place: Place): Place {
  return place.displayName ? { ...place, displayName: { text: place.displayName.text.normalize("NFKC") } } : place;
}

// Fields decide Google's price tier: these need "Enterprise" (price, hours,
// ratings); servesVegetarianFood adds "Atmosphere", so it is only asked for
// when the user's diet needs it.
const FIELDS = [
  "id",
  "displayName",
  "primaryType",
  "types",
  "location",
  "priceLevel",
  "priceRange",
  "rating",
  "userRatingCount",
  "currentOpeningHours",
  "regularOpeningHours",
  "businessStatus",
  "addressComponents",
  "googleMapsUri",
  "websiteUri",
  "photos",
];

// Cheaper "Pro" fields, enough to find an event's venue.
const LITE_FIELDS = ["id", "displayName", "location", "addressComponents", "googleMapsUri", "photos"];

function fieldMask(prefix: string, needsDiet: boolean, lite = false) {
  const fields = lite ? LITE_FIELDS : [...FIELDS, ...(needsDiet ? ["servesVegetarianFood"] : [])];
  return fields.map((f) => prefix + f).join(",");
}

function headers(mask: string) {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!,
    "X-Goog-FieldMask": mask,
  };
}

export async function searchPlaces(opts: {
  query: string;
  lat: number;
  lng: number;
  radiusKm: number;
  openNow: boolean;
  needsDiet: boolean;
  regionCode: string;
  lite?: boolean; // cheaper fields, top match only unless count is given
  count?: number;
}): Promise<Place[]> {
  if (FAKE) return fakeSearch(opts.lat, opts.lng, opts.query, /food|eat|drink|cafe|bar|restaurant|dinner|brunch|dessert/i.test(opts.query)).slice(0, opts.count ?? (opts.lite ? 1 : 20));
  const res = await paidFetch(opts.lite ? "places_text_pro" : opts.needsDiet ? "places_text_atmos" : "places_text", `${BASE}/places:searchText`, {
    method: "POST",
    headers: headers(fieldMask("places.", opts.needsDiet, opts.lite)),
    body: JSON.stringify({
      textQuery: opts.query,
      pageSize: opts.count ?? (opts.lite ? 1 : 20),
      languageCode: "en",
      regionCode: opts.regionCode,
      openNow: opts.openNow || undefined,
      locationBias: {
        circle: {
          center: { latitude: opts.lat, longitude: opts.lng },
          radius: Math.min(opts.radiusKm * 1000, 50000),
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Places search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { places?: Place[] };
  return (data.places ?? []).map(plain);
}

// Every place of the given types within the radius (up to 20), ranked by
// popularity or by distance. Used for Food & drinks: "what's near me".
export async function searchNearby(opts: {
  types: string[];
  lat: number;
  lng: number;
  radiusKm: number;
  rank: "POPULARITY" | "DISTANCE";
  needsDiet: boolean;
  regionCode: string;
}): Promise<Place[]> {
  if (FAKE) return fakeNearby(opts.lat, opts.lng, opts.types);
  const res = await paidFetch(opts.needsDiet ? "places_nearby_atmos" : "places_nearby", `${BASE}/places:searchNearby`, {
    method: "POST",
    headers: headers(fieldMask("places.", opts.needsDiet)),
    body: JSON.stringify({
      includedTypes: opts.types,
      maxResultCount: 20,
      rankPreference: opts.rank,
      languageCode: "en",
      regionCode: opts.regionCode,
      locationRestriction: {
        circle: {
          center: { latitude: opts.lat, longitude: opts.lng },
          radius: Math.min(opts.radiusKm * 1000, 50000),
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Places nearby search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { places?: Place[] };
  return (data.places ?? []).map(plain);
}

export async function placeDetails(id: string, needsDiet: boolean, lite = false): Promise<Place | null> {
  if (FAKE) return fakeDetails(id);
  const res = await orNone(lite ? "places_details_pro" : needsDiet ? "places_details_atmos" : "places_details", `${BASE}/places/${encodeURIComponent(id)}?languageCode=en`, {
    headers: headers(fieldMask("", needsDiet, lite)),
  });
  if (!res?.ok) return null;
  return plain((await res.json()) as Place);
}

// A short-lived photo address (no key in it) for the card.
export async function photoUri(photoName: string): Promise<string | null> {
  if (FAKE) return null;
  const res = await orNone("places_photo", `${BASE}/${photoName}/media?maxWidthPx=800&skipHttpRedirect=true`, {
    headers: { "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY! },
  });
  if (!res?.ok) return null;
  const data = (await res.json()) as { photoUri?: string };
  return data.photoUri ?? null;
}

// Where a trip destination is ("Goa", "Tokyo"): location and country code.
export async function findDestination(name: string): Promise<{ name: string; lat: number; lng: number; country: string } | null> {
  if (FAKE) return null; // test mode spends nothing (audit, 24 Nov 2026)
  const res = await orNone("places_text_pro", `${BASE}/places:searchText`, {
    method: "POST",
    headers: headers("places.displayName,places.location,places.addressComponents"),
    body: JSON.stringify({ textQuery: name, pageSize: 1, languageCode: "en" }),
  });
  if (!res?.ok) return null;
  const place = ((await res.json()) as { places?: Place[] }).places?.[0];
  if (!place?.location) return null;
  const country = place.addressComponents?.find((c) => c.types?.includes("country"))?.shortText ?? "";
  return { name: place.displayName?.text ?? name, lat: place.location.latitude, lng: place.location.longitude, country };
}

// "Type a neighbourhood or landmark": suggestions near the city, then the
// chosen one's location. Autocomplete is free when the session ends in this
// details call, which uses the cheapest fields (Essentials).
export async function suggestAreas(input: string, near: { lat: number; lng: number }, country: string, session: string) {
  if (FAKE) return [0, 1, 2].map((n) => ({ placeId: `fake_${near.lat.toFixed(4)}_${near.lng.toFixed(4)}_${n}_f`, name: `${input} (test ${n + 1})`, detail: "Test Area, Test City", types: ["restaurant", "food"] }));
  const res = await orNone("places_autocomplete", `${BASE}/places:autocomplete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY! },
    body: JSON.stringify({
      input,
      sessionToken: session,
      languageCode: "en",
      // No country for "places you love": they can be anywhere in the world.
      ...(country ? { includedRegionCodes: [country.toLowerCase()] } : {}),
      locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 40000 } },
      // Nearest first, so Toit in their city comes before Toit Pune (tester,
      // 21 Nov 2026); places elsewhere still come after.
      origin: { latitude: near.lat, longitude: near.lng },
    }),
  });
  if (!res?.ok) return [];
  const data = (await res.json()) as {
    suggestions?: { placePrediction?: { placeId: string; types?: string[]; distanceMeters?: number; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }[];
  };
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.structuredFormat?.mainText)
    .map((p, i) => ({ p, i, near: (p.distanceMeters ?? Infinity) <= 50000 }))
    .sort((a, b) => Number(b.near) - Number(a.near) || a.i - b.i)
    .map(({ p }) => p)
    .slice(0, 5)
    .map((p) => ({ placeId: p.placeId, name: p.structuredFormat!.mainText!.text, detail: p.structuredFormat?.secondaryText?.text ?? "", types: p.types ?? [] }));
}

// The Google place ID for a named place inside a city's area (about 55 km
// each way), or null. Asks only for the ID, which Google doesn't charge for.
export async function placeIdFor(query: string, city: City): Promise<string | null> {
  if (FAKE) return null;
  const dLat = 0.5;
  const dLng = 0.5 / Math.max(0.2, Math.cos((city.lat * Math.PI) / 180));
  const res = await orNone("places_text_ids", `${BASE}/places:searchText`, {
    method: "POST",
    headers: headers("places.id"),
    body: JSON.stringify({
      textQuery: query,
      pageSize: 1,
      languageCode: "en",
      locationRestriction: { rectangle: { low: { latitude: city.lat - dLat, longitude: city.lng - dLng }, high: { latitude: city.lat + dLat, longitude: city.lng + dLng } } },
    }),
  });
  if (!res?.ok) return null;
  return ((await res.json()) as { places?: { id: string }[] }).places?.[0]?.id ?? null;
}

// Where a place is (a typed area, or one of the founder's places). The
// session ends a typed area's autocomplete, which makes that free.
export async function placeLocation(placeId: string, session?: string): Promise<{ lat: number; lng: number } | null> {
  if (FAKE) {
    const p = fakeDetails(placeId);
    return p?.location ? { lat: p.location.latitude, lng: p.location.longitude } : null;
  }
  const res = await orNone("places_details_essentials", `${BASE}/places/${encodeURIComponent(placeId)}${session ? `?sessionToken=${encodeURIComponent(session)}` : ""}`, {
    headers: headers("location"),
  });
  if (!res?.ok) return null;
  const loc = ((await res.json()) as Place).location;
  return loc ? { lat: loc.latitude, lng: loc.longitude } : null;
}

// Prefer a photo taken by a visitor over the venue's own uploads, which are
// often adverts with slogans across them. Falls back to the first photo.
export function bestPhoto(place: Place) {
  const own = (place.displayName?.text ?? "").toLowerCase();
  const photos = place.photos ?? [];
  return (
    photos.slice(0, 6).find((ph) => {
      const author = (ph.authorAttributions?.[0]?.displayName ?? "").toLowerCase();
      return author && !own.includes(author) && !author.includes(own.split(" ")[0] ?? "");
    }) ?? photos[0]
  );
}
