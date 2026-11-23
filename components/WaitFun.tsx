"use client";

import { useEffect, useState } from "react";
import styles from "./WaitFun.module.css";

// Waiting, made fun (founder, 20 Nov 2026: "instead of keeping them
// waiting… show a clock with time so they know something is happening…
// do you wanna play tic tac toe?"). A clock counts down the usual wait, a
// line changes every few seconds, and past the usual time it says so
// honestly. With `game`, tic-tac-toe against Feta while they wait.
export type WaitKind = "picks" | "plan" | "read" | "draw" | "look";

const WAIT: Record<WaitKind, { seconds: number; lines: string[] }> = {
  picks: {
    seconds: 18,
    lines: ["Looking for the best picks for you…", "Checking what's open tonight…", "Skipping the overhyped ones…", "Asking around about what's on…", "Weighing the places you love…", "Nearly there, count to five…"],
  },
  plan: {
    seconds: 18,
    lines: ["Putting your evening together…", "Matching dinner with something to do…", "Checking they're open at the right time…", "Working out the walk between…"],
  },
  read: {
    seconds: 12,
    lines: ["Reading your photos…", "Looking at the clothes, only the clothes…", "Spotting the cuts and colours…", "Matching them to styles…"],
  },
  draw: {
    seconds: 10,
    lines: ["Drawing this look…", "Picking the colours…", "Adding the shoes…"],
  },
  // Three complete looks take about 20–30 s (founder, 23 Nov 2026: a 5 s
  // countdown, then a long wait).
  look: {
    seconds: 25,
    lines: ["Reading where you're going…", "Picking from your styles…", "Choosing colours that work together…", "Checking every look has shoes…", "Making the three really different…", "Using what's already in your wardrobe…"],
  },
};

// `onLight`: on Style's light stage, dark ink in dark mode too.
export default function WaitFun({ kind, game = false, compact = false, onLight = false }: { kind: WaitKind; game?: boolean; compact?: boolean; onLight?: boolean }) {
  const { seconds, lines } = WAIT[kind];
  const [gone, setGone] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setGone((g) => g + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, seconds - gone);
  const line = left === 0 ? "A few more seconds. Worth the wait." : lines[Math.floor(gone / 3) % lines.length];
  const r = 22;
  const round = 2 * Math.PI * r;
  return (
    <div className={`${styles.wait} ${compact ? styles.compact : ""} ${onLight ? styles.onLight : ""}`} role="status" aria-live="polite" data-waiting={kind}>
      <div className={styles.row}>
        <svg className={styles.clock} viewBox="0 0 56 56" aria-hidden="true">
          <circle cx="28" cy="28" r={r} className={styles.track} />
          <circle cx="28" cy="28" r={r} className={styles.hand} strokeDasharray={round} strokeDashoffset={round * (1 - left / seconds)} />
          <text x="28" y="33" textAnchor="middle" className={styles.num}>
            {left > 0 ? left : "…"}
          </text>
        </svg>
        <p className={styles.line} key={line}>
          {line}
        </p>
      </div>
      {game && !playing && (
        <button type="button" className={styles.play} onClick={() => setPlaying(true)}>
          Play tic-tac-toe with Feta while you wait?
        </button>
      )}
      {game && playing && <TicTacToe />}
    </div>
  );
}

// You're ✕, Feta is 🧀. Feta wins when it can, blocks when it must, else
// takes the middle, a corner, then anything; one turn in four it plays
// anywhere, so it can be beaten.
const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];
type Cell = "x" | "o" | null;
const winner = (b: Cell[]) => LINES.find(([a, c, d]) => b[a] && b[a] === b[c] && b[a] === b[d]) ?? null;

function fetaMove(b: Cell[]): number {
  const free = b.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  const finishing = (who: Cell) => free.find((i) => winner(b.map((c, j) => (j === i ? who : c))));
  if (Math.random() < 0.25) return free[Math.floor(Math.random() * free.length)];
  return finishing("o") ?? finishing("x") ?? (free.includes(4) ? 4 : (free.find((i) => [0, 2, 6, 8].includes(i)) ?? free[0]));
}

function TicTacToe() {
  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const [score, setScore] = useState({ you: 0, feta: 0 });
  const won = winner(board);
  const full = board.every(Boolean);
  const over = !!won || full;

  function tap(i: number) {
    if (board[i] || over) return;
    const mine = board.map((c, j) => (j === i ? "x" : c)) as Cell[];
    if (winner(mine)) {
      setBoard(mine);
      setScore((s) => ({ ...s, you: s.you + 1 }));
      return;
    }
    if (mine.every(Boolean)) return setBoard(mine);
    const at = fetaMove(mine);
    const next = mine.map((c, j) => (j === at ? "o" : c)) as Cell[];
    setBoard(next);
    if (winner(next)) setScore((s) => ({ ...s, feta: s.feta + 1 }));
  }

  const result = won ? (board[won[0]] === "x" ? "You win! Feta is impressed." : "Feta wins this one.") : full ? "A draw." : "Your turn: you're ✕";
  return (
    <div className={styles.game}>
      <div className={styles.board}>
        {board.map((c, i) => (
          <button key={i} type="button" aria-label={c ? (c === "x" ? "✕" : "Feta") : `Square ${i + 1}`} className={won?.includes(i) ? styles.winCell : ""} onClick={() => tap(i)}>
            {c === "x" ? "✕" : c === "o" ? "🧀" : ""}
          </button>
        ))}
      </div>
      <p className={styles.result}>
        {result} · You {score.you} – {score.feta} Feta
      </p>
      {over && (
        <button type="button" className={styles.play} onClick={() => setBoard(Array(9).fill(null))}>
          Again
        </button>
      )}
    </div>
  );
}
