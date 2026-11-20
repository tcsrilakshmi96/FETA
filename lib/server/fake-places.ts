import "server-only";
import type { Intent } from "@/lib/server/intents";
import type { Candidate, Ranked } from "@/lib/server/picks";
import type { Place } from "@/lib/server/places";

// Test mode (FAKE_PLACES=1, only on the founder's Mac, and the quality
// check, npm run eval): made-up places instead of Google, so test runs cost
// nothing. They are written to look like a real city (founder, 15 Nov 2026:
// "test mode never caught Thai lovers getting Indian"): many popular
// vegetarian Indian places, a few Thai and Korean ones (some with no veg
// information, some mainly meat), bars that are the thing to do (karaoke,
// rooftops), places closed tonight or at the weekend, and some far away.
// Searches match words in the name, type and tags, like Google roughly
// does. Gemini is replaced by fakeRank. No Google content, no photos, no
// events.
export const FAKE = process.env.FAKE_PLACES === "1" && process.env.NODE_ENV !== "production";

type Hours = "eve" | "late" | "day" | "lunch" | "weekday";
// name, main type, other types, tags, serves veg (null: Google doesn't say), price 1–4 (0: none), stars, reviews, hours, km, bearing
type Row = [string, string, string[], string, boolean | null, number, number, number, Hours, number, number];

export const CATALOGUE: Row[] = [
  // Popular vegetarian Indian places (the crowd that hid Thai and Korean).
  ["Vidyarthi Corner", "indian_restaurant", ["restaurant"], "south indian dosa tiffin vegetarian", true, 1, 4.5, 14000, "eve", 1.2, 10],
  ["Brahmin Tiffin Room", "south_indian_restaurant", ["restaurant"], "south indian tiffin idli vegetarian", true, 1, 4.6, 9000, "eve", 0.8, 80],
  ["Go Native Kitchen", "vegetarian_restaurant", ["restaurant"], "modern south indian millet vegetarian healthy", true, 2, 4.6, 1900, "eve", 1.5, 140],
  ["Element Sattvik", "vegetarian_restaurant", ["restaurant"], "sattvik jain vegan vegetarian thali", true, 2, 4.4, 1500, "eve", 2.1, 200],
  ["Thindi Lane", "indian_restaurant", ["restaurant"], "street food south indian vegetarian", true, 1, 4.0, 366, "eve", 1.8, 260],
  ["Tiffin Roastery", "indian_restaurant", ["restaurant", "cafe"], "south indian tiffin coffee vegetarian", true, 1, 4.5, 242, "eve", 0.6, 300],
  ["Coastal Thali House", "indian_restaurant", ["restaurant"], "regional thali mangalorean vegetarian", true, 2, 4.4, 2600, "eve", 2.4, 330],
  ["Punjab Dhaba Grand", "north_indian_restaurant", ["restaurant"], "north indian punjabi paneer", true, 2, 4.3, 5200, "eve", 1.9, 30],
  ["Mughlai Darbar", "indian_restaurant", ["restaurant"], "north indian mughlai", true, 2, 4.2, 3100, "eve", 2.8, 60],
  ["Biryani Darbar", "indian_restaurant", ["restaurant"], "biryani hyderabadi", true, 2, 4.3, 8000, "late", 1.1, 100],
  ["Chettinad Pepper", "indian_restaurant", ["restaurant"], "regional chettinad spicy", null, 2, 4.5, 700, "eve", 3.0, 170],
  // Thai and Southeast Asian.
  ["Lemongrass Thai Kitchen", "thai_restaurant", ["restaurant"], "thai curry pad thai", null, 2, 4.5, 820, "eve", 1.4, 50],
  ["Baan Siam", "thai_restaurant", ["restaurant"], "thai green curry", true, 3, 4.6, 1300, "eve", 3.2, 120],
  ["Thai Basil Street", "restaurant", ["food"], "thai street food noodles", true, 1, 4.3, 400, "eve", 2.2, 220],
  ["Pho Saigon", "vietnamese_restaurant", ["restaurant"], "vietnamese pho southeast asian", true, 2, 4.4, 600, "eve", 2.6, 290],
  ["Burma Lane", "restaurant", ["food"], "burmese khow suey southeast asian vegetarian", true, 2, 4.7, 4200, "eve", 3.4, 350],
  // Korean (one mainly barbecue).
  ["Seoul Kitchen", "korean_restaurant", ["restaurant"], "korean bibimbap kimchi", null, 2, 4.4, 900, "eve", 1.7, 70],
  ["Hansik Bowl", "korean_restaurant", ["restaurant"], "korean bowls tteokbokki", true, 2, 4.3, 350, "eve", 2.9, 160],
  ["Gangnam BBQ House", "korean_restaurant", ["restaurant"], "korean barbecue grill meat", false, 3, 4.5, 1100, "eve", 2.0, 250],
  // Other cuisines.
  ["Trattoria Nonna", "italian_restaurant", ["restaurant"], "italian pasta", true, 3, 4.5, 2200, "eve", 1.3, 20],
  ["Slice Theory", "pizza_restaurant", ["restaurant"], "pizza italian", true, 2, 4.4, 3400, "late", 0.9, 190],
  ["Pasta Street", "italian_restaurant", ["restaurant"], "italian pasta casual", true, 2, 4.2, 1200, "eve", 2.5, 310],
  ["Sakura Sushi Bar", "sushi_restaurant", ["japanese_restaurant", "restaurant"], "japanese sushi", true, 3, 4.5, 900, "eve", 2.3, 40],
  ["Ramen Republic", "ramen_restaurant", ["japanese_restaurant", "restaurant"], "japanese ramen", true, 2, 4.3, 700, "eve", 1.6, 230],
  ["Casa Taco", "mexican_restaurant", ["restaurant"], "mexican tacos burritos", true, 2, 4.2, 800, "eve", 2.7, 280],
  ["Beirut Grill", "lebanese_restaurant", ["restaurant"], "lebanese middle eastern falafel", true, 2, 4.4, 1000, "eve", 3.1, 150],
  ["Wok This Way", "chinese_restaurant", ["restaurant"], "indo chinese chinese noodles", true, 2, 4.1, 1600, "late", 1.0, 270],
  // Mainly meat or fish (never for vegetarians; meat never for pescatarians).
  ["Kebab Kingdom", "restaurant", ["food"], "kebab grill middle eastern", true, 2, 4.4, 2100, "late", 1.4, 320],
  ["Smoke House Steaks", "steak_house", ["restaurant"], "steak grill", true, 4, 4.5, 1700, "eve", 2.0, 90],
  ["Coastal Catch", "seafood_restaurant", ["restaurant"], "seafood fish curry", false, 3, 4.6, 2500, "eve", 2.2, 0],
  ["Wings & Things", "chicken_wings_restaurant", ["restaurant"], "chicken wings burgers", false, 2, 4.1, 900, "late", 1.5, 110],
  ["Pork & Pickle", "restaurant", ["food"], "pork belly northeast", false, 2, 4.4, 500, "eve", 2.3, 205],
  // Cafés, bakeries, fine dining.
  ["Quiet Pages Cafe", "cafe", ["coffee_shop"], "quiet book cafe reading", true, 2, 4.6, 600, "eve", 0.7, 45],
  ["Brew Lab", "coffee_shop", ["cafe"], "coffee specialty", true, 2, 4.5, 1400, "lunch", 0.5, 135],
  ["Crumb Bakery", "bakery", ["cafe"], "bakery desserts cakes", true, 2, 4.5, 1100, "eve", 1.2, 225],
  ["Sugar Spoon", "dessert_shop", ["food"], "dessert ice cream", true, 1, 4.3, 700, "late", 1.9, 315],
  ["Green Bowl Co", "salad_shop", ["restaurant"], "healthy bowls salads", true, 2, 4.4, 500, "eve", 1.1, 5],
  ["The Gilded Fork", "fine_dining_restaurant", ["restaurant"], "fine dining tasting menu upscale", true, 4, 4.7, 900, "eve", 2.6, 75],
  // Bars (some are the thing to do: karaoke, rooftops, hidden bars, jazz).
  ["Copper Tap Brewery", "brewery", ["bar", "restaurant"], "brewery craft beer lively", true, 3, 4.4, 6000, "late", 1.3, 155],
  ["The Hidden Door", "cocktail_bar", ["bar"], "speakeasy hidden cocktail", true, 3, 4.6, 800, "late", 1.7, 245],
  ["Skyline Rooftop", "bar", ["restaurant"], "rooftop lounge cocktails view", true, 3, 4.4, 2400, "late", 2.4, 25],
  ["Terrace Twelve", "restaurant", ["food"], "rooftop restaurant terrace", true, 2, 4.3, 700, "eve", 2.9, 335],
  ["Mic Drop Karaoke", "bar", ["night_club"], "karaoke bar singing", true, 2, 4.2, 450, "late", 2.1, 185],
  ["Dice & Dine", "cafe", ["restaurant"], "board game cafe games", true, 2, 4.5, 650, "eve", 1.6, 95],
  ["Blue Note Lounge", "bar", ["live_music_venue"], "live music jazz bar", true, 3, 4.5, 1200, "late", 2.0, 275],
  ["Laugh Lab", "comedy_club", ["bar"], "stand-up comedy club comedy show", true, 2, 4.6, 900, "late", 2.5, 125],
  // Things to do.
  ["City Art Gallery", "art_gallery", ["point_of_interest"], "art gallery exhibition", null, 0, 4.6, 3000, "day", 2.0, 15],
  ["Museum of Science", "museum", ["point_of_interest"], "museum science", null, 2, 4.5, 9000, "day", 3.0, 65],
  ["Cubbon Green Park", "park", ["point_of_interest"], "park nature walk garden", null, 0, 4.6, 40000, "day", 1.0, 115],
  ["Smash Pickleball", "sports_complex", ["point_of_interest"], "pickleball court sports", null, 2, 4.5, 300, "eve", 2.2, 175],
  ["Shuttle Arena", "sports_club", ["point_of_interest"], "badminton court sports", null, 2, 4.4, 500, "eve", 2.7, 210],
  ["Strike Bowling", "bowling_alley", ["point_of_interest"], "bowling alley games", null, 2, 4.2, 2000, "late", 3.3, 240],
  ["Clay Studio", "art_studio", ["point_of_interest"], "pottery workshop art workshop", null, 2, 4.8, 250, "weekday", 1.9, 285],
  ["Salsa Social", "dance_school", ["point_of_interest"], "salsa night dance class", null, 2, 4.6, 300, "eve", 2.3, 305],
  ["Pulse Club", "night_club", ["bar"], "nightclub dj dance club", null, 3, 4.0, 2200, "late", 2.6, 325],
  ["Sunday Flea Market", "market", ["point_of_interest"], "flea market night market", null, 0, 4.3, 1500, "day", 3.5, 355],
  ["Escape Room HQ", "escape_room", ["point_of_interest"], "escape room games group activity", null, 2, 4.7, 800, "eve", 1.8, 195],
  ["City Playhouse", "performing_arts_theater", ["point_of_interest"], "theatre plays concert hall", null, 3, 4.5, 2500, "eve", 2.8, 85],
  // Sights and a breakfast place, for day plans.
  ["Sunset Beach", "beach", ["tourist_attraction", "natural_feature"], "beach waterfront sunset nature park", null, 0, 4.6, 20000, "day", 3.0, 45],
  ["Old Fort Heritage Walk", "historical_landmark", ["tourist_attraction"], "heritage historic fort museum top tourist attractions", null, 0, 4.5, 6000, "day", 2.5, 100],
  ["Spice Market Street", "market", ["tourist_attraction"], "local spice market tourist attractions", null, 0, 4.4, 3000, "day", 2.0, 160],
  ["Morning Dosa House", "breakfast_restaurant", ["restaurant"], "breakfast dosa local famous food", true, 1, 4.5, 800, "lunch", 1.0, 20],
  // Far away (beyond 5 km), to test distance.
  ["Far Thai Garden", "thai_restaurant", ["restaurant"], "thai", true, 2, 4.8, 900, "eve", 9.0, 60],
  ["Lakeside Karaoke", "bar", [], "karaoke bar", true, 2, 4.7, 600, "late", 11.0, 200],
  // Poorly known (live run, 18 Nov 2026): a badly rated dessert shop, and an
  // address with 2 reviews that a workshop search finds.
  ["Sad Sweets", "dessert_shop", ["bakery", "cafe"], "bakery desserts cakes", true, 1, 1.8, 120, "eve", 0.3, 10],
  ["257, Lakshmi Nilaya", "point_of_interest", ["establishment"], "art workshop pottery", null, 0, 5.0, 2, "day", 0.4, 30],
];

const HOTELS = ["Hotel Sakura (test hotel)", "Riverside Inn (test hotel)", "Old Town Suites (test hotel)"];

const HOURS: Record<Hours, { days: number[]; open: number; close: number }> = {
  eve: { days: [0, 1, 2, 3, 4, 5, 6], open: 12, close: 23 },
  late: { days: [0, 1, 2, 3, 4, 5, 6], open: 18, close: 26 },
  day: { days: [0, 1, 2, 3, 4, 5, 6], open: 9, close: 18 },
  lunch: { days: [0, 1, 2, 3, 4, 5, 6], open: 8, close: 16 },
  weekday: { days: [1, 2, 3, 4, 5], open: 12, close: 23 },
};

const PRICE = ["", "PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"];
const FOODISH = /restaurant|cafe|coffee|bakery|bar|pub|brewery|dessert|salad|food/;

// Everything about a fake place is in its ID, so details can rebuild it.
function make(lat: number, lng: number, n: number): Place {
  const i = n % CATALOGUE.length;
  const [name, type, types, , veg, price, rating, count, hours, km, bearing] = CATALOGUE[i];
  const h = HOURS[hours];
  const rad = (bearing * Math.PI) / 180;
  const late = hours !== "day" && hours !== "lunch";
  return {
    id: `fake_${lat.toFixed(4)}_${lng.toFixed(4)}_${i}_c`,
    displayName: { text: name },
    primaryType: type,
    types: [type, ...types, FOODISH.test(type) ? "food" : "point_of_interest"],
    location: { latitude: lat + (km * Math.cos(rad)) / 111, longitude: lng + (km * Math.sin(rad)) / (111 * Math.cos((lat * Math.PI) / 180)) },
    ...(price ? { priceLevel: PRICE[price] } : {}),
    rating,
    userRatingCount: count,
    currentOpeningHours: { openNow: late, nextCloseTime: new Date(Date.now() + 4 * 3600 * 1000).toISOString() },
    regularOpeningHours: {
      periods: h.days.map((day) => ({ open: { day, hour: h.open, minute: 0 }, close: { day: h.close >= 24 ? (day + 1) % 7 : day, hour: h.close % 24, minute: 0 } })),
    },
    businessStatus: "OPERATIONAL",
    ...(veg === null ? {} : { servesVegetarianFood: veg }),
    addressComponents: [{ longText: "Test Area", types: ["sublocality_level_1"] }],
    googleMapsUri: "https://www.google.com/maps",
    photos: [],
  };
}

const STOP = new Set(["the", "a", "or", "and", "with", "near", "place", "food", "restaurant", "bar", "cafe", "venue", "one", "small", "local", "favourite", "famous", "dish", "good", "for", "things", "to", "do", "night", "show", "class", "court", "in", "of", "somewhere", "my"]);

function tokens(q: string) {
  return q.toLowerCase().split(/[^a-z]+/).filter((w) => w && !STOP.has(w));
}

// A text search: places whose name, type or tags share words with the query,
// best first; a query with no telling words finds what's popular.
export function fakeSearch(lat: number, lng: number, query: string, food: boolean): Place[] {
  if (/\b(hotels?|inns?|ryokan|stays?)\b/i.test(query)) {
    return HOTELS.map((name, i) => ({ ...make(lat, lng, i), id: `fake_${lat.toFixed(4)}_${lng.toFixed(4)}_${i}_h`, displayName: { text: name }, primaryType: "hotel", types: ["hotel", "lodging"] }));
  }
  const words = tokens(query);
  const scored = CATALOGUE.map((row, i) => {
    const hay = `${row[0]} ${row[1]} ${row[2].join(" ")} ${row[3]}`.toLowerCase().replace(/_/g, " ").split(/[^a-z]+/);
    const score = words.length ? words.filter((w) => hay.some((h) => h.startsWith(w))).length : FOODISH.test(row[1]) === food ? 1 : 0;
    return { i, score, count: row[7] };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score || b.count - a.count);
  return scored.slice(0, 20).map((s) => make(lat, lng, s.i));
}

// A nearby search by type: every place of those types, most popular first.
export function fakeNearby(lat: number, lng: number, types: string[]): Place[] {
  return CATALOGUE.map((row, i) => ({ row, i }))
    .filter(({ row }) => [row[1], ...row[2]].some((t) => types.includes(t)))
    .sort((a, b) => b.row[7] - a.row[7])
    .slice(0, 20)
    .map(({ i }) => make(lat, lng, i));
}

export function fakeDetails(id: string): Place | null {
  const m = /^fake_(-?[\d.]+)_(-?[\d.]+)_(\d+)_([a-z])$/.exec(id);
  if (!m) return null;
  if (m[4] === "h") return fakeSearch(Number(m[1]), Number(m[2]), "hotel", false)[Number(m[3]) % HOTELS.length];
  return make(Number(m[1]), Number(m[2]), Number(m[3]));
}

// Gemini's place in test mode: places for what they asked for first, then
// by stars, with the reason taken from what it matched.
export function fakeRank(candidates: Candidate[], wanted: Intent[]): Ranked[] {
  const ids = wanted.map((w) => w.id);
  return candidates
    .map((c, index) => {
      const serves = (c.intents ?? []).filter((id) => ids.includes(id));
      const score = (serves.length ? 3 : 0) + (c.place.rating ?? 4) - ((c.place.userRatingCount ?? 0) >= 3000 ? 0.3 : 0);
      const first = wanted.find((w) => serves.includes(w.id));
      return { index, score, serves, because: first?.reason ?? "" };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)
    .map(({ index, serves, because }) => ({ index, verdict: "Good if you're nearby" as const, because, serves }));
}
