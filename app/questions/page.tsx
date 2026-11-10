import Link from "next/link";

// Placeholder until the 6 question screens are built.
export default function Questions() {
  return (
    <main style={{ position: "absolute", inset: 0, padding: "96px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 34, fontWeight: 300, letterSpacing: "-0.04em" }}>The 6 questions come next.</h1>
      <Link href="/sign-in" style={{ color: "var(--roseText)" }}>‹ Back to sign-in</Link>
    </main>
  );
}
