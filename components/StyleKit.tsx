"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { stylePicture, styleById, type Look, type Wears } from "@/lib/style";
import { cityNow, keptPicture, keptSpots, lookPicture, takePictureNotice } from "@/lib/style-client";
import { useToast } from "@/components/Toast";
import k from "./StyleLook.module.css";

// Shared parts of Style (founder, 22–23 Nov 2026, docs/style-spec.md).

// The top of every Style screen: a way back (Home, the plan they came from,
// or the look), the date and STYLE · BETA, and Today · Brands · My style.
export type StyleTab = "today" | "brands" | "me";
export function StyleHead({ tab, back, backLabel = "Home" }: { tab: StyleTab | null; back?: () => void; backLabel?: string }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the city's date, read in the browser
  useEffect(() => setDate(cityNow().date), []);
  const go = (t: StyleTab) => router.push(t === "today" ? "/style" : t === "brands" ? "/style/brands" : "/style/me");
  return (
    <>
      <div className={k.head}>
        <button type="button" className={k.backBtn} onClick={back ?? (() => router.push("/home"))}>
          ‹ {backLabel}
        </button>
        <span className={k.cap}>
          {date ? `${date} · ` : ""}Style<span className={k.beta}>BETA</span>
        </span>
      </div>
      {tab && (
        <div className={k.seg} role="tablist" aria-label="Style">
          {(["today", "brands", "me"] as StyleTab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? k.segOn : ""} onClick={() => tab !== t && go(t)}>
              {t === "today" ? "Today" : t === "brands" ? "Brands" : "My style"}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// A picture of a look in a style (founder, 23 Nov 2026: never a sketch):
// an outfit board from Feta's library, made once per style for womenswear
// and menswear (`public/style/boards/`, `stylePicture`), filling its box.
// Stands for a style wherever one is shown, and stands in for a look whose
// own picture is being made or can't be made today.
export function StyleFigure({ style, wears, seed = "", className, imgStyle }: { style: string; wears: Wears; seed?: string; className?: string; imgStyle?: CSSProperties }) {
  const lens = styleById(style);
  if (!lens) return null;
  // eslint-disable-next-line @next/next/no-img-element -- a fixed picture from Feta's library
  return <img className={className} src={stylePicture(lens.id, wears, seed)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", mixBlendMode: "normal", ...imgStyle }} />;
}

// The look's picture: kept on this phone or account, else made only when
// they ask for it (founder, 24 Nov 2026: "if we take a look from the library
// and show, it will be fast"; about ₹4), else the style's library picture.
// waiting: not yet known whether it's kept or must be made, so the card shows
// a faint blur and no words (founder, 25 Nov 2026: it said "not this exact
// one" first, then "Making your look").
export function useLookPicture(look: Look | null, wears: Wears, make: boolean): { pic: string | null; making: boolean; waiting: boolean } {
  const toast = useToast();
  const [pics, setPics] = useState<Record<string, string | null>>({});
  const [making, setMaking] = useState<string | null>(null);
  // One per look; a failed one isn't tried again by itself (cost audit, 25 Nov 2026).
  const id = look ? `${look.id}#${make}` : "";
  useEffect(() => {
    if (!look || id in pics) return;
    let live = true;
    keptPicture(look).then((kept) => {
      if (!live) return;
      if (kept || !make) {
        setPics((p) => ({ ...p, [id]: kept?.image ?? null }));
        return;
      }
      setMaking(id);
      lookPicture(look, wears).then((img) => {
        if (!live) return;
        setMaking(null);
        setPics((p) => ({ ...p, [id]: img }));
        // Couldn't be made (today's limit, a hiccup): say why.
        if (!img) toast(takePictureNotice() ?? "Couldn't make the picture just now.");
      });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one look at a time, by id
  }, [id]);
  return { pic: pics[id] ?? null, making: making === id, waiting: !!look && make && !(id in pics) && making !== id };
}

// The lookbook card (founder, 23 Nov 2026): the look's picture fills the
// card (on them, or an outfit board with the bag, shoes and jewellery laid
// out beside the clothes), a numbered pulsing dot on every piece the picture
// shows, and the pieces in one row underneath, so Wear this stays on screen.
// A piece they own is dark, "YOURS ✓". The look's own picture is made as
// it comes on screen (founder, 25 Nov 2026); while it's
// made only a faint blur shows, and when it can't be (today's limit) a
// picture of a look in that style stands in, said so, with no dots (founder:
// never a sketch). Only the outfit, never on them (founder, 25 Nov 2026).
export function LookCard({ look, wears, pic, making, waiting, owned, onPiece, pill, children }: { look: Look; wears: Wears; pic: string | null; making?: boolean; waiting?: boolean; owned: (name: string) => boolean; onPiece?: (i: number) => void; pill?: string; children?: ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [img, setImg] = useState<{ w: number; h: number }>({ w: 4, h: 5 });
  const [found, setFound] = useState<{ id: string; spots: ([number, number] | null)[] | null } | null>(null);
  const spots = found?.id === look.id ? found.spots : null;
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Where the pieces are in their picture (found when it was made).
  // A new picture's dots come a few seconds after it, so asked again a few times.
  useEffect(() => {
    let live = true;
    const timers: number[] = [];
    const ask = (n: number) =>
      keptSpots(look).then((x) => {
        if (!live) return;
        if (x || n >= 4) return setFound({ id: look.id, spots: x });
        timers.push(window.setTimeout(() => ask(n + 1), 5000));
      });
    if (pic) ask(0);
    return () => {
      live = false;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [look, pic]);
  // Each dot in % of the card: the picture is shown whole (contain), centred.
  const dots = look.pieces.map((_, i): [number, number] | null => {
    const spot = pic && spots && box ? spots[i] : null;
    if (!spot || !box) return null;
    const scale = Math.min(box.w / img.w, box.h / img.h);
    const dw = img.w * scale;
    const dh = img.h * scale;
    const x = ((box.w - dw) / 2 + spot[0] * dw) / box.w;
    const y = ((box.h - dh) / 2 + spot[1] * dh) / box.h;
    return [Math.min(96, Math.max(4, x * 100)), Math.min(96, Math.max(4, y * 100))];
  });
  // Numbered top to bottom, then left to right, by where the dots are.
  const order = look.pieces.map((_, i) => i).sort((a, b) => (dots[a]?.[1] ?? 200 + a) - (dots[b]?.[1] ?? 200 + b) || (dots[a]?.[0] ?? 0) - (dots[b]?.[0] ?? 0));
  const num = new Map(order.map((piece, r) => [piece, r + 1]));
  return (
    <>
      <div className={k.card} ref={card}>
        <div className={k.fig}>
          {pic ? (
            // eslint-disable-next-line @next/next/no-img-element -- made for them
            <img className={k.photo} src={pic} alt={`${look.title}: ${look.pieces.map((p) => p.name).join(", ")}`} onLoad={(e) => setImg({ w: e.currentTarget.naturalWidth || 4, h: e.currentTarget.naturalHeight || 5 })} />
          ) : (
            <StyleFigure style={look.style} wears={wears} seed={look.id} imgStyle={{ objectFit: "contain", opacity: making || waiting ? 0.2 : 1, filter: making || waiting ? "blur(10px)" : undefined }} />
          )}
        </div>
        {dots.map((d, i) => d && (
          <button key={`d${i}`} type="button" className={`${k.num} ${owned(look.pieces[i].name) ? k.numMine : ""}`} style={{ left: `${d[0]}%`, top: `${d[1]}%` }} aria-label={look.pieces[i].name} onClick={() => onPiece?.(i)}>
            <span style={{ animationDelay: `${0.1 * num.get(i)!}s` }}>{num.get(i)}</span>
          </button>
        ))}
        {pill && <span className={k.pill}>{pill}</span>}
        {making ? <span className={k.making}>Making your look · about 10 seconds</span> : waiting ? null : <span className={k.madeBy}>{pic ? "Made by AI" : "A look in this style · not this exact one"}</span>}
        {children}
      </div>
      <div className={k.pieceRow}>
        {order.map((i) => {
          const p = look.pieces[i];
          const mine = owned(p.name);
          return (
            <button key={`i${i}`} type="button" className={`${k.piece} ${mine ? k.pieceMine : ""}`} onClick={() => onPiece?.(i)}>
              {dots[i] && <b>{num.get(i)}</b>}
              <span>
                {mine ? "Yours ✓ · " : ""}
                {p.name}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// The piece sheet: I have one · Show me another · Where to buy.
export function PieceSheet({ name, look, wears, pic, budgetText, onClose, onHave, onSwap, onBuy, swapping, mine }: { name: string; look: Look; wears: Wears; pic: string | null; budgetText: string; onClose: () => void; onHave: () => void; onSwap: () => void; onBuy: () => void; swapping: boolean; mine: boolean }) {
  return (
    <>
      <button type="button" className={k.shade} aria-label="Close" onClick={onClose} />
      <div className={k.sheet} role="dialog" aria-label={name}>
        <div className={k.grab} />
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className={k.thumbImg} style={{ width: 56, height: 70, flex: "none" }}>
            {pic ? (
              // eslint-disable-next-line @next/next/no-img-element -- kept on this phone
              <img src={pic} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
            ) : (
              <StyleFigure style={look.style} wears={wears} />
            )}
          </span>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span className={k.lookTitle} style={{ fontSize: 21 }}>
              {mine ? `Your ${name.toLowerCase()}` : name}
            </span>
            <span style={{ fontSize: 13, opacity: 0.7 }}>In &ldquo;{look.title}&rdquo;</span>
          </span>
        </div>
        {!mine && (
          <button type="button" className={k.opt} onClick={onHave}>
            <b>I have one like this</b>
            <span>Feta keeps it in your looks and adds it to your wardrobe</span>
          </button>
        )}
        <button type="button" className={k.opt} onClick={onSwap} disabled={swapping}>
          <b>{swapping ? "Finding another…" : "Show me another"}</b>
          <span>Only this piece changes; the rest stays</span>
        </button>
        <button type="button" className={k.opt} onClick={onBuy}>
          <b>Where to buy</b>
          <span>{budgetText}</span>
        </button>
      </div>
    </>
  );
}
