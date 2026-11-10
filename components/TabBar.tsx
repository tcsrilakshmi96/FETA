"use client";

import { useRouter } from "next/navigation";
import Cheese from "@/components/Cheese";
import { useToast } from "@/components/Toast";
import styles from "./TabBar.module.css";

const TABS = [
  { id: "picks", label: "Picks", href: "/picks" },
  { id: "lists", label: "Lists", href: "/lists" },
  { id: "ask", label: "Ask", href: null },
  { id: "style", label: "Style", href: null },
  { id: "you", label: "You", href: "/you" },
] as const;

// Floating glass tab bar. Tabs not built yet say so.
export default function TabBar({ active }: { active: (typeof TABS)[number]["id"] }) {
  const toast = useToast();
  const router = useRouter();
  return (
    <>
      <div className={styles.fade} aria-hidden="true" />
      <nav className={styles.bar} aria-label="Main">
        {TABS.map((tab) =>
          tab.id === "ask" ? (
            <button key={tab.id} type="button" className={styles.item} aria-label="Ask Feta" onClick={() => toast("Ask Feta is coming soon.")}>
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
                if (tab.id === active) return;
                if (tab.href) router.push(tab.href);
                else toast(`${tab.label} is coming soon.`);
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
