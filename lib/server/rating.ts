// How good a place really is, weighing its stars by how many people gave
// them (founder, 26 Nov 2026, from a tester: a 5.0 from 28 reviews sat
// level with a 4.3 from 37,900): a few reviews count for little, so a
// place with few is pulled toward an ordinary 4.1.
export function trustedRating(place: { rating?: number; userRatingCount?: number }) {
  if (place.rating === undefined) return undefined;
  const n = place.userRatingCount ?? 0;
  return Math.round(((place.rating * n + 4.1 * 150) / (n + 150)) * 100) / 100;
}
