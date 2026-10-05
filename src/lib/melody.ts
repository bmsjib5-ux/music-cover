import { FFT } from '../audio/dsp/fft';
import type { TimedLine } from './lyrics';

/**
 * เส้นทำนองอ้างอิงของเสียงร้อง ใช้ให้คะแนนการร้อง
 * cents[i] = ระดับเสียงที่เวลา i / fps วินาที (MIDI × 100), 0 = ไม่มีเสียงร้อง
 */
export interface Melody {
  fps: number;
  cents: number[];
}

export const MELODY_FPS = 20;

const TARGET_SR = 11025;
const N = 1024;
const MIN_F0 = 75;
const MAX_F0 = 1000;
/** ตัดย่านต่ำทิ้งเพื่อไม่ให้จับโน้ตเบส (เสียงร้องยังหาเจอจากฮาร์มอนิก) */
const LOW_CUT = 200;
const HIGH_CUT = 3000;
const CLARITY = 0.5;
/** เฟรมที่เบากว่าช่วงดังของเพลงเกินนี้ถือว่าไม่มีเสียงร้อง (dB) */
const GATE_DB = -26;

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * ถอดเส้นทำนองเสียงร้องจากไฟล์เพลงสเตอริโอ
 * 1. แยกเสียงที่อยู่ "ตรงกลาง" (ซ้าย ≈ ขวา) ในแต่ละ bin ของสเปกตรัม — ปกติคือเสียงร้องนำ
 * 2. หา autocorrelation จากสเปกตรัมกำลังของเสียงตรงกลาง (ย่าน 200–3000 Hz)
 * 3. เลือกคาบด้วยวิธีแบบ McLeod (MPM) แล้วกรองเฟรมเบา/กระโดดคู่แปด/สั้นเกินไปออก
 */
export async function extractMelody(
  sampleRate: number,
  left: Float32Array,
  right: Float32Array,
  onProgress?: (p: number) => void,
): Promise<Melody> {
  const dec = Math.max(1, Math.round(sampleRate / TARGET_SR));
  const sr = sampleRate / dec;
  const len = Math.floor(left.length / dec);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let a = 0;
    let b = 0;
    const o = i * dec;
    for (let d = 0; d < dec; d++) {
      a += left[o + d];
      b += right[o + d];
    }
    L[i] = a / dec;
    R[i] = b / dec;
  }

  const hop = sr / MELODY_FPS;
  const totalFrames = Math.ceil((len / sr) * MELODY_FPS);
  const fft = new FFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const power = new Float64Array(N / 2 + 1);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const tauMin = Math.floor(sr / MAX_F0);
  const tauMax = Math.min(N / 2 - 2, Math.ceil(sr / MIN_F0));
  // autocorrelation ของหน้าต่าง ใช้แก้ความเอนเอียงของ autocorrelation สัญญาณ
  const wac = new Float64Array(tauMax + 2);
  for (let t = 0; t <= tauMax + 1; t++) {
    let s = 0;
    for (let i = 0; i + t < N; i++) s += win[i] * win[i + t];
    wac[t] = s;
  }
  const kLo = Math.ceil((LOW_CUT * N) / sr);
  const kHi = Math.min(N / 2, Math.floor((HIGH_CUT * N) / sr));
  const nsdf = new Float64Array(tauMax + 2);

  const f0s = new Float64Array(totalFrames);
  const energy = new Float64Array(totalFrames);

  for (let f = 0; f < totalFrames; f++) {
    if (f > 0 && f % 150 === 0) {
      onProgress?.(f / totalFrames);
      await yieldToUi();
    }
    // หน้าต่างอยู่กึ่งกลางเวลา f / fps
    const center = Math.round(f * hop);
    const o = center - N / 2;
    for (let i = 0; i < N; i++) {
      const idx = o + i;
      const ok = idx >= 0 && idx < len;
      re[i] = ok ? L[idx] * win[i] : 0;
      im[i] = ok ? R[idx] * win[i] : 0;
    }
    // FFT เดียวได้ทั้งซ้ายและขวา (ซ้าย = ส่วนจริง, ขวา = ส่วนจินตภาพ)
    fft.transform(re, im);
    let e = 0;
    for (let k = 0; k <= N / 2; k++) {
      if (k < kLo || k > kHi) {
        power[k] = 0;
        continue;
      }
      const j = (N - k) % N;
      const cr = re[j];
      const ci = -im[j];
      const lr = (re[k] + cr) / 2;
      const li = (im[k] + ci) / 2;
      const rr = (im[k] - ci) / 2;
      const ri = -(re[k] - cr) / 2;
      const pl = lr * lr + li * li;
      const pr = rr * rr + ri * ri;
      const mr = lr + rr;
      const mi = li + ri;
      const pm = mr * mr + mi * mi;
      const s = pl + pr > 0 ? pm / (2 * (pl + pr)) : 0;
      // mask ยกกำลังสูงเพื่อกดเครื่องดนตรีที่แพนไม่สุด (ซ้าย/ขวาคล้ายกันบางส่วน)
      let m = (s - 0.5) * 2;
      m = m <= 0 ? 0 : m * m * m * m;
      const p = m * m * pm * 0.25;
      power[k] = p;
      e += p;
    }
    energy[f] = e;
    if (e <= 0) continue;
    for (let k = 0; k <= N / 2; k++) {
      re[k] = power[k];
      im[k] = 0;
    }
    for (let k = 1; k < N / 2; k++) {
      re[N - k] = power[k];
      im[N - k] = 0;
    }
    fft.transform(re, im, true);
    const r0 = re[0] / wac[0];
    if (r0 <= 0) continue;
    for (let t = 0; t <= tauMax + 1; t++) nsdf[t] = re[t] / wac[t] / r0;

    // MPM: หา peak ของแต่ละช่วงบวกหลังจุดตัดศูนย์แรก
    let t = 1;
    while (t < tauMax && nsdf[t] > 0) t++;
    let bestTau = -1;
    let globalMax = 0;
    const peaks: [number, number][] = [];
    while (t < tauMax) {
      while (t < tauMax && nsdf[t] <= 0) t++;
      let pt = -1;
      let pv = 0;
      while (t < tauMax && nsdf[t] > 0) {
        if (nsdf[t] > pv) {
          pv = nsdf[t];
          pt = t;
        }
        t++;
      }
      if (pt >= tauMin) {
        peaks.push([pt, pv]);
        globalMax = Math.max(globalMax, pv);
      }
    }
    if (globalMax < CLARITY) continue;
    for (const [pt, pv] of peaks) {
      if (pv >= globalMax * 0.88) {
        bestTau = pt;
        break;
      }
    }
    if (bestTau < 0) continue;
    const a = nsdf[bestTau - 1];
    const b = nsdf[bestTau];
    const c = nsdf[bestTau + 1];
    const den = a - 2 * b + c;
    const tau = den !== 0 ? bestTau + (a - c) / (2 * den) : bestTau;
    f0s[f] = sr / tau;
  }
  onProgress?.(1);
  return { fps: MELODY_FPS, cents: postProcess(f0s, energy) };
}

function postProcess(f0s: Float64Array, energy: Float64Array): number[] {
  const n = f0s.length;
  const sorted = Array.from(energy).filter((e) => e > 0).sort((a, b) => a - b);
  const loud = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
  const gate = loud * Math.pow(10, GATE_DB / 10);
  const cents = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (f0s[i] > 0 && energy[i] >= gate) cents[i] = (69 + 12 * Math.log2(f0s[i] / 440)) * 100;
  }
  // แก้กระโดดคู่แปดเทียบกับค่ามัธยฐานของเพื่อนบ้าน
  const fixed = cents.slice();
  for (let i = 0; i < n; i++) {
    if (!cents[i]) continue;
    const near: number[] = [];
    for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) if (j !== i && cents[j]) near.push(cents[j]);
    if (near.length < 3) continue;
    near.sort((a, b) => a - b);
    const med = near[near.length >> 1];
    const diff = med - cents[i];
    if (Math.abs(diff) > 900) fixed[i] = cents[i] + Math.round(diff / 1200) * 1200;
  }
  // median filter 5 เฟรม (เฉพาะเฟรมที่มีเสียง)
  const smooth = fixed.slice();
  for (let i = 0; i < n; i++) {
    if (!fixed[i]) continue;
    const win: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) if (fixed[j]) win.push(fixed[j]);
    win.sort((a, b) => a - b);
    smooth[i] = win[win.length >> 1];
  }
  // ตัดช่วงเสียงที่สั้นกว่า 3 เฟรม (150ms) ทิ้ง
  let i = 0;
  while (i < n) {
    if (!smooth[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && smooth[j]) j++;
    if (j - i < 3) for (let k = i; k < j; k++) smooth[k] = 0;
    i = j;
  }
  return smooth.map((c) => (c ? Math.round(c) : 0));
}

/** ระดับเสียงอ้างอิง ณ เวลา t (cents) หรือ 0 */
export function melodyAt(m: Melody, t: number): number {
  const i = Math.round(t * m.fps);
  return i >= 0 && i < m.cents.length ? m.cents[i] : 0;
}

/** สัดส่วนของช่วงเวลาที่มีเนื้อเพลงซึ่งถอดทำนองได้ — ต่ำ = เส้นทำนองไม่น่าเชื่อถือ */
export function melodyCoverage(m: Melody, timeline: TimedLine[]): number {
  let total = 0;
  let voiced = 0;
  for (const line of timeline) {
    const a = Math.max(0, Math.round(line.start * m.fps));
    const b = Math.min(m.cents.length - 1, Math.round(line.end * m.fps));
    for (let i = a; i <= b; i++) {
      total++;
      if (m.cents[i]) voiced++;
    }
  }
  return total ? voiced / total : 0;
}

/** ระยะห่างแบบไม่สนคู่แปด (0–600 cents) */
export function pitchClassDistance(a: number, b: number): number {
  const d = (((a - b) % 1200) + 1200) % 1200;
  return d > 600 ? 1200 - d : d;
}
