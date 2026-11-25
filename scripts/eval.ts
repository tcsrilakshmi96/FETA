// The quality check (founder, 15 Nov 2026: "personalised suggestion is the
// product"). Runs realistic profiles through the same curation steps as the
// app (lib/server/curate.ts) against made-up places (test mode, ₹0) and
// checks that the picks match what each person chose and never break a
// hard rule. Every change to picks must pass: npm run eval.
//
// Live mode (EVAL_LIVE=1) runs the same profiles on real Google and Gemini
// for a final check before release (about ₹50; ask the founder first). In
// live mode the expectations that name test places are skipped.

import { asksQuestion, plainReply, withDinner } from "@/lib/ask-rules";
import { buildItinerary } from "@/lib/server/itinerary";
import { hotelBudgets } from "@/lib/trip-client";
import { EMPTY_ANSWERS, QUESTIONS, type Answers } from "@/lib/onboarding";
import { CUISINE_SEARCH, INTEREST_SEARCH, SIDE_SEARCH } from "@/lib/server/catalog";
import { searchCities } from "@/lib/server/cities";
import { becauseFor, curate, eventsFirst, KIND_MAX, namedPlace, pickFrom, selectPicks } from "@/lib/server/curate";
import { cityCalendar, eventOver, eventPasses, landsOnSame, searchChip } from "@/lib/server/events";
import { allIntents, type Intent } from "@/lib/server/intents";
import { applyHardFilters, rulesBroken, dietOk, mainlyAvoided, notANightOut, distanceLimitKm, TRIP_OUT_KM, kindOf, mainlyMeat, mainlyNonVeg, popularCap, POPULAR_REVIEWS, weeklyHours, openTonight, type Candidate, type Category, type Pick, type Taste, type Tweak, type When } from "@/lib/server/picks";
import { planEvenings } from "@/lib/plan";
import { planNight, roomForOne, type NightPlace } from "@/lib/night-plan";
import { CATALOGUE, fakeDetails } from "@/lib/server/fake-places";
import { inSentence, plainRead, readTaste } from "@/lib/server/taste-reader";
import { tasteFingerprint } from "@/lib/server/taste";
import { cuisinesFor, swipeCards } from "@/lib/swipes";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { anonDb, LimitReached, paidFetch, withCosts } from "@/lib/server/costs";
import { brandPrice, lookProblem, pieceLink, shopLink } from "@/lib/style";
import { guessSearch, piecesMatch } from "@/lib/search";
import { readSpots } from "@/lib/server/style";
import { listFit, listServes, TAG_IDS, vibeClash, vibeOf } from "@/lib/server/list-tags";
import { featuredToCheck } from "@/lib/server/engine";
import { leftNotice, limitNotice, resetTime } from "@/lib/limits";
import { scopeCounts, todayScope } from "@/lib/profile-scope";
import { shareSafe } from "@/lib/share-safe";
import { trustedEventLink } from "@/lib/event-links";
import { OUT, schemaJson } from "./schema";

const LIVE = process.env.EVAL_LIVE === "1";

type Persona = {
  name: string;
  city: string;
  category: Category;
  when?: When;
  searchedBefore?: string[][]; // what their recent sets searched, newest first
  answers: Partial<Answers>;
  yes?: string[];
  lines?: string[];
  loved?: string[]; // places they love, as Feta describes them
  tweaks?: Tweak[];
  notInto?: string[]; // Google types skipped as "Not into …"
  note?: string;
  dayPlan?: boolean;
  // Expectations.
  covers?: string[]; // intent ids that must be among the 8
  half?: boolean; // at least half of the 8 are for what they chose
  never?: RegExp; // test place names that must never show
  some?: RegExp; // at least one of these test places must show
  rule?: (name: string, primary: string) => string | null; // a hard rule, checked live too
  min?: number; // at least this many picks
  most?: Record<string, number>; // at most this many picks for one intent
  founder?: RegExp; // test places that are the founder's
  founderMin?: number; // at least this many of them show (the ones that fit come before Google's)
  local?: RegExp; // test places that are local favourites
  localMin?: number; // at least this many of them show
  fromLists?: string[]; // choices Feta's lists already serve, so not searched on Google
  featured?: RegExp; // test places a city guide features
  featuredMin?: number;
};

const base: Answers = { ...EMPTY_ANSWERS, distance: "ride_5km", spend: ["level_2", "level_3"], drinks: "sometimes" };
const noBar = (_: string, primary: string) => (/^(bar|pub|night_club|wine_bar|cocktail_bar|brewery)$/.test(primary) ? "a bar for someone who doesn't drink" : null);

const PERSONAS: Persona[] = [
  {
    name: "Founder: vegetarian in Bengaluru, loves Thai and Korean, typed SE Asian",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_thai", "cuisine_korean", "hole_in_wall"],
    lines: ["Also loves SE Asian"],
    covers: ["cuisine_thai", "cuisine_korean", "said_0"],
    half: true,
    never: /Gangnam BBQ|Kebab|Biryani|Smoke House|Coastal Catch|Wings|Pork/,
    some: /Lemongrass|Seoul Kitchen|Pho Saigon|Burma Lane/,
    rule: (n) => (/bbq|barbecue|kebab|biryani|steak|chicken|mutton|seafood|fish/i.test(n) ? "mainly meat or fish for a vegetarian" : null),
  },
  {
    // Founder, 21 Nov 2026: out with Feta, it showed a Taco Bell. A global
    // fast-food chain only when it's the only option.
    name: "Mexican tonight: Casa Taco, never a fast-food chain",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything" },
    note: "mexican",
    never: /Taco Bell/,
    some: /Casa Taco/,
  },
  {
    // Founder, 23 Nov 2026: her places show only when they're for something
    // the person chose ("why is a sports bar fitting a vegetarian?").
    name: "Curated layer: the founder's places for what they chose come first, and only those",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_thai", "cuisine_korean"],
    founder: /Go Native|Element Sattvik|Coastal Thali|Tiffin Roastery|Slice Theory|Seoul Kitchen|Gangnam BBQ/,
    covers: ["cuisine_thai", "cuisine_korean"],
    founderMin: 1, // Seoul Kitchen: Korean
    never: /Gangnam BBQ|Go Native|Element Sattvik|Coastal Thali|Tiffin Roastery|Slice Theory/, // meat-led, or nothing they chose
  },
  {
    name: "Lists first: Thai her lists already serve isn't searched on Google",
    answers: { spend: ["depends"] },
    city: "Bengaluru",
    category: "food_drinks",
    yes: ["cuisine_thai", "cuisine_korean"],
    local: /Lemongrass Thai Kitchen|Baan Siam/,
    localMin: 2,
    fromLists: ["cuisine_thai"],
    covers: ["cuisine_thai", "cuisine_korean"],
  },
  {
    name: "Local favourites that fit come before Google's",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_south_indian", "cuisine_italian", "cuisine_indo_chinese"],
    local: /Tiffin Roastery|Slice Theory|Brahmin Tiffin|Wok This Way/,
    localMin: 3,
    covers: ["cuisine_south_indian", "cuisine_italian", "cuisine_indo_chinese"],
  },
  {
    name: "Places a city guide features that fit come before Google's",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_south_indian", "cuisine_italian", "cuisine_indo_chinese"],
    featured: /Tiffin Roastery|Slice Theory|Brahmin Tiffin|Wok This Way/,
    featuredMin: 3,
    covers: ["cuisine_south_indian", "cuisine_italian", "cuisine_indo_chinese"],
  },
  {
    name: "Founder: 4 cuisines ticked and loves cafes: the cafes still shape the first set",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_thai", "cuisine_korean", "cuisine_italian", "cuisine_south_indian"],
    loved: ["Third Wave Coffee (coffee shop, mid-priced, ★4.5)", "Dyu Art Cafe (cafe, mid-priced, ★4.6)"],
    covers: ["cuisine_thai", "loved_0"],
    half: true,
    some: /Brew Lab|Quiet Pages|Tiffin Roastery/,
  },
  {
    // Founder, 19 Nov 2026: "i only wanna go somewhere in 5km" and got
    // places 10 km away "worth a short ride". Within 1 km, few fit: a short
    // list, never further.
    name: "Distance is a limit: within 1 km stays within 1 km, even when few fit",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything", distance: "closer_1km" },
    yes: ["cuisine_thai", "cuisine_korean"],
  },
  {
    // Founder, 19 Nov 2026: "if the choices in You are changed, is it
    // impacting the choices given?" Six cuisines, the first four searched
    // in the last set, then Korean turned on in You: Korean comes now.
    name: "A cuisine just turned on in You is searched in the very next set",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything" },
    yes: ["cuisine_south_indian", "cuisine_italian", "cuisine_north_indian", "cuisine_thai", "cuisine_mexican", "cuisine_korean"],
    searchedBefore: [["cuisine_south_indian", "cuisine_italian", "cuisine_north_indian", "cuisine_thai"]],
    covers: ["cuisine_korean", "cuisine_mexican"],
  },
  {
    // Founder's own test, 19 Nov 2026: she ticked only ₹1,500–3,000, the
    // bottom of the range dropped every cheaper veg place and left bars.
    name: "Spend: only a pricey level ticked still shows great cheaper places (the top is the limit)",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian", spend: ["level_4"] },
    yes: ["cuisine_south_indian"],
    covers: ["cuisine_south_indian"],
    some: /Tiffin Roastery|Vidyarthi Corner|Brahmin Tiffin Room/,
  },
  {
    name: "Vegetarian in London, Thai: strict abroad (no 'not sure' places)",
    city: "London",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_thai"],
    covers: ["cuisine_thai"],
    never: /Lemongrass|Seoul Kitchen|Chettinad/,
    some: /Baan Siam|Thai Basil|Pho Saigon/,
  },
  {
    name: "Pescatarian in London, Japanese and Middle Eastern",
    city: "London",
    category: "food_drinks",
    answers: { diet: "pescatarian" },
    yes: ["cuisine_japanese", "cuisine_middle_eastern"],
    covers: ["cuisine_japanese", "cuisine_middle_eastern"],
    never: /Smoke House|Wings|Kebab|Pork|Biryani|Gangnam/,
    rule: (n, p) => (/steak|barbecue|chicken|burger/.test(p) || /steak|bbq|kebab|chicken|burger|pork|beef/i.test(n) ? "meat for a pescatarian" : null),
  },
  {
    name: "Italian lover, eats everything: Italian leads but not 8 of 8",
    city: "London",
    category: "food_drinks",
    answers: { diet: "everything" },
    yes: ["cuisine_italian"],
    covers: ["cuisine_italian"],
    half: true,
  },
  {
    name: "Four cuisines: each gets a spot",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything" },
    yes: ["cuisine_mexican", "cuisine_japanese", "cuisine_bakery", "cuisine_indo_chinese"],
    covers: ["cuisine_mexican", "cuisine_japanese", "cuisine_bakery", "cuisine_indo_chinese"],
    half: true,
  },
  {
    name: "Small budget: nothing pricey",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything", spend: ["level_1"] },
    yes: ["dressed_up"],
    never: /Gilded Fork|Smoke House|Baan Siam|Sakura|Skyline/,
  },
  {
    // Founder, 19 Nov 2026: bars belong in Food & drinks, never Things to do;
    // karaoke nights come as events.
    name: "Things to do: karaoke, rooftops, board games, sports (no bars)",
    city: "Bengaluru",
    category: "experiences",
    answers: { interests: ["karaoke", "rooftops", "board_games", "games_sports"], drinks: "love_bars" },
    covers: ["interest_board_games", "interest_games_sports"],
    half: true,
    never: /Mic Drop|Lakeside Karaoke|Skyline Rooftop/,
    rule: noBar,
  },
  {
    name: "Food & drinks: into hidden bars and rooftops, so they're searched here",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything", interests: ["hidden_bars", "rooftops"], drinks: "love_bars", spend: ["level_3", "level_4"] },
    yes: ["cuisine_italian"],
    covers: ["interest_hidden_bars", "interest_rooftops", "cuisine_italian"],
    some: /The Hidden Door/,
  },
  {
    name: "Things to do, no alcohol: rooftops and comedy, no bars",
    city: "Bengaluru",
    category: "experiences",
    answers: { interests: ["rooftops", "comedy", "hidden_bars", "nightlife"], drinks: "no_alcohol" },
    covers: ["interest_comedy"],
    never: /Hidden Door|Pulse Club|Skyline|Copper Tap/,
    rule: noBar,
  },
  {
    name: "Things to do: loves a pottery studio and a comedy club, one interest (loved places shape to-do too)",
    city: "Bengaluru",
    category: "experiences",
    when: "weekend",
    answers: { interests: ["outdoors"] },
    loved: ["Clay Studio (art studio, ★4.8)", "Laugh Lab (comedy club, ★4.6)"],
    covers: ["interest_outdoors", "loved_0", "loved_1"],
  },
  {
    name: "Quality: never a badly rated place or one with almost no reviews",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything" },
    yes: ["cuisine_bakery"],
    covers: ["cuisine_bakery"],
    never: /Sad Sweets/,
  },
  {
    name: "Quality, things to do: an address with 2 reviews is not a workshop",
    city: "Bengaluru",
    category: "experiences",
    when: "weekend",
    answers: { interests: ["workshops"] },
    never: /Lakshmi Nilaya/,
  },
  {
    // Founder, 19 Nov 2026: no filler once they've shared anything; events
    // for what they're into lead things to do in the app.
    name: "Things to do, one interest: only what fits, nothing merely popular nearby",
    city: "Bengaluru",
    category: "experiences",
    when: "weekend",
    answers: { interests: ["art_culture"] },
    covers: ["interest_art_culture"],
    never: /Strike Bowling|Escape Room|Mic Drop|Sunday Flea/,
  },
  {
    // Ask Feta test, 19 Nov 2026: live music brought a brewery as a thing to do.
    name: "Things to do, into live music: music venues, never a brewery or bar",
    city: "Bengaluru",
    category: "experiences",
    answers: { interests: ["live_music"], drinks: "love_bars" },
    never: /Copper Tap|Blue Note/,
    rule: noBar,
  },
  {
    // Founder's test, 19 Nov 2026: into karaoke and stand-up, things to do
    // tonight came back as bars.
    name: "Bengaluru tonight, into karaoke and stand-up: karaoke and comedy, no random bars",
    city: "Bengaluru",
    category: "experiences",
    answers: { interests: ["karaoke", "comedy"] },
    covers: ["interest_comedy"],
    never: /Blue Note|Skyline Rooftop|Dice & Dine|Mic Drop|Copper Tap/,
    rule: noBar,
  },
  {
    name: "Things to do, nothing chosen, tonight: evening things, not closed galleries or restaurants",
    city: "Bengaluru",
    category: "experiences",
    answers: {},
    min: 3,
    never: /Tiffin|Vidyarthi|Dosa/,
  },
  {
    name: "Nothing chosen yet: still 8 good places",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything" },
    min: 8,
  },
  {
    name: "Typed in You: into pickleball and stand-up (weekend)",
    city: "Bengaluru",
    category: "experiences",
    when: "weekend",
    answers: { interests: ["art_culture"] },
    lines: ["Into pickleball", "Loves stand-up comedy nights"],
    covers: ["interest_art_culture", "said_0", "said_1"],
    some: /Smash Pickleball/,
  },
  {
    // Round 6: pottery took 5 of 8 and tea 4 of 8; no one thing passes 3
    // when they chose more than one.
    name: "Variety: Thai and Korean lover gets at most 3 Thai",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "everything" },
    yes: ["cuisine_thai", "cuisine_korean"],
    covers: ["cuisine_thai", "cuisine_korean"],
    most: { cuisine_thai: 3, cuisine_korean: 3 },
  },
  {
    // Founder, 21 Nov 2026: "never pottery, horse riding or cooking class".
    name: "Try something new: pottery and horse riding, chosen inside their groups",
    city: "Bengaluru",
    category: "experiences",
    when: "weekend",
    answers: { interests: ["workshops", "class_pottery", "adventures", "adv_riding"] },
    covers: ["interest_class_pottery", "interest_adv_riding"],
    some: /Wheel and Kiln/,
  },
  {
    // Founder, 21 Nov 2026: hikes and adventures may be a trip out, saying so.
    name: "Horse riding at the weekend may be a trip out; nothing else may",
    city: "Bengaluru",
    category: "experiences",
    when: "weekend",
    answers: { interests: ["adventures", "adv_riding", "art_culture"] },
    covers: ["interest_adv_riding"],
    some: /Ridge Trail Stables/,
  },
  {
    name: "Horse riding tonight stays within their distance",
    city: "Bengaluru",
    category: "experiences",
    answers: { interests: ["adventures", "adv_riding"] },
    never: /Ridge Trail Stables/,
  },
  {
    name: "Day plan (Calicut-style trip day): sights, not only evening places",
    city: "Bengaluru",
    category: "experiences",
    answers: { interests: ["live_music"] },
    note: "beach and local culture",
    dayPlan: true,
    covers: ["plan_sights", "plan_heritage", "plan_outdoors"],
    some: /Sunset Beach|Old Fort/,
  },
  {
    name: "Day plan food: breakfast and local food as well as favourites",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_thai"],
    dayPlan: true,
    covers: ["plan_breakfast", "plan_local", "cuisine_thai"],
    some: /Morning Dosa House/,
  },
  {
    // Persona test, 23 Nov 2026: a vegetarian in Bengaluru chose South
    // Indian, Japanese, Korean and bakeries and typed Burmese, and got 8
    // bakeries in a row from the local favourites; South Indian and Korean
    // never showed and no banner said so.
    name: "Bengaluru vegetarian, five choices, local favourites mostly bakeries: every choice, bakeries a few",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_south_indian", "cuisine_japanese", "cuisine_korean", "cuisine_bakery"],
    lines: ["Also loves Burmese"],
    local: /Glen's|Lavonne|CakeBox|Corner House|Daily Crumbs|Sweet Chariot|Crumb Bakery|Sugar Spoon/,
    covers: ["cuisine_south_indian", "cuisine_japanese", "cuisine_korean", "cuisine_bakery", "said_0"],
    most: { cuisine_bakery: 2 },
    half: true,
  },
  {
    // Core rule audit, 23 Nov 2026: no alcohol drops bars in Food & drinks too.
    name: "Doesn't drink, Italian tonight: no bar, pub or brewery",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { drinks: "no_alcohol" },
    yes: ["cuisine_italian"],
    covers: ["cuisine_italian"],
    rule: noBar,
  },
  {
    // "Not into Thai restaurants" from a skip: never one again.
    name: "Skipped as not into Thai: no Thai place comes back",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_korean", "cuisine_italian"],
    notInto: ["thai_restaurant"],
    never: /Thai/,
  },
  {
    // Founder's test, 23 Nov 2026: someone who hadn't shared anything yet got
    // "Rhythm Riders Band for Hire" as a thing to do on Home.
    name: "Shared nothing yet, things to do: no band for hire or office",
    city: "Bengaluru",
    category: "experiences",
    answers: {},
    never: /Band for Hire/,
  },
  {
    // Persona test, 23 Nov 2026: a vegetarian traveller in Lisbon got fine
    // dining and meat-heavy places. Google says most Portuguese places serve
    // vegetarian food; their names (churrasqueira, marisqueira, bacalhau,
    // bifanas) say they're about meat or fish. Fine dining with no price on
    // Google is still above a mid-range budget.
    name: "Vegetarian traveller in Lisbon, local food: no churrasqueira or bacalhau, no fine dining over budget",
    city: "Lisbon",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_local", "cuisine_italian", "dressed_up"],
    covers: ["cuisine_local", "cuisine_italian"],
    never: /Churrasqueira|Marisqueira|Bacalhau|Bifanas|Alma Atelier|Gilded Fork/,
    some: /Jardim Verde/,
  },
  {
    name: "Asked in chat: rooftop dinner",
    city: "Bengaluru",
    category: "food_drinks",
    answers: { diet: "vegetarian" },
    yes: ["cuisine_south_indian"],
    note: "rooftop dinner",
    covers: ["asked", "cuisine_south_indian"],
    some: /Terrace Twelve|Skyline/,
  },
];

// Plan my evening (persona test, 23 Nov 2026: a bakery as dinner, a café
// as "something to do", a band for hire as a venue, tour companies'
// offices at 10 pm): plans built from a vegetarian's picks (South Indian
// and bakeries; live music, comedy and art), as the phone builds them.
const PLAN_FOOD: Persona = {
  name: "plan food",
  city: "Bengaluru",
  category: "food_drinks",
  answers: { diet: "vegetarian" },
  yes: ["cuisine_bakery", "cuisine_south_indian", "quiet_cafe"],
  local: /Glen's|Lavonne|CakeBox|Corner House|Daily Crumbs|Sweet Chariot|Crumb Bakery|Sugar Spoon/,
};
const PLAN_DO: Persona = { name: "plan do", city: "Bengaluru", category: "experiences", answers: { interests: ["live_music", "comedy", "art_culture"] }, yes: ["unwind"] };
const MEAL_TYPES = /restaurant$/;
const OFFICE = /agency|planner|office|consultant/;

async function planCheck() {
  const picksFor = async (p: Persona): Promise<Pick[]> => {
    const r = await run(p);
    return r.shown.map(({ candidate: c, ranked }) => ({
      placeId: c.place.id,
      kind: kindOf(c.place, p.category),
      verdict: ranked?.verdict ?? "Good if you're nearby",
      because: "",
      ...(c.intents?.length ? { serves: c.intents } : {}),
      name: c.place.displayName?.text ?? "?",
      area: "",
      distanceKm: c.km,
      chips: [],
      googleLine: "",
      mapsUri: "",
      directionsUri: "",
      book: null,
      photo: null,
      type: c.place.primaryType,
      lat: c.place.location?.latitude,
      lng: c.place.location?.longitude,
      hours: weeklyHours(c.place),
    }));
  };
  const [food, doing] = await Promise.all([picksFor(PLAN_FOOD), picksFor(PLAN_DO)]);
  // A Friday at 5 pm on the phone's clock.
  const plans = planEvenings(food as never, doing as never, "tonight", new Date(2026, 10, 27, 17, 0));
  const fails: string[] = [];
  if (!plans.length) fails.push("no plan at all");
  for (const plan of plans) {
    const [a, b] = plan.stops.map((s) => s.pick as unknown as Pick);
    const dinner = [a, b].find((s) => s.kind === "EAT");
    if (dinner && !MEAL_TYPES.test(dinner.type ?? "")) fails.push(`${dinner.name} (${dinner.type}) as dinner`);
    for (const s of [a, b]) {
      if (s.kind === "DO" && !s.type) fails.push(`${s.name}: no Google type, not a place to go`);
      if (s.kind === "DO" && OFFICE.test(s.type ?? "")) fails.push(`${s.name}: an office as something to do`);
      if (s.kind === "DO" && /cafe|coffee|bakery|restaurant/.test(s.type ?? "") && !(s.serves ?? []).some((id) => !id.startsWith("side_"))) fails.push(`${s.name}: a café as something to do`);
    }
  }
  const lines = plans.map((p) => p.stops.map((s) => `${s.time.getHours()}:${String(s.time.getMinutes()).padStart(2, "0")} ${s.pick.name} [${s.pick.kind} ${(s.pick as unknown as Pick).type}]`).join(" → "));
  return { fails, lines };
}

// A time zone where it's this hour now, so a check doesn't depend on when
// the eval runs (25 Nov 2026: at 9:40 am in Bengaluru, "Today" rightly left
// out bars that open at 6, and four evening personas failed).
function zoneAt(hour: number) {
  const off = ((hour - new Date().getUTCHours() + 36) % 24) - 12; // -12..11
  return off === 0 ? "UTC" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
}

async function run(p: Persona) {
  // The personas are written for the evening: their city at 8 pm.
  const city = { ...searchCities(p.city, 1)[0], timeZone: zoneAt(20) };
  const taste: Taste = {
    answers: { ...base, ...p.answers },
    lines: p.lines ?? [],
    own: p.lines ?? [],
    yes: p.yes ?? [],
    no: [],
    lovedPlaces: p.loved,
    ...(p.notInto ? { notInto: p.notInto } : {}),
  };
  const extra = await readTaste(taste, city, p.category);
  const found = await curate({
    taste,
    city,
    origin: { lat: city.lat, lng: city.lng },
    category: p.category,
    when: p.when ?? "tonight",
    tweaks: p.tweaks ?? [],
    note: p.note,
    exclude: new Set(),
    needsDiet: p.category === "food_drinks" && ["vegetarian", "vegetarian_eggs", "jain", "vegan"].includes(p.answers.diet ?? ""),
    need: 8,
    rotation: 0,
    searchedBefore: p.searchedBefore,
    extra,
    dayPlan: p.dayPlan,
    // Feta's lists in test mode: the made-up places the persona names are
    // "on a list", checked against the same hard filters before any search.
    favourites:
      p.founder || p.local || p.featured
        ? async () => {
            const label = (c: Candidate): Candidate | null => {
              const name = c.place.displayName?.text ?? "";
              return p.founder?.test(name)
                ? { ...c, fetaNote: "test" }
                : p.local?.test(name)
                  ? { ...c, local: true }
                  : p.featured?.test(name)
                    ? { ...c, featured: { guide: "Time Out", url: "https://www.timeout.com/test", searchHtml: "" } }
                    : null;
            };
            const onList = CATALOGUE.map((row, i) => [row[0], i] as const)
              .filter(([name]) => p.founder?.test(name) || p.local?.test(name) || p.featured?.test(name))
              .map(([, i]) => fakeDetails(`fake_${city.lat.toFixed(4)}_${city.lng.toFixed(4)}_${i}_c`)!);
            const passed = applyHardFilters(onList, { taste, category: p.category, when: p.when ?? "tonight", origin: { lat: city.lat, lng: city.lng }, exclude: new Set(), city });
            return { looked: passed.map((c) => label(c)!), mark: label };
          }
        : undefined,
  });
  const picked = pickFrom(found, { room: 8, small: false, popularCap: popularCap(taste) });
  const shown = picked.chosen.slice(0, picked.shown);
  const fails: string[] = [];
  const names = shown.map((c) => c.candidate.place.displayName?.text ?? "?");
  const covered = new Set(shown.flatMap((c) => c.candidate.intents ?? []));
  for (const id of p.covers ?? []) if (!covered.has(id)) fails.push(`nothing for ${id}`);
  const explicit = found.intents.filter((i) => i.explicit).map((i) => i.id);
  const isFor = (c: { intents?: string[] }) => (c.intents ?? []).some((id) => explicit.includes(id));
  const forChoices = shown.filter((c) => isFor(c.candidate)).length;
  // Half, or every one that passed the hard filters if there were fewer.
  const available = found.pool.filter(isFor).length;
  if (p.half && forChoices < Math.min(Math.ceil(shown.length / 2), available)) fails.push(`only ${forChoices} of ${shown.length} are for what they chose (${available} passed)`);
  if (!LIVE && p.never) for (const n of names) if (p.never.test(n)) fails.push(`showed ${n}`);
  if (!LIVE && p.some && !names.some((n) => p.some!.test(n))) fails.push(`none of ${p.some.source}`);
  if (p.min && shown.length < p.min) fails.push(`only ${shown.length} picks`);
  for (const [id, n] of Object.entries(p.most ?? {})) {
    const count = shown.filter((c) => c.candidate.intents?.includes(id)).length;
    if (count > n) fails.push(`${count} picks for ${id}, more than ${n}`);
  }
  for (const c of shown) {
    const why = p.rule?.(c.candidate.place.displayName?.text ?? "", c.candidate.place.primaryType ?? "");
    if (why) fails.push(`${c.candidate.place.displayName?.text}: ${why}`);
    if (taste.answers.diet === "vegetarian" && p.category === "food_drinks" && mainlyNonVeg(c.candidate.place)) fails.push(`${c.candidate.place.displayName?.text}: mainly meat or fish`);
    if (taste.answers.diet === "pescatarian" && mainlyMeat(c.candidate.place)) fails.push(`${c.candidate.place.displayName?.text}: meat`);
  }
  if (new Set(names).size !== names.length) fails.push("a place twice");
  // Curated places come before Google's (founder, 19 Nov 2026).
  const curated = shown.map((c) => c.candidate.fetaNote !== undefined || !!c.candidate.lovedBy || !!c.candidate.local || !!c.candidate.featured);
  if (curated.lastIndexOf(true) > curated.indexOf(false) && curated.includes(false)) fails.push("a Google place shown before a curated one");
  // Their distance is a limit (founder, 19 Nov 2026: within 5 km, got 10 km).
  // Only a hike or an adventure at the weekend may be a trip out.
  const tripOut = (c: { intents?: string[] }) => (p.when ?? "tonight") === "weekend" && found.intents.some((i) => i.def.far && c.intents?.includes(i.id));
  for (const c of shown) if (c.candidate.km > (tripOut(c.candidate) ? TRIP_OUT_KM : distanceLimitKm(taste.answers))) fails.push(`${c.candidate.place.displayName?.text}: ${c.candidate.km.toFixed(1)} km, beyond their ${distanceLimitKm(taste.answers)} km`);
  // No filler: once they've shared anything, each place is for something
  // they chose, said or love, or a curated place.
  if (explicit.length)
    for (const c of shown)
      if (!c.candidate.intents?.length && c.candidate.fetaNote === undefined && !c.candidate.lovedBy && !c.candidate.local && !c.candidate.featured)
        fails.push(`${c.candidate.place.displayName?.text}: filler, fits nothing they shared`);
  const feta = shown.filter((c) => c.candidate.fetaNote !== undefined).length;
  if (p.founderMin && feta < p.founderMin) fails.push(`only ${feta} of the founder's places`);
  const locals = shown.filter((c) => c.candidate.local).length;
  if (p.localMin && locals < p.localMin) fails.push(`only ${locals} local favourites`);
  for (const id of p.fromLists ?? []) if (!found.fromLists?.includes(id)) fails.push(`${id} searched on Google though her lists serve it`);
  const guides = shown.filter((c) => c.candidate.featured).length;
  if (p.featuredMin && guides < p.featuredMin) fails.push(`only ${guides} places featured in a guide`);
  // Very popular places beyond the cap only when nothing less known was left.
  const isPopular = (c: { place: { userRatingCount?: number } }) => (c.place.userRatingCount ?? 0) >= POPULAR_REVIEWS;
  const popular = shown.filter((c) => isPopular(c.candidate) && !isFor(c.candidate)).length;
  const lessKnownLeft = found.pool.filter((c) => !isPopular(c) && !shown.some((s) => s.candidate === c)).length;
  if (popular > popularCap(taste) && lessKnownLeft > 0) fails.push(`${popular} very popular places while ${lessKnownLeft} less-known ones were left`);
  const reasons = shown.map((c) => `${c.candidate.place.displayName?.text} [${c.candidate.place.primaryType}${c.candidate.place.servesVegetarianFood === undefined ? ", veg unknown" : ""}] ${(c.candidate.intents ?? []).join(" ")} — ${c.ranked?.because ?? ""}`);
  return { fails, names, forChoices, reasons, shown, missing: picked.missing.map((m) => m.label), searched: found.intents.map((i) => (found.fromLists?.includes(i.id) ? `${i.query} (from her lists)` : i.query)) };
}

// Every choice on screen has search words (lib/server/catalog.ts).
function catalogueGaps() {
  const gaps: string[] = [];
  for (const c of [...cuisinesFor("IN"), ...cuisinesFor("GB")]) if (!CUISINE_SEARCH[c.id]) gaps.push(`cuisine ${c.id}`);
  for (const o of QUESTIONS.find((q) => q.id === "interests")!.options) if (!INTEREST_SEARCH[o.id]) gaps.push(`interest ${o.id}`);
  const notSearched = ["familiar", "new_to_me"]; // novelty only nudges the ranking
  for (const card of swipeCards(base)) if (card.type === "pair") for (const s of [card.a, card.b]) if (!notSearched.includes(s.id) && !SIDE_SEARCH[s.id]) gaps.push(`card side ${s.id}`);
  return gaps;
}

async function main() {
  let failed = 0;
  const gaps = catalogueGaps();
  if (gaps.length) {
    failed++;
    console.log(`✗ Choices with no search words: ${gaps.join(", ")}`);
  } else console.log("✓ Every choice on screen has search words");
  // Admin's database check reads this list; a new migration must be in it.
  if (readFileSync(OUT, "utf8") !== schemaJson()) {
    failed++;
    console.log(`✗ ${OUT} is out of date with the migrations: run npm run schema`);
  } else console.log("✓ The database check knows every migration");
  // "Because you…" names only what the place serves (tester, 22 Nov 2026:
  // "hole-in-the-wall spots" from a vibe-card tap, "a dance class" on a choreographer).
  const thai = { id: "cuisine_thai", label: "Thai & SE Asian", reason: "Because you love Thai & SE Asian food.", query: "thai restaurant", def: { searches: [] }, explicit: true, source: "cuisine", food: true } satisfies Intent;
  const side = { id: "side_dressed_up", label: "A dressed-up dinner for an occasion", reason: "Because you picked a dressed-up dinner for an occasion.", query: "fine dining", def: { searches: [] }, explicit: false, source: "side", food: true } satisfies Intent;
  const reasonFails = [
    becauseFor([side]) !== "" && "a vibe card used as a reason",
    becauseFor([thai]) !== thai.reason && "Feta's own reason missing",
    becauseFor([]) !== "" && "a reason for a place that serves nothing they chose",
  ].filter(Boolean);
  if (reasonFails.length) {
    failed++;
    console.log(`✗ Reasons: ${reasonFails.join(", ")}`);
  } else console.log("✓ Reasons name only what a place serves");
  // "No stand-up comedy" never sits above a comedy night or a comedy club
  // (tester, 23 Nov 2026): an event shown, or a place whose Google type is
  // that thing, counts as found.
  const comedy = { id: "interest_comedy", label: "Stand-up comedy", reason: "Because you're into stand-up comedy.", query: "stand-up comedy club", def: INTEREST_SEARCH.comedy, explicit: true, source: "interest", food: false } satisfies Intent;
  const club = { place: { id: "club", displayName: { text: "Laugh Store" }, primaryType: "comedy_club", types: ["comedy_club"] }, km: 1, local: true, intents: [comedy.id] } as Candidate;
  const found = (pool: Candidate[]) => ({ pool, ranked: [], intents: [comedy], drops: { seen: 0, far: 0, price: 0, diet: 0, alcohol: 0, hours: 0, other: 0 } });
  const bannerFails = [
    pickFrom(found([]), { room: 8, small: false, popularCap: 2, taken: [comedy.id] }).missing.length && "says none found above a comedy night",
    pickFrom(found([club]), { room: 8, small: false, popularCap: 2 }).missing.length && "says none found above a comedy club",
    !pickFrom(found([]), { room: 8, small: false, popularCap: 2 }).missing.length && "says nothing when nothing was found",
  ].filter(Boolean);
  if (bannerFails.length) {
    failed++;
    console.log(`✗ Banner: ${bannerFails.join(", ")}`);
  } else console.log("✓ The banner says a choice found nothing only when nothing shown serves it");
  // The limit's reset in their own time, with "tomorrow" when it is
  // (tester, 23 Nov 2026: "more from 6:30 pm" at 9 pm in Lisbon).
  const at = (iso: string) => new Date(iso).getTime();
  const resetFails = [
    resetTime("Europe/Lisbon", at("2026-11-23T12:00:00Z")) !== "6:30 pm" && `Lisbon at noon: ${resetTime("Europe/Lisbon", at("2026-11-23T12:00:00Z"))}`,
    resetTime("Europe/Lisbon", at("2026-11-23T21:00:00Z")) !== "tomorrow at 6:30 pm" && `Lisbon at 9 pm: ${resetTime("Europe/Lisbon", at("2026-11-23T21:00:00Z"))}`,
    resetTime("Asia/Kolkata", at("2026-11-23T12:00:00Z")) !== "midnight" && `Bengaluru: ${resetTime("Asia/Kolkata", at("2026-11-23T12:00:00Z"))}`,
    resetTime("Pacific/Auckland", at("2026-11-23T05:00:00Z")) !== "tomorrow at 7:30 am" && `Auckland at 6 pm: ${resetTime("Pacific/Auckland", at("2026-11-23T05:00:00Z"))}`,
  ].filter(Boolean);
  if (resetFails.length) {
    failed++;
    console.log(`✗ Limit reset: ${resetFails.join(", ")}`);
  } else console.log("✓ The daily limit's reset says tomorrow when it is");
  // A change in You searches again only for the list it touches (tester,
  // 23 Nov 2026: a new cuisine used a search for Things to do too).
  const you: Taste = { answers: { ...base, interests: ["comedy"] }, lines: ["Favourite food: Thai", "Into stand-up comedy"], lineKeys: ["cuisines", "interests"], yes: ["cuisine_thai"], no: [] };
  const plusKorean: Taste = { ...you, lines: ["Favourite food: Thai, Korean", "Into stand-up comedy"], yes: ["cuisine_thai", "cuisine_korean"] };
  const plusKaraoke: Taste = { ...you, answers: { ...you.answers, interests: ["comedy", "karaoke"] }, lines: ["Favourite food: Thai", "Into stand-up comedy and karaoke"] };
  const cheaper: Taste = { ...you, answers: { ...you.answers, spend: ["1"] } };
  const fp = tasteFingerprint;
  const fingerprintFails = [
    fp(you, "experiences") !== fp(plusKorean, "experiences") && "a new cuisine searches Things to do again",
    fp(you, "food_drinks") === fp(plusKorean, "food_drinks") && "a new cuisine doesn't search Food again",
    fp(you, "food_drinks") !== fp(plusKaraoke, "food_drinks") && "a new interest searches Food again",
    fp(you, "experiences") === fp(plusKaraoke, "experiences") && "a new interest doesn't search Things to do again",
    (fp(you, "food_drinks") === fp(cheaper, "food_drinks") || fp(you, "experiences") === fp(cheaper, "experiences")) && "a budget change doesn't search both",
  ].filter(Boolean);
  if (fingerprintFails.length) {
    failed++;
    console.log(`✗ Changes in You: ${fingerprintFails.join(", ")}`);
  } else console.log("✓ A change in You searches again only for the list it touches");
  // A pop-up running several days shows while it's on (founder, 22 Nov 2026).
  const tz = "Europe/London";
  const cal = cityCalendar(tz);
  const shift = (n: number) => new Date(new Date(`${cal.today}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
  const ev = (date: string, endDate?: string, url = "https://www.instagram.com/p/test") => ({ title: "Pop-up", venueName: "Shoreditch", date, ...(endDate ? { endDate } : {}), time: "", priceText: "", minPrice: null, url });
  const popFails = [
    !eventPasses(ev(shift(-2), shift(2)), { when: "tonight", timeZone: tz, maxSpend: null }) && "a pop-up on now is missing",
    eventPasses(ev(shift(-2)), { when: "tonight", timeZone: tz, maxSpend: null }) && "a past one-day event shows",
    eventPasses(ev(shift(-5), shift(-1)), { when: "tonight", timeZone: tz, maxSpend: null }) && "a pop-up that ended shows",
    // Tester, 23 Nov 2026: events with no date shown.
    eventPasses(ev(""), { when: "week", timeZone: tz, maxSpend: null }) && "an event with no date shows",
    eventPasses(ev("TBA", shift(3)), { when: "week", timeZone: tz, maxSpend: null }) && "an event with a made-up date shows",
    eventPasses(ev(`${cal.today}T19:00`), { when: "tonight", timeZone: tz, maxSpend: null }) && "an event with a malformed date shows",
    !eventOver(ev(shift(-1)), tz) && "a past event stays in Want to try",
    eventOver(ev(shift(-3), shift(1)), tz) && "a pop-up still on leaves Want to try",
  ].filter(Boolean);
  if (popFails.length) {
    failed++;
    console.log(`✗ Pop-ups: ${popFails.join(", ")}`);
  } else console.log("✓ A pop-up running several days shows while it's on, with an Instagram link");
  // Linking out to a ticket site is fine; reading or scraping it isn't
  // (CLAUDE.md). Dropping BookMyShow and District links left Bengaluru with
  // no events at all (persona re-test, 23 Nov 2026).
  const sourceFails = [
    !eventPasses(ev(cal.today, undefined, "https://in.bookmyshow.com/events/standup/ET001"), { when: "tonight", timeZone: tz, maxSpend: null }) && "a BookMyShow ticket link is dropped",
    // The Search chip shows the searches: plain words, not "site:" (tester, 23 Nov 2026).
    /site:/.test(searchChip([{ type: "google_search_result", result: [{ search_suggestions: "<a>site:district.in comedy</a>" }, { search_suggestions: "<a>comedy Bengaluru this weekend</a>" }] }])) && "a chip shows a site: search",
  ].filter(Boolean);
  if (sourceFails.length) {
    failed++;
    console.log(`✗ Event sources: ${sourceFails.join(", ")}`);
  } else console.log("✓ Events may link to ticket sites, and the Search chip reads as plain words");
  // Style brands (review, 22 Nov 2026): Mumbai H&M opened Australia, London
  // Uniqlo opened India, and "In your budget" showed with no price behind it.
  const link = (website: string, proof: string | null, c: string, cn: string) => shopLink({ name: "B", website }, { presence_url: proof }, c, cn).href;
  const brandFails = [
    link("https://www2.hm.com/en_au/index.html", "https://www2.hm.com/en_in/index.html", "IN", "India") !== "https://www2.hm.com/en_in/index.html" && "Mumbai H&M doesn't open India",
    /uniqlo\.com\/in/.test(link("https://www.uniqlo.com/in/en/", null, "GB", "United Kingdom")) && "London Uniqlo opens India",
    /zara\.com\/(in|my)\//.test(link("https://www.zara.com/in/", "https://www.zara.com/sg/", "MY", "Malaysia")) && "Malaysia Zara opens another country",
    link("https://www.uniqlo.com/", null, "PT", "Portugal") === "https://www.uniqlo.com/" && "Lisbon Uniqlo opens a site that picks the country itself",
    /mens-shirt/.test(shopLink({ name: "Allen Solly", website: "https://allensolly.abfrl.in/" }, { presence_url: "https://allensolly.abfrl.in/c/mens-shirt" }, "IN", "India", "women").href) && "a womenswear shopper gets a men's page",
    shopLink({ name: "B", website: "https://www.fabindia.com/", origin_country: "IN" }, { presence_url: null }, "IN", "India").href !== "https://www.fabindia.com/" && "a homegrown brand's own site is missing",
    brandPrice({ price_feel: "budget", sample_price: 2499, sample_currency: "INR", checked_date: null }, ["c1"], "INR").fit !== "above" && "a ₹2,499 piece passes an under-₹1,500 budget",
    brandPrice({ price_feel: "budget", sample_price: null, sample_currency: null, checked_date: null }, ["c1"], "INR").fit !== "explore" && "an unpriced brand claims a budget fit",
    brandPrice({ price_feel: null, sample_price: 40, sample_currency: "USD", checked_date: null }, ["c2"], "GBP").fit !== "above" && "a brand with no price level or local price is shown",
    !lookProblem({ id: "x", style: "indian-fusion", title: "Indo Indo Evening", why: "", pieces: [{ slot: "one-piece", name: "Indigo cotton kurta set" }, { slot: "shoes", name: "Tan leather kolhapuris" }] }, ["indian-fusion"]) && "a look titled \"Indo Indo Evening\" passes",
  ].filter(Boolean);
  const nightFails: (string | false)[] = [
    !notANightOut({ displayName: { text: "Simplifry | Vegan Cloud Kitchen" }, primaryType: "vegan_restaurant" } as never) && "a cloud kitchen passes",
    !notANightOut({ displayName: { text: "The Binge Town - Private Theatre Venues for Celebration" }, primaryType: "" } as never) && "a private theatre for hire passes",
    notANightOut({ displayName: { text: "Comedy Theatre" }, primaryType: "performing_arts_theater" } as never) && "a real theatre is dropped",
  ].filter(Boolean);
  // Plan a night: two dinners ticked is one dinner and a plain "second dinner" (persona re-test, 23 Nov 2026).
  const eat = (name: string, lat: number): NightPlace => ({ placeId: name, name, area: "", kind: "EAT", light: false, lat, lng: 77.6, mapsUri: "" });
  const two = planNight([eat("Koriken", 12.97), eat("Vilva Bhavan", 12.971)], 1, 18 * 60);
  if (two.stops.length !== 1 || !/second dinner/.test(two.problems[0]?.why ?? "")) nightFails.push("two dinners stacked in Plan a night");
  // What they said beats a guess: a price word read from loved places is never searched (traveller, 23 Nov 2026).
  const plain = plainRead({ label: "Upscale Asian Fine Dining", query: "upscale asian fine dining restaurant", from: "loved" });
  if (plain.length !== 1 || /upscale|fine/i.test(plain[0].label + plain[0].query)) nightFails.push(`"Upscale Asian Fine Dining" kept its price words (${JSON.stringify(plain)})`);
  if (nightFails.length) {
    failed++;
    console.log(`✗ Places to go out: ${nightFails.join(", ")}`);
  } else console.log("✓ Cloud kitchens and places for hire are never picks");
  if (brandFails.length) {
    failed++;
    console.log(`✗ Style brands: ${brandFails.join(", ")}`);
  } else console.log("✓ Style brands link to their country's store and claim a budget fit only with a real price");
  const evening = await planCheck();
  if (evening.fails.length) failed++;
  console.log(`${evening.fails.length ? "✗" : "✓"} Plan my evening: dinner is a meal, something to do is a place to go`);
  for (const l of evening.lines) console.log(`    ${l}`);
  for (const f of evening.fails) console.log(`    ✗ ${f}`);
  // Ask Feta (two persona testers, 23 Nov 2026): what code checks in a chat answer.
  // What they ask for carries their diet: [diet, what they asked, where, how it's searched].
  const diet: [string, string, string, RegExp][] = [
    ["vegetarian", "local food", "PT", /^vegetarian local food$/],
    ["vegan", "dinner near Indiranagar", "IN", /^vegetarian dinner near Indiranagar$/],
    ["vegetarian", "vegan brunch", "PT", /^vegan brunch$/],
    ["everything", "local food", "PT", /^local food$/],
  ];
  const askFails = [
    !asksQuestion("Happy to plan it. Are you after somewhere to eat and drink, something to do, or both?") && "a question isn't seen as one, so it gets no options",
    asksQuestion("Why not? Here are three places for tonight.") && "a reply that doesn't end on a question asks for options",
    withDinner([{ category: "food_drinks", note: "craft beer, veg and meat" }, { category: "experiences", note: "comedy" }], ["Plan my date night", "Both. Saturday. He eats meat and loves craft beer, I'm veg"])[0].meal !== "dinner" && "a date night's food search isn't a dinner",
    withDinner([{ category: "experiences", note: "live music" }], ["date night tonight"]).filter((s) => s.meal === "dinner").length !== 1 && "a date night with only something to do gets no dinner",
    withDinner([{ category: "food_drinks", note: "cocktails" }], ["date night, we already ate, just drinks"])[0].meal && "a date that's only drinks is made a dinner",
    plainReply('Want to try something else?\n\n\n<invoke name="x">\n</invoke>\n\n<invoke name="x"></invoke>') !== "Want to try something else?" && "tool-call markup shows in a chat reply",
    plainReply("Dinner at 8 <3 then drinks") !== "Dinner at 8 <3 then drinks" && "a chat reply's own words are cut",
    withDinner([{ category: "food_drinks", note: "cheap eats" }], ["something cheaper tonight"])[0].meal && "an everyday search is made a dinner",
    ...diet.map(([d, note, country, want]) => {
      const [c] = searchCities(country === "IN" ? "Bengaluru" : "Lisbon", 1);
      const q = allIntents({ answers: { ...base, diet: d }, lines: [], own: [], yes: [], no: [] }, { category: "food_drinks", city: c, tweaks: [], note, rotation: 0 }).find((i) => i.id === "asked")?.query ?? "";
      return !want.test(q) && `a ${d} asking for "${note}" in ${c.name} is searched as "${q}"`;
    }),
  ].filter(Boolean);
  if (askFails.length) {
    failed++;
    console.log(`✗ Ask Feta: ${askFails.join(", ")}`);
  } else console.log("✓ Ask Feta: a question comes with answers to tap, an ask carries their diet, a date night includes dinner");
  // Trip day plans (traveller in Lisbon, 23 Nov 2026): began at a time
  // already past, missed the castle, stopped at tour-company offices, a pub
  // by day and a park at 9:30 pm, two branches of one bakery, no way home.
  const allWeek: [number, number, number][] = [0, 1, 2, 3, 4, 5, 6].map((d) => [d, 0, 24 * 60]);
  const stop = (name: string, kind: "EAT" | "DRINK" | "DO", type: string, serves: string[] = []) =>
    ({ placeId: name, name, kind, type, serves, hours: allWeek, lat: 38.71, lng: -9.14, verdict: "Good if you're nearby", because: "", area: "", distanceKm: 1, chips: [], googleLine: "", mapsUri: "", directionsUri: "", book: null, photo: null }) as unknown as Parameters<typeof buildItinerary>[0][number];
  const dayPicks = [
    stop("Lisbon Walking Tours", "DO", "tour_agency", ["plan_sights"]),
    stop("Yellow Tuk Tuk Tours", "DO", "tourist_attraction", ["plan_sights"]),
    stop("The Irish Pub", "DO", "pub"),
    stop("Parque Eduardo VII", "DO", "park", ["plan_outdoors"]),
    stop("Manteigaria Chiado", "EAT", "bakery"),
    stop("Manteigaria Baixa", "EAT", "bakery"),
    stop("Tasca do Bairro", "EAT", "restaurant"),
    stop("Cervejaria Nova", "EAT", "restaurant"),
    stop("Casa do Fado", "DO", "performing_arts_theater"),
    stop("Museu do Azulejo", "DO", "museum"),
    stop("Castelo de São Jorge", "DO", "castle", ["plan_sights"]),
    stop("Pastelaria Doce", "EAT", "cafe"),
    stop("Taberna Velha", "EAT", "restaurant"),
  ];
  const startsAt = (t: string) => {
    const [, h, m, ap] = /^(\d+):(\d+) (am|pm)$/.exec(t) ?? [];
    return ((Number(h) % 12) + (ap === "pm" ? 12 : 0)) * 60 + Number(m);
  };
  const plan = buildItinerary(dayPicks, { start: "2026-11-28", days: 2, place: "Lisbon", from: 14 * 60, hotel: { lat: 38.72, lng: -9.15 } });
  const planStops = plan.days.flatMap((d) => d.stops.map((s) => ({ ...s, day: d.date })));
  const chainNames = planStops.filter((s) => /Manteigaria/.test(s.pick.name)).length;
  const dayFails = [
    planStops.some((s) => s.day === "2026-11-28" && startsAt(s.time) < 14 * 60) && "today's plan starts before now",
    planStops.some((s) => /Tours/.test(s.pick.name)) && "a tour-company office is a stop",
    planStops.some((s) => s.pick.type === "pub" && startsAt(s.time) < 18 * 60) && "a pub by day",
    planStops.some((s) => s.pick.type === "park" && startsAt(s.time) >= 17 * 60) && "a park after dark",
    chainNames > 1 && "two branches of one chain",
    !plan.days[0].stops.some((s) => /Castelo/.test(s.pick.name)) && "the castle (a top sight) left out of the first day",
    plan.days.some((d) => d.stops.length && !d.back) && "a day doesn't end back at the hotel",
    ...["EUR", "INR", "USD", "GBP", "JPY"].flatMap((cur) =>
      hotelBudgets(cur)
        .flatMap((b) => b.label.match(/[\d,.]+/g) ?? [])
        .map((n) => Number(n.replace(/,/g, "")))
        // Round: its first two digits are a multiple of 5 (75, 150, 6,500).
        .filter((n) => (n / 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1)) % 5 !== 0)
        .map((n) => `an odd hotel budget (${cur} ${n})`),
    ),
  ].filter(Boolean);
  if (dayFails.length) {
    failed++;
    console.log(`✗ Day plans: ${dayFails.join(", ")}`);
  } else console.log("✓ Day plans start from now, lead with the sights, end at the hotel, and skip offices, pubs by day, parks after dark and repeat chains");
  // Core rules from CLAUDE.md that had no check (founder, 23 Nov 2026: "it
  // doesn't remember the core logic all the time"). Each breaks loudly here.
  const pl = (name: string, primaryType = "restaurant", veg: boolean | null = true) => ({ id: name, displayName: { text: name }, primaryType, types: [primaryType], servesVegetarianFood: veg }) as never;
  const withDiet = (d: string, extra: Partial<Answers> = {}) => ({ ...EMPTY_ANSWERS, diet: d, ...extra }) as Answers;
  const evPick = (id: string, serves: string) => ({ stored: { placeId: id, serves: [serves] } });
  const coreFails = [
    // Diets
    dietOk(pl("Pork Belly House"), withDiet("everything", { avoid: ["pork"] } as Partial<Answers>), "GB") && !mainlyAvoided(pl("Pork Belly House"), ["pork"]) && "no pork: a pork place passes",
    !mainlyAvoided(pl("Hawksmoor", "steak_house"), ["beef"]) && "no beef: a steak house passes",
    dietOk(pl("Smokehouse BBQ", "barbecue_restaurant"), withDiet("vegan"), "GB") && "vegan: a barbecue place passes",
    dietOk(pl("Kebab Corner"), withDiet("jain"), "IN") && "Jain: a kebab place passes",
    !dietOk(pl("Udupi Grand", "south_indian_restaurant", null), withDiet("vegetarian"), "IN") && "vegetarian in India: a place with no answer is dropped",
    dietOk(pl("Trattoria Roma", "italian_restaurant", null), withDiet("vegetarian"), "GB") && "vegetarian abroad: a place with no answer passes",
    // Limits never mention money
    ...(["picks", "kept", "style", "ask"] as const).map((w) => /[₹$€£]|money|budget|credit|cost|spend|rupee/i.test(limitNotice(w, "Asia/Kolkata")) && `limit text "${w}" mentions money`),
    ...[0, 1, 3].map((n) => /[₹$€£]|money|budget|credit|cost|spend|rupee/i.test(leftNotice(n, "Europe/Lisbon")) && `searches-left text mentions money (${n})`),
    // An event link that redirects away from the event is wrong (founder, 23 Nov 2026: GoOut)
    landsOnSame("https://goout.net/en/bread-hot-wine/szabcde/", "https://goout.net/en/prague/events/") && "a link that lands on a listings page counts as the event",
    !landsOnSame("https://goout.net/en/bread-hot-wine/szabcde/", "https://goout.net/cs/bread-hot-wine/szabcde/") && "a link that lands on the same event in another language is dropped",
    // Tastings in Prague start with beer (founder, 23 Nov 2026)
    !/beer/.test(allIntents({ answers: { ...EMPTY_ANSWERS, interests: ["tastings"] }, lines: [], yes: [], no: [] } as Taste, { category: "experiences", city: searchCities("Prague", 1)[0], tweaks: [], rotation: 0 }).find((i) => i.id === "interest_tastings")?.query ?? "") && "Tastings in Prague don't start with beer",
    // Diet never on anything shareable
    /vegetarian|vegan|jain/i.test(JSON.stringify(shareSafe({ title: "Tonight", stops: [{ placeId: "a", kind: "EAT", because: "Because you asked for vegetarian dinner near Alfama." }, { placeId: "b", kind: "DO", because: "Because you love comedy." }] }))) && "a shared plan says their diet",
    !/love comedy/.test(JSON.stringify(shareSafe({ title: "Tonight", stops: [{ placeId: "b", kind: "DO", because: "Because you love comedy." }] }))) && "a shared plan loses a reason with no diet in it",
    // Trip-only and today-only lines
    scopeCounts("Lisbon · 12–15 Dec", null) && "a trip-only line reaches everyday picks",
    !scopeCounts("Lisbon · 12–15 Dec", "Lisbon · 12–15 Dec") && "a trip-only line is missing from its trip",
    !scopeCounts(todayScope(), null) && "a today-only line is missing today",
    scopeCounts(todayScope(new Date(Date.now() - 2 * 86400000)), null) && "an old today-only line still counts",
    // Events lead things to do, at most KIND_MAX of one kind
    eventsFirst([1, 2, 3, 4, 5].map((i) => evPick(`c${i}`, "comedy")), 8).length !== KIND_MAX && `more than ${KIND_MAX} events of one kind`,
    eventsFirst([evPick("a", "comedy"), evPick("b", "pottery"), evPick("c", "comedy")], 8).map((e) => e.stored.placeId).join() !== "a,b,c" && "events lose their order",
    // One branch per chain
    selectPicks([], [{ place: pl("Dishoom Covent Garden", "indian_restaurant"), km: 1, intents: ["cuisine_north_indian"] }, { place: pl("Dishoom Carnaby", "indian_restaurant"), km: 1, intents: ["cuisine_north_indian"] }] as Candidate[], { room: 8, small: false, popularCap: 2, explicit: [] }).filter((c) => !c.spare).length !== 1 && "two branches of one chain shown",
    // Plan a night: a closed day said plainly; Room for dessert never a second dinner
    !/closed on Sundays/.test(planNight([{ placeId: "x", name: "Closed Sun", area: "", kind: "DO", light: false, lat: 12.97, lng: 77.6, mapsUri: "", hours: [[1, 600, 1320]] }], 0, 18 * 60).problems[0]?.why ?? "") && "a place closed that day isn't said plainly",
    roomForOne(planNight([{ placeId: "d", name: "Dinner Place", area: "", kind: "EAT", light: false, lat: 12.97, lng: 77.6, mapsUri: "" }], 5, 19 * 60), [{ placeId: "e", name: "Another Dinner", area: "", kind: "EAT", light: false, lat: 12.9701, lng: 77.6, mapsUri: "" }], 5) !== null && "Room for dessert offers a second dinner",
  ].filter(Boolean);
  if (coreFails.length) {
    failed++;
    console.log(`✗ Core rules: ${coreFails.join(", ")}`);
  } else console.log("✓ Core rules: diets (no pork, no beef, vegan, Jain, India and abroad), limits never mention money, trip and today lines, events first, one branch per chain, Plan a night");
  // Search (founder, 23 Nov 2026): what they typed, their rules held for a
  // kind of place, a place named always shown first with the rules it
  // breaks, clothes words lead with brands, a piece matched to brands.
  {
    const [blr] = searchCities("Bengaluru", 1);
    const vegLow: Taste = { answers: { ...EMPTY_ANSWERS, diet: "vegetarian", spend: ["level_1"], distance: "city" } as Answers, lines: [], own: [], yes: [], no: [] };
    const vegMid: Taste = { ...vegLow, answers: { ...vegLow.answers, spend: ["level_2", "level_3"] } as Answers };
    const searchFor = (note: string, category: Category = "food_drinks", taste = vegLow) =>
      curate({ taste, city: blr, origin: { lat: blr.lat, lng: blr.lng }, category, when: "tonight", tweaks: [], note, exclude: new Set(), needsDiet: category === "food_drinks", need: 8, rotation: 0, searches: 1, search: true });
    const fork = await searchFor("The Gilded Fork");
    const catchy = await searchFor("coastal catch");
    const catchyDo = await searchFor("Coastal Catch", "experiences");
    const kind = await searchFor("rooftop restaurant", "food_drinks", vegMid);
    const kindPicks = pickFrom(kind, { room: 8, small: false, popularCap: 3, only: "asked" });
    const opts = { taste: vegLow, category: "food_drinks" as Category, when: "tonight" as When, origin: { lat: blr.lat, lng: blr.lng }, exclude: new Set<string>(), city: blr };
    const sample = CATALOGUE.map((_, i) => fakeDetails(`fake_${blr.lat.toFixed(4)}_${blr.lng.toFixed(4)}_${i}_c`)!).filter(Boolean);
    const linen = [
      { name: "Linen House", text: "Linen House relaxed linen shirts and trousers" },
      { name: "Street Co", text: "Street Co oversized hoodies cargo pants" },
      { name: "Shirt Bar", text: "Shirt Bar crisp cotton shirts" },
    ];
    const want = (id: string, label: string, query: string, def: Intent["def"]): Intent => ({ id, label, reason: "", query, def, explicit: true, source: id.startsWith("cuisine") ? "cuisine" : "interest", food: id.startsWith("cuisine") });
    const wantMexican = want("cuisine_mexican", "Mexican", "mexican restaurant", CUISINE_SEARCH.mexican);
    const wantItalian = want("cuisine_italian", "Italian", "italian restaurant", CUISINE_SEARCH.italian);
    const wantMusic = want("interest_live_music", "Live music", "live music venue", INTEREST_SEARCH.live_music);
    const searchFails = [
      fork.named?.place.displayName?.text !== "The Gilded Fork" && "a place searched by name isn't kept",
      !fork.named?.outside?.includes("Above your usual budget") && "a named place above their budget doesn't say so",
      !catchy.named?.outside?.some((l) => /suit how you eat/.test(l)) && "a named meat-led place doesn't say it may not suit how they eat",
      catchy.named?.outside?.some((l) => /safe|pure veg/i.test(l)) && "a named place claims a diet is safe",
      !catchyDo.named?.outside?.some((l) => /suit how you eat/.test(l)) && "a place to eat searched from Things to do skips the diet line",
      !!kind.named && "a kind of place (rooftop restaurant) is treated as a name",
      kindPicks.shown === 0 && "a kind search (rooftop restaurant) finds nothing",
      namedPlace([pl("Rooftop Bar Prague", "bar")], "rooftop bar") && "\"rooftop bar\" names a place called Rooftop Bar",
      !namedPlace([pl("Bar Leone", "bar")], "bar leone") && "\"bar leone\" doesn't find Bar Leone",
      !namedPlace([pl("Café de Flore", "cafe")], "cafe de flore") && "accents stop a name matching",
      kindPicks.chosen.slice(0, kindPicks.shown).some((c) => (c.candidate.place.priceLevel ?? "").includes("EXPENSIVE")) && "a kind search breaks their budget",
      kindPicks.chosen.slice(0, kindPicks.shown).some((c) => !c.candidate.intents?.includes("asked")) && "a search shows a place that isn't what was typed",
      // The rules a place breaks, in the filter's order: the first is what the filter counts.
      sample.some((pl0) => {
        const d = { seen: 0, far: 0, price: 0, diet: 0, alcohol: 0, hours: 0, other: 0 };
        const kept = applyHardFilters([pl0], opts, d).length === 1;
        const broken = rulesBroken(pl0, opts);
        return kept !== (broken.length === 0) || (!kept && d[broken[0].why] !== 1);
      }) && "rulesBroken and the hard filters disagree",
      !guessSearch("linen shirt").clothes && "\"linen shirt\" isn't clothes",
      guessSearch("pottery class").clothes && "\"pottery class\" is taken for clothes",
      guessSearch("ramen").category !== "food_drinks" && "\"ramen\" doesn't search food",
      guessSearch("horse riding").category !== "experiences" && "\"horse riding\" doesn't search things to do",
      piecesMatch(linen, "linen shirts", (b) => b.text).cards.map((b) => b.name).join() !== "Linen House" && "a piece search doesn't find the brand that makes it",
      piecesMatch(linen, "silk dress", (b) => b.text).cards.length !== 0 && "a piece no brand mentions brings brands",
      !pieceLink({ href: "https://www.cos.com/en-cz/", label: "" }, "COS", "linen shirt", "Czechia").href.includes("site%3Acos.com") && "a piece link doesn't search the brand's own store",
      // Dots on a look's picture: the AI's 0–1000 answer is read as fractions (live check, 24 Nov 2026)
      JSON.stringify(readSpots([[324, 252], null], 2)) !== "[[0.324,0.252],null]" && "a picture's piece positions on a 0–1000 scale are thrown away",
      JSON.stringify(readSpots([[0.3, 0.2]], 1)) !== "[[0.3,0.2]]" && "a picture's piece positions as fractions are lost",
      readSpots([[0.3, 0.2]], 2) !== null && "piece positions for the wrong number of pieces are used",
      // List places are matched by their tags, not their names (founder, 24 Nov 2026: Tacocina never counted as Mexican)
      listFit({ name: "Tacocina", tags: ["mexican", "tacos"] }, [wantMexican]) < 3 && "a list place tagged mexican doesn't fit someone who loves Mexican food",
      listFit({ name: "L'Industrie Pizzeria", tags: ["pizza", "slices"] }, [wantItalian]) < 3 && "a list place tagged pizza doesn't fit someone who loves Italian food",
      listFit({ name: "Birdland Jazz Club", tags: ["jazz club", "live_music"] }, [wantMusic]) < 3 && "a jazz club tagged live_music doesn't fit someone into live music",
      listFit({ name: "Times Square", tags: ["landmark", "sightseeing"] }, [wantMexican, wantItalian, wantMusic]) !== 0 && "a landmark fits someone who chose food and live music",
      featuredToCheck([{ id: "a", name: "Guggenheim", tags: ["art_culture", "museum"] }, { id: "b", name: "L'Industrie", tags: ["pizza"] }, { id: "c", name: "Stretch", tags: ["italian"] }, { id: "d", name: "Brooklyn Bowl", tags: ["live_music", "bowling"] }, { id: "e", name: "Carbone", tags: ["italian", "dressed_up"] }, { id: "f", name: "Via Carota", tags: ["italian"] }], [wantItalian, wantMusic]).join() !== "b,c,d,e" && "Featured in doesn't check the 4 places that match them (or checks one that matches nothing)",
      featuredToCheck([{ id: "a", name: "Guggenheim", tags: ["museum"] }], [wantMexican]).length !== 0 && "a Featured in place that matches nothing they want is checked live",
      // A checked list place counts as their choice by its tags (audit, 24 Nov 2026), by whole words only
      !listServes({ name: "The Back Room", tags: ["hidden_bars", "cocktails"] }, [want("interest_hidden_bars", "Hidden bars", "speakeasy bar", INTEREST_SEARCH.hidden_bars)]).length && "a speakeasy tagged hidden_bars doesn't count as a hidden bar",
      !listServes({ name: "Smalls Jazz Club", tags: ["live_music", "jazz club"] }, [wantMusic]).length && "a jazz club tagged live_music doesn't count as live music",
      !listServes({ name: "Tacocina", tags: ["mexican", "tacos"] }, [want("asked", "tacos", "tacos", { searches: ["tacos"] })]).length && "a list place tagged tacos doesn't count for a search for tacos",
      listServes({ name: "Tacocina", tags: ["mexican", "tacos"] }, [wantItalian]).length !== 0 && "a Mexican list place counts as Italian",
      listFit({ name: "Peter Luger", tags: ["steakhouse", "steak"] }, [want("interest_taste_tea", "Tea", "tea tasting", INTEREST_SEARCH.taste_tea)]) !== 0 && "a steakhouse fits a tea lover (part of a word matched)",
      listFit({ name: "Olive Garden", tags: ["italian chain"] }, [wantMusic]) !== 0 && "\"olive\" fits someone into live music",
      !TAG_IDS.includes("live_music") || TAG_IDS.includes("local") ? "the tag words don't follow the catalog" : false,
      // Feta Picks match the vibe too (founder, 24 Nov 2026; user test: Barbara)
      !vibeClash({ tags: ["casual", "lebanese", "mezze"] }, vibeOf({ own: ["quiet, elegant places, nothing loud"] })) && "a casual chain is a Feta Pick for someone who said elegant",
      !vibeClash({ tags: ["buzzing", "cocktails"] }, vibeOf({ own: ["quiet, elegant places, nothing loud"] })) && "a buzzing bar is a Feta Pick for someone who said quiet",
      vibeClash({ tags: ["dressed_up", "fine dining", "italian"] }, vibeOf({ own: ["quiet, elegant places, nothing loud"] })) && "a dressed-up restaurant is left out for someone who said elegant",
      vibeClash({ tags: ["buzzing", "casual"] }, vibeOf({})) && "a vibe is ruled out for someone who said nothing about vibe",
      !vibeClash({ tags: ["fine dining"] }, vibeOf({ yes: ["hole_in_wall"] })) && "fine dining is a Feta Pick for someone who picked the hole-in-the-wall",
      !vibeClash({ tags: ["night_out", "club"] }, vibeOf({ skipped: ["Too loud and crowded"] })) && "a club is a Feta Pick after Too loud and crowded",
    ].filter(Boolean);
    if (searchFails.length) {
      failed++;
      console.log(`✗ Search: ${searchFails.join(", ")}`);
    } else console.log("✓ Search: a place named shows first saying which rules it breaks (never a diet promise), kinds keep their rules, clothes lead with brands, pieces match brands");
  }
  // A place open around the clock is open every day (audit, 24 Nov 2026:
  // day plans and Plan a night thought it closed Tuesday to Saturday).
  {
    const always = weeklyHours({ id: "x", regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] } } as Parameters<typeof weeklyHours>[0]) ?? [];
    const wed = always.find(([d]) => d === 3);
    if (!wed || wed[1] > 19 * 60 || wed[2] < 23 * 60) {
      failed++;
      console.log("✗ Open 24 hours: a place open around the clock counts as closed on a Wednesday");
    } else console.log("✓ Open 24 hours: a place open around the clock is open every day");
  }
  // Google's Search chip never runs code (security audit, 24 Nov 2026): it
  // is shown in a sealed frame, and no screen puts stored HTML into the page.
  {
    const raw = readdirSync("components").filter((f) => f.endsWith(".tsx") && readFileSync(`components/${f}`, "utf8").includes("dangerouslySetInnerHTML"));
    const sealed = /sandbox="allow-popups allow-popups-to-escape-sandbox"/.test(readFileSync("components/PickDetails.tsx", "utf8"));
    if (raw.length || !sealed) {
      failed++;
      console.log(`✗ Search chip: ${raw.length ? `HTML put straight into ${raw.join(", ")}` : "the chip isn't in a sealed frame"}`);
    } else console.log("✓ Search chip: shown as Google gives it, in a sealed frame where nothing can run");
  }
  // The first slot follows the city's clock (founder, 24 Nov 2026): by day
  // a place open in the next few hours fits (breakfast, a museum), not only
  // ones open in the evening; from 5 pm, places open now. An ask meant for
  // this evening keeps the evening window.
  {
    const dayOf = (tz: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: tz }).format(new Date()));
    const place = (open: number, close: number, tz: string) => ({ id: "x", regularOpeningHours: { periods: [{ open: { day: dayOf(tz), hour: open, minute: 0 }, close: { day: dayOf(tz), hour: close, minute: 0 } }] } }) as Parameters<typeof openTonight>[0];
    const morning = { ...searchCities("Bengaluru", 1)[0], timeZone: zoneAt(9) };
    const slotFails = [
      !openTonight(place(10, 17, morning.timeZone), morning) && "a museum open 10 to 5 doesn't fit Today at 9 am",
      openTonight(place(19, 23, morning.timeZone), morning) && "a dinner-only place fits Today at 9 am",
      !openTonight(place(19, 23, morning.timeZone), morning, { evening: true }) && "a dinner place doesn't fit an evening ask made at 9 am",
      openTonight(place(10, 17, morning.timeZone), morning, { evening: true }) && "a museum that shuts at 5 fits an evening ask",
      !openTonight({ id: "park" } as Parameters<typeof openTonight>[0], morning, { category: "experiences" }) && "a park with no hours on Google doesn't fit Today",
      openTonight({ id: "cafe" } as Parameters<typeof openTonight>[0], morning, { category: "food_drinks" }) && "a café with no hours on Google fits Today",
    ].filter(Boolean);
    if (slotFails.length) {
      failed++;
      console.log(`✗ Today / Tonight: ${slotFails.join(", ")}`);
    } else console.log("✓ Today / Tonight: by day, places open in the next few hours; from 5 pm, places open now; evening asks keep the evening");
  }
  // Words in reasons and banners keep capitals only for a people or a place
  // (founder's tester, 24 Nov 2026), joined words included.
  {
    const wordFails = [
      ["Upscale Quiet Bars", "upscale quiet bars"],
      ["Pan-Asian", "Pan-Asian"],
      ["K-pop Nights", "K-pop nights"],
      ["Thai & SE Asian", "Thai & SE Asian"],
      ["Live Jazz", "live jazz"],
    ]
      .filter(([from, to]) => inSentence(from) !== to)
      .map(([from, to]) => `"${from}" became "${inSentence(from)}", not "${to}"`);
    if (wordFails.length) {
      failed++;
      console.log(`✗ Wording: ${wordFails.join(", ")}`);
    } else console.log("✓ Wording: capitals only for a people or a place, in reasons and banners");
  }
  // Every database change reads as Postgres would read it (24 Nov 2026: a
  // pattern Postgres refuses stopped WhatsApp sharing; a bracket too many
  // failed in the SQL Editor). Local only, ₹0.
  {
    let sqlOk = true;
    try {
      // No input (the parser waits on an open one), and never more than a minute.
      execFileSync(process.execPath, ["scripts/sql-check.mjs"], { stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    } catch (e) {
      sqlOk = false;
      console.log(String((e as { stdout?: Buffer }).stdout ?? "").trim());
    }
    if (!sqlOk) {
      failed++;
      console.log("✗ Database changes: Postgres would refuse one (above)");
    } else console.log("✓ Database changes: every migration reads as Postgres would, functions included");
  }
  // Share pages link out only to sites Feta knows (founder, 24 Nov 2026).
  {
    const linkFails = [
      !trustedEventLink("https://in.bookmyshow.com/events/x") && "BookMyShow isn't trusted",
      !trustedEventLink("https://www.instagram.com/p/abc") && "Instagram isn't trusted",
      !trustedEventLink("https://www.timeout.com/london/things-to-do") && "Time Out isn't trusted",
      trustedEventLink("https://evil.example/login") && "an unknown site is trusted",
      trustedEventLink("https://bookmyshow.com.evil.example/x") && "a look-alike address is trusted",
      trustedEventLink("http://www.eventbrite.com/e/1") && "a plain http link is trusted",
      trustedEventLink("https://vertexaisearch.cloud.google.com/grounding-api-redirect/x") && "a Google redirect is trusted",
      trustedEventLink("https://sites.google.com/view/x") && "a Google-hosted page is trusted",
      trustedEventLink("https://l.instagram.com/?u=https%3A%2F%2Fevil.example") && "Instagram's redirect is trusted",
      trustedEventLink("https://www.eventbrite.com/redirect?url=https://evil.example") && "a link carrying another address is trusted",
      !trustedEventLink("https://www.eventbrite.com/e/comedy-night-123") && "an Eventbrite event isn't trusted",
      !trustedEventLink("https://www.blogto.com/events/comedy-night/") && "one of her guides (BlogTO) isn't trusted",
      trustedEventLink("https://evil.blogto.com/x") && "a subdomain of a guide is trusted",
      trustedEventLink("https://www.eventbrite.com/out/https://evil.example") && "a redirect path is trusted",
      trustedEventLink("https://www.eventbrite.com/x?x=%&u=https%3A%2F%2Fevil") && "a bad encoding hides a link",
      trustedEventLink("https://www.eventbrite.com/x?u=%2568ttps%253A%252F%252Fevil.example") && "a double-encoded link is trusted",
      trustedEventLink("https://www.eventbrite.com/x?next=evil.example") && "a bare address in a link is trusted",
      !trustedEventLink("https://www.eventbrite.com/e/comedy-night-123?aff=feta&ref=home") && "an ordinary event link with a tracking tag isn't trusted",
    ].filter(Boolean);
    if (linkFails.length) {
      failed++;
      console.log(`✗ Share links: ${linkFails.join(", ")}`);
    } else console.log("✓ Share links: only to sites Feta knows; others say Search it on Google");
  }
  // One door for every paid call (founder, 24 Nov 2026: three audits found
  // features that spent past a limit or weren't logged): Google Maps, Gemini
  // and Venice are called only through paidFetch, which checks the limit and
  // logs the cost itself. ₹0: nothing here reaches a paid service.
  {
    const PAID = /places\.googleapis|generativelanguage\.googleapis|api\.venice\.ai/;
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));
    const raw: string[] = [];
    for (const f of [...files("lib"), ...files("app")]) {
      if (f === "lib/server/costs.ts") continue;
      const src = readFileSync(f, "utf8");
      const hosts = [...src.matchAll(/const (\w+) = ["'`]https:\/\/([^"'`]+)/g)].filter((m) => PAID.test(m[2])).map((m) => m[1]);
      for (const m of src.matchAll(/(?<![\w.])fetch\(\s*([^,)]*)/g)) if (PAID.test(m[1]) || hosts.some((h) => m[1].includes(h))) raw.push(f);
    }
    let refused = false;
    await withCosts(null, "eval", () => paidFetch("places_photo", "https://places.googleapis.com/v1/none")).catch((e) => (refused = e instanceof LimitReached));
    const gateFails = [
      raw.length > 0 && `a paid call skips the gate in ${[...new Set(raw)].join(", ")}`,
      !refused && "a paid call with no one to charge it to isn't refused",
    ].filter(Boolean);
    if (gateFails.length) {
      failed++;
      console.log(`✗ Paid calls: ${gateFails.join(", ")}`);
    } else console.log("✓ Paid calls: every call to Google Maps, Gemini and Venice goes through one gate that checks the limit and logs the cost");
  }
  // EVAL_ONLY="Founder|London" runs just the profiles whose names match (live runs cost money).
  const only = process.env.EVAL_ONLY ? new RegExp(process.env.EVAL_ONLY) : null;
  for (const p of PERSONAS.filter((x) => !only || only.test(x.name))) {
    const r = await run(p);
    if (r.fails.length) failed++;
    console.log(`${r.fails.length ? "✗" : "✓"} ${p.name}`);
    console.log(`    searched: ${r.searched.join(" | ")}`);
    console.log(`    picks (${r.forChoices}/${r.names.length} for their choices): ${r.names.join(", ")}`);
    if (LIVE) r.reasons.forEach((x) => console.log(`      · ${x}`));
    if (r.missing.length) console.log(`    said none found: ${r.missing.join(", ")}`);
    for (const f of r.fails) console.log(`    ✗ ${f}`);
  }
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

// Live mode spends (about ₹50): logged as route "script", outside the daily pools.
withCosts(LIVE ? anonDb() : null, "script", main, { limit: "route" });
