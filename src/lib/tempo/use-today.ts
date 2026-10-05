'use client';

import { useEffect, useState } from 'react';
import { todayIn, type CivilDate } from './civil';

/**
 * Today's date in `timezone`, kept honest while the page stays open. A tab left
 * running overnight (or a phone app resumed from the background, where timers
 * are frozen) would otherwise keep marking yesterday until a refresh. It
 * re-reads on a slow tick and whenever the page becomes visible or focused;
 * setting an unchanged date is a no-op, so only a real rollover re-renders.
 */
export function useToday(timezone: string): CivilDate {
  const [today, setToday] = useState<CivilDate>(() => todayIn(timezone));

  useEffect(() => {
    const read = () => setToday(todayIn(timezone));
    read();
    const timer = window.setInterval(read, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', read);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', read);
    };
  }, [timezone]);

  return today;
}
