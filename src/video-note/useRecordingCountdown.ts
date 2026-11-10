import { useCallback, useEffect, useRef, useState } from 'react';

export function useRecordingCountdown(onComplete: () => void) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const complete = useRef(onComplete);
  complete.current = onComplete;

  const cancel = useCallback(() => {
    window.clearInterval(timer.current);
    timer.current = undefined;
    setRemaining(null);
  }, []);

  const schedule = useCallback((seconds: number) => {
    cancel();
    const deadline = Date.now() + seconds * 1000;
    setRemaining(seconds);
    timer.current = window.setInterval(() => {
      if (document.visibilityState === 'hidden') { cancel(); return; }
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (next > 0) setRemaining(next);
      else {
        cancel();
        complete.current();
      }
    }, 100);
  }, [cancel]);

  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') cancel(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', cancel);
    return () => {
      window.clearInterval(timer.current);
      timer.current = undefined;
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', cancel);
    };
  }, [cancel]);

  return { remaining, schedule, cancel };
}
