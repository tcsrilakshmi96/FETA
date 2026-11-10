"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import TabBar from "@/components/TabBar";
import { currentUserId, supabase } from "@/lib/supabase";
import styles from "./Style.module.css";

// Style and shopping: coming soon. "Tell me when it's ready" counts
// interest (one row per person in style_interest). No workflow yet.
export default function Style() {
  const [onList, setOnList] = useState(false);

  useEffect(() => {
    let live = true;
    currentUserId().then(async (userId) => {
      if (!userId) return;
      const { data } = await supabase().from("style_interest").select("user_id").eq("user_id", userId).maybeSingle();
      if (live && data) setOnList(true);
    });
    return () => {
      live = false;
    };
  }, []);

  async function join() {
    setOnList(true);
    const userId = await currentUserId();
    if (!userId) return;
    const { error } = await supabase().from("style_interest").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) console.error("Saving Style interest failed", error.message);
  }

  return (
    <>
      <main className={styles.screen}>
        <p className={styles.soon}>COMING SOON</p>
        <h1 className={styles.title}>
          Style, <strong>picked the same way.</strong>
        </h1>
        <p className={styles.sub}>Three outfit and shop picks for where you&apos;re going and what you&apos;re doing. Honest, no ads.</p>
        <div className={styles.collage} aria-hidden="true">
          <span className={styles.big}>
            <Image src="/style/1.jpg" alt="" fill sizes="200px" />
          </span>
          <span>
            <Image src="/style/2.jpg" alt="" fill sizes="160px" />
          </span>
          <span>
            <Image src="/style/3.jpg" alt="" fill sizes="160px" />
          </span>
        </div>
        <div className={styles.bottom}>
          {onList ? (
            <div className={styles.onList}>✓ You&apos;re on the list</div>
          ) : (
            <button type="button" className="btn-primary" style={{ width: "100%" }} onClick={join}>
              Tell me when it&apos;s ready
            </button>
          )}
        </div>
      </main>
      <TabBar active="style" />
    </>
  );
}
