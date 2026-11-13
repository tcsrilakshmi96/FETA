"use client";

import { usePathname, useRouter } from "next/navigation";
import Cheese from "@/components/Cheese";
import styles from "./TabBar.module.css";

// Three tabs (Anj's flow, 14 Nov 2026): Picks + Style (Home), Saved and Ask
// Feta. You (preferences and account) opens from the round button on Home.
const TABS = [
  { id: "home", label: "Picks + Style", href: "/home" },
  { id: "lists", label: "Saved", href: "/lists" },
  { id: "ask", label: "Ask", href: "/ask" },
] as const;

// Floating glass tab bar.
export default function TabBar({ active: page }: { active: "home" | "lists" | "ask" | "style" | "you" }) {
  // Style lives with the picks, so its tab is lit there too.
  const active = page === "style" ? "home" : page;
  const router = useRouter();
  const path = usePathname();
  return (
    <>
      <div className={styles.fade} aria-hidden="true" />
      <nav className={styles.bar} aria-label="Main">
        {TABS.map((tab) =>
          tab.id === "ask" ? (
            <button key={tab.id} type="button" className={styles.item} aria-label="Ask Feta" onClick={() => router.push("/ask")}>
              <span className={styles.askTile}>
                <span className={styles.pop}>
                  <Cheese />
                </span>
              </span>
            </button>
          ) : (
            <button
              key={tab.id}
              type="button"
              className={`${styles.item} ${tab.id === active ? styles.active : ""}`}
              aria-current={tab.id === active ? "page" : undefined}
              onClick={() => {
                // Home is lit on a picks list too; tapping it goes back Home.
                if (tab.href && path !== tab.href) router.push(tab.href);
              }}
            >
              <span className={styles.label}>{tab.label}</span>
              <span className={styles.dot} />
            </button>
          ),
        )}
      </nav>
    </>
  );
}
