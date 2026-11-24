"use client";

import { useEffect, useState } from "react";
import expected from "@/lib/schema-expected.json";
import { supabase } from "@/lib/supabase";
import type { Health } from "@/app/api/health/route";
import styles from "./Admin.module.css";

// The database check (founder, 18 Nov 2026): what the code expects
// (lib/schema-expected.json, from the migrations) against the live
// database. Shows only when a migration never ran, and names it, so a
// skipped one is caught the same day instead of failing quietly for days.
// Also whether Gemini is answering (founder, 21 Nov 2026: its credit ran
// out and picks and Style failed quietly).
type Live = { functions: string[]; tables: string[]; columns: string[] };

export default function AdminHealth() {
  const [missing, setMissing] = useState<string[] | null>(null);
  const [gemini, setGemini] = useState<Health | null>(null);

  useEffect(() => {
    supabase()
      .auth.getSession()
      .then(({ data }) => fetch("/api/health", { headers: { authorization: `Bearer ${data.session?.access_token ?? ""}` } }))
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : null))
      .then(setGemini)
      .catch(() => setGemini(null));
  }, []);

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

  const down = gemini && gemini.gemini !== "ok";
  const noWrites = gemini?.writes === "failing";
  if (!missing?.length && !down && !noWrites) return null;
  return (
    <>
      {noWrites && (
        <div className={styles.health} role="alert">
          <strong>Feta can&apos;t write its cost log</strong>
          <span>Spending isn&apos;t being recorded, so the daily limits can&apos;t stop it. In Vercel → Settings → Environment Variables, FETA_WRITE_KEY must match the one in .env.local (Claude can copy it to your clipboard), then redeploy.</span>
        </div>
      )}
      {down && (
        <div className={styles.health} role="alert">
          <strong>{gemini.gemini === "no_credit" ? "Gemini has run out of credit" : "Gemini isn’t answering"}</strong>
          <span>Picks ranking and all of Style are off until it&apos;s back. {gemini.detail}</span>
        </div>
      )}
      {!!missing?.length && <MissingMigrations missing={missing} />}
    </>
  );
}

function MissingMigrations({ missing }: { missing: string[] }) {
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
