import { describe, expect, it } from 'vitest';
import { PhaseVocoderShifter } from './phaseVocoder';
import { AutoTuner, nearestAllowed, scaleMask } from './autotune';

const SR = 48000;

function sine(freq: number, seconds: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

/** วัดความถี่จากจุดตัดศูนย์ขาขึ้น (interpolate) */
function measureFreq(x: Float32Array, from: number, to: number): number {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = Math.max(1, from); i < to; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const t = i - 1 + -x[i - 1] / (x[i] - x[i - 1]);
      if (first < 0) first = t;
      last = t;
      count++;
    }
  }
  return ((count - 1) * SR) / (last - first);
}

function runBlocks(input: Float32Array, fn: (inp: Float32Array, out: Float32Array) => void): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 128) {
    fn(input.subarray(i, i + 128), out.subarray(i, i + 128));
  }
  return out;
}

describe('PhaseVocoderShifter', () => {
  it('shifts a sine up by 2 semitones', () => {
    const shifter = new PhaseVocoderShifter(2048, 4);
    const ratio = Math.pow(2, 2 / 12);
    const out = runBlocks(sine(440, 1.5), (i, o) => shifter.process(i, o, ratio));
    const f = measureFreq(out, SR * 0.5, SR * 1.4);
    expect(f).toBeGreaterThan(440 * ratio * 0.995);
    expect(f).toBeLessThan(440 * ratio * 1.005);
    let peak = 0;
    for (let i = SR * 0.5; i < SR * 1.4; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak).toBeGreaterThan(0.35);
    expect(peak).toBeLessThan(0.65);
  });

  it('shifts down by 3 semitones and keeps level', () => {
    const shifter = new PhaseVocoderShifter(2048, 4);
    const ratio = Math.pow(2, -3 / 12);
    const out = runBlocks(sine(660, 1.5), (i, o) => shifter.process(i, o, ratio));
    const f = measureFreq(out, SR * 0.5, SR * 1.4);
    expect(Math.abs(f / (660 * ratio) - 1)).toBeLessThan(0.005);
    let peak = 0;
    for (let i = SR * 0.5; i < SR * 1.4; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak).toBeGreaterThan(0.35);
    expect(peak).toBeLessThan(0.65);
  });
});

describe('AutoTuner', () => {
  it('snaps a sharp note to the nearest semitone', () => {
    const tuner = new AutoTuner(SR);
    tuner.retuneSeconds = 0;
    // 447Hz ≈ A4 สูงไป ~27 cents
    const out = runBlocks(sine(447, 1.5), (i, o) => tuner.process(i, o));
    expect(tuner.info.voiced).toBe(true);
    expect(tuner.info.target).toBe(69);
    const f = measureFreq(out, SR * 0.6, SR * 1.45);
    expect(Math.abs(f - 440)).toBeLessThan(2);
  });

  it('detects pitch without correcting when strength is 0', () => {
    const tuner = new AutoTuner(SR);
    tuner.strength = 0;
    const out = runBlocks(sine(207, 1), (i, o) => tuner.process(i, o));
    expect(Math.abs(tuner.info.f0 - 207)).toBeLessThan(1);
    const f = measureFreq(out, SR * 0.4, SR * 0.95);
    expect(Math.abs(f - 207)).toBeLessThan(0.5);
  });

  it('respects a scale mask', () => {
    // C major ไม่มี C#: 61.4 ต้องไปที่ D (62) หรือ C (60) ที่ใกล้กว่า → 62
    expect(nearestAllowed(61.6, scaleMask(0, 'major'))).toBe(62);
    expect(nearestAllowed(61.4, scaleMask(null, 'major'))).toBe(61);
    // A minor: G# ไม่อยู่ในสเกล
    expect(nearestAllowed(68.2, scaleMask(9, 'minor'))).toBe(69);
  });

  it('stays silent on silence', () => {
    const tuner = new AutoTuner(SR);
    const out = runBlocks(new Float32Array(SR / 2), (i, o) => tuner.process(i, o));
    expect(tuner.info.voiced).toBe(false);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});
