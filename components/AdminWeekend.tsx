"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";
import type { WeekendDraft } from "@/app/api/admin/weekend/route";
import { showNumber } from "@/lib/phone";
import { supabase } from "@/lib/supabase";
import { thisSaturday } from "@/lib/weekend-client";
import styles from "./Admin.module.css";

// Founder only: this weekend's WhatsApp plans. Drafted on tap (each place
// is checked live on Google), edited here, sent from her own WhatsApp.
export default function AdminWeekend() {
  const toast = useToast();
  const [drafts, setDrafts] = useState<WeekendDraft[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const sat = thisSaturday();

  async function load() {
    setLoading(true);
    const { data } = await supabase().auth.getSession();
    const res = await fetch(`/api/admin/weekend?sat=${sat}`, {
      headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
    }).catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      toast("Couldn't draft the plans just now. Try again.");
      return;
    }
    const found = ((await res.json()) as { drafts: WeekendDraft[] }).drafts;
    setDrafts(found);
    setTexts(Object.fromEntries(found.map((d) => [d.userId, d.message])));
  }

  async function markSent(d: WeekendDraft, sent: boolean) {
    const db = supabase();
    const { error } = sent
      ? await db.from("weekend_sent").upsert({ user_id: d.userId, for_date: sat })
      : await db.from("weekend_sent").delete().eq("user_id", d.userId).eq("for_date", sat);
    if (error) console.error("Marking sent failed", error.message);
    setDrafts((all) => all && all.map((x) => (x.userId === d.userId ? { ...x, sentAt: sent ? new Date().toISOString() : null } : x)));
  }

  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${sat}T12:00:00`));

  return (
    <section>
      <p className={styles.sub}>
        For everyone who added a WhatsApp number in My lists. Drafted from the places they ticked for this weekend and
        their weekend picks, with opening hours checked for Saturday {day}. Read it, change anything, then send it from
        your WhatsApp.
      </p>
      <button type="button" className="btn-primary" style={{ marginTop: 14 }} disabled={loading} onClick={load}>
        {loading ? "Drafting…" : drafts ? "Draft again" : "Draft this weekend's plans"}
      </button>
      <p className={styles.costNote}>Each place is looked up live on Google, about ₹2 a place.</p>

      {drafts?.length === 0 && <p className={styles.sub}>No one has added a WhatsApp number yet.</p>}
      <ul className={styles.drafts}>
        {(drafts ?? []).map((d) => {
          const text = texts[d.userId] ?? d.message;
          const digits = d.whatsapp.replace(/\D/g, "");
          return (
            <li key={d.userId} className={d.sentAt ? styles.paused : ""}>
              <p className={styles.draftHead}>
                <strong>{showNumber(d.whatsapp)}</strong>
                <span>
                  {[d.city, d.stops.filter((s) => s.ticked).length && `${d.stops.filter((s) => s.ticked).length} ticked`, d.sentAt && "Sent ✓"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </p>
              {d.people.length > 0 && <p className={styles.draftPeople}>Knows: {d.people.join(" · ")}</p>}
              <textarea
                className={styles.draftText}
                value={text}
                onChange={(e) => setTexts((t) => ({ ...t, [d.userId]: e.target.value }))}
                aria-label={`Plan for ${showNumber(d.whatsapp)}`}
              />
              <div className={styles.actions}>
                <a
                  className="btn-primary"
                  href={`https://wa.me/${digits}?text=${encodeURIComponent(text)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => markSent(d, true)}
                >
                  Send on WhatsApp
                </a>
                {d.sentAt && (
                  <button type="button" className={styles.cancel} onClick={() => markSent(d, false)}>
                    Not sent
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
