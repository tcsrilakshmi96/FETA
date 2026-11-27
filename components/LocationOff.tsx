"use client";

import { useState } from "react";
import { locationSteps } from "@/lib/near-me";
import sheet from "./Sheet.module.css";
import styles from "./WhereSheet.module.css";

// Near me tapped while the phone or browser has location switched off
// (founder, 27 Nov 2026: "the find my location button doesn't respond… a
// pop up which says switch on your location services"): what to switch on,
// for this phone, then Try again, or search an area instead.
export default function LocationOff({ onRetry, onArea, onClose }: { onRetry: () => void; onArea: () => void; onClose: () => void }) {
  const [steps] = useState(() => locationSteps());
  return (
    <>
      <div className={sheet.dim} style={{ zIndex: 70 }} onClick={onClose} />
      <div className={sheet.sheet} style={{ zIndex: 71 }} role="dialog" aria-label="Location is off">
        <h2 className={sheet.title}>
          Location is <strong>off for Feta</strong>
        </h2>
        <p className={sheet.sub}>To find places near you, switch it on:</p>
        <p className={styles.steps}>{steps}</p>
        <p className={sheet.sub}>Feta uses it only while it&apos;s open, and never keeps where you were.</p>
        <div className={styles.offActions}>
          <button type="button" className="btn-primary" onClick={onRetry}>
            I&apos;ve switched it on · Try again
          </button>
          <button type="button" className={styles.close} onClick={onArea}>
            Search an area instead
          </button>
        </div>
      </div>
    </>
  );
}
