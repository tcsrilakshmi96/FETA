"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// A short message near the top of the screen, e.g. "Saved to Want to try",
// with an optional action ("Got it: fewer brewpubs · Undo").
// Lives in the layout so it survives moving between screens. Code outside
// a screen (a search on its way back) shows one with announce().
type Action = { label: string; run: () => void };
const ToastContext = createContext<(text: string, action?: Action) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function announce(text: string) {
  window.dispatchEvent(new CustomEvent("feta:toast", { detail: text }));
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // With an action (Undo), or a longer message, it stays long enough to tap or read.
  const show = useCallback((message: string, next?: Action) => {
    clearTimeout(timer.current);
    setText(message);
    setAction(next ?? null);
    timer.current = setTimeout(() => setText(null), next ? 5000 : Math.min(6000, Math.max(1800, message.length * 50)));
  }, []);

  useEffect(() => {
    const on = (e: Event) => show((e as CustomEvent<string>).detail);
    window.addEventListener("feta:toast", on);
    return () => window.removeEventListener("feta:toast", on);
  }, [show]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite">
        {text && (
          <div key={text} className="toast">
            {text}
            {action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  action.run();
                  setText(null);
                }}
              >
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
