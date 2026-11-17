"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import styles from "./AdminUsage.module.css";

// Usage (founder, 17 Nov 2026; mock-up "usage"): unique and new people,
// retention by the week people joined, and where new people drop off.
// Counts only, never who. From usage_dashboard (admins only).

type Cohort = { week: string; people: number; d1: number | null; d7: number | null; d30: number | null };
type Numbers = {
  days: number;
  test_people: number;
  unique_people: number;
  unique_people_before: number;
  new_people: number;
  new_people_google: number;
  active_today: number;
  days_per_week: number | null;
  funnel: { opened: number; answered: number; saw_picks: number; did_something: number; came_back: number };
  retention: Cohort[];
  retention_google: Cohort[];
};

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 3650, label: "All time" },
];

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
// Darker for more who came back: one hue, five steps.
const step = (p: number) => (p >= 60 ? 4 : p >= 45 ? 3 : p >= 30 ? 2 : p >= 15 ? 1 : 0);
const weekName = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00Z`));

export default function AdminUsage() {
  const [days, setDays] = useState(7);
  const [who, setWho] = useState<"all" | "google">("all");
  const [realOnly, setRealOnly] = useState(true);
  const [data, setData] = useState<Numbers | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    supabase()
      .rpc("usage_dashboard", { days, real_only: realOnly })
      .then(({ data: d, error }) => {
        if (!live) return;
        if (error) {
          console.error(error.message);
          setFailed(true);
        } else {
          setFailed(false);
          setData(d as Numbers);
        }
      });
    return () => {
      live = false;
    };
  }, [days, realOnly]);

  if (failed) return <p className={styles.note}>Couldn&apos;t load the numbers. Try again in a minute.</p>;
  if (!data) return <p className={styles.note}>Counting…</p>;

  const change = data.unique_people - data.unique_people_before;
  const cohorts = who === "all" ? data.retention : data.retention_google;
  const f = data.funnel;
  const funnel = [
    { label: "Opened Feta", n: f.opened },
    { label: "Finished the questions", n: f.answered },
    { label: "Saw picks", n: f.saw_picks },
    { label: "Saved, shared or planned", n: f.did_something },
    { label: "Came back another day", n: f.came_back },
  ];
  const period = RANGES.find((r) => r.days === days)?.label.toLowerCase();

  return (
    <div className={styles.usage}>
      <div className={styles.range} role="tablist" aria-label="Period">
        {RANGES.map((r) => (
          <button key={r.days} type="button" role="tab" aria-selected={days === r.days} className={days === r.days ? styles.on : ""} onClick={() => setDays(r.days)}>
            {r.label}
          </button>
        ))}
      </div>

      <button type="button" role="switch" aria-checked={realOnly} className={styles.real} onClick={() => setRealOnly(!realOnly)}>
        <span>
          Real people only
          <small>{data.test_people ? `${data.test_people} test visitor${data.test_people === 1 ? "" : "s"} (opened with ?qa=1) ${realOnly ? "left out" : "included"}` : "No test visitors in this period"}</small>
        </span>
        <span className={`switch ${realOnly ? "on" : ""}`} />
      </button>

      <h3>People</h3>
      <div className={styles.tiles}>
        <div>
          <b>{data.unique_people}</b>
          <span>unique people</span>
          {days < 3650 && <small>{change === 0 ? "same as" : `${change > 0 ? "↑" : "↓"} ${Math.abs(change)} vs`} the {days === 1 ? "day" : `${days} days`} before</small>}
        </div>
        <div>
          <b>{data.new_people}</b>
          <span>new people</span>
          <small>{data.new_people_google} signed in with Google</small>
        </div>
        <div>
          <b>{data.active_today}</b>
          <span>active today</span>
          <small>opened or used Feta today</small>
        </div>
        <div>
          <b>{data.days_per_week ?? "–"}</b>
          <span>days a week</span>
          <small>{data.days_per_week === null ? "pick 7 days or more" : "average, for active people"}</small>
        </div>
      </div>

      <h3>Who comes back</h3>
      <div className={styles.range} role="tablist" aria-label="Which people">
        <button type="button" role="tab" aria-selected={who === "all"} className={who === "all" ? styles.on : ""} onClick={() => setWho("all")}>
          Everyone
        </button>
        <button type="button" role="tab" aria-selected={who === "google"} className={who === "google" ? styles.on : ""} onClick={() => setWho("google")}>
          Signed in with Google
        </button>
      </div>
      {cohorts.length === 0 ? (
        <p className={styles.note}>No one has joined in the last 8 weeks{who === "google" ? " and signed in" : ""}.</p>
      ) : (
        <table className={styles.table} aria-label="Retention by the week people joined">
          <thead>
            <tr>
              <th>Joined</th>
              <th className={styles.num}>People</th>
              <th className={styles.num}>Day 1</th>
              <th className={styles.num}>Day 7</th>
              <th className={styles.num}>Day 30</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.week}>
                <td className={styles.week}>w/c {weekName(c.week)}</td>
                <td className={styles.num}>{c.people}</td>
                {(["d1", "d7", "d30"] as const).map((k) => {
                  const n = c[k];
                  if (n === null) return <td key={k} className={styles.na}>–</td>;
                  const p = pct(n, c.people);
                  const day = k === "d1" ? "on day 1" : k === "d7" ? "within 7 days" : "within 30 days";
                  return (
                    <td key={k} className={`${styles.cell} ${styles[`s${step(p)}`]}`} title={`${n} of ${c.people} came back ${day}`} aria-label={`${n} of ${c.people} came back ${day}`}>
                      {p}%
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={styles.legend}>
        fewer {[0, 1, 2, 3, 4].map((i) => <i key={i} className={styles[`s${i}`]} />)} more came back · – too soon to tell
      </p>

      <h3>From first open to coming back</h3>
      <p className={styles.note}>People who joined {days === 1 ? "today" : days === 3650 ? "ever" : `in the last ${period}`}.</p>
      <div className={styles.funnel}>
        {funnel.map((s, i) => (
          <div key={s.label} className={styles.step}>
            <span>{s.label}</span>
            <b>{i === 0 ? s.n : `${s.n} · ${pct(s.n, f.opened)}%`}</b>
            <span className={styles.track}>
              <span style={{ width: `${pct(s.n, f.opened)}%` }} />
            </span>
          </div>
        ))}
      </div>

      <p className={styles.foot}>
        A person is one Feta account: on one phone and browser until they sign in with Google, then the same on every phone. So &quot;Everyone&quot; can miss people who came back on another phone or after Safari cleared its data; &quot;Signed in&quot; is the reliable number. Opening Feta counts from 18 Nov 2026; before that, only searches, chats, saves and shares. Your own account isn&apos;t counted, nor (with Real people only) visitors who opened Feta with ?qa=1. Days are UTC.
      </p>
    </div>
  );
}
