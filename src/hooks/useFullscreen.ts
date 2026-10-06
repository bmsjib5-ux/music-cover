import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * เต็มจอให้ element หนึ่ง (Fullscreen API) — ถ้าเบราว์เซอร์ไม่รองรับ (เช่น iPhone) จะขยายเต็มหน้าต่างแทน (theater)
 * คีย์ลัด: F = สลับเต็มจอ, Esc = ออกจากโหมดเต็มหน้าต่าง
 */
export function useFullscreen<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [theater, setTheater] = useState(false);

  useEffect(() => {
    const onFs = () => setFullscreen(!!ref.current && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (theater) {
      setTheater(false);
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => setTheater(true));
    } else {
      setTheater(true);
    }
  }, [theater]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyF') toggle();
      else if (e.code === 'Escape' && theater) setTheater(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, theater]);

  const active = fullscreen || theater;
  return { ref, active, toggle, className: `${fullscreen ? 'is-full' : ''} ${theater ? 'theater' : ''}` };
}
