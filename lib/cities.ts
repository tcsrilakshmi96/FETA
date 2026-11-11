import type { Currency } from "@/lib/currency";

// Any city in the world (from GeoNames, searched on Feta's server; see
// lib/server/cities.ts). Every city carries country, time zone and
// currency, so a new city is never a rebuild.
export type City = {
  id: string; // "gn:<GeoNames id>"
  name: string;
  region: string;
  country: string; // ISO code
  countryName: string;
  timeZone: string;
  currency: Currency;
  lat: number;
  lng: number;
};

// Mainland China: Google Maps data there is thin, so v1 offers chat only.
// Hong Kong (HK) and Macau (MO) have their own codes and work as normal.
export function isMainlandChina(city: Pick<City, "country">) {
  return city.country === "CN";
}

// Miles in the US and UK; km everywhere else.
export function usesMiles(country: string | undefined) {
  return country === "US" || country === "GB";
}

export function formatDistance(km: number, country: string | undefined) {
  if (usesMiles(country)) {
    const mi = km / 1.609;
    return `${mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi)} mi`;
  }
  return `${km < 10 ? Math.round(km * 10) / 10 : Math.round(km)} km`;
}

// Straight-line distance in km between two points.
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// The chosen city is kept on the phone (and in the profile).
const STORAGE_KEY = "feta.city";

// Cities chosen before "any city" (Nov 2026) were stored by a short id.
const OLD_IDS: Record<string, City> = {
  bengaluru: { id: "gn:1277333", name: "Bengaluru", region: "Karnataka", country: "IN", countryName: "India", timeZone: "Asia/Kolkata", currency: "INR", lat: 12.9719, lng: 77.5937 },
  mumbai: { id: "gn:1275339", name: "Mumbai", region: "Maharashtra", country: "IN", countryName: "India", timeZone: "Asia/Kolkata", currency: "INR", lat: 19.0728, lng: 72.8826 },
  "delhi-ncr": { id: "gn:1273294", name: "Delhi", region: "Delhi", country: "IN", countryName: "India", timeZone: "Asia/Kolkata", currency: "INR", lat: 28.6519, lng: 77.2315 },
  hyderabad: { id: "gn:1269843", name: "Hyderabad", region: "Telangana", country: "IN", countryName: "India", timeZone: "Asia/Kolkata", currency: "INR", lat: 17.384, lng: 78.4564 },
  chennai: { id: "gn:1264527", name: "Chennai", region: "Tamil Nadu", country: "IN", countryName: "India", timeZone: "Asia/Kolkata", currency: "INR", lat: 13.0878, lng: 80.2785 },
  pune: { id: "gn:1259229", name: "Pune", region: "Maharashtra", country: "IN", countryName: "India", timeZone: "Asia/Kolkata", currency: "INR", lat: 18.5196, lng: 73.8554 },
  kolkata: { id: "gn:1275004", name: "Kolkata", region: "West Bengal", country: "IN", countryName: "India", timeZone: "Asia/Kolkata", currency: "INR", lat: 22.5626, lng: 88.363 },
  goa: { id: "gn:9000001", name: "Goa", region: "Goa", country: "IN", countryName: "India", timeZone: "Asia/Kolkata", currency: "INR", lat: 15.4909, lng: 73.8278 },
};

export function loadCity(): City | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    if (!raw.startsWith("{")) return OLD_IDS[raw] ?? null;
    const city = JSON.parse(raw) as City;
    return city.id && city.timeZone && Number.isFinite(city.lat) ? city : null;
  } catch {
    return null;
  }
}

export function saveCity(city: City) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(city));
  } catch {
    // Private browsing can block storage; the choice still works for this visit.
  }
}

// Asks Feta's server for cities matching what was typed.
export async function findCities(query: string): Promise<(City & { matched?: string })[]> {
  if (!query.trim()) return [];
  try {
    const res = await fetch(`/api/cities?q=${encodeURIComponent(query.trim())}`);
    return res.ok ? ((await res.json()) as { cities: (City & { matched?: string })[] }).cities : [];
  } catch {
    return [];
  }
}

// The city a point is in (or nearest to), for "Use my location".
export async function cityAt(point: { lat: number; lng: number }): Promise<City | null> {
  try {
    const res = await fetch(`/api/cities?near=${point.lat.toFixed(3)},${point.lng.toFixed(3)}`);
    return res.ok ? ((await res.json()) as { city: City | null }).city : null;
  } catch {
    return null;
  }
}
