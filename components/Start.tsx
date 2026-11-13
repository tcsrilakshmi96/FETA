"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { saveProfileBasicsToDb } from "@/lib/db";
import { loadName, loadWants, saveName, saveWants, WANTS, type Want } from "@/lib/profile";
import styles from "./Setup.module.css";

// After the intro: their first name (optional; testers' feedback then has a
// name even without sign-in) and what they want from Feta (Anj's flow). Home
// leads with what they pick, and only those questions are asked now.
export default function Start() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [wants, setWants] = useState<Want[]>(["food", "do"]);
  const [fromYou, setFromYou] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- saved on this phone, only readable in the browser */
    setName(loadName());
    setWants(loadWants());
    setFromYou(new URLSearchParams(window.location.search).get("from") === "you");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  function toggle(id: Want) {
    setWants(wants.includes(id) ? wants.filter((w) => w !== id) : [...wants, id]);
  }

  function next() {
    const first = name.trim().slice(0, 40);
    saveName(first);
    saveWants(wants);
    saveProfileBasicsToDb(first, wants);
    router.push(fromYou ? "/you" : "/questions");
  }

  return (
    <main className={styles.screen}>
      <p className={styles.kick}>Let&apos;s set you up</p>
      <h1 className={styles.title} style={{ marginTop: 8 }}>
        Hi! What should we <strong>call you?</strong>
      </h1>
      <input
        className={styles.field}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your first name"
        aria-label="Your first name"
        maxLength={40}
        autoComplete="given-name"
      />
      <h2 className={`${styles.title} ${styles.titleSmall}`}>
        And what do you want <strong>from Feta?</strong>
      </h2>
      <p className={styles.sub}>Pick all that fit. You can change it any time.</p>
      <div className={styles.wants}>
        {WANTS.map((w) => (
          <button
            key={w.id}
            type="button"
            aria-pressed={wants.includes(w.id)}
            className={`${styles.want} ${w.image ? "" : styles.wantPlain} ${wants.includes(w.id) ? styles.wantOn : ""}`}
            onClick={() => toggle(w.id)}
          >
            {w.image ? <Image src={w.image} alt="" fill sizes="200px" /> : <b className={styles.glyph}>✧</b>}
            <span>
              <strong>{w.label}</strong>
              <small>{w.sub}</small>
            </span>
          </button>
        ))}
      </div>
      <div className={styles.grow} />
      <button type="button" className="btn-primary" disabled={wants.length === 0} onClick={next}>
        {fromYou ? "Save" : "Continue"}
      </button>
    </main>
  );
}
