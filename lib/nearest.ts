import { distanceKm } from "@/lib/cities";
import type { Pick } from "@/lib/server/picks";

// Of the first 3, the one nearest `to` moves to the front (a short distance
// apart counts as near, so the best fit stays first when they're all close).
export function nearestFirst(picks: Pick[], to: Pick | undefined): Pick[] {
  if (!to || to.lat === undefined || to.lng === undefined || picks.length < 2) return picks;
  const at = { lat: to.lat, lng: to.lng };
  const km = (p: Pick) => (p.lat === undefined || p.lng === undefined ? Infinity : distanceKm(at, { lat: p.lat, lng: p.lng }));
  const first = km(picks[0]);
  if (first <= NEAR_KM) return picks;
  const best = picks.slice(0, 3).reduce((b, p) => (km(p) < km(b) ? p : b), picks[0]);
  return best === picks[0] ? picks : [best, ...picks.filter((p) => p !== best)];
}
const NEAR_KM = 3;
