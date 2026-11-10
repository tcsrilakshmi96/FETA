# Feta v1 data contract

Everything in the prototype is placeholder. These are the shapes the UI expects, and where each field should come from.

## Pick (one card)
```ts
type PickKind = 'EAT' | 'DRINK' | 'DO' | 'EVENT';
type Verdict = 'Worth a detour' | "Good if you're nearby" | 'Skip unless…';

interface Pick {
  id: string;
  kind: PickKind;
  name: string;
  area: string;              // neighbourhood
  distanceKm: number;        // from the user's location or chosen area
  verdict: Verdict;          // Feta's judgement, never stars
  because: string;           // ONE line tied to the user's answers or swipes
  reason: string;            // fuller "Why it's yours" paragraph (details)
  matched: string[];         // 2–4 chips, e.g. "Veg-friendly ✓", "Under $40 ✓", "1.2 km ✓"
  highlights: { title: 'WHAT TO ORDER' | 'HIGHLIGHTS' | 'PLAN' | 'GOOD TO KNOW'; rows: [string, string][] }; // max 3 rows
  photos: { url: string; attribution?: string }[];
  google: { placeId: string; openNow?: boolean; closesAt?: string; opensAt?: string; checkedAt: string }; // rendered ONLY in the Google line
  booking?: { label: string; url: string };   // e.g. "Book a table", "Get tickets"
  event?: { startsAt: string; soldOut: boolean; seatsLeft?: number };
  favourite?: { loved: number; total: number }; // show badge only if total >= 3 && loved/total >= 0.7
  reviews: { firstName: string; text: string; when: string; photoUrl?: string }[]; // approved only
}
```

## Sources
- **Google Places API**: placeId, open now / hours (Google line only), coordinates, photos (with attribution). Never merge into Feta's own copy. Store only the placeId; fetch the rest live.
- **Place finder**: Gemini API with Grounding with Google Maps supplies candidate places (see `CLAUDE.md`).
- **AI model** (Venice AI): ranks candidates against the profile and writes `because`, `reason`, `verdict` and `matched`. It must return exactly 3 (or fewer, with the nothing-nearby state), one line each, honest wording, no hype, and never "safe" for food.
- **Events / tickets**: the provider for the city; sets `event` and `booking`.
- **Booking**: deep links to the partner for that city.
- **Feta DB**: lists, check-ins, reviews (pending|approved|hidden), favourites, profile lines, consent.
- **Phone auth**: Firebase Phone Auth (it already handles India's SMS/DLT registration); 6-digit code, resend after 30 s.

## Profile
```ts
interface ProfileLine {
  id: string; text: string;
  source: 'answers' | 'swipes' | 'checkin' | 'chat'; sourceLabel?: string;
  scope: { type: 'everyday' } | { type: 'trip'; tripId: string }; // default everyday
  createdAt: string; removed?: boolean;
}
interface Trip { id: string; destination: string; startDate: string; endDate: string; company?: string }
```
Removing a line regenerates picks (toast "Picks updated"). Everyday picks use only `scope.type === 'everyday'` lines. Trip lines are used only when the picks request targets that trip (destination city, or dates inside the trip window). `Use these every day instead` flips their scope to everyday.

## Chat (Ask)
Request: user message + profile lines + current context. Response:
```ts
interface ChatReply {
  text: string;                       // short, warm, honest
  picks?: Pick[];                     // up to 3, shown as mini cards
  addedToProfile?: string[];          // shown in "ADDED TO YOUR PROFILE" with Undo
  trip?: Trip;                        // when present, the card shows the "Only for this trip" toggle; on = lines saved with scope trip
  context?: { destination?: string; dates?: string; company?: string }; // updates the "Planning: …" chip
}
```
Undo removes those exact profile lines. Chat never makes anything public.

## Picks request
`{ tab: 'tonight' | 'weekend', city, area?, coords?, category: 'food_drinks' | 'experiences', // required; food_drinks = EAT|DRINK, experiences = DO|EVENT
   tweak?: string, tripId?: string, excludeIds: string[] }` → `{ picks: Pick[] (≤3), nothingNearby?: boolean }`

## Skip reasons and check-in
- Skip reason: `too_far | too_pricey | not_my_vibe | been_there` (optional).
- Check-in: `{ pickId, went: boolean, rating?: 'loved' | 'fine' | 'not_for_me', reason?: string, text?: string, photos?: string[], public: boolean (default false) }`.
