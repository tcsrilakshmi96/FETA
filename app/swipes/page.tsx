import Link from "next/link";

// Placeholder until the 10 taste swipes are built.
export default function Swipes() {
  return (
    <main style={{ position: "absolute", inset: 0, padding: "96px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 34, fontWeight: 300, letterSpacing: "-0.04em" }}>The 10 swipes come next.</h1>
      <Link href="/questions" style={{ color: "var(--roseText)" }}>‹ Back to the questions</Link>
    </main>
  );
}
