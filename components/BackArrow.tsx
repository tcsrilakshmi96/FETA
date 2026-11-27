"use client";

import { useRouter } from "next/navigation";
import styles from "./BackArrow.module.css";

// One back arrow, top left, on every screen that has no other way back
// (testers, 26 Nov 2026: "navigation and going back are poor"; founder: "just
// the arrow"). It goes to the screen they came from, or Home when Feta was
// opened straight on this screen. onBack replaces that (a sheet closes).
export default function BackArrow({ onBack, label = "Back", floating = false }: { onBack?: () => void; label?: string; floating?: boolean }) {
  const router = useRouter();
  function back() {
    if (onBack) return onBack();
    if (window.history.length > 1) router.back();
    else router.push("/home");
  }
  return (
    <button type="button" className={`${styles.back} ${floating ? styles.floating : ""}`} aria-label={label} onClick={back}>
      ‹
    </button>
  );
}
