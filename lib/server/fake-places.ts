import "server-only";
import type { Place } from "@/lib/server/places";

// Test mode (FAKE_PLACES=1, only on the founder's Mac): made-up places
// instead of Google, so test runs cost nothing. No Google content, no
// photos, no events, and Gemini ranking is skipped (filtered order is used).
export const FAKE = process.env.FAKE_PLACES === "1" && process.env.NODE_ENV !== "production";

const FOOD = ["restaurant", "cafe", "bar", "bakery", "indian_restaurant", "pub"];
const DOING = ["art_gallery", "bowling_alley", "museum", "park", "performing_arts_theater", "escape_room"];
const WORDS = ["Mango", "Copper", "Juniper", "Saffron", "Indigo", "Pebble", "Lantern", "Basil", "Monsoon", "Tamarind", "Cobalt", "Fig", "Marigold", "Clove", "Amber", "Orchid", "Cinder", "Hazel", "Lotus", "Quill"];

// Everything about a fake place is in its ID, so details can rebuild it.
function make(lat: number, lng: number, n: number, food: boolean): Place {
  const type = (food ? FOOD : DOING)[n % 6];
  const id = `fake_${lat.toFixed(4)}_${lng.toFixed(4)}_${n}_${food ? "f" : "d"}`;
  const close = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
  return {
    id,
    displayName: { text: `${WORDS[n % 20]} ${WORDS[(n * 7 + 3) % 20]} (test ${type.replace(/_/g, " ")})` },
    primaryType: type,
    types: [type, food ? "food" : "point_of_interest"],
    location: { latitude: lat + ((n % 5) - 2) * 0.004, longitude: lng + ((n % 7) - 3) * 0.004 },
    priceLevel: ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE"][n % 3],
    rating: 4 + (n % 9) / 10,
    userRatingCount: 150 + n * 400,
    currentOpeningHours: { openNow: true, nextCloseTime: close },
    regularOpeningHours: { periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 8, minute: 0 }, close: { day: (day + 1) % 7, hour: 1, minute: 0 } })) },
    businessStatus: "OPERATIONAL",
    servesVegetarianFood: true,
    addressComponents: [{ longText: "Test Area", types: ["sublocality_level_1"] }],
    googleMapsUri: "https://www.google.com/maps",
    photos: [],
  };
}

export function fakeSearch(lat: number, lng: number, query: string, food: boolean): Place[] {
  const offset = [...query].reduce((a, c) => a + c.charCodeAt(0), 0) % 7;
  return Array.from({ length: 20 }, (_, i) => make(lat, lng, i + offset * 20, food));
}

export function fakeDetails(id: string): Place | null {
  const m = /^fake_(-?[\d.]+)_(-?[\d.]+)_(\d+)_([fd])$/.exec(id);
  return m ? make(Number(m[1]), Number(m[2]), Number(m[3]), m[4] === "f") : null;
}
