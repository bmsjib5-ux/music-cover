import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { songsDb } from '../lib/db';
import { paths } from '../lib/router';
import { buildTimeline, findActive, progressAt, syncedCount } from '../lib/lyrics';
import { formatTime, formatTimePrecise } from '../lib/format';
import type { LyricLine, Song } from '../lib/types';
import { Icon } from '../components/Icon';
import { Waveform } from '../components/Waveform';
import { LyricLineView } from '../components/LyricLineView';
import { useAnimationFrame } from '../hooks/useEngine';

const MIN_HOLD = 0.3;

/** ตัวอย่างเนื้อไล่สีตามเวลาที่ซิงก์ไว้ */
function Preview({ lines, getTime }: { lines: LyricLine[]; getTime: () => number }) {
  const tl = useMemo(() => buildTimeline(lines), [lines]);
  const [t, setT] = useState(0);
  useAnimationFrame(() => setT(getTime()));
  const i = findActive(tl, t);
  const line = tl[i];
  const showing = line && t <= line.end + 0.8;
  return (
    <div className="sync-preview">
      {showing ? <LyricLineView text={line.text} progress={progressAt(line, t)} /> : <span className="muted">♪</span>}
    </div>
  );
}

export function SyncPage({ id }: { id: string }) {
  const [song, setSong] = useState<Song | null>(null);
  const [missing, setMissing] = useState(false);
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [holding, setHolding] = useState(false);
  const [rate, setRate] = useState(1);
  const [duration, setDuration] = useState(0);
  const [saved, setSaved] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const holdRef = useRef<{ index: number } | null>(null);
  const skipKeyUp = useRef(false);
  const firstLoad = useRef(true);

  useEffect(() => {
    let url: string | null = null;
    void songsDb.get(id).then((s) => {
      if (!s) {
        setMissing(true);
        return;
      }
      setSong(s);
      setLines(s.lines);
      setDuration(s.duration);
      const firstUnsynced = s.lines.findIndex((l) => l.start === null);
      setCursor(firstUnsynced === -1 ? s.lines.length : firstUnsynced);
      if (s.audio) {
        url = URL.createObjectURL(s.audio);
        setAudioUrl(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  // บันทึกอัตโนมัติ
  useEffect(() => {
    if (!song) return;
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    setSaved(false);
    const h = setTimeout(() => {
      void songsDb.put({ ...song, lines, updatedAt: Date.now() }).then(() => setSaved(true));
    }, 500);
    return () => clearTimeout(h);
  }, [lines, song]);

  const getTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);

  const play = () => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = rate;
    void a.play();
  };
  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) play();
    else a.pause();
  };
  const seek = (t: number) => {
    const a = audioRef.current;
    if (a) a.currentTime = Math.max(0, Math.min(t, (a.duration || t) - 0.05));
  };

  const pressDown = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      play();
      skipKeyUp.current = true;
      return;
    }
    const index = cursorRef.current;
    if (index >= linesRef.current.length) return;
    const t = a.currentTime;
    holdRef.current = { index };
    setHolding(true);
    setLines((ls) => {
      const next = [...ls];
      next[index] = { ...next[index], start: t, end: null };
      const prev = next[index - 1];
      if (prev && prev.end !== null && prev.end > t) next[index - 1] = { ...prev, end: t };
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);

  const pressUp = useCallback(() => {
    if (skipKeyUp.current) {
      skipKeyUp.current = false;
      return;
    }
    const hold = holdRef.current;
    holdRef.current = null;
    setHolding(false);
    if (!hold) return;
    const t = audioRef.current?.currentTime ?? 0;
    setLines((ls) => {
      const next = [...ls];
      const line = next[hold.index];
      if (line.start !== null) next[hold.index] = { ...line, end: t - line.start >= MIN_HOLD ? t : null };
      return next;
    });
    setCursor(hold.index + 1);
  }, []);

  const undo = useCallback(() => {
    const index = Math.max(0, cursorRef.current - 1);
    const old = linesRef.current[index];
    setLines((ls) => {
      const next = [...ls];
      next[index] = { ...next[index], start: null, end: null };
      return next;
    });
    setCursor(index);
    if (old?.start !== null && old?.start !== undefined) seek(old.start - 3);
  }, []);

  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) pressDown();
      } else if (e.code === 'Enter') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'Backspace' || e.code === 'ArrowUp') {
        e.preventDefault();
        undo();
      } else if (e.code === 'ArrowLeft') {
        seek(getTime() - 3);
      } else if (e.code === 'ArrowRight') {
        seek(getTime() + 3);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        e.preventDefault();
        pressUp();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  // เลื่อนรายการให้เห็นบรรทัดที่กำลังจะกด
  useEffect(() => {
    const el = listRef.current?.children[Math.min(cursor, lines.length - 1)] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [cursor, lines.length]);

  const nudge = (i: number, field: 'start' | 'end', delta: number) => {
    setLines((ls) => {
      const next = [...ls];
      const v = next[i][field];
      if (v === null) return ls;
      next[i] = { ...next[i], [field]: Math.max(0, Math.round((v + delta) * 100) / 100) };
      return next;
    });
  };

  const setNow = (i: number) => {
    const t = getTime();
    setLines((ls) => {
      const next = [...ls];
      next[i] = { ...next[i], start: t, end: next[i].end !== null && next[i].end! > t ? next[i].end : null };
      return next;
    });
  };

  const shiftAll = (delta: number) => {
    setLines((ls) =>
      ls.map((l) => ({
        ...l,
        start: l.start === null ? null : Math.max(0, Math.round((l.start + delta) * 100) / 100),
        end: l.end === null ? null : Math.max(0, Math.round((l.end + delta) * 100) / 100),
      })),
    );
  };

  const resetAll = () => {
    if (!confirm('ล้างเวลาซิงก์ทั้งหมด แล้วเริ่มใหม่?')) return;
    setLines((ls) => ls.map((l) => ({ ...l, start: null, end: null })));
    setCursor(0);
    seek(0);
  };

  if (missing) return <div className="page">ไม่พบเพลงนี้</div>;
  if (!song) return <div className="page muted">กำลังโหลด…</div>;

  const done = syncedCount(lines);
  const allDone = lines.length > 0 && done === lines.length;
  const current = lines[cursor];

  return (
    <div className="page">
      <a className="back-link" href={paths.library()}>
        <Icon name="back" size={18} /> คลังเพลง
      </a>
      <div className="page-head">
        <div>
          <h1>ซิงก์เนื้อเพลง</h1>
          <p className="muted">
            {song.title} {song.artist && `— ${song.artist}`} · ซิงก์แล้ว {done}/{lines.length} บรรทัด ·{' '}
            <span className={saved ? 'ok-text' : ''}>{saved ? '✓ บันทึกอัตโนมัติแล้ว' : 'กำลังบันทึก…'}</span>
          </p>
        </div>
        <div className="row">
          <a className="btn btn-ghost" href={paths.edit(song.id)}>
            <Icon name="edit" size={18} /> แก้เนื้อเพลง
          </a>
          <a className={`btn ${allDone ? 'btn-primary' : 'btn-ghost'}`} href={paths.sing(song.id)}>
            <Icon name="mic" size={18} /> ไปร้องเลย
          </a>
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="card empty">
          <p>เพลงนี้ยังไม่มีเนื้อเพลง</p>
          <a className="btn btn-primary" href={paths.edit(song.id)}>
            ใส่เนื้อเพลง
          </a>
        </div>
      ) : (
        <div className="sync-layout">
          <section className="card sync-main">
            <audio
              ref={audioRef}
              src={audioUrl ?? undefined}
              preload="auto"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || song.duration)}
            />
            <Waveform peaks={song.peaks} duration={duration} getTime={getTime} lines={lines} cursor={cursor} onSeek={seek} />
            <div className="sync-transport">
              <button type="button" className="play-btn" onClick={togglePlay} aria-label={playing ? 'หยุด' : 'เล่น'}>
                <Icon name={playing ? 'pause' : 'play'} size={24} />
              </button>
              <Clock getTime={getTime} duration={duration} />
              <div className="seg">
                {[0.5, 0.75, 1].map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={rate === r ? 'on' : ''}
                    onClick={() => {
                      setRate(r);
                      if (audioRef.current) audioRef.current.playbackRate = r;
                    }}
                  >
                    {r}x
                  </button>
                ))}
              </div>
            </div>

            <Preview lines={lines} getTime={getTime} />

            <div className="tap-area">
              <div className="tap-next">
                {current ? (
                  <>
                    <small>บรรทัดถัดไป ({cursor + 1}/{lines.length})</small>
                    <strong>{current.text}</strong>
                  </>
                ) : (
                  <strong className="ok-text">✓ ซิงก์ครบทุกบรรทัดแล้ว!</strong>
                )}
              </div>
              <button
                type="button"
                className={`tap-btn ${holding ? 'holding' : ''}`}
                disabled={!current && playing}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  pressDown();
                }}
                onPointerUp={pressUp}
                onPointerCancel={pressUp}
                onContextMenu={(e) => e.preventDefault()}
              >
                {!playing ? 'แตะเพื่อเริ่มเล่น' : holding ? 'ปล่อยเมื่อจบท่อน' : 'กดค้างตอนเริ่มร้อง'}
              </button>
              <div className="tap-tools">
                <button type="button" className="btn btn-ghost btn-sm" onClick={undo} disabled={cursor === 0}>
                  <Icon name="back" size={16} /> ย้อน 1 บรรทัด
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftAll(-0.1)}>
                  ทุกบรรทัด −0.1 วิ
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftAll(0.1)}>
                  ทุกบรรทัด +0.1 วิ
                </button>
                <button type="button" className="btn btn-ghost btn-sm danger" onClick={resetAll}>
                  <Icon name="trash" size={16} /> ล้างทั้งหมด
                </button>
              </div>
            </div>

            <details className="help">
              <summary>วิธีซิงก์ &amp; คีย์ลัด</summary>
              <ul>
                <li>
                  <kbd>Space</kbd> กดค้างตอนเริ่มร้องท่อนนั้น แล้วปล่อยเมื่อร้องจบ (กดแตะสั้นๆ ก็ได้ ระบบจะใช้เวลาท่อนถัดไปเป็นเวลาจบ)
                </li>
                <li>
                  <kbd>Enter</kbd> เล่น/หยุด · <kbd>←</kbd> <kbd>→</kbd> ถอย/เดินหน้า 3 วิ · <kbd>Backspace</kbd> ย้อนกลับ 1 บรรทัด
                </li>
                <li>มือถือ: กดปุ่มใหญ่ค้างไว้แทน Space · ถ้าร้องเร็วเกินไป ลดความเร็วเป็น 0.75x ก่อน</li>
                <li>แตะที่บรรทัดใดก็ได้ในรายการ เพื่อซิงก์ใหม่ตั้งแต่บรรทัดนั้น</li>
              </ul>
            </details>
          </section>

          <section className="card sync-list-card">
            <ol className="sync-list" ref={listRef}>
              {lines.map((l, i) => (
                <li key={i} className={`${i === cursor ? 'cursor' : ''} ${l.start !== null ? 'done' : ''}`}>
                  <button
                    type="button"
                    className="sync-line"
                    onClick={() => {
                      setCursor(i);
                      if (l.start !== null) seek(l.start - 2);
                      else {
                        const prev = [...lines.slice(0, i)].reverse().find((x) => x.start !== null);
                        if (prev?.start != null) seek(prev.start);
                      }
                    }}
                  >
                    <span className="sync-num">{i + 1}</span>
                    <span className="sync-text">{l.text}</span>
                  </button>
                  <span className="sync-times">
                    <span className="t-start">{formatTimePrecise(l.start)}</span>
                    {l.end !== null && <span className="t-end">→ {formatTimePrecise(l.end)}</span>}
                  </span>
                  {l.start !== null && (
                    <span className="sync-nudge">
                      <button type="button" onClick={() => nudge(i, 'start', -0.1)} title="เร็วขึ้น 0.1 วิ">
                        −
                      </button>
                      <button type="button" onClick={() => nudge(i, 'start', 0.1)} title="ช้าลง 0.1 วิ">
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          seek((l.start ?? 0) - 1);
                          play();
                        }}
                        title="ฟังบรรทัดนี้"
                      >
                        <Icon name="play" size={12} />
                      </button>
                    </span>
                  )}
                  {l.start === null && i === cursor && playing && (
                    <span className="sync-nudge">
                      <button type="button" onClick={() => setNow(i)} title="ตั้งเวลาเป็นตอนนี้">
                        ตอนนี้
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  );
}

function Clock({ getTime, duration }: { getTime: () => number; duration: number }) {
  const [t, setT] = useState(0);
  useAnimationFrame(() => setT(getTime()));
  return (
    <span className="time">
      {formatTimePrecise(t)} / {formatTime(duration)}
    </span>
  );
}
