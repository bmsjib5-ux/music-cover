import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEngine } from '../audio/engine';
import { ensureMelody } from '../lib/songs';
import { recordScore, getBestScore, ScoreSession, MIN_MELODY_COVERAGE, type LineScore, type ScoreResult } from '../lib/scoring';
import { melodyCoverage, type Melody } from '../lib/melody';
import type { TimedLine } from '../lib/lyrics';
import type { Song } from '../lib/types';

/** ชดเชยความหน่วงของไมค์ + ตัวตรวจระดับเสียง (วินาที) */
const MIC_DELAY = 0.06;
/** เก็บเสียงที่ร้องย้อนหลังไว้วาดบนแถบทำนอง (วินาที) */
const TRAIL_SECONDS = 3;

export interface TrailFrame {
  t: number;
  /** cents หรือ 0 */
  c: number;
}

export interface FinalScore extends ScoreResult {
  isBest: boolean;
  eligible: boolean;
  best: number | null;
}

export type ScoringStatus = 'off' | 'preparing' | 'needs-mic' | 'ready';

/** แหล่งเวลาของเพลงที่ใช้ให้คะแนน (ค่าเริ่มต้น = เครื่องเล่นเสียงของแอป, หรือวิดีโอ YouTube) */
export interface ScoreClock {
  /** เวลาในเพลงสำหรับเทียบกับเนื้อเพลง (วินาที) */
  time(): number;
  paused(): boolean;
  on(event: 'play' | 'seeked', fn: () => void): () => void;
}

let engineClock: ScoreClock | null = null;

function getEngineClock(): ScoreClock {
  if (!engineClock) {
    const engine = getEngine();
    engineClock = {
      time: () => engine.lyricTime,
      paused: () => engine.el.paused,
      on: (event, fn) => {
        engine.el.addEventListener(event, fn);
        return () => engine.el.removeEventListener(event, fn);
      },
    };
  }
  return engineClock;
}

export function useScoring(
  song: Song,
  timeline: TimedLine[],
  keyShift: number,
  enabled: boolean,
  opts: { recordBest?: boolean; clock?: ScoreClock } = {},
) {
  const recordBest = opts.recordBest ?? true;
  const engine = getEngine();
  const clock = opts.clock ?? getEngineClock();
  const [status, setStatus] = useState<ScoringStatus>('off');
  const [progress, setProgress] = useState(0);
  const [melody, setMelody] = useState<Melody | null>(null);
  const [lastLine, setLastLine] = useState<{ line: LineScore; at: number } | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [result, setResult] = useState<FinalScore | null>(null);
  const [micOn, setMicOn] = useState(engine.state.micOn);
  const sessionRef = useRef<ScoreSession | null>(null);
  const trailRef = useRef<TrailFrame[]>([]);
  const nextLineRef = useRef(0);
  const keyShiftRef = useRef(keyShift);
  keyShiftRef.current = keyShift;

  useEffect(() => engine.subscribe(() => setMicOn(engine.state.micOn)), [engine]);

  // เตรียมเส้นทำนอง (ถอดจากไฟล์ถ้ายังไม่มี)
  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      return;
    }
    let cancelled = false;
    setStatus('preparing');
    setProgress(0);
    ensureMelody(song, (p) => !cancelled && setProgress(p))
      .then((m) => {
        if (cancelled) return;
        setMelody(m);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setMelody(null);
        setStatus('ready');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, song.id]);

  const startSession = useCallback((from?: number) => {
    const t = from ?? clock.time();
    sessionRef.current = new ScoreSession(timeline, melody, {
      keyShift: keyShiftRef.current,
      songKey: song.key,
      startTime: t,
      // วิดีโอ YouTube ไม่รู้คีย์ → เดาคีย์จากเสียงที่ร้อง
      inferKey: !!song.youtube,
    });
    trailRef.current = [];
    nextLineRef.current = timeline.findIndex((l) => l.end > t);
    if (nextLineRef.current < 0) nextLineRef.current = timeline.length;
    setLastLine(null);
    setRunning(null);
    setResult(null);
  }, [clock, timeline, melody, song.key, song.youtube]);

  const active = enabled && status === 'ready' && micOn;

  // สร้างรอบใหม่เมื่อพร้อม / เปลี่ยนเพลง / เปลี่ยนเวลาเนื้อ
  useEffect(() => {
    if (!active) {
      sessionRef.current = null;
      return;
    }
    startSession();
  }, [active, startSession]);

  useEffect(() => {
    sessionRef.current?.setKeyShift(keyShift);
  }, [keyShift]);

  // รับระดับเสียงจากไมค์
  useEffect(() => {
    if (!active) return;
    return engine.onPitch((p) => {
      const session = sessionRef.current;
      if (!session || clock.paused()) return;
      const t = clock.time() - MIC_DELAY;
      session.add(t, p.voiced ? p.midi : null);
      const trail = trailRef.current;
      trail.push({ t, c: p.voiced ? p.midi * 100 : 0 });
      while (trail.length && trail[0].t < t - TRAIL_SECONDS) trail.shift();
      // ให้คะแนนบรรทัดที่เพิ่งจบ
      let next = nextLineRef.current;
      while (next < timeline.length && t > timeline[next].end + 0.25) {
        const ls = session.scoreLine(next);
        if (ls) setLastLine({ line: ls, at: performance.now() });
        next++;
      }
      if (next !== nextLineRef.current) {
        nextLineRef.current = next;
        setRunning(session.runningScore());
      }
    });
  }, [active, engine, clock, timeline]);

  // การกระโดดตำแหน่งเพลง: ย้อนไปต้นเพลง = เริ่มรอบใหม่, กระโดดที่อื่น = ไม่นับสถิติ
  // หลังเพลงจบ (ไม่มีรอบที่ค้างอยู่) การกดเล่น/ย้อนเพลงจะเริ่มรอบใหม่ให้เอง
  useEffect(() => {
    if (!active) return;
    const onSeeked = () => {
      const session = sessionRef.current;
      const t = clock.time();
      const first = timeline[0]?.start ?? 0;
      if (!session || t < first - 0.3) {
        startSession(t);
        return;
      }
      session.seeked = true;
      const idx = timeline.findIndex((l) => l.end > t);
      nextLineRef.current = idx < 0 ? timeline.length : idx;
      trailRef.current = [];
    };
    const onPlay = () => {
      if (!sessionRef.current) startSession();
    };
    const offSeeked = clock.on('seeked', onSeeked);
    const offPlay = clock.on('play', onPlay);
    return () => {
      offSeeked();
      offPlay();
    };
  }, [active, clock, timeline, startSession]);

  /** เรียกเมื่อเพลงจบ — คืนผลคะแนน (null = ไม่มีข้อมูลให้คะแนน) */
  const finish = useCallback((): FinalScore | null => {
    const session = sessionRef.current;
    if (!session) return null;
    const r = session.finalize();
    sessionRef.current = null;
    if (r.lines.length === 0) return null;
    const first = timeline[0]?.start ?? 0;
    const eligible = !session.seeked && session.startedAt <= first + 1;
    const isBest = recordBest && eligible && r.total > 0 ? recordScore(song.id, r.total) : false;
    const final: FinalScore = { ...r, eligible, isBest, best: getBestScore(song.id)?.best ?? null };
    setResult(final);
    return final;
  }, [timeline, song.id, recordBest]);

  const dismissResult = useCallback(() => setResult(null), []);

  /** melody = เทียบกับทำนองของเพลง, scale = เทียบกับโน้ตในคีย์ (ถอดทำนองไม่ชัด) */
  const mode = useMemo(
    () => (melody && melodyCoverage(melody, timeline) >= MIN_MELODY_COVERAGE ? 'melody' : 'scale'),
    [melody, timeline],
  );

  useEffect(() => {
    if (enabled && status === 'ready' && !micOn) setStatus('needs-mic');
    if (enabled && status === 'needs-mic' && micOn) setStatus('ready');
  }, [enabled, status, micOn]);

  return {
    status,
    progress,
    melody,
    mode,
    trailRef,
    lastLine,
    running,
    result,
    finish,
    dismissResult,
    /** เริ่มนับใหม่ (from = เวลาในเพลงที่เริ่ม เช่น 0 เมื่อเล่นใหม่ตั้งแต่ต้น) */
    restart: startSession,
  };
}
