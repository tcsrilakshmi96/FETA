"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import styles from "./SharedPlace.module.css";

type Shared = { name: string; area: string; mapsUri: string; photo: string | null; credit: string | null };

// What a friend sees from a WhatsApp share: the place, and a way into Feta.
// Nothing about the person who shared it (no diet, no reasons).
export default function SharedPlace() {
  const { id } = useParams<{ id: string }>();
  const [place, setPlace] = useState<Shared | null | "missing">(null);

  useEffect(() => {
    fetch(`/api/place/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : "missing"))
      .then(setPlace)
      .catch(() => setPlace("missing"));
  }, [id]);

  return (
    <main className={styles.screen}>
      <p className={styles.from}>A friend picked this on Feta</p>
      {place === null && <div className={styles.card} />}
      {place === "missing" && <p className={styles.missing}>This place couldn&apos;t be found.</p>}
      {place && place !== "missing" && (
        <div className={styles.card}>
          {place.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={place.photo} alt="" referrerPolicy="no-referrer" />
          )}
          <div className={styles.scrim} />
          <div className={styles.text}>
            <h1 className={styles.name}>{place.name}</h1>
            <p className={styles.area}>{place.area}</p>
          </div>
          {place.credit && (
            <span className={styles.credit}>
              Photo: {place.credit} · <span translate="no">Google Maps</span>
            </span>
          )}
        </div>
      )}
      {place && place !== "missing" && (
        <a className={styles.maps} href={place.mapsUri} target="_blank" rel="noopener noreferrer">
          See it on <span translate="no">Google Maps</span>
        </a>
      )}
      <div className={styles.cta}>
        <p className={styles.pitch}>
          Feta learns your taste and picks <strong>3 places for tonight</strong>, each with a reason.
        </p>
        <Link href="/" className="btn-primary" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
          Get your own picks
        </Link>
      </div>
    </main>
  );
}
