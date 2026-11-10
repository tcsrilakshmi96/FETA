import Link from "next/link";

// Placeholder until the sign-in screen is built.
export default function SignIn() {
  return (
    <main style={{ position: "absolute", inset: 0, padding: "96px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 34, fontWeight: 300, letterSpacing: "-0.04em" }}>Sign-in comes next.</h1>
      <Link href="/" style={{ color: "var(--roseText)" }}>‹ Back to Welcome</Link>
    </main>
  );
}
