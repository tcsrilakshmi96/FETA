// Builds data/cities.json from GeoNames (CC BY 4.0, https://www.geonames.org):
// every city of 15,000+ people, with country, region, time zone and a few
// English alternative names ("Bangalore", "Bombay"), for "type any city".
//
// Usage: node scripts/build-cities.mjs <folder with cities15000.txt,
//        admin1CodesASCII.txt and countryInfo.txt from download.geonames.org>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("Pass the GeoNames folder");
const lines = (f) => readFileSync(join(dir, f), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));

const regions = new Map(lines("admin1CodesASCII.txt").map((l) => { const [code, name] = l.split("\t"); return [code, name]; }));
// Country code → [name, currency code].
const countries = Object.fromEntries(lines("countryInfo.txt").map((l) => { const c = l.split("\t"); return [c[0], [c[4], c[10]]]; }));

// English-looking alternatives only: no airport codes or transliterations.
const latin = /^[A-Z][a-z]+(?:[ -][A-Za-z][a-z]+)*$/;

// Places people choose like a city that GeoNames lists as a region.
const EXTRAS = [
  [9000001, "Goa", "Goa", "IN", 15.4909, 73.8278, "Asia/Kolkata", 1500000, "Panaji|Panjim"],
  [9000002, "Bali", "Bali", "ID", -8.65, 115.2167, "Asia/Makassar", 4300000, "Denpasar|Ubud"],
];
const cities = lines("cities15000.txt").map((l) => {
  const c = l.split("\t");
  const [id, name, ascii, alt, lat, lng, , , country, , admin1] = c;
  const population = Number(c[14]);
  const own = new Set([name.toLowerCase(), ascii.toLowerCase()]);
  const alts = population >= 100000
    ? [...new Set(alt.split(",").filter((a) => latin.test(a) && a.length <= 24 && !own.has(a.toLowerCase())))].slice(0, population >= 500000 ? 15 : 6)
    : [];
  if (ascii !== name) alts.unshift(ascii);
  return [Number(id), name, regions.get(`${country}.${admin1}`) ?? "", country, Number(Number(lat).toFixed(4)), Number(Number(lng).toFixed(4)), c[17], population, alts.join("|")];
});
cities.push(...EXTRAS);
cities.sort((a, b) => b[7] - a[7]);
writeFileSync(new URL("../data/cities.json", import.meta.url), JSON.stringify({ source: "GeoNames, CC BY 4.0", countries, cities }));
console.log(`${cities.length} cities`);
