"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";
import { addLine } from "@/lib/profile-client";
import styles from "./TellFeta.module.css";

// "Tell Feta what you like" (founder, 15 Nov 2026: "I can't see a place
// where they can add further things they like"). What they type is saved
// as a line in their own words, and the next search looks for it
// (lib/server/taste-reader.ts), so it changes the picks straight away.
export default function TellFeta({ hint, onAdded }: { hint: string; onAdded?: (text: string) => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const words = text.trim();
    if (!words || busy) return;
    setBusy(true);
    const line = await addLine(words, null);
    setBusy(false);
    if (!line) {
      toast("Couldn't save that just now. Try again?");
      return;
    }
    setText("");
    toast("Got it. Feta will look for that.");
    onAdded?.(words);
  }

  return (
    <form className={styles.box} onSubmit={send}>
      <p className={styles.title}>Tell Feta what you like</p>
      <div className={styles.row}>
        <input className={styles.field} value={text} onChange={(e) => setText(e.target.value)} placeholder={hint} maxLength={80} aria-label="Tell Feta what you like" />
        <button type="submit" className={styles.send} disabled={!text.trim() || busy} aria-label="Add">
          {busy ? "…" : "＋"}
        </button>
      </div>
    </form>
  );
}
