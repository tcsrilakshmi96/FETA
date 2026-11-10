import type { Currency } from "@/lib/currency";

// Cities in the picker. Every city carries country, time zone and currency,
// so adding a city (in India or abroad) is a data change, not a rebuild.
export type City = {
  id: string;
  name: string;
  region: string;
  country: string; // ISO code
  timeZone: string;
  currency: Currency;
  lat: number;
  lng: number;
  covered: boolean; // false shows "Not yet"
  aliases?: string[]; // other names people search for
};

const india = { country: "IN", timeZone: "Asia/Kolkata", currency: "INR" as const };

export const CITIES: City[] = [
  { id: "bengaluru", name: "Bengaluru", region: "Karnataka", ...india, lat: 12.97, lng: 77.59, covered: true, aliases: ["bangalore"] },
  { id: "mumbai", name: "Mumbai", region: "Maharashtra", ...india, lat: 19.08, lng: 72.88, covered: true, aliases: ["bombay"] },
  { id: "delhi-ncr", name: "Delhi NCR", region: "Delhi", ...india, lat: 28.61, lng: 77.21, covered: true, aliases: ["delhi", "new delhi", "gurugram", "gurgaon", "noida"] },
  { id: "hyderabad", name: "Hyderabad", region: "Telangana", ...india, lat: 17.39, lng: 78.49, covered: true },
  { id: "chennai", name: "Chennai", region: "Tamil Nadu", ...india, lat: 13.08, lng: 80.27, covered: true, aliases: ["madras"] },
  { id: "pune", name: "Pune", region: "Maharashtra", ...india, lat: 18.52, lng: 73.86, covered: true },
  { id: "kolkata", name: "Kolkata", region: "West Bengal", ...india, lat: 22.57, lng: 88.36, covered: true, aliases: ["calcutta"] },
  { id: "goa", name: "Goa", region: "Goa", ...india, lat: 15.49, lng: 73.83, covered: true, aliases: ["panaji", "panjim"] },
  { id: "ahmedabad", name: "Ahmedabad", region: "Gujarat", ...india, lat: 23.02, lng: 72.57, covered: false },
  { id: "jaipur", name: "Jaipur", region: "Rajasthan", ...india, lat: 26.91, lng: 75.79, covered: false },
  { id: "kochi", name: "Kochi", region: "Kerala", ...india, lat: 9.93, lng: 76.27, covered: false, aliases: ["cochin"] },
  { id: "chandigarh", name: "Chandigarh", region: "Chandigarh", ...india, lat: 30.73, lng: 76.78, covered: false },
  { id: "lucknow", name: "Lucknow", region: "Uttar Pradesh", ...india, lat: 26.85, lng: 80.95, covered: false },
  { id: "indore", name: "Indore", region: "Madhya Pradesh", ...india, lat: 22.72, lng: 75.86, covered: false },
  { id: "mysuru", name: "Mysuru", region: "Karnataka", ...india, lat: 12.3, lng: 76.64, covered: false, aliases: ["mysore"] },
];

export function searchCities(query: string): City[] {
  const q = query.trim().toLowerCase();
  const matches = q
    ? CITIES.filter((c) => [c.name, c.region, ...(c.aliases ?? [])].some((n) => n.toLowerCase().includes(q)))
    : CITIES;
  // Covered cities first, each group in the order above.
  return [...matches.filter((c) => c.covered), ...matches.filter((c) => !c.covered)];
}

// Straight-line distance in km, good enough to suggest the nearest cities.
function distanceKm(a: City, b: City) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function nearestCovered(city: City, count = 2) {
  return CITIES.filter((c) => c.covered)
    .map((c) => ({ city: c, km: Math.round(distanceKm(city, c) / 10) * 10 }))
    .sort((a, b) => a.km - b.km)
    .slice(0, count);
}

// Kept on this phone until the database is connected.
const STORAGE_KEY = "feta.city";

export function loadCity(): City | null {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return CITIES.find((c) => c.id === id) ?? null;
  } catch {
    return null;
  }
}

export function saveCity(city: City) {
  try {
    localStorage.setItem(STORAGE_KEY, city.id);
  } catch {
    // Private browsing can block storage; the choice still works for this visit.
  }
}
