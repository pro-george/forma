import { useEffect, useState } from 'react';

const QUERY = '(max-width: 720px), (max-height: 520px) and (pointer: coarse)';

/** true on phones (and very short touch screens): the layout switches to bottom sheets. */
export function useIsMobile(): boolean {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = matchMedia(QUERY);
    const upd = () => setM(mq.matches);
    mq.addEventListener('change', upd);
    return () => mq.removeEventListener('change', upd);
  }, []);
  return m;
}
