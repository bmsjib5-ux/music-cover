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
