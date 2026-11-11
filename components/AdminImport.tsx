"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import type { City } from "@/lib/cities";
import { supabase } from "@/lib/supabase";
import styles from "./Admin.module.css";

// Founder only: places found in her Instagram stories, matched to Google
// place IDs on her Mac (scripts/match-instagram.mjs). She opens the file
// here; it stays in this browser. Only the places she ticks become Feta
// picks (place ID, her label and her note).

type Found = {
  name: string;
  city: string | null;
  country: string | null;
  kind: "EAT" | "DRINK" | "DO" | "unsure";
  caption: string | null;
  dates: string[];
  times: number;
  confidence: string;
  placeId: string | null;
};
type Live = { found: boolean; name?: string; area?: string; mapsUri?: string; city?: City | null };
type Filter = "food" | "do" | "unsure";

const FILE_KEY = "feta.admin.instagram";
const DONE_KEY = "feta.admin.instagramDone";
const PAGE = 8; // Google is asked about each shown place, so a few at a time

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept for this visit only.
  }
}

const when = (dates: string[]) => {
  const d = dates[0];
  if (!d) return "";
  const [y, m] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(y, (m || 1) - 1, 1));
};

export default function AdminImport({ onAdded }: { onAdded: () => void }) {
  const toast = useToast();
  const [found, setFound] = useState<Found[]>([]);
  const [done, setDone] = useState<Record<string, "yes" | "no">>({});
  const [filter, setFilter] = useState<Filter>("food");
  const [city, setCity] = useState("");
  const [live, setLive] = useState<Record<string, Live>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [kinds, setKinds] = useState<Record<string, "EAT" | "DRINK" | "DO">>({});
  const asked = useRef(new Set<string>());

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- kept in this browser only */
    setFound(read<Found[]>(FILE_KEY, []));
    setDone(read(DONE_KEY, {}));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  async function open(file: File) {
    try {
      const list = (JSON.parse(await file.text()) as Found[]).filter((f) => f.placeId);
      // One row per Google place (a sticker and a caption can name the same one).
      const unique = [...new Map(list.map((f) => [f.placeId, f])).values()];
      setFound(unique);
      write(FILE_KEY, unique);
      toast(`${unique.length} places to go through`);
    } catch {
      toast("That isn't the feta-places.json file");
    }
  }

  const inFilter = (f: Found) =>
    filter === "food" ? f.kind === "EAT" || f.kind === "DRINK" : filter === "do" ? f.kind === "DO" : f.kind === "unsure";
  const todo = found.filter((f) => !done[f.placeId!] && inFilter(f));
  const cities = [...new Set(todo.map((f) => f.city ?? "No city"))];
  const cityShown = cities.includes(city) ? city : (cities[0] ?? "");
  const shown = todo.filter((f) => (f.city ?? "No city") === cityShown).slice(0, PAGE);

  // What Google has for each place on screen, so a wrong match is easy to spot.
  useEffect(() => {
    const missing = shown.filter((f) => !asked.current.has(f.placeId!));
    if (missing.length === 0) return;
    missing.forEach((f) => asked.current.add(f.placeId!));
    (async () => {
      const { data } = await supabase().auth.getSession();
      const token = data.session?.access_token ?? "";
      const got = await Promise.all(
        missing.map(async (f) => {
          const res = await fetch(`/api/admin/place?id=${encodeURIComponent(f.placeId!)}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
          return [f.placeId!, res?.ok ? ((await res.json()) as Live) : { found: false }] as const;
        }),
      );
      setLive((l) => ({ ...l, ...Object.fromEntries(got) }));
    })();
  }, [shown]);

  function decide(f: Found, verdict: "yes" | "no") {
    const next = { ...done, [f.placeId!]: verdict };
    setDone(next);
    write(DONE_KEY, next);
  }

  async function add(f: Found) {
    const l = live[f.placeId!];
    const c = l?.city;
    if (!c) {
      toast("Couldn't tell which city this is in");
      return;
    }
    const kind = kinds[f.placeId!] ?? (f.kind === "unsure" ? "DO" : f.kind);
    const note = (notes[f.placeId!] ?? f.caption ?? "").trim() || `I went in ${when(f.dates)}.`;
    const { error } = await supabase().from("founder_places").insert({
      place_id: f.placeId,
      name: l.name || f.name,
      kind,
      note: note.slice(0, 160),
      city_id: c.id,
      city_name: c.name,
      country: c.country,
      time_zone: c.timeZone,
      currency: c.currency,
    });
    if (error && !error.message.includes("duplicate")) {
      toast("Couldn't save");
      return;
    }
    decide(f, "yes");
    toast(`${l.name || f.name} is a Feta pick`);
    onAdded();
  }

  const left = (k: Filter) =>
    found.filter((f) => !done[f.placeId!] && (k === "food" ? f.kind === "EAT" || f.kind === "DRINK" : k === "do" ? f.kind === "DO" : f.kind === "unsure")).length;

  if (found.length === 0)
    return (
      <section>
        <p className={styles.sub}>
          Open <strong>feta-places.json</strong> from the Instagram data folder on your Desktop. It stays in this browser;
          only the places you tick become Feta picks.
        </p>
        <label className={styles.fileBtn}>
          Open the file
          <input type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} />
        </label>
      </section>
    );

  return (
    <section>
      <p className={styles.sub}>
        Tick the places you&apos;d send a friend to. Your caption becomes the note; change it if you like. Hotels and
        big sights rarely make good picks.
      </p>
      <div className={styles.kinds}>
        {(
          [
            ["food", "Food & drinks"],
            ["do", "Things to do"],
            ["unsure", "Unsure"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={filter === id ? styles.on : ""} onClick={() => setFilter(id)}>
            {label} · {left(id)}
          </button>
        ))}
      </div>
      {cities.length > 0 && (
        <select className={styles.citySelect} value={cityShown} onChange={(e) => setCity(e.target.value)} aria-label="City">
          {cities.map((c) => (
            <option key={c} value={c}>
              {c} ({todo.filter((f) => (f.city ?? "No city") === c).length})
            </option>
          ))}
        </select>
      )}
      {shown.length === 0 && <p className={styles.sub}>All done here.</p>}
      <ul className={styles.drafts}>
        {shown.map((f) => {
          const l = live[f.placeId!];
          const kind = kinds[f.placeId!] ?? (f.kind === "unsure" ? "DO" : f.kind);
          return (
            <li key={f.placeId}>
              <p className={styles.draftHead}>
                <strong>{f.name}</strong>
                <span>
                  {[when(f.dates), f.times > 1 && `posted ${f.times}×`, f.confidence !== "high" && `${f.confidence} confidence`].filter(Boolean).join(" · ")}
                </span>
              </p>
              <p className={styles.draftPeople}>
                {!l ? (
                  "Checking Google Maps…"
                ) : l.found ? (
                  <>
                    Google Maps: {l.name}
                    {l.area ? `, ${l.area}` : ""} ·{" "}
                    <a href={l.mapsUri} target="_blank" rel="noopener noreferrer">
                      open
                    </a>
                  </>
                ) : (
                  "Not found on Google Maps"
                )}
              </p>
              <div className={styles.kinds}>
                {(["EAT", "DRINK", "DO"] as const).map((k) => (
                  <button key={k} type="button" className={k === kind ? styles.on : ""} onClick={() => setKinds((x) => ({ ...x, [f.placeId!]: k }))}>
                    {k}
                  </button>
                ))}
              </div>
              <textarea
                className={styles.draftText}
                style={{ height: 64 }}
                value={notes[f.placeId!] ?? f.caption ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [f.placeId!]: e.target.value }))}
                placeholder={`Your note, e.g. Went in ${when(f.dates)}. Order the…`}
                aria-label={`Your note for ${f.name}`}
                maxLength={160}
              />
              <div className={styles.importBtns}>
                <button type="button" className="btn-primary" disabled={!l?.found} onClick={() => add(f)}>
                  ✓ Feta pick
                </button>
                <button type="button" className={styles.cancel} onClick={() => decide(f, "no")}>
                  ✕ Skip
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
