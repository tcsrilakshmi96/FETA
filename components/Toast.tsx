"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

// A short message near the top of the screen, e.g. "Saved to Want to try".
// Lives in the layout so it survives moving between screens.
const ToastContext = createContext<(text: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((message: string) => {
    clearTimeout(timer.current);
    setText(message);
    timer.current = setTimeout(() => setText(null), 1800);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite">
        {text && (
          <div key={text} className="toast">
            {text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
