"use client";

import { TESTER_FORM } from "@/components/Feedback";
import { useEffect, useState } from "react";
import Mascot from "@/components/Mascot";
import { isSignedIn } from "@/lib/auth";
import { currentUserId, supabase } from "@/lib/supabase";
import styles from "./Sheet.module.css";
import { popUpSlot } from "@/lib/popups";
import { VISIT } from "@/lib/visit";

// The tester form (founder, 18 Nov 2026): once someone has really tried
// Feta (their second visit), a card asks them to fill in the Google Form.
// Firm but never a lock: Later brings it back on every visit until they
// open it (a Google Form can't tell Feta it was sent). Replaced the five
// tap-to-answer questions, so testers get one ask, not two.
const FORM = TESTER_FORM;
const VISITS_KEY = "feta.visits";
const OPENED_KEY = "feta.formOpened";
const COUNTED = `${VISIT}counted`;
const LATER = `${VISIT}formLater`;

export default function TesterForm() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let due = false;
    try {
      if (localStorage.getItem(OPENED_KEY)) return;
      // Counted once a visit (lib/visit.ts); asks from the second.
      if (!sessionStorage.getItem(COUNTED)) {
        sessionStorage.setItem(COUNTED, "1");
        localStorage.setItem(VISITS_KEY, String(Number(localStorage.getItem(VISITS_KEY) ?? 0) + 1));
      }
      due = Number(localStorage.getItem(VISITS_KEY)) >= 2 && !sessionStorage.getItem(LATER);
    } catch {
      return;
    }
    if (!due) return;
    // After Home has settled, never on top of another pop-up, and only once
    // "Save your taste" has had its turn (it asks first).
    let live = true;
    const slot = popUpSlot(3);
    const t = setTimeout(async () => {
      let asked = false;
      try {
        asked = !!localStorage.getItem("feta.saveTasteAsked");
      } catch {
        // Treated as not asked yet.
      }
      if (!asked && !(await isSignedIn())) return slot.none();
      if (live) slot.ready(() => live && (setOpen(true), true));
    }, 2500);
    return () => {
      live = false;
      clearTimeout(t);
      slot.cancel();
    };
  }, []);

  async function fill() {
    window.open(FORM, "_blank", "noopener");
    setOpen(false);
    try {
      localStorage.setItem(OPENED_KEY, "1");
    } catch {
      // Asked again next visit; that's all.
    }
    // Counted with the rest of the feedback, so the sheet shows who opened it.
    const userId = await currentUserId();
    if (userId) await supabase().from("feedback").insert({ user_id: userId, message: "Opened the tester form", screen: "/home (tester form)", user_agent: navigator.userAgent.slice(0, 300) });
  }

  function later() {
    setOpen(false);
    try {
      sessionStorage.setItem(LATER, "1");
    } catch {
      // Fine.
    }
  }

  if (!open) return null;
  return (
    <>
      <div className={styles.dim} />
      <div className={styles.sheet} role="dialog" aria-label="Help shape Feta">
        <Mascot pose="wave" size={96} pop />
        <p className={styles.kick}>You&apos;re one of the first</p>
        <h2 className={styles.title}>
          Help shape <strong>Feta</strong>
        </h2>
        <p className={styles.sub}>A short form, about 2 minutes. What you say decides what we build next.</p>
        <button type="button" className={`btn-primary ${styles.go}`} onClick={fill}>
          Fill it in
        </button>
        <button type="button" className={styles.ghost} onClick={later}>
          Later
        </button>
      </div>
    </>
  );
}
