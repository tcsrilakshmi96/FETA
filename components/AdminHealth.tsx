"use client";

import { useEffect, useState } from "react";
import expected from "@/lib/schema-expected.json";
import { supabase } from "@/lib/supabase";
import styles from "./Admin.module.css";

// The database check (founder, 18 Nov 2026): what the code expects
// (lib/schema-expected.json, from the migrations) against the live
// database. Shows only when a migration never ran, and names it, so a
// skipped one is caught the same day instead of failing quietly for days.
type Live = { functions: string[]; tables: string[]; columns: string[] };

export default function AdminHealth() {
  const [missing, setMissing] = useState<string[] | null>(null);

  useEffect(() => {
    supabase()
      .rpc("schema_objects")
      .then(({ data, error }) => {
        // Before its own migration has run, the check can't look yet.
        if (error) return setMissing(["20261118130000_schema_health.sql"]);
        const live = data as Live;
        const has = (e: (typeof expected)[number]) =>
          e.kind === "function" ? live.functions.includes(e.name) : e.kind === "table" ? live.tables.includes(e.name) : live.columns.includes(e.name);
        setMissing([...new Set(expected.filter((e) => !has(e)).map((e) => e.file))]);
      });
  }, []);

  if (!missing?.length) return null;
  return (
    <div className={styles.health} role="alert">
      <strong>The database is missing {missing.length === 1 ? "a migration" : `${missing.length} migrations`}</strong>
      <span>Run {missing.length === 1 ? "it" : "them, in this order,"} in the Supabase SQL Editor (Claude can put each on your clipboard):</span>
      <ul>
        {missing.sort().map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  );
}
