"use client";

import { useEffect, useState } from "react";
import type { Coverage } from "@/app/api/admin/coverage/route";
import { supabase } from "@/lib/supabase";
import styles from "./Admin.module.css";

// Founder only (19 Nov 2026: Bengaluru had none of her Reddit list and no
// one noticed): for each city, how many real people searched there in the
// last 30 days and how many of her places and local favourites it has.
// Cities people use with few curated places come first.
export default function AdminCoverage() {
  const [rows, setRows] = useState<Coverage[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    supabase()
      .auth.getSession()
      .then(({ data }) => fetch("/api/admin/coverage", { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } }))
      .then(async (res) => (res.ok ? setRows(((await res.json()) as { rows: Coverage[] }).rows) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className={styles.sub}>Couldn&apos;t load the cities. Has 20261119200000_city_coverage.sql run?</p>;
  if (!rows) return <p className={styles.sub}>Loading…</p>;
  const used = rows.filter((r) => r.people > 0);
  const gaps = used.filter((r) => r.founder + r.local < 10);
  return (
    <>
      <p className={styles.sub}>
        Where people searched in the last 30 days, and how many of your places and local favourites each city has.
        {gaps.length > 0 && ` ${gaps.length} ${gaps.length === 1 ? "city has" : "cities have"} fewer than 10: add places there first.`}
      </p>
      <ul className={styles.list}>
        {[...gaps, ...rows.filter((r) => !gaps.includes(r))].map((r) => (
          <li key={r.cityId} className={gaps.includes(r) ? styles.gap : undefined}>
            <strong>{r.name}</strong>
            <span>
              {r.people > 0 ? `${r.people} ${r.people === 1 ? "person" : "people"} · ` : ""}
              {r.founder} yours · {r.local} local
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
