# Feta — project guide for Claude Code

Feta (working name: Fashion, Experience, Travel, All in one) is a personal AI lifestyle companion that learns a user's taste and decides for them: 3 confident picks for food, drinks and experiences, each with a reason.

The full v1 spec (features, screens, onboarding questions, two end-to-end journeys) lives in the founder's doc "Feta v1 Feature List". Ask the founder to paste a section when you need detail. The approved designs come from Claude Design.

## Who you're working with
- The founder, Srilakshmi, is non-technical and builds with Claude Code. Explain choices in plain English, one short paragraph at a time.
- Work in small steps she can test on her phone. After each step, say what changed and how to check it.
- Ask before adding any paid service, creating accounts, or deleting anything.
- Never put API keys or secrets in code or commits. Keep them in `.env.local` (git-ignored) and list required keys in `.env.example`.

## v1 scope (friends test, India, Nov–Dec 2026)
- Mobile web app opened from a link. Phone-first, works on slow connections, light and dark mode.
- Onboarding: 6 question screens first (diet, city/area + distance, budget per person, company, drinks, interests), then 10 swipe cards. First picks appear before sign-up, in about 90 seconds.
- No taste types or labels on users. The profile is plain, editable lines, and can hold notes tied to an occasion or a trip.
- Picks home: "Tonight" and "This weekend" tabs, a "Who's with you?" chip, exactly 3 swipeable cards mixing food and experiences.
- Every pick has a "Because you…" line, matched chips, honest wording ("Worth a detour" / "Good if you're nearby" / "Skip unless…"), and an action row: Book on District / Swiggy Dineout / BookMyShow (link out), Directions, Save, Share to WhatsApp.
- Chat with Feta: plan for a destination (India or abroad), change choices, ask "why this one?". Before saving anything new to the profile, ask: Remember always / Only for this trip / No.
- Location: "Near me now" (one-time location while the app is open, never stored as a trail) and a city picker for any Indian city.
- After an outing: Loved it / It was fine / Not for me, optional review and up to 3 photos, with a "Show my review to others" toggle off by default. Photos and public reviews need founder approval on an admin screen.
- Feta Favourite badge: at least 3 ratings and at least 70% loved.
- Style and shopping: a "coming soon" card and tab with a "Tell me when" button that counts interest. No workflow.
- Sign-in: phone number with a one-time code, only when the user saves something. Use a provider that already handles India's SMS (DLT) registration.
- Weekend plan: drafted by the app, sent by the founder on WhatsApp. No web push in v1.
- A small feedback button on every screen.
- Not in v1: group mode, full travel mode, native app, background location, in-app booking, allergy filter.

## Proposed stack (confirm with the founder before installing)
- Next.js web app, hosted on Vercel.
- Supabase for the database, file storage (review photos) and row-level security.
- Venice AI (OpenAI-compatible API, founder's credits) for chat, profile updates, choosing the 3 picks, writing reasons, and turning reviews into tags. Use a mainstream model, not an "uncensored" one.
- Gemini API with Grounding with Google Maps as the place-finder tool only.
- Google Places API for live open-now status on the 3 picks shown.
- Web search (Venice or Gemini with Google Search) for this week's events, linking out to the event page.
- Foursquare open places data or Overture Maps as a stored base list of places.
- PostHog for usage analytics.

## Rules that must not be broken
- Diet, budget, distance, alcohol and opening hours are hard filters enforced in code, never left to the AI.
- Never claim food is safe for an allergy or diet. Jain and vegan matches say "not confirmed, check with staff". Use neutral diet labels; never "pure veg".
- Google data: store only Google place IDs. Show live Google data on its own labelled line, e.g. "Open now · checked just now · Google Maps", with the words "Google Maps" unchanged. Never use Google content to train or test AI models.
- Do not scrape Zomato, District, Swiggy, BookMyShow or Meetup. Link out to them.
- Published lists (Condé Nast Traveller, 50 Best, Culinary Culture, 30 Best Bars) may be used only as "Featured in" facts with links. Never copy their text, photos or logos.
- Privacy: 18+ check, itemised consent with a separate location toggle, a consent log, one-tap "delete my data", a grievance email. Nothing public by default. Diet never appears on anything shareable.
- Every place, event and user record carries city, country, time zone and currency, so new cities are a data job, not a rebuild.

## Metrics to build in
Onboarding drop-off per step, time to first pick, day-1 and day-7 return, "loved" rate, share of picks with a logged outcome, "Tell me when" taps on Style, and feedback-button use.
