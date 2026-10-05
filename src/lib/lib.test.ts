import { describe, expect, it } from 'vitest';
import { parseLrc, serializeLrc } from './lrc';
import { buildTimeline, findActive, mergeTimings, progressAt, textToLines } from './lyrics';
import { countGraphemes, segmentWords } from './thai';
import { parseYouTubeId } from './youtube';
import { parseRoute } from './router';
import { demoLines } from './demoSong';
import { detectKey } from './analyze';

describe('LRC', () => {
  it('parses timestamps, metadata, offset and end markers', () => {
    const src = `[ti:คิดถึง]
[ar:Palmy]
[offset:500]
[00:12.50]ฉันคิดถึงเธอ
[00:16.00]
[00:20.120][01:30.00]ท่อนซ้ำ <00:20.50>คำ
[00:25.00]บรรทัดสุดท้าย`;
    const r = parseLrc(src);
    expect(r.title).toBe('คิดถึง');
    expect(r.artist).toBe('Palmy');
    expect(r.timed).toBe(true);
    expect(r.lines).toHaveLength(4);
    expect(r.lines[0]).toEqual({ text: 'ฉันคิดถึงเธอ', start: 12, end: 15.5 });
    expect(r.lines[1].text).toBe('ท่อนซ้ำ คำ');
    expect(r.lines[1].start).toBeCloseTo(19.62);
    expect(r.lines[3].start).toBeCloseTo(89.5);
  });

  it('treats text without timestamps as plain lyrics', () => {
    const r = parseLrc('บรรทัดหนึ่ง\n\nบรรทัดสอง\n');
    expect(r.timed).toBe(false);
    expect(r.lines.map((l) => l.text)).toEqual(['บรรทัดหนึ่ง', 'บรรทัดสอง']);
  });

  it('round-trips through serialize', () => {
    const lines = [
      { text: 'หนึ่ง', start: 1.234, end: 3 },
      { text: 'สอง', start: 3.1, end: null },
      { text: 'ยังไม่ซิงก์', start: null, end: null },
      { text: 'สาม', start: 65.5, end: 70 },
    ];
    const out = serializeLrc(lines, { title: 'T', artist: 'A' });
    expect(out).toContain('[00:01.23]หนึ่ง');
    expect(out).toContain('[01:05.50]สาม');
    expect(out).toContain('[01:10.00]');
    expect(out).not.toContain('ยังไม่ซิงก์');
    const back = parseLrc(out);
    expect(back.lines.map((l) => l.text)).toEqual(['หนึ่ง', 'สอง', 'สาม']);
    expect(back.lines[2].end).toBe(70);
  });
});

describe('lyrics timing', () => {
  it('keeps timings for unchanged and edited lines', () => {
    const old = [
      { text: 'a', start: 1, end: 2 },
      { text: 'b', start: 3, end: null },
      { text: 'c', start: 5, end: 6 },
      { text: 'd', start: 7, end: null },
    ];
    // แทรกบรรทัดใหม่ → ไม่มีเวลา, บรรทัดที่ถูกแก้ในตำแหน่งเดิม → เก็บเวลาเดิม
    const merged = mergeTimings(old, ['a', 'B!', 'c', 'new', 'd']);
    expect(merged.map((l) => l.start)).toEqual([1, 3, 5, null, 7]);
    const removed = mergeTimings(old, ['a', 'c', 'd']);
    expect(removed.map((l) => l.start)).toEqual([1, 5, 7]);
    const typoFix = mergeTimings(old, ['a', 'bb', 'c', 'd']);
    expect(typoFix.map((l) => l.start)).toEqual([1, 3, 5, 7]);
  });

  it('builds a timeline with derived end times', () => {
    const tl = buildTimeline(
      [
        { text: 'สวัสดีครับ', start: 10, end: null },
        { text: 'บรรทัดสอง', start: 11, end: 12.5 },
        { text: 'ยาวมากกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกกก', start: 30, end: null },
      ],
      0.5,
      40,
    );
    expect(tl[0].start).toBe(10.5);
    expect(tl[0].end).toBeCloseTo(11.45);
    expect(tl[1].end).toBe(13);
    expect(tl[2].end).toBeLessThanOrEqual(37.5);
    expect(findActive(tl, 5)).toBe(-1);
    expect(findActive(tl, 11)).toBe(0);
    expect(findActive(tl, 20)).toBe(1);
    expect(progressAt(tl[1], 12.25)).toBeCloseTo(0.5);
  });

  it('splits pasted text into clean lines', () => {
    expect(textToLines('  ก   ข \n\n ค\r\n')).toEqual(['ก ข', 'ค']);
  });
});

describe('Thai text', () => {
  it('counts grapheme clusters, not code points', () => {
    expect(countGraphemes('น้ำ')).toBe(1);
    expect(countGraphemes('ที่')).toBe(1);
    expect(countGraphemes('เพลง')).toBe(4);
  });

  it('segments Thai words without breaking clusters', () => {
    const segs = segmentWords('ฉันรักเธอมาก');
    expect(segs.map((s) => s.text).join('')).toBe('ฉันรักเธอมาก');
    expect(segs.length).toBeGreaterThan(1);
    expect(segs[segs.length - 1].g1).toBe(countGraphemes('ฉันรักเธอมาก'));
  });
});

describe('YouTube', () => {
  it('parses many URL forms', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('ลอยกระทง')).toBeNull();
  });
});

describe('router', () => {
  it('parses hash routes', () => {
    expect(parseRoute('')).toEqual({ name: 'library' });
    expect(parseRoute('#/room')).toEqual({ name: 'room' });
    expect(parseRoute('#/song/abc/sync')).toEqual({ name: 'sync', id: 'abc' });
    expect(parseRoute('#/nope')).toEqual({ name: 'notFound' });
    expect(parseRoute('#/battle')).toEqual({ name: 'battle' });
    expect(parseRoute('#/battle/abc')).toEqual({ name: 'battle', songId: 'abc' });
    expect(parseRoute('#/online')).toEqual({ name: 'online', local: false });
    expect(parseRoute('#/online/ABC234?local')).toEqual({ name: 'online', code: 'ABC234', local: true });
    expect(parseRoute('#/room?x=1')).toEqual({ name: 'room' });
  });
});

describe('demo song', () => {
  it('has fully synced lines in order', () => {
    const lines = demoLines();
    expect(lines).toHaveLength(8);
    for (let i = 0; i < lines.length; i++) {
      expect(lines[i].start).not.toBeNull();
      expect(lines[i].end!).toBeGreaterThan(lines[i].start!);
      if (i > 0) expect(lines[i].start!).toBeGreaterThan(lines[i - 1].end!);
    }
  });
});

describe('key detection', () => {
  it('detects a C major chord progression', () => {
    const sr = 22050;
    const len = sr * 12;
    const l = new Float32Array(len);
    const chords = [
      [60, 64, 67],
      [65, 69, 72],
      [67, 71, 74],
      [60, 64, 67],
    ];
    for (let i = 0; i < len; i++) {
      const c = chords[Math.floor((i / len) * 4)];
      let s = 0.4 * Math.sin((2 * Math.PI * 440 * Math.pow(2, (c[0] - 81) / 12) * i) / sr);
      for (const m of c) s += 0.2 * Math.sin((2 * Math.PI * 440 * Math.pow(2, (m - 69) / 12) * i) / sr);
      l[i] = s;
    }
    expect(detectKey(sr, l, l)).toEqual({ root: 0, mode: 'major' });
  });
});
