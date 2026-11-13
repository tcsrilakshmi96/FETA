"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Cheese from "@/components/Cheese";
import LetsGo from "@/components/LetsGo";
import PickDetails, { kindLabel } from "@/components/PickDetails";
import PickPhoto from "@/components/PickPhoto";
import { useToast } from "@/components/Toast";
import { savePickAction } from "@/lib/db";
import { askFeta, loadChat, type AskReply } from "@/lib/ask-client";
import type { Pick } from "@/lib/picks-client";
import { loadOrigin, type Origin } from "@/lib/origin";
import { setLinesTrip, undoLines } from "@/lib/profile-client";
import { removeWeekendWish } from "@/lib/weekend-client";
import styles from "./Ask.module.css";

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; text: string; reply?: AskReply; undone?: boolean; tripOnly?: boolean; weekendUndone?: boolean };

const GREETING =
  "Going somewhere, or out with someone new? Tell me and I'll adjust your picks. Anything I learn shows up in You, where you can change it.";

const PROMPTS = ["Plan my date night", "Something cheaper tonight", "I'm out with my parents", "Plans for this weekend", "I'm going to Goa next month", "Why this one?"];

export default function Ask() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: "assistant", text: GREETING }]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [trip, setTrip] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [detail, setDetail] = useState<Pick | null>(null);
  const [going, setGoing] = useState<Pick | null>(null);
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- the origin and link are only readable in the browser */
    setOrigin(loadOrigin());
    // "Ask Feta about Shanghai" arrives with a starting message, ready to send.
    setInput(new URLSearchParams(window.location.search).get("q")?.slice(0, 200) ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
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

  // When Feta has just asked a question, its tap-able answers replace the
  // usual prompts.
  const last = messages[messages.length - 1];
  const lastOptions = !thinking && last?.role === "assistant" && last.reply?.options?.length ? last.reply.options : null;

  function patch(id: number, change: Partial<Extract<Message, { role: "assistant" }>>) {
    setMessages((all) => all.map((m) => (m.id === id && m.role === "assistant" ? { ...m, ...change } : m)));
  }

  function close() {
    if (window.history.length > 1) router.back();
    else router.push("/home");
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
            {m.role === "assistant" && m.reply?.itinerary && (
              <div className={styles.itinerary}>
                <p className={styles.itTitle}>{m.reply.itinerary.title}</p>
                {m.reply.itinerary.days.map((d) => (
                  <div key={d.date} className={styles.itDay}>
                    {m.reply!.itinerary!.days.length > 1 && <p className={styles.itDayLabel}>{d.label}</p>}
                    <ol className={styles.itStops}>
                      {d.stops.map((st) => (
                        <li key={st.pick.placeId}>
                          {st.travel && <span className={styles.itTravel}>{st.travel}</span>}
                          <button type="button" className={styles.itStop} onClick={() => setDetail(st.pick)}>
                            <span className={styles.itTime}>{st.time}</span>
                            <span className={styles.itPic}>
                              <PickPhoto photo={st.pick.photo} />
                            </span>
                            <span className={styles.itText}>
                              <span className={styles.itSlot}>{st.slot}</span>
                              <span className={styles.itName}>{st.pick.name}</span>
                              <span className={styles.itArea}>{st.pick.area}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
                <p className={styles.attribution}>
                  Places and photos: <span translate="no">Google Maps</span>. Tap a stop for hours and directions.
                </p>
              </div>
            )}
            {m.role === "assistant" && m.reply && m.reply.picks.length > 0 && (
              <>
                <div className={styles.minis}>
                  {m.reply.picks.slice(0, 3).map((p) => (
                    <button key={p.placeId} type="button" className={styles.mini} onClick={() => setDetail(p)}>
                      <PickPhoto photo={p.photo} />
                      <span className={styles.miniScrim} />
                      <span className={styles.miniText}>
                        <span className={styles.miniKind} style={{ display: "block" }}>{kindLabel(p.kind)}</span>
                        <span className={styles.miniName}>{p.name}</span>
                        <span className={styles.miniArea} style={{ display: "block" }}>{p.area}</span>
                      </span>
                    </button>
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
            {m.role === "assistant" && m.reply?.weekend && (
              <div className={styles.added}>
                <div className={styles.addedHead}>
                  <span className={styles.addedLabel}>ADDED TO YOUR WEEKEND</span>
                  <button
                    type="button"
                    className={styles.undo}
                    disabled={m.weekendUndone}
                    onClick={() => {
                      removeWeekendWish(m.reply!.weekend!.id);
                      patch(m.id, { weekendUndone: true });
                    }}
                  >
                    {m.weekendUndone ? "Undone" : "Undo"}
                  </button>
                </div>
                <div className={styles.addedLines} style={{ opacity: m.weekendUndone ? 0.4 : 1 }}>
                  <span>＋ {m.reply.weekend.text}</span>
                  <span className={styles.tripSub}>On your weekend list in Lists. Feta plans your weekend from it.</span>
                </div>
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
        {/* Surprise me leads (testers: it takes the deciding off you). */}
        {!lastOptions && (
          <button type="button" className={styles.surprise} onClick={() => send("Surprise me tonight")} disabled={thinking}>
            🎲 Surprise me
          </button>
        )}
        {(lastOptions ?? PROMPTS).map((p) => (
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

      {detail && (
        <PickDetails
          pick={detail}
          onClose={() => setDetail(null)}
          onSave={() => {
            savePickAction(detail.placeId, "saved", {
              category: detail.kind === "DO" || detail.kind === "EVENT" ? "experiences" : "food_drinks",
              cityId: origin?.city.id ?? "",
              because: detail.because,
            });
            toast("Saved to Want to try");
          }}
          onGo={() => {
            setGoing(detail);
            setDetail(null);
          }}
        />
      )}
      {going && <LetsGo pick={going} cityId={origin?.city.id ?? ""} onClose={() => setGoing(null)} />}
    </main>
  );
}
