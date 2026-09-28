import { useEffect, useState } from 'react';

/** One wall clock for all three visible/adjacent day panels. */
export function useScheduleClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      setNow(new Date());
      timer = setTimeout(refresh, 60_000 - Date.now() % 60_000);
    };
    const resume = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', refresh);
    };
  }, []);
  return now;
}
