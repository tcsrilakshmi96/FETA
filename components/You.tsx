"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TabBar from "@/components/TabBar";
import { useToast } from "@/components/Toast";
import {
  readGoogleReturn,
  signInToExistingAccount,
  startGoogleSignIn,
} from "@/lib/auth";
import { loadCity } from "@/lib/cities";
import {
  deleteMyData,
  loadAppearance,
  loadProfile,
  makeEveryday,
  removeLine,
  setAppearance,
  setConsent,
  type Appearance,
  type Profile,
} from "@/lib/profile-client";
import styles from "./You.module.css";

const SOURCE_LABELS: Record<string, string> = {
  chat: "From chat",
  checkin: "From an outing",
};

export default function You() {
  const router = useRouter();
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [appearance, setAppearanceState] = useState<Appearance>("auto");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cityName, setCityName] = useState("");

  useEffect(() => {
    // Back from signing in with Google here.
    const google = readGoogleReturn();
    if (google.errorCode === "identity_already_exists") {
      signInToExistingAccount("/you");
      return;
    }
    if (google.error)
      toast("Google sign-in didn't finish. Try again any time.");
    /* eslint-disable react-hooks/set-state-in-effect -- reads the phone's own settings */
    setAppearanceState(loadAppearance());
    setCityName(loadCity()?.name ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
    loadProfile().then((p) => {
      setProfile(p);
      if (window.location.search) window.history.replaceState(null, "", "/you");
    });
  }, [toast]);

  if (!profile) return <main className={styles.screen} />;

  const everyday = profile.lines.filter((l) => !l.trip);
  const trips = [
    ...new Set(profile.lines.filter((l) => l.trip).map((l) => l.trip!)),
  ];

  function remove(id: string) {
    removeLine(id);
    setProfile((p) => p && { ...p, lines: p.lines.filter((l) => l.id !== id) });
    toast("Picks updated");
  }

  function toEveryday(trip: string) {
    makeEveryday(trip);
    setProfile(
      (p) =>
        p && {
          ...p,
          lines: p.lines.map((l) =>
            l.trip === trip ? { ...l, trip: null } : l,
          ),
        },
    );
    toast("These now shape your everyday picks");
  }

  function toggle(kind: "location" | "public_reviews") {
    if (!profile) return;
    const key = kind === "location" ? "location" : "publicReviews";
    const next = !profile.consent[key];
    setConsent(kind, next);
    setProfile({ ...profile, consent: { ...profile.consent, [key]: next } });
  }

  async function confirmDeletion() {
    const ok = await deleteMyData();
    if (!ok) {
      toast("Couldn't delete just now. Try again, or email us.");
      return;
    }
    // A full reload, so nothing from the deleted account stays in memory.
    window.location.replace("/");
  }

  return (
    <>
      <main className={styles.screen}>
        <h1 className={styles.title}>
          What I think <strong>you like</strong>
        </h1>
        <p className={styles.sub}>
          Built from your answers, swipes, outings and chats. Change anything.
        </p>

        <ul className={styles.lines}>
          {everyday.map((line, i) => (
            <li
              key={line.id}
              className={styles.line}
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <span className={styles.lineText}>
                {line.text}
                {SOURCE_LABELS[line.source] && (
                  <span className={styles.source}>
                    {SOURCE_LABELS[line.source]}
                  </span>
                )}
              </span>
              <button
                type="button"
                className={styles.remove}
                onClick={() => remove(line.id)}
              >
                Remove
              </button>
            </li>
          ))}
          {everyday.length === 0 && (
            <li className={styles.empty}>
              Nothing yet. Your swipes, outings and chats will fill this in.
            </li>
          )}
        </ul>
        <div className={styles.links}>
          <button
            type="button"
            className={styles.chipLink}
            onClick={() => router.push("/questions?from=you")}
          >
            Change my answers
          </button>
          <button
            type="button"
            className={styles.chipLink}
            onClick={() => router.push("/city?from=you")}
          >
            {cityName ? `City: ${cityName}` : "Choose a city"}
          </button>
        </div>

        {trips.map((trip) => (
          <section key={trip} className={styles.trip}>
            <div className={styles.tripHead}>
              <span className={styles.tripLabel}>ONLY FOR THIS TRIP</span>
              <span className={styles.tripName}>{trip}</span>
            </div>
            <p className={styles.tripText}>
              Used only while you plan or are on this trip. Your everyday picks
              stay as they are.
            </p>
            <ul className={styles.lines} style={{ marginTop: 6 }}>
              {profile.lines
                .filter((l) => l.trip === trip)
                .map((line) => (
                  <li key={line.id} className={styles.line}>
                    <span className={styles.lineText}>{line.text}</span>
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => remove(line.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
            </ul>
            <button
              type="button"
              className={styles.everyday}
              onClick={() => toEveryday(trip)}
            >
              Use these every day instead
            </button>
          </section>
        ))}

        <p className={styles.section}>ACCOUNT</p>
        {profile.email ? (
          <div className={styles.rows}>
            <div className={styles.row}>
              <span>Signed in with Google</span>
              <span className={styles.muted}>{profile.email}</span>
            </div>
          </div>
        ) : (
          <>
            <p className={styles.sub}>
              Sign in so your lists and likes follow you to any phone.
            </p>
            <button
              type="button"
              className={styles.google}
              onClick={async () => {
                const error = await startGoogleSignIn("/you");
                if (error) toast("Couldn't reach Google. Try again.");
              }}
            >
              Continue with Google
            </button>
          </>
        )}

        <p className={styles.section}>PRIVACY</p>
        <div className={styles.rows}>
          <div className={styles.row}>
            <span>Appearance</span>
            <span
              className={styles.appearance}
              role="radiogroup"
              aria-label="Appearance"
            >
              {(["auto", "light", "dark"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={appearance === a}
                  className={appearance === a ? styles.on : ""}
                  onClick={() => {
                    setAppearance(a);
                    setAppearanceState(a);
                  }}
                >
                  {a === "auto" ? "Auto" : a === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={profile.consent.location}
            className={styles.row}
            onClick={() => toggle("location")}
          >
            <span>Use my location</span>
            <span
              className={`switch ${profile.consent.location ? "on" : ""}`}
            />
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={profile.consent.publicReviews}
            className={styles.row}
            onClick={() => toggle("public_reviews")}
          >
            <span>Show my reviews to others</span>
            <span
              className={`switch ${profile.consent.publicReviews ? "on" : ""}`}
            />
          </button>
          <Link href="/privacy" className={styles.row}>
            <span>Privacy policy</span>
            <span className={styles.muted}>›</span>
          </Link>
          <button
            type="button"
            className={`${styles.row} ${styles.danger}`}
            onClick={() => setConfirmDelete(true)}
          >
            Delete my data
          </button>
        </div>
        {confirmDelete && (
          <div className={styles.confirm}>
            This deletes your lists, likes, answers and everything above. It
            can&apos;t be undone.
            <div className={styles.confirmBtns}>
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={confirmDeletion}
              >
                Delete everything
              </button>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </main>
      <TabBar active="you" />
    </>
  );
}
