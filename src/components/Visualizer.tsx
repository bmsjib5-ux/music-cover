import { useEffect, useRef } from 'react';
import { getEngine } from '../audio/engine';

/** แท่งสเปกตรัมจางๆ ด้านล่างจอคาราโอเกะ */
export function Visualizer() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const analyser = getEngine().analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let id = 0;
    const draw = () => {
      id = requestAnimationFrame(draw);
      if (document.hidden) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      analyser.getByteFrequencyData(data);
      const bars = 48;
      const usable = Math.floor(data.length * 0.7);
      const bw = w / bars;
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, 'rgba(255, 79, 163, 0.55)');
      grad.addColorStop(1, 'rgba(57, 213, 255, 0.15)');
      ctx.fillStyle = grad;
      for (let i = 0; i < bars; i++) {
        // ใช้สเกล log ให้ย่านเสียงต่ำไม่กินพื้นที่ทั้งหมด
        const a = Math.floor(Math.pow(i / bars, 1.6) * usable);
        const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / bars, 1.6) * usable));
        let v = 0;
        for (let k = a; k < b; k++) v = Math.max(v, data[k]);
        const bh = (v / 255) * h;
        ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
      }
    };
    id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, []);
  return <canvas ref={ref} className="visualizer" aria-hidden="true" />;
}
