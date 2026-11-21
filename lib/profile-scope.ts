// A profile line can count only today (Ask Feta: "out with my parents
// tonight"; Round 6, founder 21 Nov 2026), kept in its trip column as
// "day:<YYYY-MM-DD>" (UTC, so it lasts into the early hours in India).
export function todayScope(now = new Date()) {
  return `day:${now.toISOString().slice(0, 10)}`;
}

// Whether a line with this scope counts now: always, for this trip, or today.
export function scopeCounts(scope: string | null, trip?: string | null, now = new Date()) {
  if (!scope) return true;
  if (scope.startsWith("day:")) return scope === todayScope(now);
  return !!trip && scope === trip;
}
