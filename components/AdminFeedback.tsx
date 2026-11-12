"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import styles from "./Admin.module.css";

type Item = { id: number; message: string; screen: string | null; screenshot: string | null; user_agent: string | null; created_at: string };

// Founder only: everything sent from the Feedback pill, newest first.
export default function AdminFeedback() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    supabase()
      .from("feedback")
      .select("id, message, screen, screenshot, user_agent, created_at")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setItems((data ?? []) as Item[]));
  }, []);

  if (!items) return <p className={styles.sub}>Loading feedback…</p>;
  if (items.length === 0) return <p className={styles.sub}>No feedback yet.</p>;

  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const phone = (ua: string | null) => (!ua ? "" : /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : "Computer");

  return (
    <section>
      <p className={styles.sub}>{items.length} messages from the Feedback button, newest first. Tap a screenshot to enlarge it.</p>
      <ul className={styles.drafts}>
        {items.map((f) => (
          <li key={f.id}>
            <p className={styles.draftHead}>
              <strong>{f.screen ?? "?"}</strong>
              <span>{[when(f.created_at), phone(f.user_agent)].filter(Boolean).join(" · ")}</span>
            </p>
            <p className={styles.feedbackText}>{f.message}</p>
            {f.screenshot && (
              <button type="button" className={styles.shotBtn} onClick={() => setOpen(open === f.id ? null : f.id)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.screenshot} alt={`Screenshot of ${f.screen ?? "the screen"}`} className={open === f.id ? styles.shotBig : styles.shot} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
