"use client";

import { useEffect, useState } from "react";
import LetsGo from "@/components/LetsGo";
import PickDetails, { lovedLabel } from "@/components/PickDetails";
import PickPhoto from "@/components/PickPhoto";
import { useToast } from "@/components/Toast";
import { formatDistance } from "@/lib/cities";
import { savePickAction } from "@/lib/db";
import type { Origin } from "@/lib/origin";
import { fetchFetaPicks } from "@/lib/picks-client";
import type { Pick, When } from "@/lib/server/picks";
import sheet from "./Sheet.module.css";
import styles from "./FetaPicksSheet.module.css";

// "Feta Picks near you" (founder, 16 Nov 2026): the founder's own places
// (★ with her note) and places Feta users with a similar taste love, that
// fit their diet and budget, nearest first.
export default function FetaPicksSheet({ origin, when, onClose }: { origin: Origin; when: When; onClose: () => void }) {
  const toast = useToast();
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const [open, setOpen] = useState<Pick | null>(null);
  const [going, setGoing] = useState<Pick | null>(null);

  useEffect(() => {
    let live = true;
    fetchFetaPicks(origin, when).then((r) => {
      if (!live) return;
      setPicks(r.picks ?? []);
      setNotice(r.notice ?? r.error);
    });
    return () => {
      live = false;
    };
  }, [origin, when]);

  function save(p: Pick) {
    savePickAction(p.placeId, "saved", { because: p.because, category: p.kind === "DO" || p.kind === "EVENT" ? "experiences" : "food_drinks", cityId: origin.city.id });
    toast("Saved to Want to try");
  }

  return (
    <>
      <div className={sheet.dim} onClick={onClose} />
      <div className={`${sheet.sheet} ${styles.sheet}`} role="dialog" aria-label="Feta Picks near you">
        <p className={sheet.kick}>★ Feta Picks</p>
        <h2 className={sheet.title}>
          Near you, <strong>loved by Feta</strong>
        </h2>
        <p className={sheet.sub}>Feta&apos;s own favourites and places people with your taste love. All fit your diet and budget.</p>
        {picks === null && <p className={styles.empty}>Finding them…</p>}
        {picks?.length === 0 && <p className={styles.empty}>{notice ?? `No Feta Picks in ${origin.city.name} that fit you yet.`}</p>}
        <ul className={styles.list}>
          {(picks ?? []).map((p) => (
            <li key={p.placeId}>
              <button type="button" className={styles.row} onClick={() => setOpen(p)}>
                <span className={styles.pic}>
                  <PickPhoto photo={p.photo} />
                </span>
                <span className={styles.text}>
                  <strong>{p.name}</strong>
                  {p.fetaNote ? <span className={styles.note}>★ “{p.fetaNote}”</span> : p.fetaNote !== undefined ? <span className={styles.note}>★ Feta pick</span> : null}
                  {lovedLabel(p.lovedBy) && <span className={styles.loved}>{lovedLabel(p.lovedBy)}</span>}
                  <small>
                    {[p.area, p.distanceKm ? formatDistance(p.distanceKm, p.country) : null].filter(Boolean).join(" · ")} · <span translate="no">Google Maps</span>
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className={sheet.ghost} onClick={onClose}>
          Close
        </button>
      </div>
      {open && <PickDetails pick={open} onClose={() => setOpen(null)} onSave={() => save(open)} onGo={() => (setGoing(open), setOpen(null))} />}
      {going && <LetsGo pick={going} cityId={origin.city.id} onClose={() => setGoing(null)} onWhatsAfter={() => setGoing(null)} />}
    </>
  );
}
