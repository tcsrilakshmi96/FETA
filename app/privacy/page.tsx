import type { Metadata } from "next";
import Link from "next/link";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy · Feta",
  description: "What Feta collects, why, and how to delete it.",
};

// Plain-English policy for the friends test. Describe only what the app
// really does today, and update it whenever a new service or data type is added.
const CONTACT_EMAIL = "tcsrilakshmi96@gmail.com";

export default function Privacy() {
  return (
    <main className={styles.page}>
      <Link href="/" className="back-btn" aria-label="Back">
        ‹
      </Link>
      <h1 className={styles.title}>
        Your privacy, <strong>plainly.</strong>
      </h1>
      <p className={styles.updated}>Last updated 11 November 2026 · Friends test</p>

      <section>
        <h2>Who we are</h2>
        <p>
          Feta is a small app being tested with friends. It is run by its founder,
          Srilakshmi. You must be 18 or older to use it.
        </p>
      </section>

      <section>
        <h2>What we keep</h2>
        <ul>
          <li>That you confirmed you are 18 or older.</li>
          <li>Your choices about location and public reviews, and a dated record each time you change them.</li>
          <li>Your city, and the area you pick for distances.</li>
          <li>The places you save, skip (and why, if you tell us) or have been to, by their Google place ID only.</li>
          <li>
            Your answers: what you eat, how far you will go, what you usually spend, who you go out with,
            drinks, and what you are into.
          </li>
          <li>Your taste cards (favourite cuisines and this-or-that choices), and the plain lines Feta writes about what you like.</li>
          <li>Cities you asked us to tell you about.</li>
          <li>Your chats with Ask Feta, and the lines it adds to your profile (you can undo or remove them).</li>
          <li>Lines you add or change in You, including ones about the people you go out with (“Partner loves live music”).</li>
          <li>
            If you ask for the weekend plan: your WhatsApp number, the saved places you tick for the weekend and what
            you say you want to do. Srilakshmi reads these to write your plan and sends it from her own WhatsApp.
            Remove your number any time in My lists or You.
          </li>
          <li>Feedback you send, and a screenshot of that screen if you leave the box ticked.</li>
          <li>If you sign in with Google: your name and email address from Google.</li>
        </ul>
      </section>

      <section>
        <h2>Why</h2>
        <p>Only to choose picks for you and to improve Feta. Nothing else.</p>
      </section>

      <section>
        <h2>What we never do</h2>
        <ul>
          <li>We never sell your data.</li>
          <li>Nothing you do is public unless you turn on “Show my reviews to others”.</li>
          <li>What you eat never appears on anything you share.</li>
          <li>
            We never keep a trail of where you go. Your location is used only when you tap “Use my location”, only
            while the app is open, and it is never saved.
          </li>
        </ul>
      </section>

      <section>
        <h2>Who helps us run it</h2>
        <ul>
          <li>Supabase stores your data, in Mumbai, India.</li>
          <li>Vercel hosts the app.</li>
          <li>Google handles sign-in if you choose it.</li>
          <li>
            Google Maps finds places near you, and Google&apos;s Gemini AI chooses your picks, searches Google for
            events this week, and writes why. Gemini gets a short summary of your answers and likes and the name of
            your area, never your name, email or exact location.
          </li>
        </ul>
        <ul>
          <li>
            Venice AI reads your chats with Ask Feta, with a short summary of what you like, to reply and suggest
            what to remember. It never gets place details from Google.
          </li>
          <li>
            When you type an area, Google Maps suggests matching places from what you type. City names come from
            GeoNames (geonames.org, CC BY 4.0), kept inside Feta, so choosing a city sends nothing to anyone.
          </li>
        </ul>
        <p>When we add another service, we will update this page first.</p>
      </section>

      <section>
        <h2>Deleting your data</h2>
        <p>
          You can delete everything Feta holds about you at any time: You → Settings and privacy → Delete my data.
          Or email us and we will delete it within 7 days.
        </p>
        <p>We keep your data only while your account exists.</p>
      </section>

      <section>
        <h2>Questions or complaints</h2>
        <p>
          Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. This is also our grievance contact. We aim
          to reply within 7 days.
        </p>
      </section>
    </main>
  );
}
