import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { peekEngine } from './audio/engine';
import './styles.css';

// เบราว์เซอร์จะเริ่ม AudioContext ได้หลังผู้ใช้แตะหน้าจอครั้งแรกเท่านั้น
const unlock = () => void peekEngine()?.unlock();
window.addEventListener('pointerdown', unlock, { capture: true });
window.addEventListener('keydown', unlock, { capture: true });

if (import.meta.env.DEV) {
  // ใช้ตรวจสอบเอนจินเสียงจาก devtools / ชุดทดสอบ
  (window as unknown as { __engine: typeof peekEngine }).__engine = peekEngine;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// ซ่อนหน้าจอเปิดแอปเมื่อหน้าแรกพร้อม (แสดงอย่างน้อยครู่หนึ่งให้เห็นไอคอน ไม่กะพริบ)
const SPLASH_MIN_MS = 800;
const splash = document.getElementById('splash');
if (splash) {
  const hide = () => {
    splash.classList.add('hide');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 600);
  };
  requestAnimationFrame(() => setTimeout(hide, Math.max(0, SPLASH_MIN_MS - performance.now())));
}
