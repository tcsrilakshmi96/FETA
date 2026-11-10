"use client";

import Cheese from "@/components/Cheese";
import { useToast } from "@/components/Toast";
import styles from "./TabBar.module.css";

const TABS = [
  { id: "picks", label: "Picks" },
  { id: "lists", label: "Lists" },
  { id: "ask", label: "Ask" },
  { id: "style", label: "Style" },
  { id: "you", label: "You" },
] as const;

// Floating glass tab bar. Only Picks exists so far; the rest say so.
export default function TabBar({ active }: { active: (typeof TABS)[number]["id"] }) {
  const toast = useToast();
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
              onClick={() => tab.id !== active && toast(`${tab.label} is coming soon.`)}
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
