"use client";

import { useEffect, useRef, useState } from "react";
import Mascot from "@/components/Mascot";
import { GoogleLine } from "@/components/PickDetails";
import PickPhoto from "@/components/PickPhoto";
import { formatDistance } from "@/lib/cities";
import type { Origin } from "@/lib/origin";
import { fetchSurprise, type Category, type Pick, type When } from "@/lib/picks-client";
import type { Slot } from "@/lib/picks-store";
import styles from "./ChooseForMe.module.css";

// Choose for me's answer (founder, 17 Nov 2026): the cheese rolls like a
// dice, then one place fills the screen like a magazine cover. Swipe left
// (or Not this one) for the next, swipe down (or ✕) for Home; Let's go
// goes back to Home too. Each mood is read from what they've shared:
// Something new is a lesser-known place for something they love, My usual
// the best-loved place most like the places they love (both from their
// lists, free), Surprise me a kind of place they haven't chosen but would
// likely love (a new search, about ₹3–4).

export type Mood = "new" | "usual" | "surprise";

const KICK: Record<Mood, string> = { new: "SOMETHING NEW", usual: "AN OLD FAVOURITE STYLE", surprise: "SURPRISE" };
const ROLLING: Record<Mood, string> = { new: "Picking something new…", usual: "Finding your usual…", surprise: "Rolling for something new to you…" };
const ROLL_MS = 900;

const fits = (p: Pick) => p.verdict !== "Skip unless";
const known = (p: Pick) => p.ratingCount ?? 500;
// Matched something they shared; the places they love count most for the usual.
const shared = (p: Pick) => (p.serves ?? []).some((s) => !s.startsWith("side_") && s !== "popular");
const likeLoved = (p: Pick) => (p.serves ?? []).some((s) => s.startsWith("loved_"));

// The order the free moods offer places in, from one list. Within each
// group they take turns across what they're for (else their Google type),
// so "Not this one" brings another kind (persona test, 23 Nov 2026: three
// bakeries in a row).
function inOrder(slot: Slot | undefined, mood: Mood) {
  const all = [...(slot?.picks ?? []), ...(slot?.spares ?? [])].filter(fits);
  const score = mood === "new" ? (p: Pick) => (shared(p) ? 1 : 0) : (p: Pick) => (likeLoved(p) ? 2 : shared(p) ? 1 : 0);
  const best = mood === "new" ? (a: Pick, b: Pick) => known(a) - known(b) : (a: Pick, b: Pick) => known(b) * (b.rating ?? 4) - known(a) * (a.rating ?? 4);
  const sorted = all.sort((a, b) => score(b) - score(a) || best(a, b));
  const turn = new Map<string, number>();
  const nth = new Map(sorted.map((p) => {
    const k = `${score(p)}|${p.serves?.[0] ?? p.type ?? p.placeId}`;
    turn.set(k, (turn.get(k) ?? 0) + 1);
    return [p, turn.get(k)!] as const;
  }));
  return sorted
    .map((p, i) => ({ p, i }))
    .sort((a, b) => score(b.p) - score(a.p) || nth.get(a.p)! - nth.get(b.p)! || a.i - b.i)
    .map((x) => x.p)
    .slice(0, 6);
}

export default function ChooseForMe({ mood, origin, when, lead, lists, onGo, onClose }: { mood: Mood; origin: Origin; when: When; lead: Category; lists: { category: Category; slot: Slot | undefined }[]; onGo: (p: Pick) => void; onClose: () => void }) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [notice, setNotice] = useState("");
  const [leaving, setLeaving] = useState<"" | "left" | "down">("");
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const seen = useRef<string[]>([]);
  const tried = useRef<string[]>([]);
  const turn = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);

  // The next answer, after the cheese has rolled a little.
  async function next() {
    setPick(null);
    setNotice("");
    const rolled = new Promise((r) => setTimeout(r, ROLL_MS));
    let found: Pick | null = null;
    if (mood === "surprise") {
      // Takes turns between food and things to do when they want both.
      const category = lists[turn.current++ % lists.length]?.category ?? lead;
      const shown = lists.flatMap((l) => [...(l.slot?.picks ?? []), ...(l.slot?.spares ?? [])].map((p) => p.placeId));
      const reply = await fetchSurprise(origin, when, category, tried.current, [...shown, ...seen.current]);
      tried.current = [...new Set([...tried.current, ...(reply.tried ?? []), ...(reply.kind ? [reply.kind] : [])])];
      found = reply.pick ?? null;
      if (!found) setNotice(reply.notice ?? "Couldn't find a surprise that fits right now.");
    } else {
      found = lists.flatMap((l) => inOrder(l.slot, mood)).find((p) => !seen.current.includes(p.placeId)) ?? null;
      if (!found) setNotice("That's everything that fits for now. Try another mood.");
    }
    await rolled;
    if (found) seen.current.push(found.placeId);
    setLeaving("");
    setDrag({ x: 0, y: 0 });
    setPick(found);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first answer starts rolling when it opens
    next();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, []);

  function away(way: "left" | "down", then: () => void) {
    setLeaving(way);
    setTimeout(then, 260);
  }
  const another = () => away("left", next);
  const close = () => away("down", onClose);
  const go = (p: Pick) => away("down", () => onGo(p));

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("a, button")) return;
    start.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return;
    const x = e.clientX - start.current.x, y = e.clientY - start.current.y;
    setDrag(Math.abs(x) > Math.abs(y) ? { x: Math.min(0, x), y: 0 } : { x: 0, y: Math.max(0, y) });
  }
  function onPointerUp() {
    if (!start.current) return;
    start.current = null;
    if (drag.x < -80) another();
    else if (drag.y > 110) close();
    else setDrag({ x: 0, y: 0 });
  }

  const meta = pick ? [pick.rating ? `★ ${pick.rating.toFixed(1)}` : null, pick.area, pick.distanceKm > 0 && formatDistance(pick.distanceKm, origin.city.country)].filter(Boolean).join(" · ") : "";
  const moving = drag.x || drag.y ? { transform: `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 40}deg)`, transition: "none" } : undefined;

  return (
    <div className={styles.screen} role="dialog" aria-label="Feta's choice">
      {!pick && !notice && (
        <div className={styles.rolling}>
          <span className={styles.die}>
            <Mascot pose="cheer" size={96} limbs={false} />
          </span>
          <p>{ROLLING[mood]}</p>
        </div>
      )}
      {!pick && notice && (
        <div className={styles.rolling}>
          <Mascot pose="sorry" size={120} />
          <p>{notice}</p>
          <span className={styles.notice}>
            {mood === "surprise" && (
              <button type="button" className={styles.back} onClick={next}>
                Try another
              </button>
            )}
            <button type="button" className={`${styles.back} ${styles.quiet}`} onClick={onClose}>
              Back to Home
            </button>
          </span>
        </div>
      )}
      {pick && (
        <div
          key={pick.placeId}
          className={`${styles.cover} ${leaving === "left" ? styles.outLeft : leaving === "down" ? styles.outDown : ""}`}
          style={moving}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <PickPhoto photo={pick.photo} className={styles.photo} />
          <span className={styles.shade} />
          <span className={styles.tag}>FETA&apos;S CHOICE · {KICK[mood]}</span>
          <button type="button" className={styles.x} onClick={close} aria-label="Back to Home">
            ✕
          </button>
          <div className={styles.text}>
            <h2>{pick.name}</h2>
            <p>{pick.because}</p>
            <small>
              {meta}
              {meta && " · "}
              {pick.event ? (
                pick.chips[0]
              ) : (
                // Opening hours, as on the picks list (Round 5 review).
                <GoogleLine pick={pick} />
              )}
              {pick.photo?.credit && ` · Photo: ${pick.photo.credit}`}
            </small>
            <div className={styles.acts}>
              <button type="button" onClick={another}>
                Not this one
              </button>
              <button type="button" className={styles.go} onClick={() => go(pick)}>
                Let&apos;s go
              </button>
            </div>
            <span className={styles.hint}>Swipe left for another · down for Home</span>
          </div>
        </div>
      )}
    </div>
  );
}
