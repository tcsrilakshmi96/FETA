"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";
import { createShare, type SharePayload } from "@/lib/share-client";
import styles from "./SendToGroup.module.css";

// "Send to the group": makes a Feta link friends can vote on, then offers
// WhatsApp or copy. Two taps, because phones block opening WhatsApp after a wait.
export default function SendToGroup({ kind, payload, message }: { kind: "pick" | "plan"; payload: SharePayload; message: string }) {
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  const [making, setMaking] = useState(false);

  async function make() {
    setMaking(true);
    const url = await createShare(kind, payload);
    setMaking(false);
    if (url) setLink(url);
    else toast("Couldn't make a link just now. Try again.");
  }

  if (!link) {
    return (
      <button type="button" className={styles.send} onClick={make} disabled={making}>
        {making ? "Making a link…" : "Send to the group"}
      </button>
    );
  }
  const text = `${message}\nIn or out? Tap to vote: ${link}`;
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
