"use client";

import { cityAt, isMainlandChina, saveCity, type City } from "@/lib/cities";
import { saveCityToDb, saveLocationConsent } from "@/lib/db";
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

// "Near me" tapped (the location screen in setup, the Where sheet): the
// phone's location once, the city following them. Says what happened so the
// screen can say it: found (and saved), the phone said no, couldn't tell
// which city, or another failure; mainland China goes to chat.
// "off": the phone or browser has location switched off (Feta was refused,
// or the phone can't give a position at all), so the screen shows how to
// switch it on (founder, 27 Nov 2026: "the button doesn't respond").
export type Located = { origin: Origin; movedTo?: string } | { china: City } | "off" | "nocity" | "failed";
export function locateMe(current: City | null): Promise<Located> {
  if (!navigator.geolocation) return Promise.resolve("off");
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        saveLocationConsent(true);
        const point = { lat: coords.latitude, lng: coords.longitude };
        const here = (await cityAt(point)) ?? current;
        if (!here) return resolve("nocity");
        const moved = here.id !== current?.id;
        if (moved) {
          saveCity(here);
          saveCityToDb(here);
          markNewCity(here.name);
        }
        if (isMainlandChina(here)) return resolve({ china: here });
        const origin = originFromGps(point.lat, point.lng, here);
        saveOrigin(origin);
        resolve(moved ? { origin, movedTo: here.name } : { origin });
      },
      (error) => resolve(error.code === error.TIMEOUT ? "failed" : "off"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    ),
  );
}

// How to switch location on, for this phone and browser.
export function locationSteps(): string {
  const ua = navigator.userAgent;
  const installed = window.matchMedia?.("(display-mode: standalone)").matches;
  if (/iPhone|iPad|iPod/.test(ua)) {
    return installed || !/CriOS/.test(ua)
      ? "Open Settings → Privacy & Security → Location Services: switch it on, then tap Safari Websites and choose While Using the App."
      : "Open Settings → Privacy & Security → Location Services: switch it on, then tap Chrome and choose While Using the App.";
  }
  if (/Android/.test(ua)) return "Swipe down from the top of the screen and switch Location on. Then in Chrome tap ⋮ → Settings → Site settings → Location, and allow askfeta.com.";
  return "Switch location on in your computer's privacy settings, then click the icon at the left of the address bar and allow location for askfeta.com.";
}
