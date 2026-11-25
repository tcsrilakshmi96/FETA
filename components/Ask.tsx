"use client";

import { plainReply } from "@/lib/ask-rules";
import { leaveLists } from "@/lib/picks-store";
import { SearchChip } from "@/components/PickDetails";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Cheese from "@/components/Cheese";
import LetsGo from "@/components/LetsGo";
import Mascot from "@/components/Mascot";
import PickDetails, { kindLabel } from "@/components/PickDetails";
import ItineraryView from "@/components/ItineraryView";
import OutfitCard from "@/components/OutfitCard";
import PickPhoto from "@/components/PickPhoto";
import TripCard from "@/components/TripCard";
import { useToast } from "@/components/Toast";
import { savePickAction } from "@/lib/db";
import { chatState, emptyChat, openChat, patchMessage, sendChat, subscribeChat, type AskReply } from "@/lib/ask-client";
import type { Pick } from "@/lib/picks-client";
import { loadOrigin, type Origin } from "@/lib/origin";
import { setLinesTrip, undoLines } from "@/lib/profile-client";
import { todayScope } from "@/lib/profile-scope";
import { addWeekendWish, removeWeekendWish } from "@/lib/weekend-client";
import styles from "./Ask.module.css";

const PROMPTS = ["Plan my date night", "Something cheaper tonight", "I'm out with my parents", "Plans for this weekend", "Help me plan a trip", "Why this one?"];

const WHO: Record<string, string> = { partner: "your partner", family: "your family", friends: "your friends", kids: "your kids" };

// "NOTED ABOUT ARJUN", or who they are when no name was said.
function notedLabel(noted: NonNullable<AskReply["noted"]>) {
  const names = [...new Set(noted.map((n) => n.name ?? WHO[n.who] ?? "them"))];
  return `NOTED ABOUT ${names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]}`.toUpperCase();
}

export default function Ask() {
  const router = useRouter();
  // The conversation is kept outside the screen (lib/ask-client.ts), so
  // closing Ask, or a reply arriving after it closed, loses nothing.
  const { messages, trip, thinking } = useSyncExternalStore(subscribeChat, chatState, emptyChat);
  const [input, setInput] = useState("");
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [detail, setDetail] = useState<Pick | null>(null);
  const [going, setGoing] = useState<Pick | null>(null);
  const toast = useToast();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- the origin and link are only readable in the browser */
    setOrigin(loadOrigin());
    // "Ask Feta about Shanghai" arrives with a starting message, ready to send.
    setInput(new URLSearchParams(window.location.search).get("q")?.slice(0, 200) ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
    // A saved trip opened from Saved: its card at the end of the chat.
    openChat(new URLSearchParams(window.location.search).get("trip"));
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  function send(text: string) {
    if (!text.trim() || thinking) return;
    setInput("");
    sendChat(text, origin);
  }

  // When Feta has just asked a question, its tap-able answers replace the
  // usual prompts.
  const last = messages[messages.length - 1];
  const lastOptions = !thinking && last?.role === "assistant" && last.reply?.options?.length ? last.reply.options : null;

  const lastTripCard = new Map<string, number>();
  for (const m of messages) if (m.role === "assistant" && m.tripId) lastTripCard.set(m.tripId, m.id);

  const patch = patchMessage;

  function close() {
    if (window.history.length > 1) router.back();
    else router.push("/home");
  }

  return (
    <main className={styles.screen}>
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
            <div className={`${styles.bubble} ${m.role === "user" ? styles.fromMe : styles.fromFeta}`}>{m.role === "user" ? m.text : plainReply(m.text)}</div>
            {/* Places aren't stored (Google's details), only that they were shown. */}
            {m.role === "assistant" && !!m.earlier && (
              <p className={styles.attribution}>
                {m.earlier === 1 ? "A place was" : `${m.earlier} places were`} here, checked live at the time. Ask again to see what fits now.
              </p>
            )}
            {m.role === "assistant" && m.reply?.itinerary &&<ItineraryView itinerary={m.reply.itinerary} onStop={setDetail} />}
            {m.role === "assistant" && m.reply?.outfit && <OutfitCard outfit={m.reply.outfit} brands={m.reply.brands ?? []} />}
            {/* One card per trip: the latest one, after an edit. */}
            {m.role === "assistant" && m.tripId && lastTripCard.get(m.tripId) === m.id && <TripCard key={`${m.tripId}-${m.id}`} id={m.tripId} home={origin?.city ?? null} onStop={setDetail} />}
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
                  <SearchChip html={m.reply.picks.find((p) => p.event)!.event!.searchHtml} />
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
                    aria-checked={m.tripOnly !== false}
                    className={styles.tripToggle}
                    onClick={() => {
                      // On by default: learned while planning a trip (Ask route).
                      const next = m.tripOnly === false;
                      setLinesTrip(m.reply!.added.map((a) => a.id), next ? m.reply!.trip : null);
                      patch(m.id, { tripOnly: next });
                    }}
                  >
                    <span>
                      <span className={styles.tripTitle}>Only for this trip</span>
                      <span className={styles.tripSub}>Keeps your everyday picks unchanged. Used for {m.reply.trip}.</span>
                    </span>
                    <span className={`switch ${m.tripOnly !== false ? "on" : ""}`} />
                  </button>
                )}
                {/* Round 6: "out with my parents tonight" reached Lisbon a week later. */}
                {!m.reply.trip && !m.undone && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={m.todayOnly ?? !!m.reply.today}
                    className={styles.tripToggle}
                    onClick={() => {
                      const next = !(m.todayOnly ?? !!m.reply!.today);
                      setLinesTrip(m.reply!.added.map((a) => a.id), next ? todayScope() : null);
                      patch(m.id, { todayOnly: next });
                    }}
                  >
                    <span>
                      <span className={styles.tripTitle}>Just for today</span>
                      <span className={styles.tripSub}>Tomorrow Feta goes back to your usual taste.</span>
                    </span>
                    <span className={`switch ${(m.todayOnly ?? m.reply.today) ? "on" : ""}`} />
                  </button>
                )}
              </div>
            )}
            {/* About someone they go out with: never "your profile" (tester,
                23 Nov 2026: her boyfriend's "eats meat" read as hers). */}
            {m.role === "assistant" && m.reply?.noted && m.reply.noted.length > 0 && (
              <div className={styles.added}>
                <div className={styles.addedHead}>
                  <span className={styles.addedLabel}>{notedLabel(m.reply.noted)}</span>
                  <button
                    type="button"
                    className={styles.undo}
                    disabled={m.notedUndone}
                    onClick={() => {
                      undoLines(m.reply!.noted!.map((a) => a.id));
                      patch(m.id, { notedUndone: true });
                    }}
                  >
                    {m.notedUndone ? "Undone" : "Undo"}
                  </button>
                </div>
                <div className={styles.addedLines} style={{ opacity: m.notedUndone ? 0.4 : 1 }}>
                  {m.reply.noted.map((a) => (
                    <span key={a.id}>＋ {a.text}</span>
                  ))}
                  <span className={styles.tripSub}>Used only when they come along. Your own picks stay yours.</span>
                </div>
              </div>
            )}
            {m.role === "assistant" && m.reply?.weekend && (
              <div className={styles.added}>
                <div className={styles.addedHead}>
                  <span className={styles.addedLabel}>{m.weekendId && !m.weekendUndone ? "ADDED TO YOUR WEEKEND" : "FOR YOUR WEEKEND?"}</span>
                  <button
                    type="button"
                    className={styles.undo}
                    onClick={async () => {
                      if (m.weekendId && !m.weekendUndone) {
                        removeWeekendWish(m.weekendId);
                        patch(m.id, { weekendUndone: true });
                        return;
                      }
                      const wish = await addWeekendWish(m.reply!.weekend!.text);
                      if (wish) patch(m.id, { weekendId: wish.id, weekendUndone: false });
                    }}
                  >
                    {m.weekendId && !m.weekendUndone ? "Undo" : "Add to my weekend"}
                  </button>
                </div>
                <div className={styles.addedLines} style={{ opacity: m.weekendId && !m.weekendUndone ? 1 : 0.7 }}>
                  <span>＋ {m.reply.weekend.text}</span>
                  {m.weekendId && !m.weekendUndone && <span className={styles.tripSub}>On your weekend list in Lists. Feta plans your weekend from it.</span>}
                </div>
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div className={styles.thinking}>
            <Mascot pose="think" size={34} limbs={false} />
            <div className={styles.typing} aria-label="Feta is thinking">
              <span />
              <span />
              <span />
            </div>
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
            leaveLists(detail.placeId);
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
