import "server-only";

// How Feta searches for each thing a person can choose: one entry per
// cuisine (lib/swipes.ts), interest (lib/onboarding.ts) and taste-card side
// (lib/swipes.ts). The labels people see live with the screens; this is the
// only place that says what to search for and which Google place types
// count as a match. The quality check (npm run eval) fails if a choice on
// screen has no entry here.
//
// searches: Google text searches, the first used first, the next ones on
//   later searches ("Show me more"), so results don't repeat.
// types: Google place types that show a place is this (strong evidence,
//   wherever the place was found).
// related: types that count only when the place came from this entry's own
//   search ("south indian restaurant" finding an indian_restaurant).
// foodDrink: a thing to do that happens in a bar or café (karaoke, rooftops,
//   board games), so Experiences keeps those places when they match.
// alcohol: only for people who drink.

export type SearchDef = {
  searches: string[];
  soberSearches?: string[];
  types?: RegExp;
  related?: RegExp;
  foodDrink?: boolean;
  alcohol?: boolean;
};

const ASIAN = /asian/;

export const CUISINE_SEARCH: Record<string, SearchDef> = {
  south_indian: { searches: ["south indian restaurant", "south indian tiffin", "andhra or kerala restaurant"], types: /south_indian/, related: /indian|vegetarian/ },
  north_indian: { searches: ["north indian restaurant", "punjabi restaurant"], types: /north_indian|punjabi|mughlai/, related: /indian/ },
  regional: { searches: ["regional indian thali restaurant", "bengali or goan or chettinad restaurant"], related: /indian|vegetarian/ },
  indian: { searches: ["indian restaurant", "south indian restaurant"], types: /indian|pakistani|bangladeshi|sri_lankan|nepal/ },
  indo_chinese: { searches: ["indo chinese restaurant"], types: /chinese|dim_sum|cantonese|sichuan/, related: ASIAN },
  local: { searches: [] }, // "traditional <country> food", built per city in intents.ts
  italian: { searches: ["italian restaurant", "pizzeria", "pasta restaurant"], types: /italian|pizza/, related: /mediterranean|european/ },
  japanese: { searches: ["japanese restaurant", "sushi or ramen restaurant"], types: /japanese|sushi|ramen|izakaya|udon|yakitori/, related: ASIAN },
  korean: { searches: ["korean restaurant", "korean food"], types: /korean/, related: ASIAN },
  thai: { searches: ["thai restaurant", "vietnamese restaurant", "southeast asian restaurant"], types: /thai|vietnamese|indonesian|malaysian|burmese|singapore|filipino|cambodian|lao/, related: ASIAN },
  middle_eastern: { searches: ["middle eastern restaurant", "lebanese restaurant"], types: /middle_eastern|lebanese|turkish|mediterranean|afghan|persian|greek|israeli/ },
  mexican: { searches: ["mexican restaurant", "taqueria"], types: /mexican|latin|tex_mex/ },
  bakery: { searches: ["bakery", "dessert cafe"], types: /bakery|dessert|patisserie|cake|ice_cream|confectioner|donut/ },
  healthy: { searches: ["healthy bowls and salads", "salad bar"], types: /salad|health|juice|acai|poke/ },
};

export const INTEREST_SEARCH: Record<string, SearchDef> = {
  karaoke: { searches: ["karaoke bar", "karaoke"], types: /karaoke/, foodDrink: true },
  live_music: { searches: ["live music venue", "live music bar", "jazz bar"], types: /live_music|concert|music_venue|jazz/, foodDrink: true },
  comedy: { searches: ["stand-up comedy club", "comedy show"], types: /comedy/, foodDrink: true },
  rooftops: { searches: ["rooftop bar", "rooftop lounge"], soberSearches: ["rooftop restaurant", "rooftop cafe"], foodDrink: true },
  board_games: { searches: ["board game cafe", "board games bar"], types: /board_game|game_cafe/, foodDrink: true },
  dancing: { searches: ["salsa night", "dance class", "dance club"], soberSearches: ["dance class", "salsa class"], types: /dance|night_club/ },
  art_culture: { searches: ["art gallery", "museum"], types: /art_gallery|museum|art_studio|cultural|exhibit/ },
  games_sports: { searches: ["pickleball court", "badminton court", "bowling alley"], types: /sport|badminton|pickleball|bowling|tennis|golf|climbing|stadium|arena|athletic|skating|swimming/ },
  hidden_bars: { searches: ["speakeasy bar", "hidden cocktail bar"], foodDrink: true, alcohol: true },
  outdoors: { searches: ["park", "nature walk", "lake or garden"], types: /park|hiking|garden|nature|lake|beach|trail|botanical/ },
  workshops: { searches: ["pottery workshop", "art workshop", "cooking class"], types: /workshop|art_studio|pottery|cooking_class|craft/ },
  markets: { searches: ["flea market", "night market", "farmers market"], types: /market/ },
  nightlife: { searches: ["nightclub", "night club with dj"], types: /night_club/, alcohol: true },
};

// Taste-card sides: what kind of place, not what they love most, so these
// steer the search only when there's room (intents.ts).
export const SIDE_SEARCH: Record<string, SearchDef & { category: "food_drinks" | "experiences"; vegWords?: boolean }> = {
  hole_in_wall: { category: "food_drinks", searches: ["small local favourite, one famous dish"], vegWords: true },
  dressed_up: { category: "food_drinks", searches: ["fine dining restaurant"], types: /fine_dining/, vegWords: true },
  quiet_cafe: { category: "food_drinks", searches: ["quiet cafe"], types: /cafe|coffee|tea_house/ },
  buzzing: { category: "food_drinks", searches: ["lively bar with music"], alcohol: true },
  buzzing_sober: { category: "food_drinks", searches: ["cafe with live music"] },
  night_out: { category: "food_drinks", searches: ["cocktail bar"], types: /cocktail_bar/, alcohol: true },
  night_out_sober: { category: "food_drinks", searches: ["dessert cafe"], types: /dessert/ },
  street_food: { category: "food_drinks", searches: ["street food"], vegWords: true },
  spicy_regional: { category: "food_drinks", searches: ["spicy regional food"], vegWords: true },
  local_breakfast: { category: "food_drinks", searches: ["local favourite restaurant"], vegWords: true },
  get_moving: { category: "experiences", searches: ["dance class", "badminton court"], types: /dance|sport|badminton/ },
  slow_down: { category: "experiences", searches: ["pottery workshop", "book cafe"], types: /pottery|workshop|art_studio|book/, foodDrink: true },
  crowd: { category: "experiences", searches: ["live music venue", "stadium"], types: /live_music|concert|stadium|arena/ },
  circle: { category: "experiences", searches: ["community meetup", "trivia night"], foodDrink: true },
  // Older cards (people who swiped before 13 Nov 2026).
  dance: { category: "experiences", searches: ["dance class"], types: /dance/ },
  make: { category: "experiences", searches: ["pottery workshop"], types: /pottery|workshop|art_studio/ },
  hands_on: { category: "experiences", searches: ["pottery workshop"], types: /pottery|workshop|art_studio/ },
  play: { category: "experiences", searches: ["badminton court"], types: /sport|badminton/ },
  unwind: { category: "experiences", searches: ["book cafe"], types: /book/, foodDrink: true },
};

// Tweaks that change what to look for (the others change the hard filters).
export const TWEAK_SEARCH: Record<string, { food: string; doing: string }> = {
  quieter: { food: "quiet cafe", doing: "museum" },
  fancier: { food: "upscale restaurant", doing: "upscale cocktail lounge" },
  outdoors: { food: "outdoor seating restaurant", doing: "park" },
  groups: { food: "restaurant good for groups", doing: "group activity" },
  kids: { food: "family friendly restaurant", doing: "things to do with kids" },
};

// When someone hasn't said what they're into.
export const DEFAULT_DOING = ["art gallery", "park", "museum"];
