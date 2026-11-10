"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Cheese from "@/components/Cheese";
import { askFeta, loadChat, type AskReply } from "@/lib/ask-client";
import { loadOrigin, type Origin } from "@/lib/origin";
import { setLinesTrip, undoLines } from "@/lib/profile-client";
import styles from "./Ask.module.css";

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; reply?: AskReply; undone?: boolean; tripOnly?: boolean };

const GREETING =
  "Going somewhere, or out with someone new? Tell me and I'll adjust your picks. Anything I learn shows up in You, where you can change it.";

const PROMPTS = ["Something cheaper tonight", "I'm out with my parents", "Plans for this weekend", "I'm going to Goa next month", "Why this one?"];

export default function Ask() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: "assistant", text: GREETING }]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [trip, setTrip] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the origin is only readable in the browser
    setOrigin(loadOrigin());
    loadChat().then((past) => {
      if (past.length === 0) return;
      setMessages([
        ...past.map((m) => ({ id: nextId.current++, role: m.role, text: m.content }) as Message),
      ]);
      setTrip(past.map((m) => m.trip).filter(Boolean).pop() ?? null);
    });
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || thinking) return;
    setInput("");
    setMessages((m) => [...m, { id: nextId.current++, role: "user", text: message }]);
    setThinking(true);
    const reply = await askFeta(message, origin);
    setThinking(false);
    if (reply.trip) setTrip(reply.trip);
    const text2 = reply.notice && reply.picks.length === 0 ? `${reply.reply}\n${reply.notice}` : reply.reply;
    setMessages((m) => [...m, { id: nextId.current++, role: "assistant", text: text2, reply }]);
  }

  function patch(id: number, change: Partial<Extract<Message, { role: "assistant" }>>) {
    setMessages((all) => all.map((m) => (m.id === id && m.role === "assistant" ? { ...m, ...change } : m)));
  }

  function close() {
    if (window.history.length > 1) router.back();
    else router.push("/picks");
  }

  return (
    <main className={styles.screen}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.head}>
        <h1 className={styles.brand}>
          <span className={styles.pop}>
            <Cheese width={34} />
          </span>
          <span>
            Ask <strong>Feta</strong>
          </span>
        </h1>
        <button type="button" className={styles.close} aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      {trip && <div className={styles.context}>Planning: {trip}</div>}

      <div className={styles.list} ref={listRef} style={{ top: trip ? 134 : 104 }} aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={styles.msg}>
            <div className={`${styles.bubble} ${m.role === "user" ? styles.fromMe : styles.fromFeta}`}>{m.text}</div>
            {m.role === "assistant" && m.reply && m.reply.picks.length > 0 && (
              <>
                <div className={styles.minis}>
                  {m.reply.picks.slice(0, 3).map((p) => (
                    <a key={p.placeId} className={styles.mini} href={p.event ? p.event.url : p.mapsUri} target="_blank" rel="noopener noreferrer">
                      {p.photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.photo.uri} alt="" referrerPolicy="no-referrer" />
                      )}
                      <span className={styles.miniScrim} />
                      <span className={styles.miniText}>
                        <span className={styles.miniKind} style={{ display: "block" }}>{p.kind}</span>
                        <span className={styles.miniName}>{p.name}</span>
                        <span className={styles.miniArea} style={{ display: "block" }}>{p.area}</span>
                      </span>
                    </a>
                  ))}
                </div>
                {m.reply.picks.some((p) => !p.event) && (
                  <p className={styles.attribution}>
                    Places and photos: <span translate="no">Google Maps</span>
                  </p>
                )}
                {m.reply.picks.find((p) => p.event)?.event?.searchHtml && (
                  <div dangerouslySetInnerHTML={{ __html: m.reply.picks.find((p) => p.event)!.event!.searchHtml }} />
                )}
              </>
            )}
            {m.role === "assistant" && m.reply && m.reply.added.length > 0 && (
              <div className={styles.added}>
                <div className={styles.addedHead}>
                  <span className={styles.addedLabel}>ADDED TO YOUR PROFILE</span>
                  <button
                    type="button"
                    className={styles.undo}
                    disabled={m.undone}
                    onClick={() => {
                      undoLines(m.reply!.added.map((a) => a.id));
                      patch(m.id, { undone: true });
                    }}
                  >
                    {m.undone ? "Undone" : "Undo"}
                  </button>
                </div>
                <div className={styles.addedLines} style={{ opacity: m.undone ? 0.4 : 1 }}>
                  {m.reply.added.map((a) => (
                    <span key={a.id}>＋ {a.text}</span>
                  ))}
                </div>
                {m.reply.trip && !m.undone && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!m.tripOnly}
                    className={styles.tripToggle}
                    onClick={() => {
                      const next = !m.tripOnly;
                      setLinesTrip(m.reply!.added.map((a) => a.id), next ? m.reply!.trip : null);
                      patch(m.id, { tripOnly: next });
                    }}
                  >
                    <span>
                      <span className={styles.tripTitle}>Only for this trip</span>
                      <span className={styles.tripSub}>Keeps your everyday picks unchanged. Used for {m.reply.trip}.</span>
                    </span>
                    <span className={`switch ${m.tripOnly ? "on" : ""}`} />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div className={styles.typing} aria-label="Feta is thinking">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <div className={styles.prompts}>
        {PROMPTS.map((p) => (
          <button key={p} type="button" onClick={() => send(p)} disabled={thinking}>
            {p}
          </button>
        ))}
      </div>
      <form
        className={styles.input}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Where are you going? Who with?" aria-label="Message Feta" maxLength={500} />
        <button type="submit" className={styles.send} aria-label="Send" disabled={!input.trim() || thinking}>
          ↑
        </button>
      </form>
    </main>
  );
}
