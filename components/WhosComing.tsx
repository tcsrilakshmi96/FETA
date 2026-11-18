"use client";

import { useEffect } from "react";
import Mascot from "@/components/Mascot";
import { markRepliesSeen, shareLink, type MyShare, type Reply } from "@/lib/share-client";
import sheet from "./Sheet.module.css";
import styles from "./WhosComing.module.css";

// "Who's coming Saturday?" (founder, 17 Nov 2026): the friends who replied
// to a shared plan, In or Out (or which plan, for a choice of plans), with
// the plan and the link to send again. Only the person who shared it sees
// this; names are what friends typed when they replied.

export const initial = (r: Reply) => (r.name?.trim()[0] ?? "?").toUpperCase();

export function voteLabel(r: Reply) {
  return r.vote === "yes" ? "In" : r.vote === "no" ? "Out" : `Plan ${r.vote}`;
}

// "3 in · 1 out", or "2 replied" for a choice of plans.
export function replySummary(replies: Reply[]) {
  if (replies.some((r) => r.vote !== "yes" && r.vote !== "no")) return `${replies.length} replied`;
  const yes = replies.filter((r) => r.vote === "yes").length;
  const no = replies.length - yes;
  return [yes && `${yes} in`, no && `${no} out`].filter(Boolean).join(" · ");
}

export default function WhosComing({ title, shares, onOpen, onClose, onSeen }: { title: string; shares: MyShare[]; onOpen: () => void; onClose: () => void; onSeen: (slugs: string[]) => void }) {
  const replies = shares.flatMap((s) => s.replies);
  const choice = replies.some((r) => r.vote !== "yes" && r.vote !== "no");
  const latest = shares[0];

  useEffect(() => {
    const slugs = shares.map((s) => s.slug);
    markRepliesSeen(slugs);
    onSeen(slugs);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, []);

  const message = `${title}: are you in? ${shareLink(latest.slug)}`;
  return (
    <>
      <div className={sheet.dim} onClick={onClose} />
      <div className={sheet.sheet} role="dialog" aria-label={`Who's coming ${title}?`}>
        {/* Cheers when someone's in; waits, thinking, until anyone replies. */}
        <Mascot pose={replies.some((r) => r.vote === "yes") ? "cheer" : replies.length ? "idle" : "think"} size={84} />
        <h2 className={sheet.title}>
          Who&apos;s coming <strong>{title}?</strong>
        </h2>
        {choice ? (
          <p className={sheet.sub}>{replySummary(replies)}</p>
        ) : (
          <div className={styles.count}>
            <span>
              <b>{replies.filter((r) => r.vote === "yes").length}</b>in
            </span>
            <span>
              <b>{replies.filter((r) => r.vote === "no").length}</b>out
            </span>
          </div>
        )}
        {replies.length === 0 ? (
          <p className={sheet.sub}>No replies yet. Send the link again?</p>
        ) : (
          <ul className={styles.people}>
            {replies.map((r, i) => (
              <li key={i}>
                <span className={styles.face} aria-hidden="true">
                  {initial(r)}
                </span>
                {r.name || "Someone"}
                <em className={r.vote === "no" ? styles.out : styles.in}>{voteLabel(r)}</em>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className={`btn-primary ${sheet.go}`} onClick={onOpen}>
          Open the plan
        </button>
        <a className={styles.again} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
          Send the link again
        </a>
        <p className={styles.note}>Only you see this. Friends see the places and times, never anything about your diet or taste.</p>
        <button type="button" className={sheet.ghost} onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
