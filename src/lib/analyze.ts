import { FFT } from '../audio/dsp/fft';
import type { MusicKey } from './types';

export interface AudioInfo {
  duration: number;
  stereo: boolean;
  peaks: number[];
  key: MusicKey | null;
}

export interface ChannelData {
  sampleRate: number;
  channels: Float32Array[];
}

/** วิเคราะห์ไฟล์เสียง: ความยาว, เป็นสเตอริโอจริงไหม (ตัดเสียงร้องได้ไหม), waveform, คีย์เพลงโดยประมาณ */
export function analyzeChannels({ sampleRate, channels }: ChannelData): AudioInfo {
  const l = channels[0];
  const r = channels[1] ?? channels[0];
  const len = l.length;

  let side = 0;
  let mid = 0;
  for (let i = 0; i < len; i += 7) {
    const a = l[i];
    const b = r[i];
    side += (a - b) * (a - b);
    mid += (a + b) * (a + b);
  }
  const stereo = channels.length > 1 && mid > 0 && Math.sqrt(side / mid) > 0.02;

  const buckets = 1000;
  const raw = new Array<number>(buckets).fill(0);
  const per = len / buckets;
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * per);
    const e = Math.min(len, Math.floor((b + 1) * per));
    const step = Math.max(1, Math.floor((e - s) / 200));
    let m = 0;
    for (let i = s; i < e; i += step) m = Math.max(m, Math.abs((l[i] + r[i]) / 2));
    raw[b] = m;
  }
  const max = Math.max(...raw, 1e-9);
  const peaks = raw.map((v) => Math.round((v / max) * 1000) / 1000);

  return { duration: len / sampleRate, stereo, peaks, key: detectKey(sampleRate, l, r) };
}

// โปรไฟล์คีย์ของ Krumhansl–Kessler
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** ประมาณคีย์เพลงจาก chromagram (ความแม่นยำราว 70–80% — ผู้ใช้แก้เองได้) */
export function detectKey(sampleRate: number, l: Float32Array, r: Float32Array): MusicKey | null {
  const dec = Math.max(1, Math.round(sampleRate / 11025));
  const sr = sampleRate / dec;
  const N = 8192;
  const fft = new FFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const total = Math.floor(l.length / dec);
  if (total < N * 2) return null;

  const binPc = new Int8Array(N / 2).fill(-1);
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sr) / N;
    if (f < 55 || f > 2000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    binPc[k] = ((Math.round(midi) % 12) + 12) % 12;
  }

  const chroma = new Array<number>(12).fill(0);
  const frames = 120;
  const first = Math.floor(total * 0.05);
  const span = Math.floor(total * 0.9) - N;
  for (let f = 0; f < frames; f++) {
    const start = first + Math.floor((span * f) / frames);
    for (let i = 0; i < N; i++) {
      const idx = (start + i) * dec;
      let s = 0;
      for (let d = 0; d < dec; d++) s += l[idx + d] + r[idx + d];
      re[i] = (s / (2 * dec)) * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    for (let k = 1; k < N / 2; k++) {
      const pc = binPc[k];
      if (pc < 0) continue;
      chroma[pc] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
  }
  if (chroma.every((v) => v === 0)) return null;

  let best: MusicKey = { root: 0, mode: 'major' };
  let bestScore = -Infinity;
  for (let root = 0; root < 12; root++) {
    const rotated = chroma.map((_, i) => chroma[(i + root) % 12]);
    const maj = correlate(rotated, MAJOR);
    const min = correlate(rotated, MINOR);
    if (maj > bestScore) {
      bestScore = maj;
      best = { root, mode: 'major' };
    }
    if (min > bestScore) {
      bestScore = min;
      best = { root, mode: 'minor' };
    }
  }
  return best;
}
