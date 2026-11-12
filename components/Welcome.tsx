"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { restoreFromAccount, saveAgeConfirmed, setUpOnThisPhone } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import styles from "./Welcome.module.css";

export default function Welcome() {
  const [isAdult, setIsAdult] = useState(false);
  const router = useRouter();

  // Returning people skip the setup: straight to their picks, from this
  // phone's copy or, if this phone is already signed in, from their account.
  useEffect(() => {
    if (setUpOnThisPhone()) {
      router.replace("/home");
      return;
    }
    supabase()
      .auth.getSession()
      .then(({ data }) => (data.session ? restoreFromAccount() : false))
      .then((restored) => restored && router.replace("/home"));
  }, [router]);

  return (
    <main className={styles.screen}>
      <div className={styles.photo}>
        {/* Placeholder photo from the design; swap for an Indian scene. */}
        <Image
          src="/welcome.jpg"
          alt=""
          fill
          priority
          sizes="(max-width: 430px) 100vw, 430px"
          className="kenburns"
        />
        <div className={styles.scrim} />
        <div className={styles.promise}>
          <div className={styles.wordmark}>feta</div>
          <h1 className={styles.headline}>
            Tonight&apos;s picks, <strong>chosen for your taste.</strong>
          </h1>
        </div>
      </div>

      <div className={styles.controls}>
        <p className={styles.intro}>
          A few quick questions, six taste cards, then your picks.
        </p>
        <button
          type="button"
          role="checkbox"
          aria-checked={isAdult}
          className={styles.ageRow}
          onClick={() => setIsAdult(!isAdult)}
        >
          <span className={`${styles.tick} ${isAdult ? styles.tickOn : ""}`}>
            {isAdult ? "✓" : ""}
          </span>
          I&apos;m 18 or older
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!isAdult}
          onClick={() => {
            saveAgeConfirmed();
            router.push("/sign-in");
          }}
        >
          Let&apos;s go
        </button>
      </div>
    </main>
  );
}
