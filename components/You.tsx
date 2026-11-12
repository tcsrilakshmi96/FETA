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
import { saveWhatsApp } from "@/lib/db";
import { showNumber } from "@/lib/phone";
import {
  aboutOf,
  addLine,
  cachedProfile,
  deleteMyData,
  editLine,
  loadAppearance,
  loadProfile,
  makeEveryday,
  PEOPLE,
  removeLine,
  setAppearance,
  setConsent,
  type Appearance,
  type Line,
  type Person,
  type Profile,
} from "@/lib/profile-client";
import styles from "./You.module.css";

const SOURCE_LABELS: Record<string, string> = {
  chat: "From Ask Feta",
  checkin: "From an outing",
  tweaks: "From your tweaks",
};

// Lines from the answers and taste cards are changed by redoing them (they
// also drive the filters); lines from chat, tweaks or typed here are words.
const FOOD_KEYS = ["cuisines", "style", "vibe", "diet", "drinks", "spend"];
const DOING_KEYS = ["move_make", "play_unwind", "crowd_circle", "interests"];

function groupOf(line: Line) {
  if (FOOD_KEYS.includes(line.key)) return "food";
  if (DOING_KEYS.includes(line.key)) return "doing";
  return "rest";
}

const fixed = (line: Line) => line.source === "answers" || line.source === "swipes";

// What Feta knows about you: taste, the people you go out with, trips and
// your places. Every line can be changed or removed; settings sit below.
export default function You() {
  const router = useRouter();
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(cachedProfile);
  const [appearance, setAppearanceState] = useState<Appearance>("auto");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cityName, setCityName] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [adding, setAdding] = useState<{ about: Person | null; text: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  if (!profile)
    return (
      <>
        <main className={styles.screen}>
          <h1 className={styles.title}>
            What Feta knows <strong>about you</strong>
          </h1>
          <p className={styles.sub}>Getting your profile…</p>
        </main>
        <TabBar active="you" />
      </>
    );

  const everyday = profile.lines.filter((l) => !l.trip);
  const mine = everyday.filter((l) => !aboutOf(l));
  const trips = [
    ...new Set(profile.lines.filter((l) => l.trip).map((l) => l.trip!)),
  ];

  function remove(id: string) {
    removeLine(id);
    setProfile((p) => p && { ...p, lines: p.lines.filter((l) => l.id !== id) });
    toast("Picks updated");
  }

  function saveEdit() {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) {
      remove(editing.id);
    } else {
      editLine(editing.id, text);
      setProfile(
        (p) =>
          p && {
            ...p,
            lines: p.lines.map((l) =>
              l.id === editing.id ? { ...l, text } : l,
            ),
          },
      );
      toast("Picks updated");
    }
    setEditing(null);
  }

  async function saveAdd() {
    if (!adding?.text.trim()) return;
    const line = await addLine(adding.text, adding.about);
    setAdding(null);
    if (!line) {
      toast("Couldn't save that just now. Try again.");
      return;
    }
    setProfile((p) => p && { ...p, lines: [...p.lines, line] });
    toast("Added. Your picks and Ask Feta will use it.");
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

  function lineRow(line: Line, i: number) {
    if (editing?.id === line.id)
      return (
        <li key={line.id} className={styles.line}>
          <form
            className={styles.editForm}
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit();
            }}
          >
            <input
              autoFocus
              value={editing.text}
              maxLength={80}
              aria-label="Change this line"
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            />
            <button type="submit" className={styles.save}>
              Save
            </button>
          </form>
        </li>
      );
    return (
      <li
        key={line.id}
        className={styles.line}
        style={{ animationDelay: `${i * 0.04}s` }}
      >
        <span className={styles.lineText}>
          {line.text}
          {SOURCE_LABELS[line.source] && (
            <span className={styles.source}>{SOURCE_LABELS[line.source]}</span>
          )}
        </span>
        <span className={styles.lineBtns}>
          {!fixed(line) && (
            <button
              type="button"
              className={styles.remove}
              onClick={() => setEditing({ id: line.id, text: line.text })}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            className={styles.remove}
            onClick={() => remove(line.id)}
          >
            Remove
          </button>
        </span>
      </li>
    );
  }

  function addForm(about: Person | null, placeholder: string) {
    if (adding?.about !== about)
      return (
        <button
          type="button"
          className={styles.add}
          onClick={() => setAdding({ about, text: "" })}
        >
          ＋ {about ? "Add something about them" : "Add something about you"}
        </button>
      );
    return (
      <form
        className={styles.editForm}
        onSubmit={(e) => {
          e.preventDefault();
          saveAdd();
        }}
      >
        <input
          autoFocus
          value={adding.text}
          maxLength={80}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setAdding({ ...adding, text: e.target.value })}
        />
        <button type="submit" className={styles.save} disabled={!adding.text.trim()}>
          Add
        </button>
      </form>
    );
  }

  const groups = [
    { id: "food", title: "FOOD & DRINKS", lines: mine.filter((l) => groupOf(l) === "food") },
    { id: "doing", title: "THINGS TO DO", lines: mine.filter((l) => groupOf(l) === "doing") },
    { id: "rest", title: "HOW YOU GO OUT", lines: mine.filter((l) => groupOf(l) === "rest") },
  ];
  const people = PEOPLE.map((p) => ({
    ...p,
    lines: everyday.filter((l) => aboutOf(l) === p.id),
  }));
  const knownPeople = people.filter((p) => p.lines.length > 0);
  // A person with no lines yet, being added from the chips below.
  const addingPerson = adding?.about && !knownPeople.some((p) => p.id === adding.about) ? adding.about : null;

  return (
    <>
      <main className={styles.screen}>
        <h1 className={styles.title}>
          What Feta knows <strong>about you</strong>
        </h1>
        <p className={styles.sub}>
          Your picks and Ask Feta (the 🧀) work from this. Change anything, and picks follow.
        </p>

        {mine.length === 0 && (
          <p className={styles.empty}>
            Nothing yet. Your answers, taste cards and talks with Ask Feta will fill this in.
          </p>
        )}
        {groups.map(
          (g) =>
            g.lines.length > 0 && (
              <section key={g.id}>
                <p className={styles.group}>{g.title}</p>
                <ul className={styles.lines}>{g.lines.map(lineRow)}</ul>
              </section>
            ),
        )}
        <div className={styles.addWrap}>
          {addForm(null, "e.g. Loves rooftop places")}
        </div>
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
            onClick={() => router.push("/swipes?from=you")}
          >
            Redo taste cards
          </button>
          <button
            type="button"
            className={styles.chipLink}
            onClick={() => router.push("/city?from=you")}
          >
            {cityName ? `City: ${cityName}` : "Choose a city"}
          </button>
        </div>

        <p className={styles.section}>PEOPLE YOU GO OUT WITH</p>
        {knownPeople.length === 0 && !addingPerson && (
          <p className={styles.sub}>
            Tell Feta about them here, or by tapping the 🧀, and date nights and family
            dinners get easier. &ldquo;My partner loves live music.&rdquo;
          </p>
        )}
        {knownPeople.map((p) => (
          <div key={p.id} className={styles.person}>
            <p className={styles.personName}>{p.label}</p>
            <ul className={styles.lines}>{p.lines.map(lineRow)}</ul>
            {addForm(p.id, `About your ${p.label.toLowerCase()}, e.g. prefers early dinners`)}
          </div>
        ))}
        {addingPerson && (
          <div className={styles.person}>
            <p className={styles.personName}>
              {PEOPLE.find((p) => p.id === addingPerson)!.label}
            </p>
            {addForm(addingPerson, "e.g. loves live music")}
          </div>
        )}
        <div className={styles.links}>
          {people
            .filter((p) => p.lines.length === 0 && p.id !== addingPerson)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.chipLink}
                onClick={() => setAdding({ about: p.id, text: "" })}
              >
                ＋ {p.label}
              </button>
            ))}
        </div>

        {trips.length > 0 && <p className={styles.section}>TRIPS</p>}
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

        <p className={styles.section}>YOUR PLACES</p>
        <Link href="/lists" className={styles.places}>
          <span>
            <strong>{profile.places.want}</strong> to try
          </span>
          <span>
            <strong>{profile.places.been}</strong> been
          </span>
          <span className={styles.muted}>My lists ›</span>
        </Link>
        <p className={styles.hint}>
          Places you&apos;ve saved, been to or skipped never come back as new
          picks.
        </p>

        <button
          type="button"
          className={styles.settingsHead}
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          <span>Settings and privacy</span>
          <span className={styles.muted}>{settingsOpen ? "Hide" : "Show"}</span>
        </button>

        {settingsOpen && (
          <div className={styles.settings}>
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
              {profile.whatsapp && (
                <div className={styles.row}>
                  <span>
                    Weekend plan on WhatsApp
                    <span className={styles.source}>
                      {showNumber(profile.whatsapp)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => {
                      saveWhatsApp(null);
                      setProfile({ ...profile, whatsapp: null });
                      toast("Number removed");
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
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
          </div>
        )}
      </main>
      <TabBar active="you" />
    </>
  );
}
