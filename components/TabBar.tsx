"use client";

import { useRouter } from "next/navigation";
import Cheese from "@/components/Cheese";
import styles from "./TabBar.module.css";

const TABS = [
  { id: "home", label: "Home", href: "/home" },
  { id: "lists", label: "Lists", href: "/lists" },
  { id: "ask", label: "Ask", href: "/ask" },
  { id: "style", label: "Style", href: "/style" },
  { id: "you", label: "You", href: "/you" },
] as const;

// Floating glass tab bar.
export default function TabBar({ active }: { active: (typeof TABS)[number]["id"] }) {
  const router = useRouter();
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
                if (tab.id !== active && tab.href) router.push(tab.href);
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
