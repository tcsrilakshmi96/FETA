"use client";

import { cityAt, saveCity } from "@/lib/cities";
import { saveCityToDb } from "@/lib/db";
import { originFromGps, saveOrigin, type Origin } from "@/lib/origin";

// "Use my location" is kept only for the visit, so reopening Feta (say from
// WhatsApp) fell back to the whole city and measured from its centre. If
// this phone already allows Feta its location, use it again quietly, once
// per visit; nothing is stored beyond the visit and no prompt appears.
export async function nearMeIfAllowed(current: Origin): Promise<Origin | null> {
  if (current.source !== "city" || !navigator.geolocation) return null;
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (status?.state !== "granted") return null;
  } catch {
    return null;
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
  }
  const origin = originFromGps(point.lat, point.lng, city);
  saveOrigin(origin);
  return origin;
}
