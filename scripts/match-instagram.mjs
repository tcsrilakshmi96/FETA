// Matches the places found in the founder's Instagram stories to Google
// place IDs, for the "From Instagram" tab on /admin.
//
//   node --env-file=.env.local scripts/match-instagram.mjs <places.json> <out.json>
//
// Uses Google's Text Search with only the place ID field ("IDs Only"),
// which Google does not charge for. Runs on the founder's Mac; the output
// stays on her Mac and is opened in the admin page, never uploaded.

import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node --env-file=.env.local scripts/match-instagram.mjs <places.json> <out.json>");
  process.exit(1);
}
const key = process.env.GOOGLE_PLACES_API_KEY;
if (!key) {
  console.error("GOOGLE_PLACES_API_KEY is missing");
  process.exit(1);
}

const places = JSON.parse(readFileSync(input, "utf8"));

async function placeId(query) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id" },
    body: JSON.stringify({ textQuery: query, pageSize: 1, languageCode: "en" }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()).places?.[0]?.id ?? null;
}

const out = [];
let next = 0;
async function worker() {
  while (next < places.length) {
    const p = places[next++];
    const query = [p.name, p.city, p.country].filter(Boolean).join(", ");
    let id = null;
    if (p.city) {
      try {
        id = await placeId(query);
      } catch (error) {
        console.error(`Couldn't match ${query}: ${error.message}`);
      }
    }
    out.push({
      name: p.name,
      city: p.city ?? null,
      country: p.country ?? null,
      kind: p.kind,
      caption: p.caption ?? null,
      dates: p.dates ?? [],
      times: p.times_posted ?? 1,
      confidence: p.confidence,
      placeId: id,
    });
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

const order = { EAT: 0, DRINK: 1, DO: 2, unsure: 3 };
out.sort((a, b) => (order[a.kind] ?? 4) - (order[b.kind] ?? 4) || (a.city ?? "~").localeCompare(b.city ?? "~") || b.times - a.times);
writeFileSync(output, JSON.stringify(out, null, 1));
console.log(`${out.filter((p) => p.placeId).length} of ${out.length} matched → ${output}`);
