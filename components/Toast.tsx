"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

// A short message near the top of the screen, e.g. "Saved to Want to try",
// with an optional action ("Got it: fewer brewpubs · Undo").
// Lives in the layout so it survives moving between screens.
type Action = { label: string; run: () => void };
const ToastContext = createContext<(text: string, action?: Action) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // With an action (Undo), it stays long enough to tap.
  const show = useCallback((message: string, next?: Action) => {
    clearTimeout(timer.current);
    setText(message);
    setAction(next ?? null);
    timer.current = setTimeout(() => setText(null), next ? 5000 : 1800);
  }, []);

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
