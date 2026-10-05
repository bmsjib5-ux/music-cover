import { describe, expect, it } from 'vitest';
import { ScoreSession, gradeFor } from './scoring';
import type { Melody } from './melody';
import type { TimedLine } from './lyrics';

// สองบรรทัด: บรรทัดแรก A4 (69) 1–3 วิ, บรรทัดสอง C5 (72) 4–6 วิ
const timeline: TimedLine[] = [
  { index: 0, text: 'หนึ่ง', start: 1, end: 3 },
  { index: 1, text: 'สอง', start: 4, end: 6 },
];
function melody(): Melody {
  const cents = new Array<number>(8 * 20).fill(0);
  for (let i = 20; i <= 60; i++) cents[i] = 6900;
  for (let i = 80; i <= 120; i++) cents[i] = 7200;
  return { fps: 20, cents };
}

function sing(session: ScoreSession, fn: (t: number) => number | null) {
  for (let t = 0; t <= 7; t += 0.05) session.add(t, fn(t));
}
const refMidi = (t: number) => (t >= 1 && t <= 3 ? 69 : t >= 4 && t <= 6 ? 72 : null);

describe('ScoreSession (melody mode)', () => {
  const make = (keyShift = 0) => new ScoreSession(timeline, melody(), { keyShift, songKey: null, startTime: 0 });

  it('gives a near-perfect score for singing the melody', () => {
    const s = make();
    expect(s.mode).toBe('melody');
    sing(s, (t) => {
      const m = refMidi(t);
      return m === null ? null : m + 0.1 * Math.sin(t * 30);
    });
    const r = s.finalize();
    expect(r.total).toBeGreaterThanOrEqual(95);
    expect(r.grade).toBe('S');
    expect(r.lines).toHaveLength(2);
  });

  it('ignores octave differences', () => {
    const s = make();
    sing(s, (t) => {
      const m = refMidi(t);
      return m === null ? null : m - 12;
    });
    expect(s.finalize().total).toBeGreaterThanOrEqual(95);
  });

  it('follows the key shift', () => {
    const s = make(2);
    sing(s, (t) => {
      const m = refMidi(t);
      return m === null ? null : m + 2;
    });
    expect(s.finalize().total).toBeGreaterThanOrEqual(95);
    const wrong = make(2);
    sing(wrong, refMidi);
    expect(wrong.finalize().pitch!).toBeLessThan(0.1);
  });

  it('punishes singing out of tune but still credits timing', () => {
    const s = make();
    sing(s, (t) => {
      const m = refMidi(t);
      return m === null ? null : m + 3;
    });
    const r = s.finalize();
    expect(r.pitch!).toBeLessThan(0.05);
    expect(r.timing).toBeGreaterThan(0.95);
    expect(r.total).toBeLessThan(40);
    expect(r.grade).toBe('D');
  });

  it('scores silence as zero and labels lines', () => {
    const s = make();
    sing(s, () => null);
    const r = s.finalize();
    expect(r.total).toBe(0);
    expect(r.lines.every((l) => l.silent && l.label === 'ไม่ได้ยินเสียง')).toBe(true);
  });

  it('tolerates singing slightly late', () => {
    const s = make();
    sing(s, (t) => refMidi(t - 0.12));
    expect(s.finalize().total).toBeGreaterThanOrEqual(85);
  });

  it('reports a running score per finished line', () => {
    const s = make();
    for (let t = 0; t <= 3.5; t += 0.05) s.add(t, refMidi(t));
    expect(s.scoreLine(0)!.score).toBeGreaterThanOrEqual(95);
    expect(s.runningScore()).toBeGreaterThanOrEqual(95);
  });

  it('flags seeking backwards', () => {
    const s = make();
    s.add(5, 69);
    s.add(2, 69);
    expect(s.seeked).toBe(true);
  });
});

describe('ScoreSession (scale mode)', () => {
  it('falls back to key-based scoring without a usable melody', () => {
    const s = new ScoreSession(timeline, null, { keyShift: 0, songKey: { root: 0, mode: 'major' }, startTime: 0 });
    expect(s.mode).toBe('scale');
    sing(s, (t) => (t >= 1 && t <= 3 ? 67 : t >= 4 && t <= 6 ? 64.05 : null));
    const inTune = s.finalize();
    expect(inTune.total).toBeGreaterThanOrEqual(90);

    const off = new ScoreSession(timeline, null, { keyShift: 0, songKey: { root: 0, mode: 'major' }, startTime: 0 });
    sing(off, (t) => (t >= 1 && t <= 6 ? 66.5 : null)); // ระหว่าง F# กับ G — เพี้ยน
    expect(off.finalize().total).toBeLessThan(inTune.total - 20);
  });
});

describe('grades', () => {
  it('maps totals to grades', () => {
    expect(gradeFor(97).grade).toBe('S');
    expect(gradeFor(88).grade).toBe('A');
    expect(gradeFor(72).grade).toBe('B');
    expect(gradeFor(60).grade).toBe('C');
    expect(gradeFor(10).grade).toBe('D');
  });
});
