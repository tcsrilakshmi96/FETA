"use client";

import { cityAt, saveCity } from "@/lib/cities";
import { saveCityToDb } from "@/lib/db";
import { choseNearMe, originFromGps, saveOrigin, type Origin } from "@/lib/origin";

// Arrived somewhere new (the phone is in a different city from the one Feta
// knew): Home greets the first evening there. Kept for the visit only.
const NEW_CITY_KEY = "feta.newCity";

export function markNewCity(name: string) {
  try {
    sessionStorage.setItem(NEW_CITY_KEY, name);
  } catch {
    // Just no greeting.
  }
}

export function newCityName(): string | null {
  try {
    return sessionStorage.getItem(NEW_CITY_KEY);
  } catch {
    return null;
  }
}

// "Use my location" is kept only for the visit, so reopening Feta (say from
// WhatsApp) fell back to the whole city and measured from its centre. If
// this phone already allows Feta its location, use it again quietly, once
// per visit; nothing is stored beyond the visit and no prompt appears.
// Someone who chose "Near me" is found again even when the phone doesn't
// say the location is allowed (an installed Feta on an iPhone answers "ask"
// every time); only a "no" stops it.
export async function nearMeIfAllowed(current: Origin): Promise<Origin | null> {
  if (current.source !== "city" || !navigator.geolocation) return null;
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (status?.state === "denied" || (status?.state !== "granted" && !choseNearMe())) return null;
  } catch {
    if (!choseNearMe()) return null;
  }
  const pos = await new Promise<GeolocationPosition | null>((resolve) =>
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: false, timeout: 4000, maximumAge: 300000 }),
  );
  if (!pos) return null;
  const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  const city = (await cityAt(point)) ?? current.city;
  if (city.id !== current.city.id) {
    saveCity(city);
    saveCityToDb(city);
    markNewCity(city.name);
  }
  const origin = originFromGps(point.lat, point.lng, city);
  saveOrigin(origin);
  return origin;
}
