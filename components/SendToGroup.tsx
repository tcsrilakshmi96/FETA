"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";
import { logEvent } from "@/lib/db";
import { createShare, type ChoicePayload, type ShareKind, type SharePayload } from "@/lib/share-client";
import styles from "./SendToGroup.module.css";

// "Send to the group": makes a Feta link friends can vote on, then offers
// WhatsApp or copy. Two taps, because phones block opening WhatsApp after a wait.
export default function SendToGroup({
  kind,
  payload,
  message,
  label = "Send to the group",
}: {
  kind: ShareKind;
  payload: SharePayload | ChoicePayload;
  message: string;
  label?: string;
}) {
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  const [making, setMaking] = useState(false);

  async function make() {
    setMaking(true);
    const url = await createShare(kind, payload);
    setMaking(false);
    if (url) {
      setLink(url);
      const first = "stops" in payload ? payload.stops[0]?.placeId : undefined;
      logEvent(kind === "pick" ? "share" : kind === "plan" ? "plan_share" : "choice_share", first);
    }
    else toast("Couldn't make a link just now. Try again.");
  }

  if (!link) {
    return (
      <button type="button" className={styles.send} onClick={make} disabled={making}>
        {making ? "Making a link…" : label}
      </button>
    );
  }
  const text = kind === "choice" ? `${message}\nWhich one? Tap to vote: ${link}` : `${message}\nIn or out? Tap to vote: ${link}`;
  return (
    <div className={styles.ready}>
      <a className={styles.whatsapp} href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
        Open WhatsApp
      </a>
      <button
        type="button"
        className={styles.copy}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            toast("Link copied");
          } catch {
            toast(link);
          }
        }}
      >
        Copy link
      </button>
    </div>
  );
}
