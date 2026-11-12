"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatDistance } from "@/lib/cities";
import { clock } from "@/lib/plan";
import { castVote, loadShare, loadVotes, type ChoicePayload, type ShareKind, type SharePayload, type ShareStop, type Vote } from "@/lib/share-client";
import styles from "./GroupShare.module.css";

type Live = { name: string; area: string; mapsUri: string; photo: string | null };

// What friends see from "Send to the group": the pick or plan, and a vote,
// with no sign-up. Place details are fetched live from Google.
export default function GroupShare() {
  const { slug } = useParams<{ slug: string }>();
  const [share, setShare] = useState<{ kind: ShareKind; payload: SharePayload & ChoicePayload } | null | "missing">(null);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [votes, setVotes] = useState<{ name: string | null; vote: Vote }[]>([]);
  const [name, setName] = useState("");
  const [mine, setMine] = useState<Vote | null>(null);

  useEffect(() => {
    loadShare(slug).then(async (s) => {
      if (!s) return setShare("missing");
      setShare(s);
      setVotes(await loadVotes(slug));
      // A choice of plans shows names and areas only (no photos: each costs).
      const choice = s.kind === "choice";
      const stops = choice ? (s.payload.options ?? []).flatMap((o) => o.stops) : s.payload.stops;
      const found = await Promise.all(
        stops
          .filter((st) => !st.event)
          .map(async (st) => {
            const r = await fetch(`/api/place/${encodeURIComponent(st.placeId)}${choice ? "?lite=1" : ""}`);
            return r.ok ? ([st.placeId, (await r.json()) as Live] as const) : null;
          }),
      );
      setLive(Object.fromEntries(found.filter(Boolean) as [string, Live][]));
    });
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the remembered name is only readable in the browser
      setName(localStorage.getItem("feta.voterName") ?? "");
    } catch {
      // A name is optional.
    }
  }, [slug]);

  async function vote(choice: Vote) {
    setMine(choice);
    try {
      localStorage.setItem("feta.voterName", name);
    } catch {
      // Fine without.
    }
    if (await castVote(slug, name, choice)) setVotes(await loadVotes(slug));
  }

  if (share === null) return <main className={styles.screen} />;
  if (share === "missing") {
    return (
      <main className={styles.screen}>
        <h1 className={styles.title}>This plan has gone.</h1>
        <Link href="/" className={styles.cta}>
          Get your own picks on Feta
        </Link>
      </main>
    );
  }

  const { payload } = share;
  const label = (st: ShareStop) => st.event?.title ?? live[st.placeId]?.name ?? "…";

  // "Let the group choose": each plan with its votes; the leader is marked.
  if (share.kind === "choice") {
    const options = payload.options ?? [];
    const count = (i: number) => votes.filter((v) => v.vote === String(i + 1));
    const top = Math.max(0, ...options.map((_, i) => count(i).length));
    return (
      <main className={styles.screen}>
        <p className={styles.from}>{`Plans for ${payload.title.toLowerCase()}`} · Feta</p>
        <h1 className={styles.title}>
          Which one <strong>are we doing?</strong>
        </h1>
        <input className={styles.nameBox} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (so they know)" aria-label="Your name" maxLength={40} />
        <ol className={styles.options}>
          {options.map((o, i) => {
            const n = count(i);
            const leading = n.length > 0 && n.length === top;
            const v = String(i + 1) as Vote;
            return (
              <li key={i} className={`${styles.option} ${mine === v ? styles.optionMine : ""}`}>
                <p className={styles.optionHead}>
                  <span>Plan {i + 1}</span>
                  {leading && <span className={styles.leading}>Leading</span>}
                </p>
                {o.stops.map((st) => (
                  <p key={st.placeId} className={styles.optionStop}>
                    {st.time && <span className={styles.time}>{clock(new Date(st.time))}</span>}
                    <strong>{label(st)}</strong>
                    <span className={styles.area}>{st.event ? st.event.venueName : live[st.placeId]?.area}</span>
                  </p>
                ))}
                <button type="button" className={mine === v ? styles.yesOn : styles.yes} onClick={() => vote(v)}>
                  {mine === v ? "Your vote ✓" : "This one"}
                </button>
                {n.length > 0 && (
                  <p className={styles.tally}>
                    <strong>{n.length}</strong> {n.some((x) => x.name) && `: ${n.map((x) => x.name || "someone").join(", ")}`}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <p className={styles.mapsNote}>
          Places from <span translate="no">Google Maps</span>.
        </p>
        <div className={styles.footer}>
          <p>Feta plans your evening, chosen for your taste.</p>
          <Link href="/" className={styles.cta}>
            Get your own picks
          </Link>
        </div>
      </main>
    );
  }
  const yes = votes.filter((v) => v.vote === "yes");
  const no = votes.filter((v) => v.vote === "no");

  return (
    <main className={styles.screen}>
      <p className={styles.from}>{share.kind === "plan" ? `A plan for ${payload.title.toLowerCase()}` : "A friend picked this"} · Feta</p>
      <h1 className={styles.title}>
        {share.kind === "plan" ? (
          <>
            {label(payload.stops[0])} <strong>then</strong> {label(payload.stops[1])}
          </>
        ) : (
          label(payload.stops[0])
        )}
      </h1>

      <ol className={styles.stops}>
        {payload.stops.map((st, i) => {
          const l = live[st.placeId];
          return (
            <li key={st.placeId}>
              {i === 1 && payload.travel && (
                <p className={styles.travel}>
                  {payload.travel.minutes}-minute {payload.travel.mode} · {formatDistance(payload.travel.km, payload.country)}
                </p>
              )}
              <div className={styles.stop}>
                <span className={styles.pic}>
                  {l?.photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.photo} alt="" referrerPolicy="no-referrer" />
                  )}
                </span>
                <span className={styles.stopText}>
                  {st.time && <span className={styles.time}>{clock(new Date(st.time))}</span>}
                  <strong>{label(st)}</strong>
                  <span className={styles.area}>{st.event ? `${st.event.venueName} · ${st.event.date} ${st.event.time}` : l?.area}</span>
                  {st.fetaNote !== undefined && <span className={styles.note}>★ Feta pick{st.fetaNote ? `: “${st.fetaNote}”` : ""}</span>}
                  {st.event ? (
                    <a href={st.event.url} target="_blank" rel="noopener noreferrer">
                      Tickets on {st.event.site}
                    </a>
                  ) : (
                    l && (
                      <a href={l.mapsUri} target="_blank" rel="noopener noreferrer">
                        See it on <span translate="no">Google Maps</span>
                      </a>
                    )
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <section className={styles.vote}>
        <p className={styles.voteTitle}>{share.kind === "plan" ? "Are you in?" : "Up for it?"}</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (so they know)" aria-label="Your name" maxLength={40} />
        <div className={styles.voteBtns}>
          <button type="button" className={mine === "yes" ? styles.yesOn : styles.yes} onClick={() => vote("yes")}>
            I&apos;m in
          </button>
          <button type="button" className={mine === "no" ? styles.noOn : styles.no} onClick={() => vote("no")}>
            Not this time
          </button>
        </div>
        {votes.length > 0 && (
          <p className={styles.tally}>
            <strong>{yes.length} in</strong>
            {yes.some((v) => v.name) && `: ${yes.map((v) => v.name || "someone").join(", ")}`}
            {no.length > 0 && ` · ${no.length} out`}
          </p>
        )}
      </section>

      <div className={styles.footer}>
        <p>Feta plans your evening, chosen for your taste.</p>
        <Link href="/" className={styles.cta}>
          Get your own picks
        </Link>
      </div>
    </main>
  );
}
