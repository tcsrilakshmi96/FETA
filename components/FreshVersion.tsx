"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Keeps an installed Feta up to date (founder, 18 Nov 2026: closing the app
// to get an update "ruins the experience"). When Feta comes back from the
// background, it asks which deploy is live; if it's newer, the page reloads
// quietly at a calm moment (on a main screen, nothing open, nothing being
// typed), never in the middle of setup, a plan or a chat.
const CALM = ["/", "/home", "/lists", "/you", "/style"];
const BUILD = process.env.NEXT_PUBLIC_BUILD;

export default function FreshVersion() {
  const path = usePathname();
  const stale = useRef(false);

  useEffect(() => {
    if (!BUILD || BUILD === "dev") return;
    const calm = () => CALM.includes(window.location.pathname) && !document.querySelector('[role="dialog"]') && !(document.activeElement instanceof HTMLInputElement);
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      if (!stale.current) {
        const live = await fetch("/api/version", { cache: "no-store" })
          .then((r) => r.json() as Promise<{ build?: string }>)
          .catch(() => null);
        stale.current = !!live?.build && live.build !== "dev" && live.build !== BUILD;
      }
      if (stale.current && calm()) window.location.reload();
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  // Moving to a main screen is a calm moment too.
  useEffect(() => {
    if (stale.current && CALM.includes(path) && !document.querySelector('[role="dialog"]')) window.location.reload();
  }, [path]);

  return null;
}
