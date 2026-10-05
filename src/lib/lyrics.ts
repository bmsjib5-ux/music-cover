import type { LyricLine } from './types';
import { countGraphemes } from './thai';

export function textToLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function linesToText(lines: LyricLine[]): string {
  return lines.map((l) => l.text).join('\n');
}

export function syncedCount(lines: LyricLine[]): number {
  return lines.reduce((n, l) => n + (l.start !== null ? 1 : 0), 0);
}

/**
 * รวมเนื้อเพลงที่แก้ไขกับเวลาซิงก์เดิม: บรรทัดที่เหมือนเดิมเก็บเวลาไว้ (LCS)
 * ถ้าช่วงที่ถูกแก้มีจำนวนบรรทัดเท่าเดิม (เช่นแก้คำผิด) จะเก็บเวลาไว้ตามลำดับ
 */
export function mergeTimings(old: LyricLine[], texts: string[]): LyricLine[] {
  const n = old.length;
  const m = texts.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = old[i].text === texts[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: LyricLine[] = texts.map((text) => ({ text, start: null, end: null }));
  const fillGap = (oi: number, oj: number, ni: number, nj: number) => {
    if (oj - oi === nj - ni) {
      for (let k = 0; k < nj - ni; k++) {
        result[ni + k].start = old[oi + k].start;
        result[ni + k].end = old[oi + k].end;
      }
    }
  };
  let i = 0;
  let j = 0;
  let gapI = 0;
  let gapJ = 0;
  while (i < n && j < m) {
    if (old[i].text === texts[j]) {
      fillGap(gapI, i, gapJ, j);
      result[j].start = old[i].start;
      result[j].end = old[i].end;
      i++;
      j++;
      gapI = i;
      gapJ = j;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  fillGap(gapI, n, gapJ, m);
  return result;
}

export interface TimedLine {
  index: number;
  text: string;
  start: number;
  end: number;
}

/** ความยาวโดยประมาณของการร้องหนึ่งบรรทัด (ใช้เมื่อไม่ได้กำหนดเวลาจบ) */
export function estimateDuration(text: string): number {
  const g = countGraphemes(text.replace(/\s+/g, ''));
  return Math.min(7, Math.max(1.2, g * 0.22));
}

export function buildTimeline(lines: LyricLine[], offset = 0, duration = 0): TimedLine[] {
  const timed = lines
    .map((l, index) => ({ l, index }))
    .filter((x) => x.l.start !== null)
    .sort((a, b) => a.l.start! - b.l.start!);
  return timed.map((x, k) => {
    const start = x.l.start! + offset;
    const nextStart = k + 1 < timed.length ? timed[k + 1].l.start! + offset : Infinity;
    let end = x.l.end !== null ? x.l.end + offset : start + estimateDuration(x.l.text);
    end = Math.min(end, nextStart - 0.05);
    if (duration > 0) end = Math.min(end, duration);
    end = Math.max(end, start + 0.1);
    return { index: x.index, text: x.l.text, start, end };
  });
}

/** บรรทัดสุดท้ายที่เริ่มแล้ว ณ เวลา t (-1 ถ้ายังไม่ถึงบรรทัดแรก) */
export function findActive(tl: TimedLine[], t: number): number {
  let lo = 0;
  let hi = tl.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tl[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function progressAt(line: TimedLine, t: number): number {
  if (t <= line.start) return 0;
  if (t >= line.end) return 1;
  return (t - line.start) / (line.end - line.start);
}
