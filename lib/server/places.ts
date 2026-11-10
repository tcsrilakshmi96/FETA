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
  addressComponents?: { longText: string; types?: string[] }[];
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

function fieldMask(prefix: string, needsDiet: boolean) {
  return [...FIELDS, ...(needsDiet ? ["servesVegetarianFood"] : [])].map((f) => prefix + f).join(",");
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
}): Promise<Place[]> {
  const res = await fetch(`${BASE}/places:searchText`, {
    method: "POST",
    headers: headers(fieldMask("places.", opts.needsDiet)),
    body: JSON.stringify({
      textQuery: opts.query,
      pageSize: 20,
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

export async function placeDetails(id: string, needsDiet: boolean): Promise<Place | null> {
  const res = await fetch(`${BASE}/places/${encodeURIComponent(id)}?languageCode=en`, {
    headers: headers(fieldMask("", needsDiet)),
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
