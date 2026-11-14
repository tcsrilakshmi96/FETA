"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import LetsGo from "@/components/LetsGo";
import PickDetails from "@/components/PickDetails";
import TripCard from "@/components/TripCard";
import { loadCity, type City } from "@/lib/cities";
import type { Pick } from "@/lib/picks-client";
import styles from "./TripPage.module.css";

// A saved trip on its own page (founder, 14 Nov 2026: opening a trip from
// Saved should show everything planned, not the chat): the route with the
// stories, getting around, the hotels and the days, all still changeable.
export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [home, setHome] = useState<City | null>(null);
  const [detail, setDetail] = useState<Pick | null>(null);
  const [going, setGoing] = useState<Pick | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the city is only readable in the browser
    setHome(loadCity());
  }, []);

  return (
    <main className={styles.screen}>
      <div className={styles.top}>
        <button type="button" className={styles.back} onClick={() => router.push("/lists")}>
          ‹ Saved
        </button>
        <button type="button" className={styles.chat} onClick={() => router.push(`/ask?trip=${id}`)}>
          Change it in chat 🧀
        </button>
      </div>
      <TripCard id={id} home={home} onStop={setDetail} page />
      {detail && (
        <PickDetails
          pick={detail}
          onClose={() => setDetail(null)}
          onSave={() => setDetail(null)}
          onGo={() => {
            setGoing(detail);
            setDetail(null);
          }}
        />
      )}
      {going && <LetsGo pick={going} cityId={home?.id ?? ""} onClose={() => setGoing(null)} />}
    </main>
  );
}
