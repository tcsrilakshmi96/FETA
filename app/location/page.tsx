import Link from "next/link";

// Placeholder until the exact-location screen and picks are built.
export default function Location() {
  return (
    <main style={{ position: "absolute", inset: 0, padding: "96px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 34, fontWeight: 300, letterSpacing: "-0.04em" }}>Location and your picks come next.</h1>
      <Link href="/picked-up" style={{ color: "var(--roseText)" }}>‹ Back to what I picked up</Link>
    </main>
  );
}
