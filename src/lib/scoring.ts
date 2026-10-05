import type { TimedLine } from './lyrics';
import { melodyAt, melodyCoverage, pitchClassDistance, type Melody } from './melody';
import { nearestAllowed, scaleMask } from '../audio/dsp/autotune';
import type { MusicKey } from './types';

/** เส้นทำนองที่ถอดได้ครอบคลุมช่วงเนื้อเพลงน้อยกว่านี้ → ให้คะแนนจากความตรงคีย์แทน */
export const MIN_MELODY_COVERAGE = 0.3;
/** ยอมให้ร้องเร็ว/ช้ากว่าทำนองได้เท่านี้ (วินาที) */
const TIME_SLACK = 0.18;

export interface LineScore {
  index: number;
  text: string;
  /** 0–100 */
  score: number;
  /** 0–1 หรือ null ถ้าไม่มีข้อมูล */
  pitch: number | null;
  timing: number;
  stability: number | null;
  label: string;
  silent: boolean;
}

export interface ScoreResult {
  total: number;
  grade: string;
  message: string;
  pitch: number | null;
  timing: number;
  stability: number | null;
  mode: 'melody' | 'scale';
  lines: LineScore[];
}

interface Frame {
  t: number;
  /** cents หรือ 0 = ไม่มีเสียง */
  c: number;
}

export function lineLabel(score: number, silent: boolean): string {
  if (silent) return 'ไม่ได้ยินเสียง';
  if (score >= 90) return 'เยี่ยมมาก!';
  if (score >= 75) return 'ดีมาก';
  if (score >= 55) return 'ดี';
  if (score >= 35) return 'พอใช้';
  return 'สู้ๆ นะ';
}

export function gradeFor(total: number): { grade: string; message: string } {
  if (total >= 95) return { grade: 'S', message: 'ระดับนักร้องอาชีพ!' };
  if (total >= 85) return { grade: 'A', message: 'เสียงดีมาก ร้องได้เพราะ' };
  if (total >= 70) return { grade: 'B', message: 'ร้องดี อีกนิดเดียวก็เป๊ะ' };
  if (total >= 55) return { grade: 'C', message: 'ไม่เลว ลองฝึกอีกหน่อย' };
  return { grade: 'D', message: 'สนุกที่สุดคือได้ร้อง ลองใหม่อีกรอบ!' };
}

/** คะแนนดิบ 0–1 → คะแนนที่แสดง (โค้งขึ้นเล็กน้อย เพราะการตรวจระดับเสียงมีความคลาดเคลื่อนเสมอ) */
function curve(raw: number): number {
  return Math.round(100 * Math.pow(Math.max(0, Math.min(1, raw)), 0.75));
}

/**
 * เก็บระดับเสียงที่ผู้ใช้ร้องระหว่างเพลง แล้วให้คะแนนทีละบรรทัด
 * - โหมด melody: เทียบกับเส้นทำนองที่ถอดจากเพลง (ไม่สนคู่แปด, เลื่อนตามคีย์ที่ปรับ)
 * - โหมด scale: ไม่มีทำนองที่เชื่อถือได้ → ให้คะแนนจากความตรงกับโน้ตในคีย์ของเพลง
 */
export class ScoreSession {
  readonly mode: 'melody' | 'scale';
  private frames: Frame[] = [];
  private readonly lineScores = new Map<number, LineScore>();
  private keyShift: number;
  private readonly allowed: boolean[];
  /** ผู้ใช้กระโดดข้ามช่วงเพลง → ไม่นับเป็นสถิติ */
  seeked = false;
  readonly startedAt: number;

  constructor(
    private readonly timeline: TimedLine[],
    private readonly melody: Melody | null,
    opts: { keyShift: number; songKey: MusicKey | null; startTime: number },
  ) {
    this.mode = melody && melodyCoverage(melody, timeline) >= MIN_MELODY_COVERAGE ? 'melody' : 'scale';
    this.keyShift = opts.keyShift;
    const key = opts.songKey;
    this.allowed = scaleMask(key ? (((key.root + opts.keyShift) % 12) + 12) % 12 : null, key?.mode ?? 'major');
    this.startedAt = opts.startTime;
  }

  setKeyShift(n: number): void {
    this.keyShift = n;
  }

  /** เพิ่มเฟรม: t = เวลาในเพลง (วินาที), midi = ระดับเสียงที่ร้อง หรือ null ถ้าไม่มีเสียง */
  add(t: number, midi: number | null): void {
    const last = this.frames[this.frames.length - 1];
    if (last && t < last.t - 1) this.seeked = true;
    this.frames.push({ t, c: midi === null ? 0 : midi * 100 });
  }

  /** ช่วงเวลาของทำนอง (cents) หลังปรับคีย์ */
  private refAt(t: number): number {
    if (!this.melody) return 0;
    const c = melodyAt(this.melody, t);
    return c ? c + this.keyShift * 100 : 0;
  }

  /** ให้คะแนนบรรทัด (เรียกเมื่อบรรทัดจบแล้ว) — ผลถูกจำไว้ */
  scoreLine(i: number): LineScore | null {
    const cached = this.lineScores.get(i);
    if (cached) return cached;
    const line = this.timeline[i];
    if (!line) return null;
    const frames = this.frames.filter((f) => f.t >= line.start - TIME_SLACK && f.t <= line.end + TIME_SLACK);
    if (frames.length < 3) return null;

    let expected = 0;
    let covered = 0;
    let pitchSum = 0;
    let pitchCount = 0;
    const inLine = frames.filter((f) => f.t >= line.start && f.t <= line.end);

    if (this.mode === 'melody') {
      for (const f of inLine) {
        if (!this.refAt(f.t)) continue;
        expected++;
        // ร้องเร็ว/ช้าเล็กน้อยก็นับ
        if (f.c || frames.some((g) => g.c && Math.abs(g.t - f.t) <= TIME_SLACK)) covered++;
      }
      for (const f of frames) {
        if (!f.c) continue;
        let best = Infinity;
        for (let dt = -TIME_SLACK; dt <= TIME_SLACK + 1e-9; dt += 0.05) {
          const r = this.refAt(f.t + dt);
          if (r) best = Math.min(best, pitchClassDistance(f.c, r));
        }
        if (best === Infinity) continue;
        pitchCount++;
        // คลาดไม่เกิน 60 เซ็นต์ได้เต็ม ลดลงจนเป็น 0 ที่ 180 เซ็นต์ (เกือบสองครึ่งเสียง)
        pitchSum += best <= 60 ? 1 : best <= 180 ? 1 - (best - 60) / 120 : 0;
      }
    } else {
      expected = inLine.length;
      covered = inLine.filter((f) => f.c).length;
      for (const f of frames) {
        if (!f.c) continue;
        const midi = f.c / 100;
        const d = Math.abs(midi - nearestAllowed(midi, this.allowed)) * 100;
        pitchCount++;
        pitchSum += d <= 20 ? 1 : d <= 50 ? 1 - ((d - 20) / 30) * 0.7 : 0.3 * Math.max(0, 1 - (d - 50) / 50);
      }
    }

    const timing = expected ? Math.min(1, covered / expected) : 0;
    const pitch = pitchCount ? pitchSum / pitchCount : null;

    // ความนิ่ง: การเปลี่ยนระดับเสียงระหว่างเฟรมติดกันที่ไม่ใช่การเปลี่ยนโน้ต
    let steady = 0;
    let moves = 0;
    for (let k = 1; k < frames.length; k++) {
      const a = frames[k - 1].c;
      const b = frames[k].c;
      if (!a || !b) continue;
      const d = Math.abs(a - b);
      if (d > 150) continue;
      moves++;
      if (d <= 45) steady++;
    }
    const stability = moves >= 3 ? steady / moves : null;

    const silent = covered === 0 && pitchCount === 0;
    // ความนิ่งได้คะแนนเฉพาะเมื่อร้องถูกโน้ต (ร้องนิ่งแต่ผิดโน้ตไม่ควรได้คะแนน)
    const p = pitch ?? 0;
    const st = stability ?? 1;
    let raw: number;
    if (silent) raw = 0;
    else if (this.mode === 'melody') raw = p * (0.7 + 0.1 * st) + 0.2 * timing;
    else raw = p * (0.55 + 0.1 * st) + 0.35 * timing;
    const score = curve(raw);
    const result: LineScore = { index: i, text: line.text, score, pitch, timing, stability, label: lineLabel(score, silent), silent };
    this.lineScores.set(i, result);
    return result;
  }

  /** คะแนนเฉลี่ยของบรรทัดที่จบแล้ว (ระหว่างร้อง) */
  runningScore(): number | null {
    const done = [...this.lineScores.values()];
    if (!done.length) return null;
    return Math.round(done.reduce((s, l) => s + l.score, 0) / done.length);
  }

  finalize(): ScoreResult {
    const lines: LineScore[] = [];
    let weight = 0;
    let sum = 0;
    let pitchW = 0;
    let pitchSum = 0;
    let timingSum = 0;
    let stabW = 0;
    let stabSum = 0;
    this.timeline.forEach((line, i) => {
      // นับเฉพาะบรรทัดที่อยู่ในช่วงที่ร้องจริง
      if (line.end < this.startedAt) return;
      const s = this.scoreLine(i);
      if (!s) return;
      const w = Math.max(0.5, line.end - line.start);
      lines.push(s);
      weight += w;
      sum += s.score * w;
      timingSum += s.timing * w;
      if (s.pitch !== null) {
        pitchW += w;
        pitchSum += s.pitch * w;
      }
      if (s.stability !== null) {
        stabW += w;
        stabSum += s.stability * w;
      }
    });
    const total = weight ? Math.round(sum / weight) : 0;
    return {
      total,
      ...gradeFor(total),
      pitch: pitchW ? pitchSum / pitchW : null,
      timing: weight ? timingSum / weight : 0,
      stability: stabW ? stabSum / stabW : null,
      mode: this.mode,
      lines,
    };
  }
}

// ---------- สถิติสูงสุด ----------
export interface BestScore {
  best: number;
  at: number;
  plays: number;
}

const BEST_KEY = 'rongloei.bestScores.v1';

export function getBestScores(): Record<string, BestScore> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, BestScore>;
  } catch {
    return {};
  }
}

export function getBestScore(songId: string): BestScore | null {
  return getBestScores()[songId] ?? null;
}

/** บันทึกผล คืนค่า true ถ้าเป็นสถิติใหม่ */
export function recordScore(songId: string, total: number): boolean {
  const all = getBestScores();
  const prev = all[songId];
  const isBest = !prev || total > prev.best;
  all[songId] = { best: isBest ? total : prev.best, at: isBest ? Date.now() : prev.at, plays: (prev?.plays ?? 0) + 1 };
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SCORE_EVENT));
  return isBest;
}

/** event ที่ยิงเมื่อบันทึกคะแนนใหม่ */
export const SCORE_EVENT = 'rongloei:score';
