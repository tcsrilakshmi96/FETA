"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadMyShares, newReplies, type Reply } from "@/lib/share-client";
import styles from "./RepliesPill.module.css";

// "Priya and Arjun are in · Saturday" (founder, 17 Nov 2026): when friends
// reply to a plan they shared, Home says so in the black pill at the top,
// after the Feta Picks star has landed. Tap for Saved → Plans. It shows each
// time Home opens until they look at the replies there.
const WAIT_MS = 3400;
const SHOW_MS = 6000;

function people(list: Reply[]) {
  const names = [...new Set(list.map((r) => r.name?.trim() || "Someone"))];
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

// What the pill says for one plan's new replies.
function sayFor(replies: Reply[], title: string) {
  const yes = replies.filter((r) => r.vote === "yes");
  const no = replies.filter((r) => r.vote === "no");
  const voted = replies.filter((r) => r.vote !== "yes" && r.vote !== "no");
  const many = (l: Reply[]) => new Set(l.map((r) => r.name?.trim() || "Someone")).size > 1;
  if (yes.length) return `${people(yes)} ${many(yes) ? "are" : "is"} in · ${title}`;
  if (voted.length) return `${people(voted)} voted · ${title}`;
  return `${people(no)} can't make it · ${title}`;
}

export default function RepliesPill() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    const timers: number[] = [];
    timers.push(
      window.setTimeout(async () => {
        const shares = await loadMyShares();
        const fresh = shares.map((s) => ({ s, replies: newReplies(s) })).filter((x) => x.replies.length);
        if (!live || !fresh.length) return;
        // The plan with the latest reply.
        const top = fresh.sort((a, b) => (b.replies[b.replies.length - 1].at > a.replies[a.replies.length - 1].at ? 1 : -1))[0];
        setText(sayFor(top.replies, top.s.payload.title));
        setOpen(true);
        timers.push(window.setTimeout(() => live && setOpen(false), SHOW_MS));
      }, WAIT_MS),
    );
    return () => {
      live = false;
      timers.forEach(clearTimeout);
    };
  }, []);

  if (!text) return null;
  return (
    <button type="button" className={`${styles.pill} ${open ? styles.open : ""}`} onClick={() => router.push("/lists#plans")} aria-hidden={!open} tabIndex={open ? 0 : -1}>
      <span aria-hidden="true">🧀</span>
      {text}
    </button>
  );
}
