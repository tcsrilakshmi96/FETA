import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Feta",
  description: "Three picks for tonight, chosen for your taste.",
};

export const viewport: Viewport = {
  // Shrink the page when the keyboard opens, so the main button stays visible.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF3EE" },
    { media: "(prefers-color-scheme: dark)", color: "#161213" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={outfit.variable}>
      <body>
        <div className="app">
          <div className="haze haze-saffron" />
          <div className="haze haze-turquoise" />
          <div className="haze haze-rose" />
          <ToastProvider>{children}</ToastProvider>
          {/* The feedback sheet comes in a later step. */}
          <button type="button" className="feedback-pill">
            Feedback
          </button>
        </div>
      </body>
    </html>
  );
}
