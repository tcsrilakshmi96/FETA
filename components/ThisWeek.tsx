"use client";

import { useEffect, useState } from "react";
import { SearchChip } from "@/components/PickDetails";
import type { City } from "@/lib/cities";
import { fetchThisWeek, type WeekEvent } from "@/lib/picks-client";
import styles from "./ThisWeek.module.css";

// "This week in <city>" on Home (founder, 18 Nov 2026): events for the next
// 7 days, chosen for them, each linking to the organiser's own page to book
// (app/api/this-week). Shown only when there are some.
const day = (iso: string, time: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
  if (!time) return date;
  const [h, m] = time.split(":").map(Number);
  return `${date} · ${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
};

export default function ThisWeek({ city }: { city: City }) {
  const [week, setWeek] = useState<{ events: WeekEvent[]; searchHtml: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetchThisWeek(city.id).then((w) => live && setWeek(w));
    return () => {
      live = false;
    };
  }, [city.id]);

  if (!week?.events.length) return null;
  return (
    <section className={styles.week} aria-label={`This week in ${city.name}`}>
      <p className={styles.kick}>THIS WEEK IN {city.name.toUpperCase()}</p>
      <ul className={styles.row}>
        {week.events.map((e) => (
          <li key={e.url} className={styles.card}>
            <span className={styles.when}>{day(e.date, e.time)}</span>
            <strong className={styles.title}>{e.title}</strong>
            <span className={styles.where}>{[e.venueName, e.priceText].filter(Boolean).join(" · ")}</span>
            {e.because && <span className={styles.why}>{e.because}</span>}
            <a className={styles.book} href={e.url} target="_blank" rel="noopener noreferrer">
              See it on {e.site} ↗
            </a>
          </li>
        ))}
      </ul>
      <SearchChip html={week.searchHtml} />
    </section>
  );
}
