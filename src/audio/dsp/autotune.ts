/**
 * Auto-Tune สำหรับเสียงร้องเดี่ยว (monophonic) แบบเรียลไทม์
 *
 * 1. ตรวจระดับเสียงด้วยอัลกอริทึม YIN (ลด sample rate ลงครึ่งหนึ่งก่อนเพื่อประหยัด CPU)
 * 2. หาโน้ตเป้าหมายที่ใกล้ที่สุด (ทุกโน้ต หรือเฉพาะโน้ตในสเกล)
 * 3. เปลี่ยนระดับเสียงด้วย delay line ที่กระโดดทีละ "รอบคลื่น" (pitch-synchronous)
 *    ทำให้รอยต่อเนียนและหน่วงต่ำ (~5–20ms)
 */

export interface PitchInfo {
  voiced: boolean;
  /** ความถี่ที่ตรวจได้ (Hz) */
  f0: number;
  /** ระดับเสียงที่ร้อง (MIDI, ทศนิยม) */
  midi: number;
  /** โน้ตเป้าหมาย (MIDI จำนวนเต็ม) */
  target: number;
}

const MIN_F0 = 70;
const MAX_F0 = 1100;
const YIN_THRESHOLD = 0.15;
const SILENCE_RMS = 0.006;
/** จำกัดการแก้ไม่ให้เกิน ±2 เซมิโทน (กันกรณีตรวจผิดคู่แปด) */
const MAX_CORRECTION = 2;

export function freqToMidi(f: number): number {
  return 69 + 12 * Math.log2(f / 440);
}

/** หาโน้ตที่อนุญาตที่ใกล้ที่สุด; allowed = 12 ช่อง (C..B) */
export function nearestAllowed(midi: number, allowed: readonly boolean[]): number {
  const base = Math.round(midi);
  let best = base;
  let bestDist = Infinity;
  for (let d = -6; d <= 6; d++) {
    const cand = base + d;
    const pc = ((cand % 12) + 12) % 12;
    if (!allowed[pc]) continue;
    const dist = Math.abs(cand - midi);
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  }
  return best;
}

export class AutoTuner {
  /** 0 = ไม่แก้, 1 = แก้เต็มที่ */
  strength = 1;
  /** เวลาที่ใช้ดึงเข้าโน้ต (วินาที) — 0 = ทันที (เสียงหุ่นยนต์) */
  retuneSeconds = 0.04;
  allowed: boolean[] = new Array(12).fill(true);

  readonly info: PitchInfo = { voiced: false, f0: 0, midi: 0, target: 0 };

  private readonly sr: number;
  // ตัวตรวจระดับเสียง
  private readonly dec = 2;
  private readonly dsr: number;
  private readonly tauMin: number;
  private readonly tauMax: number;
  private readonly win: number;
  private readonly ring: Float32Array;
  private ringPos = 0;
  private readonly frame: Float32Array;
  private readonly yin: Float32Array;
  private decAcc = 0;
  private decCount = 0;
  private readonly hop: number;
  private hopCount = 0;
  private lastTarget = -1;

  // ตัวเปลี่ยนระดับเสียง
  private readonly buf: Float32Array;
  private readonly mask: number;
  private w = 0;
  private r = 0;
  private rOld = 0;
  private fadePos = 0;
  private fadeLen = 0;
  private readonly minDelay: number;
  private readonly defaultPeriod: number;
  private period = 0;
  private shift = 0;
  private targetShift = 0;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    this.dsr = sampleRate / this.dec;
    this.tauMin = Math.max(2, Math.floor(this.dsr / MAX_F0));
    this.tauMax = Math.ceil(this.dsr / MIN_F0);
    this.win = Math.ceil(this.tauMax * 1.2);
    this.ring = new Float32Array(this.win + this.tauMax);
    this.frame = new Float32Array(this.win + this.tauMax);
    this.yin = new Float32Array(this.tauMax + 2);
    this.hop = Math.round(sampleRate * 0.01);

    let size = 1;
    while (size < sampleRate * 0.2) size <<= 1;
    this.buf = new Float32Array(size);
    this.mask = size - 1;
    this.minDelay = Math.round(sampleRate * 0.003);
    this.defaultPeriod = Math.round(sampleRate * 0.008);
    this.r = -this.minDelay;
  }

  /** ความหน่วงโดยประมาณ (วินาที) */
  get latency(): number {
    return (this.w - this.r) / this.sr;
  }

  process(input: Float32Array, output: Float32Array): void {
    const coef = this.retuneSeconds <= 0.001 ? 1 : 1 - Math.exp(-1 / (this.retuneSeconds * this.sr));
    const buf = this.buf;
    const mask = this.mask;
    const n = Math.min(input.length, output.length);
    for (let i = 0; i < n; i++) {
      const x = input[i];
      this.feed(x);

      buf[this.w & mask] = x;
      this.w++;

      this.shift += (this.targetShift - this.shift) * coef;
      const ratio = this.shift === 0 ? 1 : Math.pow(2, this.shift / 12);

      let y = this.read(this.r);
      if (this.fadeLen > 0) {
        const g = this.fadePos / this.fadeLen;
        y = y * g + this.read(this.rOld) * (1 - g);
        this.rOld += ratio;
        if (++this.fadePos >= this.fadeLen) this.fadeLen = 0;
      }
      output[i] = y;
      this.r += ratio;

      // รักษาระยะหน่วงให้อยู่ในช่วง โดยกระโดดทีละรอบคลื่น
      const p = this.period > 0 ? this.period : this.defaultPeriod;
      const d = this.w - this.r;
      if (d < this.minDelay) {
        this.jump(-p * Math.ceil((this.minDelay - d) / p), p);
      } else if (d > this.minDelay + 2 * p) {
        this.jump(p * Math.floor((d - this.minDelay - p) / p), p);
      }
    }
  }

  private jump(amount: number, p: number): void {
    if (amount === 0) return;
    this.rOld = this.r;
    this.r += amount;
    this.fadePos = 0;
    this.fadeLen = Math.max(16, Math.min(Math.round(p), 1024));
  }

  private read(pos: number): number {
    const i = Math.floor(pos);
    const f = pos - i;
    const a = this.buf[i & this.mask];
    const b = this.buf[(i + 1) & this.mask];
    return a + (b - a) * f;
  }

  private feed(x: number): void {
    this.decAcc += x;
    if (++this.decCount === this.dec) {
      this.ring[this.ringPos] = this.decAcc / this.dec;
      this.ringPos = (this.ringPos + 1) % this.ring.length;
      this.decAcc = 0;
      this.decCount = 0;
    }
    if (++this.hopCount >= this.hop) {
      this.hopCount = 0;
      this.detect();
    }
  }

  private detect(): void {
    const len = this.ring.length;
    const f = this.frame;
    let energy = 0;
    for (let i = 0; i < len; i++) {
      const v = this.ring[(this.ringPos + i) % len];
      f[i] = v;
      energy += v * v;
    }
    const rms = Math.sqrt(energy / len);
    const f0 = rms < SILENCE_RMS ? 0 : this.yinPitch();
    this.update(f0);
  }

  /** คืนค่าความถี่ (Hz) หรือ 0 ถ้าไม่ใช่เสียงที่มีระดับเสียงชัด */
  private yinPitch(): number {
    const f = this.frame;
    const y = this.yin;
    const W = this.win;
    const tauMax = this.tauMax;
    y[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const d = f[j] - f[j + tau];
        s += d * d;
      }
      running += s;
      y[tau] = running > 0 ? (s * tau) / running : 1;
    }
    let tau = -1;
    for (let t = this.tauMin; t < tauMax; t++) {
      if (y[t] < YIN_THRESHOLD) {
        while (t + 1 < tauMax && y[t + 1] < y[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return 0;
    let better = tau;
    if (tau > 1 && tau < tauMax) {
      const a = y[tau - 1];
      const b = y[tau];
      const c = y[tau + 1];
      const den = a - 2 * b + c;
      if (den !== 0) better = tau + (a - c) / (2 * den);
    }
    return this.dsr / better;
  }

  private update(f0: number): void {
    const info = this.info;
    if (f0 <= 0) {
      info.voiced = false;
      this.targetShift = 0;
      this.period = 0;
      this.lastTarget = -1;
      return;
    }
    const midi = freqToMidi(f0);
    let target = nearestAllowed(midi, this.allowed);
    // hysteresis: ไม่สลับโน้ตไปมาเวลาร้องอยู่กึ่งกลางระหว่างโน้ต
    if (this.lastTarget >= 0 && target !== this.lastTarget && this.allowed[((this.lastTarget % 12) + 12) % 12]) {
      if (Math.abs(midi - this.lastTarget) < Math.abs(midi - target) + 0.15) target = this.lastTarget;
    }
    this.lastTarget = target;
    const correction = Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, target - midi));
    this.targetShift = correction * this.strength;
    this.period = this.sr / f0;
    info.voiced = true;
    info.f0 = f0;
    info.midi = midi;
    info.target = target;
  }
}

export const SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
} as const;

export function scaleMask(root: number | null, mode: 'major' | 'minor'): boolean[] {
  if (root === null) return new Array(12).fill(true);
  const mask = new Array(12).fill(false);
  for (const iv of SCALE_INTERVALS[mode]) mask[(root + iv) % 12] = true;
  return mask;
}
