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
  areas?: Area[]; // neighbourhoods for "Pick an area"
};

// Approximate centre of a neighbourhood, for distances.
export type Area = { id: string; name: string; lat: number; lng: number };

const area = (name: string, lat: number, lng: number): Area => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name,
  lat,
  lng,
});

const india = { country: "IN", timeZone: "Asia/Kolkata", currency: "INR" as const };

export const CITIES: City[] = [
  { id: "bengaluru", name: "Bengaluru", region: "Karnataka", ...india, lat: 12.97, lng: 77.59, covered: true, aliases: ["bangalore"],
    areas: [area("Indiranagar", 12.9784, 77.6408), area("Koramangala", 12.9352, 77.6245), area("HSR Layout", 12.9116, 77.6474), area("Jayanagar", 12.925, 77.5938), area("Malleshwaram", 13.0035, 77.571), area("MG Road", 12.9756, 77.6066), area("JP Nagar", 12.9063, 77.5857), area("Whitefield", 12.9698, 77.75)] },
  { id: "mumbai", name: "Mumbai", region: "Maharashtra", ...india, lat: 19.08, lng: 72.88, covered: true, aliases: ["bombay"],
    areas: [area("Bandra", 19.0596, 72.8295), area("Colaba", 18.9067, 72.8147), area("Fort", 18.9338, 72.8356), area("Lower Parel", 18.998, 72.83), area("Juhu", 19.1075, 72.8263), area("Andheri West", 19.1364, 72.8296), area("Powai", 19.1176, 72.906), area("Chembur", 19.0522, 72.9005)] },
  { id: "delhi-ncr", name: "Delhi NCR", region: "Delhi", ...india, lat: 28.61, lng: 77.21, covered: true, aliases: ["delhi", "new delhi", "gurugram", "gurgaon", "noida"],
    areas: [area("Connaught Place", 28.6315, 77.2167), area("Khan Market", 28.6003, 77.227), area("Hauz Khas", 28.5494, 77.2001), area("Defence Colony", 28.5741, 77.231), area("Saket", 28.5245, 77.2066), area("Chandni Chowk", 28.6506, 77.2303), area("Cyber Hub, Gurugram", 28.495, 77.0895), area("Sector 18, Noida", 28.5708, 77.326)] },
  { id: "hyderabad", name: "Hyderabad", region: "Telangana", ...india, lat: 17.39, lng: 78.49, covered: true,
    areas: [area("Banjara Hills", 17.4126, 78.4482), area("Jubilee Hills", 17.4325, 78.4073), area("Begumpet", 17.4447, 78.4664), area("HITEC City", 17.4435, 78.3772), area("Gachibowli", 17.4401, 78.3489), area("Kondapur", 17.46, 78.357), area("Charminar", 17.3616, 78.4747)] },
  { id: "chennai", name: "Chennai", region: "Tamil Nadu", ...india, lat: 13.08, lng: 80.27, covered: true, aliases: ["madras"],
    areas: [area("T. Nagar", 13.0418, 80.2341), area("Mylapore", 13.0368, 80.2676), area("Nungambakkam", 13.0569, 80.2425), area("Adyar", 13.0012, 80.2565), area("Besant Nagar", 12.9986, 80.2668), area("Anna Nagar", 13.085, 80.2101), area("Velachery", 12.9815, 80.218)] },
  { id: "pune", name: "Pune", region: "Maharashtra", ...india, lat: 18.52, lng: 73.86, covered: true,
    areas: [area("Koregaon Park", 18.5362, 73.894), area("Kalyani Nagar", 18.5463, 73.9033), area("Viman Nagar", 18.5679, 73.9143), area("Camp", 18.515, 73.878), area("Deccan", 18.5167, 73.8415), area("Aundh", 18.558, 73.8075), area("Baner", 18.559, 73.7868)] },
  { id: "kolkata", name: "Kolkata", region: "West Bengal", ...india, lat: 22.57, lng: 88.36, covered: true, aliases: ["calcutta"],
    areas: [area("Park Street", 22.553, 88.352), area("Ballygunge", 22.528, 88.365), area("Gariahat", 22.519, 88.366), area("College Street", 22.5745, 88.363), area("Salt Lake", 22.5867, 88.417), area("New Town", 22.576, 88.479)] },
  { id: "goa", name: "Goa", region: "Goa", ...india, lat: 15.49, lng: 73.83, covered: true, aliases: ["panaji", "panjim"],
    areas: [area("Panaji", 15.4909, 73.8278), area("Assagao", 15.595, 73.772), area("Anjuna", 15.5733, 73.74), area("Calangute", 15.5439, 73.7553), area("Margao", 15.2832, 73.9862), area("Palolem", 15.01, 74.0232)] },
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

// Straight-line distance in km between two points.
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function nearestCovered(city: { lat: number; lng: number }, count = 2) {
  return CITIES.filter((c) => c.covered)
    .map((c) => ({ city: c, km: Math.round(distanceKm(city, c) / 10) * 10 }))
    .sort((a, b) => a.km - b.km)
    .slice(0, count);
}

// The covered city a point is in, if any (within 50 km of its centre).
export function coveredCityAt(point: { lat: number; lng: number }): City | null {
  const [nearest] = nearestCovered(point, 1);
  return nearest && nearest.km <= 50 ? nearest.city : null;
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
