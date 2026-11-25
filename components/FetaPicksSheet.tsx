"use client";

import { useEffect, useState } from "react";
import { Caveat } from "next/font/google";
import AddPlace from "@/components/AddPlace";
import LetsGo from "@/components/LetsGo";
import Mascot from "@/components/Mascot";
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
// The founder's notes, handwritten.
const hand = Caveat({ subsets: ["latin"], weight: ["600"] });

export default function FetaPicksSheet({ origin, when, onClose, onPlan }: { origin: Origin; when: When; onClose: () => void; onPlan: () => void }) {
  const toast = useToast();
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const [open, setOpen] = useState<Pick | null>(null);
  const [going, setGoing] = useState<Pick | null>(null);
  const [recommending, setRecommending] = useState(false);

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
      {/* Hidden while they recommend one, so the two sheets never stack. */}
      <div className={`${sheet.sheet} ${styles.sheet}`} role="dialog" aria-label="Feta Picks near you" hidden={recommending}>
        <p className={sheet.kick}>★ Feta Picks</p>
        <h2 className={sheet.title}>
          Near you, <strong>loved by Feta</strong>
        </h2>
        <p className={sheet.sub}>Feta&apos;s own favourites and places people with your taste love. All fit your diet and budget.</p>
        {picks === null && (
          <div className={styles.finding}>
            <Mascot pose="walk" size={96} />
            <p className={styles.empty}>Finding them…</p>
          </div>
        )}
        {/* Nothing near them yet: sorry, and a way to add one themselves (founder, 25 Nov 2026). */}
        {picks?.length === 0 && (
          <div className={styles.finding}>
            <Mascot pose="sorry" size={96} />
            <p className={styles.empty}>{notice ?? `Sorry, no Feta Picks within your distance in ${origin.city.name} yet.`}</p>
          </div>
        )}
        {/* Polaroids, swiped sideways (founder, 16 Nov 2026): the founder's
            note in handwriting, so they read like a friend's recommendations. */}
        <ul className={styles.deck}>
          {(picks ?? []).map((p) => {
            const mine = p.fetaNote !== undefined;
            const closed = p.googleLine?.startsWith("Closed now");
            return (
              <li key={p.placeId}>
                <button type="button" className={styles.polaroid} onClick={() => setOpen(p)}>
                  <span className={styles.pic}>
                    <PickPhoto photo={p.photo} />
                    <span className={styles.badge}>{mine ? "★ FETA PICK" : lovedLabel(p.lovedBy) ?? "♥ Loved by Feta users"}</span>
                  </span>
                  <strong>{p.name}</strong>
                  {mine ? (
                    <span className={`${hand.className} ${styles.note}`}>{p.fetaNote ? `${p.fetaNote} – S` : "One of my favourites – S"}</span>
                  ) : (
                    <span className={styles.why}>Loved by people with a taste like yours</span>
                  )}
                  <small>
                    {[p.distanceKm ? formatDistance(p.distanceKm, p.country) : p.area, closed ? "Closed now" : null].filter(Boolean).join(" · ")} · <span translate="no">Google Maps</span>
                    {p.photo && ` · Photo: ${p.photo.credit}`}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
        {picks !== null && (
          <button type="button" className={`btn-primary ${styles.recommend}`} onClick={() => setRecommending(true)}>
            ＋ Recommend a place you love
          </button>
        )}
        <button type="button" className={sheet.ghost} onClick={onClose}>
          Close
        </button>
      </div>
      {recommending && (
        <AddPlace
          city={origin.city}
          recommending
          onClose={() => setRecommending(false)}
          onAdded={() => {
            setRecommending(false);
            toast("Thank you! People with a taste like yours will see it.");
          }}
        />
      )}
      {open && <PickDetails pick={open} onClose={() => setOpen(null)} onSave={() => save(open)} onGo={() => (setGoing(open), setOpen(null))} />}
      {going && <LetsGo pick={going} cityId={origin.city.id} onClose={() => setGoing(null)} onWhatsAfter={() => {
            // Plan my evening, as from Choose for me (founder, 25 Nov 2026).
            setGoing(null);
            onPlan();
          }}
        />}
    </>
  );
}
