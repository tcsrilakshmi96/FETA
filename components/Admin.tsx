"use client";

import { useEffect, useState } from "react";
import AdminFeedback from "@/components/AdminFeedback";
import AdminImport from "@/components/AdminImport";
import AdminWeekend from "@/components/AdminWeekend";
import { useToast } from "@/components/Toast";
import { findCities, loadCity, type City } from "@/lib/cities";
import { readGoogleReturn, signInToExistingAccount, startGoogleSignIn } from "@/lib/auth";
import { currentUserId, supabase } from "@/lib/supabase";
import styles from "./Admin.module.css";

type Result = { placeId: string; name: string; area: string };
type FetaPlace = { id: string; place_id: string; name: string; kind: string; note: string; city_id: string; city_name: string | null; active: boolean };

// Founder only: add and manage Feta picks (her own places, with a note).
export default function Admin() {
  const toast = useToast();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [city, setCity] = useState<City | null>(null);
  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState<City[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [chosen, setChosen] = useState<Result | null>(null);
  const [kind, setKind] = useState<"EAT" | "DRINK" | "DO">("EAT");
  const [note, setNote] = useState("");
  const [places, setPlaces] = useState<FetaPlace[]>([]);
  const [editing, setEditing] = useState<{ id: string; note: string } | null>(null);
  const [tab, setTab] = useState<"picks" | "weekend" | "instagram" | "feedback">("picks");

  async function refresh() {
    const { data } = await supabase().from("founder_places").select("id, place_id, name, kind, note, city_id, city_name, active").order("created_at", { ascending: false });
    setPlaces((data ?? []) as FetaPlace[]);
  }

  useEffect(() => {
    // Back from Google: the founder's account already exists, so sign in to it.
    if (readGoogleReturn().errorCode === "identity_already_exists") {
      signInToExistingAccount("/admin");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the city is only readable in the browser
    setCity(loadCity());
    currentUserId().then(async () => {
      const { data } = await supabase().rpc("is_admin");
      setAllowed(data === true);
      if (data === true) refresh();
    });
  }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const { data } = await supabase().auth.getSession();
    if (!city) return;
    const res = await fetch(`/api/admin/search?city=${city.id}&q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    });
    setResults(res.ok ? ((await res.json()) as { results: Result[] }).results : []);
  }

  async function save() {
    if (!chosen || !city || !note.trim()) return;
    const { error } = await supabase().from("founder_places").insert({
      place_id: chosen.placeId,
      name: chosen.name,
      kind,
      note: note.trim(),
      city_id: city.id,
      city_name: city.name,
      country: city.country,
      time_zone: city.timeZone,
      currency: city.currency,
    });
    if (error) {
      toast(error.message.includes("duplicate") ? "That place is already a Feta pick" : "Couldn't save");
      return;
    }
    toast("Added as a Feta pick");
    setChosen(null);
    setNote("");
    setResults([]);
    setQuery("");
    refresh();
  }

  async function toggle(p: FetaPlace) {
    await supabase().from("founder_places").update({ active: !p.active }).eq("id", p.id);
    refresh();
  }

  async function remove(p: FetaPlace) {
    await supabase().from("founder_places").delete().eq("id", p.id);
    refresh();
  }

  if (allowed === null) return <main className={styles.screen} />;
  if (!allowed) {
    return (
      <main className={styles.screen}>
        <h1 className={styles.title}>Not for you, sorry.</h1>
        <p className={styles.sub}>This page is only for Feta&apos;s founder. Sign in with the founder&apos;s Google account.</p>
        <button
          type="button"
          className="btn-primary"
          style={{ width: "100%", marginTop: 18 }}
          onClick={async () => {
            const error = await startGoogleSignIn("/admin");
            if (error) toast("Couldn't reach Google. Try again.");
          }}
        >
          Continue with Google
        </button>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <h1 className={styles.title}>
        Feta <strong>admin</strong>
      </h1>
      <div className={styles.tabs} role="tablist">
        {(
          [
            ["picks", "Feta picks"],
            ["weekend", "Weekend plans"],
            ["instagram", "From Instagram"],
            ["feedback", "Feedback"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? styles.on : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "weekend" && <AdminWeekend />}
      {tab === "instagram" && <AdminImport onAdded={refresh} />}
      {tab === "feedback" && <AdminFeedback />}
      {tab === "picks" && (
      <>
      <p className={styles.sub}>Your own places. One shows up in someone&apos;s 3 whenever it fits their hard filters, with your note.</p>

      <form
        className={styles.search}
        onSubmit={async (e) => {
          e.preventDefault();
          setCityResults(await findCities(cityQuery));
        }}
      >
        <input value={cityQuery} onChange={(e) => setCityQuery(e.target.value)} placeholder={city ? `City: ${city.name}` : "Which city?"} aria-label="City" />
        <button type="submit">Change</button>
      </form>
      {cityResults.length > 0 && (
        <div className={styles.cities}>
          {cityResults.slice(0, 5).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setCity(c);
                setCityResults([]);
                setCityQuery("");
              }}
            >
              {c.name}, {c.countryName}
            </button>
          ))}
        </div>
      )}

      {!chosen ? (
        <>
          <form className={styles.search} onSubmit={search}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a place, e.g. Toit" aria-label="Find a place" />
            <button type="submit">Find</button>
          </form>
          <ul className={styles.results}>
            {results.map((r) => (
              <li key={r.placeId}>
                <button type="button" onClick={() => setChosen(r)}>
                  <strong>{r.name}</strong> <span>{r.area}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className={styles.form}>
          <p className={styles.chosen}>
            <strong>{chosen.name}</strong> · {chosen.area}
          </p>
          <div className={styles.kinds}>
            {(["EAT", "DRINK", "DO"] as const).map((k) => (
              <button key={k} type="button" className={k === kind ? styles.on : ""} onClick={() => setKind(k)}>
                {k}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Your note, e.g. Went in March. Order the mushroom risotto."
            aria-label="Your note"
            maxLength={160}
          />
          <div className={styles.actions}>
            <button type="button" className="btn-primary" disabled={!note.trim()} onClick={save}>
              Add as a Feta pick
            </button>
            <button type="button" className={styles.cancel} onClick={() => setChosen(null)}>
              Back
            </button>
          </div>
        </div>
      )}

      <p className={styles.section}>YOUR PLACES ({places.length})</p>
      <ul className={styles.list}>
        {places.map((p) => (
          <li key={p.id} className={p.active ? "" : styles.paused}>
            <div>
              <strong>{p.name}</strong> <span>· {p.kind} · {p.city_name ?? ""}</span>
              {editing?.id === p.id ? (
                <form
                  className={styles.noteEdit}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await supabase().from("founder_places").update({ note: editing.note.trim() }).eq("id", p.id);
                    setEditing(null);
                    refresh();
                  }}
                >
                  <textarea autoFocus value={editing.note} maxLength={160} onChange={(e) => setEditing({ ...editing, note: e.target.value })} placeholder="A tip for friends, e.g. order the filter coffee" aria-label={`Note for ${p.name}`} />
                  <button type="submit">Save</button>
                </form>
              ) : (
                <button type="button" className={styles.noteBtn} onClick={() => setEditing({ id: p.id, note: p.note })}>
                  {p.note ? `“${p.note}”` : "＋ Add a tip"}
                </button>
              )}
            </div>
            <div className={styles.rowActions}>
              <button type="button" onClick={() => toggle(p)}>
                {p.active ? "Pause" : "Show"}
              </button>
              <button type="button" onClick={() => remove(p)}>
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      </>
      )}
    </main>
  );
}
