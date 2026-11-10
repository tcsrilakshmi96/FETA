# Feta — project guide for Claude Code

Feta (working name: Fashion, Experience, Travel, All in one) is a personal AI lifestyle companion that learns a user's taste and decides for them: 3 confident picks for food and drinks, and 3 for experiences, each with a reason.

The full v1 spec (features, screens, onboarding questions, two end-to-end journeys) lives in the founder's doc "Feta v1 Feature List". Ask the founder to paste a section when you need detail.

The approved designs are in `design/`. Start with `design/README.md` (screens, rules, tokens, motion) and `design/DATA_CONTRACT.md` (data shapes). `design/prototype/Feta App v2.dc.html` is the visual source of truth; `design/explorations/` is earlier rounds for context only (they include dropped ideas such as taste types). Screenshots of every screen and state are in `design/screenshots/light/` and `design/screenshots/dark/`. Prototype content (Lisbon, Tokyo, $ prices, Unsplash photos) is placeholder: use Indian cities and ₹ for the friends test. This file and `design/` were checked against each other on 10 Nov 2026 and agree. If you still find a conflict, the design wins for look, copy and flow; this file wins for data, privacy and the rules below. Tell the founder what you found.

## Who you're working with
- The founder, Srilakshmi, is non-technical and builds with Claude Code. Explain choices in plain English, one short paragraph at a time.
- Work in small steps she can test on her phone. After each step, say what changed and how to check it.
- Ask before adding any paid service, creating accounts, or deleting anything.
- She is also learning automation tools through this project. Whenever a step could be automated (deploys, tester invites and follow-ups, feedback tagging, usage and cost reports, weekly digests), say so in one or two lines: what it would do, which tool fits (for example Vercel, Zapier, n8n, PostHog, a Claude scheduled task), and whether it is rule-based, AI-assisted or agentic. Suggest it; don't set it up without her go-ahead. Remind her to note it in her automation journal.
- Never put API keys or secrets in code or commits. Keep them in `.env.local` (git-ignored) and list required keys in `.env.example`.

## v1 scope (friends test, India, Nov–Dec 2026)
- Mobile web app opened from a link. Phone-first, works on slow connections. Light and dark mode: Auto follows the phone, and the user can choose Auto / Light / Dark in You (tokens in `design/README.md`).
- Flow: Welcome (18+ check) → phone sign-in and consent → 6 question screens (diet, distance, spend per person, company, drinks, interests) → 10 swipe cards → "Here's what I picked up" → location → picks. Aim for first picks in about 90 seconds.
- Sign-in comes right after Welcome (founder's decision): phone number, 6-digit code, then consent toggles. "Not now" skips it and the user can sign in later from You. The Welcome screen must not say "No sign-up".
- Consent toggles: "Use my location" is on by default and "Show my reviews to others" is off by default (founder's decision, as designed). Both can be changed any time in You. The browser's own location prompt still appears only when the user taps "Use my location".
- No taste types or labels on users. The profile is plain, editable lines, and can hold notes tied to an occasion or a trip.
- Picks home: "Tonight" and "This weekend" tabs, a city pill, and a category switch: "Food & drinks" (EAT and DRINK cards) and "Experiences" (DO and EVENT cards), plus a muted "Style · soon" that opens the Style teaser. Each category has exactly 3 picks, shown one card at a time, and the two are never mixed on this screen (founder's decision). The title follows both switches ("Your 3 to eat tonight", "Your 3 to do this weekend"). The last category is remembered, each category keeps its own progress and states, and "Tweak these" applies to the category in view. Chat replies may still mix categories. There is no "Who's with you?" chip (founder's decision): company comes from the onboarding answer, the Tweak sheet ("Better for groups") and chat.
- Every pick has a "Because you…" line, matched chips, honest wording ("Worth a detour" / "Good if you're nearby" / "Skip unless…"), and an action row: Book on District / Swiggy Dineout / BookMyShow (link out), Directions, Save, Share to WhatsApp.
- Chat ("Ask Feta"): plan for a destination (India or abroad), change choices, ask "why this one?". What it learns is added to the profile straight away and shown in an "ADDED TO YOUR PROFILE" card with Undo. When the reply is tied to a trip, the card also has an "Only for this trip" toggle (off by default). Trip-only lines are never used for everyday picks and appear in their own group in the profile, with "Use these every day instead".
- Location: "Near me now" (one-time location while the app is open, never stored as a trail) and a city picker for any Indian city.
- After an outing: Loved it / It was fine / Not for me, optional review and up to 3 photos, with a "Show my review to others" toggle off by default. Photos and public reviews need founder approval on an admin screen.
- Feta Favourite badge: at least 3 ratings and at least 70% loved.
- Style and shopping: a "coming soon" card and tab with a "Tell me when" button that counts interest. No workflow.
- Phone sign-in provider: Firebase Phone Auth, because it already handles India's SMS (DLT) registration.
- Weekend plan: drafted by the app, sent by the founder on WhatsApp. No web push in v1.
- A small feedback button on every screen.
- Not in v1: group mode, full travel mode, native app, background location, in-app booking, allergy filter.

## Proposed stack (confirm with the founder before installing)
- Next.js web app, hosted on Vercel.
- Supabase for the database, file storage (review photos) and row-level security.
- Venice AI (OpenAI-compatible API, founder's credits) for chat, profile updates, choosing the 3 picks per category, writing reasons, and turning reviews into tags. Use a mainstream model, not an "uncensored" one.
- Gemini API with Grounding with Google Maps as the place-finder tool only.
- Google Places API for live open-now status on the picks shown.
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
Onboarding drop-off per step, time to first pick, day-1 and day-7 return, "loved" rate, share of picks with a logged outcome, use of Food & drinks versus Experiences, "Tell me when" taps on Style, and feedback-button use.
