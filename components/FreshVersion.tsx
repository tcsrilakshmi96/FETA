"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { awayLongEnough, endVisit, markHidden } from "@/lib/visit";

// Keeps an installed Feta fresh. When Feta comes back from the background,
// it reloads quietly at a calm moment (on a main screen, nothing open,
// nothing being typed; never in the middle of setup, a plan or a chat) when
// a newer deploy is live (founder, 18 Nov 2026: closing the app to get an
// update "ruins the experience") or when it was away 30 minutes or more, so
// a new visit starts (founder, 26 Nov 2026; lib/visit.ts).
const CALM = ["/home", "/lists", "/you", "/style"];
const BUILD = process.env.NEXT_PUBLIC_BUILD;

export default function FreshVersion() {
  const path = usePathname();
  const stale = useRef(false); // a newer deploy is live
  const newVisit = useRef(false); // back after 30 minutes away

  // Calm: a main screen, nothing open, nothing typed and not yet saved.
  const calm = (where = window.location.pathname) => CALM.includes(where) && !document.querySelector('[role="dialog"]') && ![...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type]), input[type=text], input[type=search], textarea")].some((e) => e.value.trim());
  const go = () => {
    if (newVisit.current) endVisit();
    window.location.reload();
  };

  useEffect(() => {
    const check = async () => {
      if (document.visibilityState === "hidden") return markHidden();
      // A new visit reloads at once, before the version is asked (tech
      // audit, 26 Nov 2026: Home started a paid search the reload then repeated).
      if (awayLongEnough()) newVisit.current = true;
      if (newVisit.current && calm()) return go();
      if (!stale.current && BUILD && BUILD !== "dev") {
        const live = await fetch("/api/version", { cache: "no-store" })
          .then((r) => r.json() as Promise<{ build?: string }>)
          .catch(() => null);
        stale.current = !!live?.build && live.build !== "dev" && live.build !== BUILD;
      }
      if ((stale.current || newVisit.current) && calm()) go();
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  // Moving to a main screen is a calm moment too.
  useEffect(() => {
    if ((stale.current || newVisit.current) && calm(path)) go();
  }, [path]);

  return null;
}
