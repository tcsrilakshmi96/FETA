"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { clock } from "@/lib/plan";
import { castVote, loadShare, loadVotes, type SharePayload, type ShareStop } from "@/lib/share-client";
import styles from "./GroupShare.module.css";

type Live = { name: string; area: string; mapsUri: string; photo: string | null };

// What friends see from "Send to the group": the pick or plan, and a vote,
// with no sign-up. Place details are fetched live from Google.
export default function GroupShare() {
  const { slug } = useParams<{ slug: string }>();
  const [share, setShare] = useState<{ kind: "pick" | "plan"; payload: SharePayload } | null | "missing">(null);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [votes, setVotes] = useState<{ name: string | null; vote: "yes" | "no" }[]>([]);
  const [name, setName] = useState("");
  const [mine, setMine] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    loadShare(slug).then(async (s) => {
      if (!s) return setShare("missing");
      setShare(s);
      setVotes(await loadVotes(slug));
      const found = await Promise.all(
        s.payload.stops
          .filter((st) => !st.event)
          .map(async (st) => {
            const r = await fetch(`/api/place/${encodeURIComponent(st.placeId)}`);
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

  async function vote(choice: "yes" | "no") {
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
  const yes = votes.filter((v) => v.vote === "yes");
  const no = votes.filter((v) => v.vote === "no");
  const label = (st: ShareStop) => st.event?.title ?? live[st.placeId]?.name ?? "…";

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
                  {payload.travel.minutes}-minute {payload.travel.mode} · {payload.travel.km} km
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
                  {st.fetaNote && <span className={styles.note}>★ Feta pick: “{st.fetaNote}”</span>}
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
        <p>Feta picks 3 places for tonight, chosen for your taste.</p>
        <Link href="/" className={styles.cta}>
          Get your own picks
        </Link>
      </div>
    </main>
  );
}
