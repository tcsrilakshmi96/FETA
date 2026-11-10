import "server-only";

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
  regularOpeningHours?: { periods?: { open: { day: number } }[] };
  businessStatus?: string;
  servesVegetarianFood?: boolean;
  addressComponents?: { longText: string; shortText?: string; types?: string[] }[];
  googleMapsUri?: string;
  websiteUri?: string;
  photos?: { name: string; authorAttributions?: { displayName: string; uri?: string }[] }[];
};

const BASE = "https://places.googleapis.com/v1";

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
  lite?: boolean; // just the top match, cheaper fields
}): Promise<Place[]> {
  const res = await fetch(`${BASE}/places:searchText`, {
    method: "POST",
    headers: headers(fieldMask("places.", opts.needsDiet, opts.lite)),
    body: JSON.stringify({
      textQuery: opts.query,
      pageSize: opts.lite ? 1 : 20,
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
  return data.places ?? [];
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
  const res = await fetch(`${BASE}/places:searchNearby`, {
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
  return data.places ?? [];
}

export async function placeDetails(id: string, needsDiet: boolean, lite = false): Promise<Place | null> {
  const res = await fetch(`${BASE}/places/${encodeURIComponent(id)}?languageCode=en`, {
    headers: headers(fieldMask("", needsDiet, lite)),
  });
  if (!res.ok) return null;
  return (await res.json()) as Place;
}

// A short-lived photo address (no key in it) for the card.
export async function photoUri(photoName: string): Promise<string | null> {
  const res = await fetch(`${BASE}/${photoName}/media?maxWidthPx=800&skipHttpRedirect=true`, {
    headers: { "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY! },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { photoUri?: string };
  return data.photoUri ?? null;
}

// Where a trip destination is ("Goa", "Tokyo"): location and country code.
export async function findDestination(name: string): Promise<{ name: string; lat: number; lng: number; country: string } | null> {
  const res = await fetch(`${BASE}/places:searchText`, {
    method: "POST",
    headers: headers("places.displayName,places.location,places.addressComponents"),
    body: JSON.stringify({ textQuery: name, pageSize: 1, languageCode: "en" }),
  });
  if (!res.ok) return null;
  const place = ((await res.json()) as { places?: Place[] }).places?.[0];
  if (!place?.location) return null;
  const country = place.addressComponents?.find((c) => c.types?.includes("country"))?.shortText ?? "";
  return { name: place.displayName?.text ?? name, lat: place.location.latitude, lng: place.location.longitude, country };
}
