import { describe, expect, it } from 'vitest';
import { extractMelody, melodyAt, melodyCoverage, pitchClassDistance } from './melody';

const SR = 44100;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** เพลงจำลอง: เสียงร้องตรงกลาง + คอร์ดแพนซ้าย + อาร์เปจจิโอแพนขวา + เบสตรงกลาง + noise */
function synthMix() {
  const notes: [number, number, number][] = []; // [start, dur, midi]
  const melody = [64, 67, 69, 67, 64, 62, 60, 62, 64, 72, 71, 69, 67, 65, 64, 62];
  melody.forEach((m, i) => notes.push([1 + i * 0.5, 0.42, m]));
  // ท่อนผู้ชาย (ต่ำ)
  [52, 55, 57, 55, 52, 50].forEach((m, i) => notes.push([10 + i * 0.5, 0.42, m]));
  const dur = 14;
  const len = SR * dur;
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const chords = [48, 52, 55, 59];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let left = 0;
    let right = 0;
    for (const c of chords) left += 0.05 * Math.sin(2 * Math.PI * mtof(c + 12) * t);
    const arp = [72, 76, 79][Math.floor(t * 8) % 3];
    right += 0.06 * Math.sin(2 * Math.PI * mtof(arp) * t);
    const bass = 0.25 * Math.sin(2 * Math.PI * mtof([36, 41, 43][Math.floor(t / 2) % 3]) * t);
    const noise = (Math.random() - 0.5) * 0.01;
    L[i] = left * 1 + right * 0.25 + bass + noise;
    R[i] = left * 0.3 + right * 1 + bass + noise;
  }
  for (const [s, d, m] of notes) {
    const f = mtof(m);
    const a = Math.floor(s * SR);
    const b = Math.floor((s + d) * SR);
    let ph = 0;
    for (let i = a; i < b; i++) {
      const t = (i - a) / SR;
      const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / 0.2);
      ph += (2 * Math.PI * f * vib) / SR;
      const env = Math.min(1, t / 0.03) * Math.min(1, (b - i) / (0.03 * SR));
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin(h * ph) / h;
      L[i] += 0.12 * env * v;
      R[i] += 0.12 * env * v;
    }
  }
  return { L, R, notes };
}

describe('melody extraction', () => {
  it('follows a centered vocal line in a stereo mix', async () => {
    const { L, R, notes } = synthMix();
    const m = await extractMelody(SR, L, R);
    let total = 0;
    let hit = 0;
    let falseVoiced = 0;
    let silentFrames = 0;
    for (let i = 0; i < m.cents.length; i++) {
      const t = i / m.fps;
      const note = notes.find(([s, d]) => t >= s + 0.06 && t <= s + d - 0.06);
      const inGap = !notes.some(([s, d]) => t >= s - 0.1 && t <= s + d + 0.1);
      if (note) {
        total++;
        if (m.cents[i] && pitchClassDistance(m.cents[i], note[2] * 100) <= 50) hit++;
      } else if (inGap) {
        silentFrames++;
        if (m.cents[i]) falseVoiced++;
      }
    }
    expect(hit / total).toBeGreaterThan(0.8);
    expect(falseVoiced / Math.max(1, silentFrames)).toBeLessThan(0.2);
  });

  it('samples and measures coverage', () => {
    const m = { fps: 20, cents: [0, 0, 6400, 6400, 6400, 0, 0, 0] };
    expect(melodyAt(m, 0.1)).toBe(6400);
    expect(melodyAt(m, 5)).toBe(0);
    expect(melodyCoverage(m, [{ index: 0, text: 'x', start: 0.1, end: 0.2 }])).toBe(1);
    expect(melodyCoverage(m, [{ index: 0, text: 'x', start: 0.1, end: 0.3 }])).toBeCloseTo(0.6);
    expect(pitchClassDistance(6400, 5200)).toBe(0);
    expect(pitchClassDistance(6450, 6400)).toBe(50);
    expect(pitchClassDistance(6400 + 700, 6400)).toBe(500);
  });
});
