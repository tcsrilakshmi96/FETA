import { CITIES, loadCity, type Area, type City } from "@/lib/cities";

// Where distances for picks are measured from.
export type Origin = {
  lat: number;
  lng: number;
  label: string; // "Near you", "Indiranagar", "Anywhere in Bengaluru"
  source: "gps" | "area" | "city";
  cityId: string;
};

// A phone location lives only in this tab's session memory: used while the
// app is open, never saved to the database or kept as a trail. A chosen
// area is a preference, so it is remembered on the phone.
const SESSION_KEY = "feta.origin";
const AREA_KEY = "feta.area";

export function originFromGps(lat: number, lng: number, city: City): Origin {
  return { lat, lng, label: "Near you", source: "gps", cityId: city.id };
}

export function originFromArea(area: Area, city: City): Origin {
  return { lat: area.lat, lng: area.lng, label: area.name, source: "area", cityId: city.id };
}

export function originFromCity(city: City): Origin {
  return { lat: city.lat, lng: city.lng, label: `Anywhere in ${city.name}`, source: "city", cityId: city.id };
}

export function saveOrigin(origin: Origin) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(origin));
    if (origin.source === "area") localStorage.setItem(AREA_KEY, `${origin.cityId}:${origin.label}`);
    if (origin.source === "city") localStorage.removeItem(AREA_KEY);
  } catch {
    // Without storage the origin still works for this screen.
  }
}

export function loadOrigin(): Origin | null {
  try {
    const session = sessionStorage.getItem(SESSION_KEY);
    if (session) return JSON.parse(session) as Origin;
    const city = loadCity();
    if (!city) return null;
    const [cityId, areaName] = (localStorage.getItem(AREA_KEY) ?? "").split(":");
    const area = cityId === city.id ? city.areas?.find((a) => a.name === areaName) : undefined;
    return area ? originFromArea(area, city) : originFromCity(city);
  } catch {
    return null;
  }
}

export function cityById(id: string) {
  return CITIES.find((c) => c.id === id) ?? null;
}
