/**
 * ตัวช่วยภาษาไทย: ภาษาไทยไม่เว้นวรรคระหว่างคำ จึงใช้ Intl.Segmenter ของเบราว์เซอร์ตัดคำ
 * และนับ "กลุ่มตัวอักษร" (grapheme) เพื่อไม่ให้แยกสระบน/ล่าง/วรรณยุกต์ออกจากพยัญชนะ
 */

type SegmenterCtor = new (
  locale: string,
  opts: { granularity: 'word' | 'grapheme' },
) => { segment(s: string): Iterable<{ segment: string }> };

const Segmenter: SegmenterCtor | undefined = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
const wordSeg = Segmenter ? new Segmenter('th', { granularity: 'word' }) : null;
const graphemeSeg = Segmenter ? new Segmenter('th', { granularity: 'grapheme' }) : null;

// สระบน/ล่าง วรรณยุกต์ และเครื่องหมายที่ไม่กินที่ในภาษาไทย
const COMBINING = /[ัิ-ฺ็-๎]/;

export function countGraphemes(s: string): number {
  if (graphemeSeg) {
    let n = 0;
    for (const _ of graphemeSeg.segment(s)) n++;
    return n;
  }
  let n = 0;
  for (const ch of s) if (!COMBINING.test(ch)) n++;
  return n;
}

export interface Segment {
  text: string;
  /** ตำแหน่งเริ่ม (นับเป็น grapheme) */
  g0: number;
  /** ตำแหน่งจบ (ไม่รวม) */
  g1: number;
}

export function segmentWords(text: string): Segment[] {
  const parts = wordSeg ? Array.from(wordSeg.segment(text), (s) => s.segment) : text.split(/(\s+)/).filter(Boolean);
  const out: Segment[] = [];
  let pos = 0;
  for (const p of parts) {
    const len = countGraphemes(p);
    out.push({ text: p, g0: pos, g1: pos + len });
    pos += len;
  }
  return out;
}
