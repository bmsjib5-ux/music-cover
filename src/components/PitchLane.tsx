import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { melodyAt, pitchClassDistance, type Melody } from '../lib/melody';
import type { TrailFrame } from '../hooks/useScoring';

interface Props {
  melody: Melody | null;
  /** แสดงเส้นทำนองหรือไม่ (โหมด melody) */
  showMelody: boolean;
  keyShift: number;
  getTime: () => number;
  trailRef: MutableRefObject<TrailFrame[]>;
}

const PAST = 2;
const FUTURE = 4;
const HEAD = 0.3;

/** แถบเส้นทำนองแบบเกมร้องเพลง: แท่งขาว = ทำนองที่ต้องร้อง, จุดสี = เสียงของคุณ (เขียว = ตรง) */
export function PitchLane({ melody, showMelody, keyShift, getTime, trailRef }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef({ melody, showMelody, keyShift, getTime });
  props.current = { melody, showMelody, keyShift, getTime };

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let id = 0;
    let center = 6000;
    const draw = () => {
      id = requestAnimationFrame(draw);
      if (document.hidden) return;
      const { melody, showMelody, keyShift, getTime } = props.current;
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
      const shift = keyShift * 100;
      const x = (time: number) => w * HEAD + ((time - t) / (PAST + FUTURE)) * w;

      // ช่วงระดับเสียงที่แสดง: ตามทำนองรอบๆ ตอนนี้ (เลื่อนนุ่มๆ)
      const ref = (time: number) => {
        if (!melody || !showMelody) return 0;
        const c = melodyAt(melody, time);
        return c ? c + shift : 0;
      };
      let lo = Infinity;
      let hi = -Infinity;
      if (melody && showMelody) {
        for (let s = t - PAST; s <= t + FUTURE; s += 0.1) {
          const c = ref(s);
          if (c) {
            lo = Math.min(lo, c);
            hi = Math.max(hi, c);
          }
        }
      }
      const trail = trailRef.current;
      if (lo === Infinity) {
        const voiced = trail.filter((f) => f.c).map((f) => f.c);
        if (voiced.length) {
          voiced.sort((a, b) => a - b);
          lo = hi = voiced[voiced.length >> 1];
        }
      }
      if (lo !== Infinity) center += ((lo + hi) / 2 - center) * 0.05;
      const span = Math.max(1400, (hi - lo || 0) + 600);
      const y = (c: number) => h / 2 - ((c - center) / span) * (h - 16);
      const barH = Math.max(6, Math.min(14, (h / span) * 100));

      // เส้นตาราง (ทุก 1 เสียงเต็ม)
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let c = Math.ceil((center - span / 2) / 200) * 200; c < center + span / 2; c += 200) {
        ctx.beginPath();
        ctx.moveTo(0, y(c));
        ctx.lineTo(w, y(c));
        ctx.stroke();
      }

      // แท่งทำนอง
      if (melody && showMelody) {
        const step = 1 / melody.fps;
        let segStart = -1;
        let segC = 0;
        const flush = (endT: number) => {
          if (segStart < 0) return;
          const x0 = x(segStart);
          const x1 = x(endT);
          const past = endT < t;
          ctx.fillStyle = past ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.62)';
          const yy = y(segC) - barH / 2;
          ctx.beginPath();
          ctx.roundRect(x0, yy, Math.max(2, x1 - x0), barH, barH / 2);
          ctx.fill();
          segStart = -1;
        };
        for (let s = Math.floor((t - PAST) * melody.fps) / melody.fps; s <= t + FUTURE; s += step) {
          const c = ref(s);
          if (c && segStart >= 0 && Math.abs(c - segC) < 80) continue;
          flush(s);
          if (c) {
            segStart = s;
            segC = c;
          }
        }
        flush(t + FUTURE);
      }

      // เสียงของผู้ใช้ (ย้ายคู่แปดให้ใกล้ทำนอง/จุดก่อนหน้า)
      let prev = 0;
      for (const f of trail) {
        if (!f.c || f.t < t - PAST) {
          prev = 0;
          continue;
        }
        const target = ref(f.t) || prev || center;
        const c = f.c + Math.round((target - f.c) / 1200) * 1200;
        const r = ref(f.t);
        const hit = r ? pitchClassDistance(f.c, r) <= 60 : true;
        ctx.fillStyle = hit ? '#3ddc97' : '#ffb547';
        ctx.beginPath();
        ctx.arc(x(f.t), y(c), 3.2, 0, Math.PI * 2);
        ctx.fill();
        prev = c;
      }

      // เส้นตำแหน่งปัจจุบัน
      ctx.fillStyle = 'rgba(255,79,163,0.9)';
      ctx.fillRect(w * HEAD - 1, 4, 2, h - 8);
    };
    id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [trailRef]);

  return <canvas ref={ref} className="pitch-lane" aria-hidden="true" />;
}
