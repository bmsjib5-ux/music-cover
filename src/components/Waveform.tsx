import { useEffect, useRef } from 'react';
import type { LyricLine } from '../lib/types';

interface Props {
  peaks: number[];
  duration: number;
  getTime: () => number;
  lines: LyricLine[];
  cursor: number;
  onSeek: (t: number) => void;
}

/** ภาพรวมคลื่นเสียงทั้งเพลง พร้อมจุดเริ่ม/จบของแต่ละบรรทัด — คลิกเพื่อกระโดดไปตำแหน่งนั้น */
export function Waveform({ peaks, duration, getTime, lines, cursor, onSeek }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef({ peaks, duration, getTime, lines, cursor });
  props.current = { peaks, duration, getTime, lines, cursor };

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let id = 0;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#ff4fa3';
    const accent2 = css.getPropertyValue('--accent-2').trim() || '#39d5ff';
    const draw = () => {
      id = requestAnimationFrame(draw);
      const { peaks, duration, getTime, lines, cursor } = props.current;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = getTime();
      const x = (sec: number) => (duration > 0 ? (sec / duration) * w : 0);
      const playX = x(t);
      const n = peaks.length || 1;
      const mid = h / 2;
      for (let i = 0; i < w; i += 2) {
        const v = peaks.length ? peaks[Math.min(n - 1, Math.floor((i / w) * n))] : 0.15;
        const bh = Math.max(1, v * (h - 8));
        ctx.fillStyle = i < playX ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
        ctx.fillRect(i, mid - bh / 2, 1.5, bh);
      }
      lines.forEach((l, i) => {
        if (l.start === null) return;
        const sx = x(l.start);
        const ex = l.end !== null ? x(l.end) : sx;
        ctx.fillStyle = i === cursor - 1 ? 'rgba(255,79,163,0.28)' : 'rgba(255,79,163,0.12)';
        ctx.fillRect(sx, 0, Math.max(2, ex - sx), h);
        ctx.fillStyle = accent;
        ctx.fillRect(sx, 0, 1.5, h);
        if (l.end !== null) {
          ctx.fillStyle = accent2;
          ctx.fillRect(ex, h - 10, 1.5, 10);
        }
      });
      ctx.fillStyle = '#fff';
      ctx.fillRect(playX - 1, 0, 2, h);
    };
    id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <canvas
      ref={ref}
      className="waveform"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - rect.left) / rect.width) * duration);
      }}
      aria-label="คลื่นเสียง คลิกเพื่อเลื่อนตำแหน่ง"
    />
  );
}
