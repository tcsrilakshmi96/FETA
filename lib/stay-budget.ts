// What a stay costs a night, as a range they set (traveller, 26 Nov 2026:
// the only budget under ₹6,500 was "Under ₹6,500"; founder, 27 Nov 2026: a
// range from ₹500), in their own currency, converted from US dollars at a
// rough rate (a hotel abroad costs what it costs, unlike dinner at home).
// Used by the trip card (the range) and the server (the kind of stay to search).
export const PER_USD: Record<string, number> = {
  INR: 84, EUR: 0.92, GBP: 0.79, AED: 3.67, SGD: 1.35, HKD: 7.8, THB: 36, AUD: 1.5, CAD: 1.37, CHF: 0.88, JPY: 150, KRW: 1350, CZK: 23, NZD: 1.65, USD: 1,
};

// A round amount people would say: the nearest 1, 2 or 5 of its size (€5, €50, ¥1,000).
export function nice(n: number) {
  const size = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((d) => d * size).reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best));
}

// The lowest a night can be set to (₹500 in India, about the same elsewhere),
// a starting range, and the step the − and ＋ move by.
export function stayRange(currency: string): { currency: string; floor: number; min: number; max: number; step: number } {
  const cur = PER_USD[currency] ? currency : "USD";
  const floor = cur === "INR" ? 500 : nice(6 * PER_USD[cur]);
  const max = cur === "INR" ? 3000 : nice(40 * PER_USD[cur]);
  return { currency: cur, floor, min: floor, max, step: floor };
}

// "500-3000" as kept on the trip; old trips kept a band, 1 to 4.
export function parseRange(kept: string | null | undefined, currency: string): { min: number; max: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(kept ?? "");
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const band = ({ "1": [0, 80], "2": [80, 180], "3": [180, 350], "4": [350, 1000] } as Record<string, number[]>)[kept ?? ""];
  const rate = PER_USD[currency] ?? 1;
  return band ? { min: Math.round(band[0] * rate), max: Math.round(band[1] * rate) } : null;
}

// The kind of stay that fits the top of their range, as words a search
// understands (prices aren't on Google for most stays, so never promised).
export function stayKind(max: number, currency: string): string {
  const usd = max / (PER_USD[currency] ?? 1);
  if (usd <= 20) return "hostel or guesthouse";
  if (usd <= 50) return "budget hotel or guesthouse";
  if (usd <= 140) return "hotel";
  if (usd <= 320) return "boutique hotel";
  return "luxury hotel";
}
