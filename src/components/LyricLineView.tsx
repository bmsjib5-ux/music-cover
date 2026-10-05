import { memo, useMemo, type CSSProperties } from 'react';
import { segmentWords } from '../lib/thai';

/**
 * แสดงเนื้อเพลงหนึ่งบรรทัดพร้อมไล่สี (wipe)
 * ตัดเป็นคำด้วย Intl.Segmenter แล้วให้แต่ละคำไล่สีด้วย gradient + background-clip:text
 * จึงไม่แยกสระ/วรรณยุกต์ออกจากพยัญชนะ และไล่สีถูกต้องแม้บรรทัดจะตัดขึ้นบรรทัดใหม่
 */
export const LyricLineView = memo(function LyricLineView({ text, progress }: { text: string; progress: number }) {
  const segs = useMemo(() => segmentWords(text), [text]);
  const total = segs.length ? segs[segs.length - 1].g1 : 0;
  const pos = progress * total;
  return (
    <span className="lyric-text">
      {segs.map((s, i) => {
        const span = s.g1 - s.g0;
        const p = span <= 0 ? (pos >= s.g1 ? 1 : 0) : Math.min(1, Math.max(0, (pos - s.g0) / span));
        return (
          <span key={i} className="lw" style={{ '--p': `${(p * 100).toFixed(1)}%` } as CSSProperties}>
            {s.text}
          </span>
        );
      })}
    </span>
  );
});
