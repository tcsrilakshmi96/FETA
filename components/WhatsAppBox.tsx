"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import { loadCity } from "@/lib/cities";
import { loadWhatsApp, saveWhatsApp } from "@/lib/db";
import { CALLING_CODES, codeFor, fullNumber, showNumber } from "@/lib/phone";
import styles from "./WhatsAppBox.module.css";

// The optional WhatsApp number for the weekend plan, in Plan my evening
// (testers, 13 Nov 2026: it felt random on Lists). Only used for that, and
// removable here and in You.
export default function WhatsAppBox() {
  const toast = useToast();
  const [whatsApp, setWhatsApp] = useState<string | null | undefined>(undefined);
  const [number, setNumber] = useState("");
  const [callingCode, setCallingCode] = useState("91");

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the city is only readable in the browser
    setCallingCode(codeFor(loadCity()?.country).code);
    loadWhatsApp().then((n) => live && setWhatsApp(n));
    return () => {
      live = false;
    };
  }, []);

  if (whatsApp === undefined) return null;
  const full = fullNumber(callingCode, number);
  return (
    <section className={styles.whatsapp}>
      <p className={styles.waTitle}>Want your weekend plan on WhatsApp?</p>
      {whatsApp ? (
        <>
          <p className={styles.waText}>We&apos;ll send it to {showNumber(whatsApp)} on Fridays. Only used for this.</p>
          <button
            type="button"
            className={styles.waRemove}
            onClick={() => {
              saveWhatsApp(null);
              setWhatsApp(null);
              toast("Number removed");
            }}
          >
            Remove my number
          </button>
        </>
      ) : (
        <>
          <p className={styles.waText}>A short plan for Saturday and Sunday, from your saved places and picks. Only used for this, and you can remove it any time.</p>
          <form
            className={styles.waForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (!full) return;
              saveWhatsApp(full);
              setWhatsApp(full);
              setNumber("");
              toast("You're on the weekend plan list");
            }}
          >
            <label className={styles.waField}>
              <select value={callingCode} onChange={(e) => setCallingCode(e.target.value)} aria-label="Country code">
                {CALLING_CODES.map((c) => (
                  <option key={c.country} value={c.code}>
                    {c.name} +{c.code}
                  </option>
                ))}
              </select>
              <span aria-hidden="true">+{callingCode}</span>
              <input type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="Your number" aria-label="WhatsApp number" value={number} onChange={(e) => setNumber(e.target.value)} />
            </label>
            <button type="submit" className={styles.waBtn} disabled={!full}>
              Send it
            </button>
          </form>
        </>
      )}
    </section>
  );
}
