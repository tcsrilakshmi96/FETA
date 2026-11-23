"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SLOT_AT, SLOT_NAME, figureHalf, lookImage, styleById, type Look, type Wears } from "@/lib/style";
import { cityNow, keptPicture, keptSpots, lookPicture } from "@/lib/style-client";
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

// One figure from a style's illustration (Feta's own picture, a woman and a
// man side by side), cropped to the one they shop for.
export function StyleFigure({ style, wears, className, imgStyle }: { style: string; wears: Wears; className?: string; imgStyle?: CSSProperties }) {
  const lens = styleById(style);
  if (!lens) return null;
  const half = figureHalf(lens, wears);
  // The illustration is square, a figure in each half: the chosen one is
  // centred in whatever box it's in.
  const pos: CSSProperties = half === "both" ? { width: "100%", height: "auto", top: "auto", bottom: 0, left: 0 } : { left: "50%", width: "auto", aspectRatio: "1", transform: `translateX(${half === "right" ? -75 : -25}%)` };
  // eslint-disable-next-line @next/next/no-img-element -- cropped to one figure
  return <img className={className} src={lookImage(lens.id)} alt="" style={{ ...pos, ...imgStyle }} />;
}

// The look's picture: kept on this phone, else made now (about ₹4, only
// when the look is on screen: founder, 22 Nov 2026), else the style's own
// illustration while it's made or when it can't be.
export function useLookPicture(look: Look | null, wears: Wears, make: boolean, round = 0): { pic: string | null; making: boolean } {
  const [pics, setPics] = useState<Record<string, string | null>>({});
  const [making, setMaking] = useState<string | null>(null);
  // A new round (their photo just added) makes each look's picture again.
  const id = look ? `${look.id}#${round}` : "";
  useEffect(() => {
    if (!look || id in pics) return;
    let live = true;
    keptPicture(look).then((kept) => {
      if (!live) return;
      if (kept || !make) {
        setPics((p) => ({ ...p, [id]: kept }));
        return;
      }
      setMaking(id);
      lookPicture(look, wears).then((img) => {
        if (!live) return;
        setMaking(null);
        setPics((p) => ({ ...p, [id]: img }));
      });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one look at a time, by id
  }, [id, make]);
  return { pic: pics[id] ?? null, making: making === id };
}

// The lookbook card (founder, 23 Nov 2026, option C): the figure on the left
// of a grey card, numbered pulsing dots on the clothes, dotted lines to the
// pieces listed beside it. A piece they own is dark, "YOURS ✓".
export function LookCard({ look, wears, pic, making, owned, onPiece, pill, children }: { look: Look; wears: Wears; pic: string | null; making?: boolean; owned: (name: string) => boolean; onPiece?: (i: number) => void; pill?: string; children?: ReactNode }) {
  const n = look.pieces.length;
  const card = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [img, setImg] = useState<{ w: number; h: number }>({ w: 9, h: 16 });
  const [found, setFound] = useState<{ id: string; spots: [number, number][] | null } | null>(null);
  const spots = found?.id === look.id ? found.spots : null;
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Where the pieces are in their picture (found when it was made).
  useEffect(() => {
    let live = true;
    if (pic) keptSpots(look).then((x) => live && setFound({ id: look.id, spots: x }));
    return () => {
      live = false;
    };
  }, [look, pic]);
  // Each dot in % of the card. With the picture: where the piece really is
  // (the picture fills the left 64%, cropped from the centre, top kept).
  // Without: about where that kind of piece sits on a figure.
  const dots = look.pieces.map((p, i): [number, number] => {
    if (pic && spots && box) {
      const figW = box.w * 0.64;
      const scale = Math.max(figW / img.w, box.h / img.h);
      const dw = img.w * scale;
      const x = ((figW - dw) / 2 + spots[i][0] * dw) / box.w;
      const y = (spots[i][1] * img.h * scale) / box.h;
      return [Math.min(60, Math.max(4, x * 100)), Math.min(96, Math.max(4, y * 100))];
    }
    const [x, y] = SLOT_AT[p.slot];
    // Two pieces in one slot (a layer and an extra) shouldn't sit on one spot.
    const same = look.pieces.slice(0, i).filter((q) => q.slot === p.slot).length;
    return [x * 64 + same * 8, y * 100 + same * 6];
  });
  // Numbered top to bottom by where the dots are, and listed in that order,
  // so no two dotted lines cross.
  const order = look.pieces.map((_, i) => i).sort((a, b) => dots[a][1] - dots[b][1] || a - b);
  const row = new Map(order.map((piece, r) => [piece, r]));
  const ys = order.map((_, r) => ((r + 1) / (n + 1)) * 100);
  return (
    <div className={k.card} ref={card}>
      <div className={k.fig}>
        {pic ? (
          // eslint-disable-next-line @next/next/no-img-element -- made for them, kept on this phone
          <img className={k.photo} src={pic} alt={`${look.title}: ${look.pieces.map((p) => p.name).join(", ")}`} onLoad={(e) => setImg({ w: e.currentTarget.naturalWidth || 9, h: e.currentTarget.naturalHeight || 16 })} />
        ) : (
          <StyleFigure style={look.style} wears={wears} imgStyle={{ top: 0, height: "100%", opacity: making ? 0.55 : 1 }} />
        )}
      </div>
      <svg className={k.lines} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {dots.map(([x, y], i) => (
          <path key={i} d={`M${x + 2} ${y} L58 ${ys[row.get(i)!]}`} stroke="#1a1616" strokeWidth="1" strokeDasharray="3 3" fill="none" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {dots.map(([x, y], i) => (
        <button key={`d${i}`} type="button" className={`${k.num} ${owned(look.pieces[i].name) ? k.numMine : ""}`} style={{ left: `${x}%`, top: `${y}%` }} aria-label={look.pieces[i].name} onClick={() => onPiece?.(i)}>
          <span style={{ animationDelay: `${0.1 * row.get(i)!}s` }}>{row.get(i)! + 1}</span>
        </button>
      ))}
      {look.pieces.map((p, i) => {
        const mine = owned(p.name);
        const r = row.get(i)!;
        return (
          <button key={`i${i}`} type="button" className={`${k.item} ${mine ? k.itemMine : ""}`} style={{ top: `${ys[r]}%`, animationDelay: `${0.12 * r}s` }} onClick={() => onPiece?.(i)}>
            <b>
              {String(r + 1).padStart(2, "0")} · {mine ? "YOURS ✓" : SLOT_NAME[p.slot]}
            </b>
            <span>{p.name}</span>
          </button>
        );
      })}
      {pill && <span className={k.pill}>{pill}</span>}
      {making ? <span className={k.making}>Making the picture…</span> : <span className={k.madeBy}>{pic ? "Made by AI" : "Feta's sketch"}</span>}
      {children}
    </div>
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
