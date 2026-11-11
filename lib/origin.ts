import { loadCity, type City } from "@/lib/cities";

// Where distances for picks are measured from, and the city it's in.
export type Origin = {
  lat: number;
  lng: number;
  label: string; // "Near you", "Kreuzberg", "Anywhere in Lisbon"
  source: "gps" | "area" | "city";
  areaId?: string; // the typed area's Google place ID
  city: City;
};

// A phone location lives only in this tab's session memory: used while the
// app is open, never saved to the database or kept as a trail. A typed area
// is a preference, so it is remembered on the phone, for up to 30 days
// (Google allows a location to be kept that long; the place ID any time).
const SESSION_KEY = "feta.origin";
const AREA_KEY = "feta.area";
const AREA_DAYS = 30;

export function originFromGps(lat: number, lng: number, city: City): Origin {
  return { lat, lng, label: "Near you", source: "gps", city };
}

export function originFromArea(area: { placeId: string; name: string; lat: number; lng: number }, city: City): Origin {
  return { lat: area.lat, lng: area.lng, label: area.name, source: "area", areaId: area.placeId, city };
}

export function originFromCity(city: City): Origin {
  return { lat: city.lat, lng: city.lng, label: `Anywhere in ${city.name}`, source: "city", city };
}

export function saveOrigin(origin: Origin) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(origin));
    if (origin.source === "area") localStorage.setItem(AREA_KEY, JSON.stringify({ origin, at: Date.now() }));
    if (origin.source === "city") localStorage.removeItem(AREA_KEY);
  } catch {
    // Without storage the origin still works for this screen.
  }
}

function valid(o: Origin | null | undefined): o is Origin {
  return !!o && Number.isFinite(o.lat) && Number.isFinite(o.lng) && !!o.city?.id && !!o.city.timeZone;
}

export function loadOrigin(): Origin | null {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as Origin | null;
    if (valid(session)) return session;
    const city = loadCity();
    if (!city) return null;
    const area = JSON.parse(localStorage.getItem(AREA_KEY) ?? "null") as { origin: Origin; at: number } | null;
    if (area && valid(area.origin) && area.origin.city.id === city.id && Date.now() - area.at < AREA_DAYS * 86400000) return area.origin;
    return originFromCity(city);
  } catch {
    return null;
  }
}

// Same place, same picks: a key for keeping each origin's picks apart.
export function originKey(o: Origin) {
  return o.source === "gps" ? `gps:${o.city.id}` : o.source === "area" ? `area:${o.areaId ?? o.label}` : `city:${o.city.id}`;
}
