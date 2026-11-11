import "server-only";
import data from "@/data/cities.json";
import { distanceKm, type City } from "@/lib/cities";
import { knownCurrency } from "@/lib/currency";

// Every city of 15,000+ people, from GeoNames (CC BY 4.0, credited in the
// privacy page). Free to search and to store, unlike Google's answers.
// Rows: [id, name, region, country, lat, lng, timeZone, population, alternative names].
type Row = [number, string, string, string, number, number, string, number, string];
const rows = data.cities as unknown as Row[];
const countries = data.countries as unknown as Record<string, [string, string]>;

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

let index: { row: Row; names: string[] }[] | null = null;
function searchIndex() {
  index ??= rows.map((row) => ({ row, names: [row[1], ...(row[8] ? row[8].split("|") : [])].map(fold) }));
  return index;
}

function toCity(row: Row): City {
  const [name, currency] = countries[row[3]] ?? [row[3], "USD"];
  return {
    id: `gn:${row[0]}`,
    name: row[1],
    region: row[2],
    country: row[3],
    countryName: name,
    timeZone: row[6],
    currency: knownCurrency(currency),
    lat: row[4],
    lng: row[5],
  };
}

// Best matches for what was typed: whole name first, then names starting
// with it, then names containing a word starting with it; bigger cities
// first within each. "Bangalore" finds Bengaluru, and says so.
export function searchCities(query: string, limit = 8): (City & { matched?: string })[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const scored: { row: Row; score: number; matched?: string }[] = [];
  for (const { row, names } of searchIndex()) {
    let best = 0;
    let via = -1;
    names.forEach((n, i) => {
      const s = n === q ? 3 : n.startsWith(q) ? 2 : n.includes(` ${q}`) || n.includes(`-${q}`) ? 1 : 0;
      if (s > best || (s === best && s > 0 && i === 0)) {
        best = s;
        via = i;
      }
    });
    if (best) scored.push({ row, score: best + (via === 0 ? 0.5 : 0), matched: via > 0 ? row[8].split("|")[via - 1] : undefined });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.row[7] - a.row[7])
    .slice(0, limit)
    .map(({ row, matched }) => ({ ...toCity(row), ...(matched ? { matched } : {}) }));
}

export function cityById(id: string | undefined | null): City | null {
  const n = Number((id ?? "").replace(/^gn:/, ""));
  const row = n ? rows.find((r) => r[0] === n) : undefined;
  return row ? toCity(row) : null;
}

// The city someone is in: the biggest city within a few km (so a point in
// a suburb counts as the city), else the nearest one at all.
export function cityAt(point: { lat: number; lng: number }): City | null {
  let nearest: { row: Row; km: number } | null = null;
  let biggestClose: Row | null = null;
  for (const row of rows) {
    if (Math.abs(row[4] - point.lat) > 1 || Math.abs(row[5] - point.lng) > 1.5) continue;
    const km = distanceKm(point, { lat: row[4], lng: row[5] });
    if (!nearest || km < nearest.km) nearest = { row, km };
    if (km <= 15 + Math.min(25, Math.sqrt(row[7]) / 100) && (!biggestClose || row[7] > biggestClose[7])) biggestClose = row;
  }
  const row = biggestClose ?? nearest?.row;
  return row ? toCity(row) : null;
}
