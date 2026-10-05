import { useLayoutEffect, useRef, useState } from 'react';
import { findActive, progressAt, type TimedLine } from '../lib/lyrics';
import { LyricLineView } from './LyricLineView';
import { useAnimationFrame } from '../hooks/useEngine';

interface Props {
  timeline: TimedLine[];
  getTime: () => number;
  mode: 'classic' | 'scroll';
  title: string;
  artist: string;
}

const COUNTDOWN = 4;
const INTERLUDE_GAP = 6;

function Countdown({ remain }: { remain: number }) {
  const n = Math.ceil(remain);
  return (
    <div className="countdown" aria-label={`อีก ${n} วินาที`}>
      {Array.from({ length: COUNTDOWN }, (_, i) => (
        <span key={i} className={i < n ? 'on' : ''} />
      ))}
    </div>
  );
}

export function KaraokeLyrics({ timeline, getTime, mode, title, artist }: Props) {
  const [t, setT] = useState(0);
  useAnimationFrame(() => {
    const now = getTime();
    setT((prev) => (Math.abs(prev - now) > 0.004 ? now : prev));
  });

  if (timeline.length === 0) {
    return (
      <div className="lyrics-empty">
        <div className="stage-title">{title}</div>
        <div className="stage-artist">{artist}</div>
        <p className="muted">ยังไม่มีเนื้อเพลงที่ซิงก์เวลา</p>
      </div>
    );
  }
  return mode === 'scroll' ? (
    <ScrollLyrics timeline={timeline} t={t} />
  ) : (
    <ClassicLyrics timeline={timeline} t={t} title={title} artist={artist} />
  );
}

interface Slot {
  line: TimedLine;
  progress: number;
  state: 'active' | 'next';
}

/** แบบคาราโอเกะคลาสสิก 2 บรรทัดสลับกัน (บรรทัดบนชิดซ้าย บรรทัดล่างชิดขวา) */
function ClassicLyrics({ timeline: tl, t, title, artist }: { timeline: TimedLine[]; t: number; title: string; artist: string }) {
  const c = findActive(tl, t);
  const slots: (Slot | null)[] = [null, null];
  let countdown = 0;
  let showTitle = false;
  let interlude = false;
  let ended = false;

  const put = (i: number, state: Slot['state']) => {
    const line = tl[i];
    if (!line) return;
    slots[i % 2] = { line, state, progress: state === 'active' ? progressAt(line, t) : 0 };
  };

  if (c === -1) {
    const remain = tl[0].start - t;
    if (remain > COUNTDOWN + 0.5) showTitle = true;
    else countdown = remain;
    put(0, 'next');
    put(1, 'next');
  } else {
    const cur = tl[c];
    const nxt = tl[c + 1];
    if (!nxt && t > cur.end + 1.5) {
      ended = true;
    } else if (nxt && t > cur.end + 0.6 && nxt.start - cur.end > INTERLUDE_GAP) {
      const remain = nxt.start - t;
      if (remain <= COUNTDOWN) countdown = remain;
      else interlude = true;
      put(c + 1, 'next');
      put(c + 2, 'next');
    } else {
      put(c, 'active');
      put(c + 1, 'next');
    }
  }

  if (showTitle) {
    return (
      <div className="lyrics-classic">
        <div className="title-card">
          <div className="stage-title">{title}</div>
          {artist && <div className="stage-artist">{artist}</div>}
        </div>
      </div>
    );
  }
  if (ended) {
    return (
      <div className="lyrics-classic">
        <div className="title-card">
          <div className="stage-note">♪ ♪ ♪</div>
        </div>
      </div>
    );
  }
  return (
    <div className="lyrics-classic">
      <div className="cue-row">
        {countdown > 0 ? <Countdown remain={countdown} /> : interlude ? <div className="stage-note">♪ ดนตรี ♪</div> : null}
      </div>
      {slots.map((s, i) => (
        <div key={i} className={`classic-line ${i === 0 ? 'left' : 'right'} ${s?.state ?? ''}`}>
          {s && <LyricLineView key={s.line.index} text={s.line.text} progress={s.progress} />}
        </div>
      ))}
    </div>
  );
}

/** แบบเลื่อนขึ้นทีละบรรทัด */
function ScrollLyrics({ timeline: tl, t }: { timeline: TimedLine[]; t: number }) {
  const c = findActive(tl, t);
  const boxRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [offset, setOffset] = useState(0);
  const focus = Math.max(0, c);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const el = lineRefs.current[focus];
    if (!box || !el) return;
    setOffset(box.clientHeight * 0.42 - (el.offsetTop + el.offsetHeight / 2));
  }, [focus, tl]);

  const nxt = tl[c + 1];
  const cur = tl[c];
  const remain = nxt ? nxt.start - t : 0;
  const showCountdown =
    nxt && remain > 0 && remain <= COUNTDOWN && (c === -1 || (cur && nxt.start - cur.end > INTERLUDE_GAP && t > cur.end));

  return (
    <div className="lyrics-scroll" ref={boxRef}>
      <div className="cue-row floating">{showCountdown ? <Countdown remain={remain} /> : null}</div>
      <div className="lyrics-scroll-inner" style={{ transform: `translateY(${offset}px)` }}>
        {tl.map((line, i) => (
          <div
            key={line.index}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            className={`scroll-line ${i === c ? 'active' : i < c ? 'past' : 'future'}`}
          >
            <LyricLineView text={line.text} progress={i === c ? progressAt(line, t) : i < c ? 1 : 0} />
          </div>
        ))}
      </div>
    </div>
  );
}
