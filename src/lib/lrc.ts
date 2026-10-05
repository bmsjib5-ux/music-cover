import type { LyricLine } from './types';
import { formatTimePrecise } from './format';

export interface ParsedLrc {
  title?: string;
  artist?: string;
  lines: LyricLine[];
  /** true ถ้ามี timestamp อย่างน้อยหนึ่งบรรทัด */
  timed: boolean;
}

const TAG_TIME = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const META = /^\[([a-z#]+):(.*)\]$/i;
const WORD_TIME = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

function toSeconds(m: string, s: string, frac?: string): number {
  let t = parseInt(m, 10) * 60 + parseInt(s, 10);
  if (frac) t += parseInt(frac, 10) / Math.pow(10, frac.length);
  return t;
}

/** อ่านไฟล์ .lrc (รองรับหลาย timestamp ต่อบรรทัด, [offset:], และ enhanced LRC) — ถ้าไม่มีเวลาเลยจะได้เนื้อเพลงธรรมดา */
export function parseLrc(src: string): ParsedLrc {
  let offsetMs = 0;
  let title: string | undefined;
  let artist: string | undefined;
  const timedEntries: { t: number; text: string; order: number }[] = [];
  const plain: string[] = [];
  let order = 0;

  for (const raw of src.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const times: number[] = [];
    let rest = line;
    let m: RegExpExecArray | null;
    while ((m = TAG_TIME.exec(rest))) {
      times.push(toSeconds(m[1], m[2], m[3]));
      rest = rest.slice(m[0].length);
    }
    if (times.length === 0) {
      const meta = META.exec(line);
      if (meta) {
        const key = meta[1].toLowerCase();
        const value = meta[2].trim();
        if (key === 'ti') title = value;
        else if (key === 'ar') artist = value;
        else if (key === 'offset') offsetMs = parseInt(value, 10) || 0;
        continue;
      }
      plain.push(line);
      continue;
    }
    const text = rest.replace(WORD_TIME, '').replace(/\s+/g, ' ').trim();
    for (const t of times) timedEntries.push({ t, text, order: order++ });
  }

  if (timedEntries.length === 0) {
    return { title, artist, timed: false, lines: plain.map((text) => ({ text, start: null, end: null })) };
  }

  timedEntries.sort((a, b) => a.t - b.t || a.order - b.order);
  const lines: LyricLine[] = [];
  for (const e of timedEntries) {
    // [offset:+ms] = เนื้อขึ้นเร็วขึ้น
    const t = Math.max(0, e.t - offsetMs / 1000);
    if (!e.text) {
      const last = lines[lines.length - 1];
      if (last && last.end === null) last.end = t;
      continue;
    }
    lines.push({ text: e.text, start: t, end: null });
  }
  return { title, artist, timed: true, lines };
}

export function serializeLrc(lines: LyricLine[], meta: { title?: string; artist?: string } = {}): string {
  const out: string[] = [];
  if (meta.title) out.push(`[ti:${meta.title}]`);
  if (meta.artist) out.push(`[ar:${meta.artist}]`);
  out.push('[re:ร้องเลย คาราโอเกะ]');
  const timed = lines.filter((l) => l.start !== null).sort((a, b) => a.start! - b.start!);
  timed.forEach((l, i) => {
    out.push(`[${formatTimePrecise(l.start)}]${l.text}`);
    const next = timed[i + 1];
    if (l.end !== null && (!next || next.start! - l.end > 0.3)) out.push(`[${formatTimePrecise(l.end)}]`);
  });
  return out.join('\n') + '\n';
}
