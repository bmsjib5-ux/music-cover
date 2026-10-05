import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEngine } from '../audio/engine';
import { buildTimeline } from '../lib/lyrics';
import { formatTime } from '../lib/format';
import { getPrefs, setPrefs } from '../lib/prefs';
import { YT_STATE, type YTPlayer } from '../lib/youtube';
import type { Song } from '../lib/types';
import { useEngineState } from '../hooks/useEngine';
import { useScoring, type ScoreClock } from '../hooks/useScoring';
import type { BattleProps } from './KaraokePlayer';
import { YouTubePlayer } from './YouTubePlayer';
import { KaraokeLyrics } from './KaraokeLyrics';
import { PitchLane } from './PitchLane';
import { Stepper } from './Controls';
import { Icon } from './Icon';

/** จบการแข่งเองเมื่อเลยท่อนสุดท้ายไปเท่านี้ (วินาที) — ไม่ต้องรอช่วงท้าย MV */
const END_AFTER_LAST_LINE = 4;
/** สั่งเล่นแล้วยังไม่เล่นภายในเวลานี้ (มือถือบางรุ่นบล็อกการเล่นอัตโนมัติ) → บอกให้แตะวิดีโอ */
const STUCK_MS = 2500;

/**
 * นาฬิกาของวิดีโอ YouTube: getCurrentTime() อัปเดตเป็นช่วงๆ จึงประมาณเวลาระหว่างช่วงจาก performance.now()
 * ให้เนื้อเพลงไหลลื่น และแจ้ง play/seeked ให้ระบบให้คะแนน
 */
class YtClock implements ScoreClock {
  player: YTPlayer | null = null;
  state: number = YT_STATE.UNSTARTED;
  private anchorMedia = 0;
  private anchorPerf = 0;
  private lastRaw = -1;
  private last = 0;
  private readonly listeners = { play: new Set<() => void>(), seeked: new Set<() => void>() };

  private raw(): number | null {
    try {
      const t = this.player?.getCurrentTime();
      return typeof t === 'number' && Number.isFinite(t) ? t : null;
    } catch {
      return null;
    }
  }

  private emit(event: 'play' | 'seeked'): void {
    // แจ้งหลังจบงานปัจจุบัน ไม่ให้ผู้ฟังเรียก time() ซ้อนกลับเข้ามา
    queueMicrotask(() => this.listeners[event].forEach((fn) => fn()));
  }

  private anchor(t: number, now: number): void {
    if (Math.abs(t - this.last) > 1) this.emit('seeked');
    this.anchorMedia = t;
    this.anchorPerf = now;
  }

  time(): number {
    const raw = this.raw();
    if (raw === null) return this.last;
    const now = performance.now();
    if (this.state !== YT_STATE.PLAYING) {
      this.lastRaw = raw;
      this.anchor(raw, now);
      return (this.last = raw);
    }
    const predicted = this.anchorMedia + (now - this.anchorPerf) / 1000;
    if (raw !== this.lastRaw) {
      this.lastRaw = raw;
      // ค่าใหม่จาก YouTube คลาดจากที่ประมาณไว้ → ยึดค่าจริง
      if (Math.abs(raw - predicted) > 0.12) {
        this.anchor(raw, now);
        return (this.last = raw);
      }
    }
    return (this.last = predicted);
  }

  setState(state: number): void {
    const was = this.state;
    this.state = state;
    const raw = this.raw();
    if (raw !== null) {
      this.lastRaw = raw;
      this.anchor(raw, performance.now());
      this.last = raw;
    }
    if (state === YT_STATE.PLAYING && was !== YT_STATE.PLAYING) this.emit('play');
  }

  paused(): boolean {
    return this.state !== YT_STATE.PLAYING;
  }

  on(event: 'play' | 'seeked', fn: () => void): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }
}

interface Props {
  /** เพลงที่มี song.youtube */
  song: Song;
  autoPlay?: boolean;
  /** โหมดแข่งร้อง (นับคะแนนเสมอ) */
  battle?: BattleProps;
  /** เริ่มพร้อมกันที่เวลานี้ (performance.now()) — แข่งข้ามเครื่อง */
  startAt?: number | null;
  /** โหมดตั้งเวลาเนื้อก่อนแข่ง: แสดงปุ่มเลื่อนเวลาเนื้อ */
  onOffsetChange?: (offset: number) => void;
}

/** คาราโอเกะจากวิดีโอ YouTube: วิดีโอ + เนื้อเพลงที่ซิงก์ + ให้คะแนน (จังหวะ + ความตรงคีย์) */
export function YouTubeKaraoke({ song, autoPlay = true, battle, startAt, onOffsetChange }: Props) {
  const yt = song.youtube!;
  const engine = getEngine();
  const { workletsOk } = useEngineState();
  const clock = useMemo(() => new YtClock(), []);
  const [prefs, setPrefsState] = useState(getPrefs);
  const [offset, setOffset] = useState(song.offset || 0);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [stuck, setStuck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  /** เต็มหน้าต่างแทน (iPhone ไม่รองรับ Fullscreen API กับ div) */
  const [theater, setTheater] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const battleRef = useRef(battle);
  battleRef.current = battle;
  const finishedRef = useRef(false);
  /** สั่งเล่นตอนที่วิดีโอยังโหลดไม่เสร็จ → เล่นทันทีที่พร้อม */
  const pendingPlay = useRef(false);
  const stuckTimer = useRef(0);
  const useCountdown = startAt !== null && startAt !== undefined;

  // วิดีโอ YouTube เล่นเสียงเอง — หยุดเครื่องเล่นของแอปไว้
  useEffect(() => engine.pause(), [engine]);

  useEffect(() => setOffset(song.offset || 0), [song.offset]);

  // ไม่ใช้ความยาววิดีโอตัดเวลาเนื้อ (ความยาวมาทีหลัง จะทำให้รอบให้คะแนนเริ่มใหม่)
  const timeline = useMemo(() => buildTimeline(song.lines, offset, 0), [song.lines, offset]);
  const getTime = useCallback(() => clock.time(), [clock]);
  const scoringOn = !!battle && workletsOk !== false && timeline.length > 0;
  const score = useScoring(song, timeline, 0, scoringOn, { recordBest: false, clock });
  const finishScore = useRef(score.finish);
  finishScore.current = score.finish;

  useEffect(() => {
    if (score.lastLine) battleRef.current?.onLine(score.lastLine.line);
  }, [score.lastLine]);

  const finish = useCallback(() => {
    if (finishedRef.current || !battleRef.current) return;
    finishedRef.current = true;
    try {
      clock.player?.pauseVideo();
    } catch {
      /* ignore */
    }
    battleRef.current.onFinish(finishScore.current());
  }, [clock]);

  const watchStuck = useCallback(() => {
    window.clearTimeout(stuckTimer.current);
    stuckTimer.current = window.setTimeout(() => {
      if (clock.state !== YT_STATE.PLAYING && clock.state !== YT_STATE.BUFFERING) setStuck(true);
    }, STUCK_MS);
  }, [clock]);

  useEffect(() => () => window.clearTimeout(stuckTimer.current), []);

  const play = useCallback(() => {
    const p = clock.player;
    if (!p) {
      pendingPlay.current = true;
      return;
    }
    p.playVideo();
    watchStuck();
  }, [clock, watchStuck]);

  // นับถอยหลังแล้วเริ่มพร้อมกัน (แข่งข้ามเครื่อง)
  useEffect(() => {
    if (startAt === null || startAt === undefined) return;
    let raf = 0;
    const tick = () => {
      const remain = startAt - performance.now();
      if (remain <= 0) {
        setCountdown(null);
        play();
        return;
      }
      setCountdown(Math.ceil(remain / 1000));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [startAt, play]);

  // อัปเดตเวลา + จบการแข่งเมื่อเลยท่อนสุดท้าย
  const lastEnd = timeline.length ? timeline[timeline.length - 1].end : Infinity;
  useEffect(() => {
    const h = window.setInterval(() => {
      const t = clock.time();
      setCurrent(t);
      if (battleRef.current && clock.state === YT_STATE.PLAYING && t > lastEnd + END_AFTER_LAST_LINE) finish();
    }, 200);
    return () => window.clearInterval(h);
  }, [clock, lastEnd, finish]);

  const onReady = (p: YTPlayer) => {
    clock.player = p;
    try {
      const d = p.getDuration();
      if (d > 0) setDuration(d);
    } catch {
      /* ignore */
    }
    if (pendingPlay.current) {
      pendingPlay.current = false;
      play();
    } else if (autoPlay && !useCountdown) {
      watchStuck();
    }
  };

  const onState = (s: number) => {
    clock.setState(s);
    setPlaying(s === YT_STATE.PLAYING);
    if (s === YT_STATE.PLAYING || s === YT_STATE.BUFFERING) {
      setStuck(false);
      window.clearTimeout(stuckTimer.current);
    }
    if (s === YT_STATE.PLAYING && clock.player) {
      try {
        const d = clock.player.getDuration();
        if (d > 0) setDuration(d);
      } catch {
        /* ignore */
      }
    }
  };

  const togglePlay = () => {
    if (clock.player && clock.state === YT_STATE.PLAYING) clock.player.pauseVideo();
    else play();
  };

  const changeOffset = (next: number) => {
    const v = Math.round(next * 10) / 10;
    setOffset(v);
    onOffsetChange?.(v);
  };

  // เต็มจอ: ทั้งวิดีโอ + เนื้อเพลง + กระดานคะแนน
  useEffect(() => {
    const onFs = () => setFullscreen(!!shellRef.current && document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (theater) {
      setTheater(false);
    } else if (shell.requestFullscreen) {
      shell.requestFullscreen().catch(() => setTheater(true));
    } else {
      setTheater(true);
    }
  }, [theater]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyF') toggleFullscreen();
      else if (e.code === 'Escape' && theater) setTheater(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen, theater]);

  const updateLyricMode = (lyricMode: 'classic' | 'scroll') => setPrefsState(setPrefs({ lyricMode }));
  const feedback = score.lastLine && (battle?.feedbackFor?.(score.lastLine.line.index) ?? true) ? score.lastLine : null;

  return (
    <div className="player yt-karaoke">
      <div ref={shellRef} className={`player-shell yt-shell ${fullscreen ? 'is-full' : ''} ${theater ? 'theater' : ''}`}>
        <div className="yt-stage">
          <YouTubePlayer
            videoId={yt.videoId}
            rate={1}
            autoplay={autoPlay && !useCountdown}
            onReady={onReady}
            onState={onState}
            onEnded={finish}
            onError={setError}
          />
        </div>
        <div className={`stage yt-lyrics ${scoringOn ? 'scoring' : ''} ${battle ? 'battle' : ''}`} onDoubleClick={toggleFullscreen}>
          {scoringOn && score.status === 'ready' && (
            <PitchLane melody={null} showMelody={false} keyShift={0} getTime={getTime} trailRef={score.trailRef} />
          )}
          {scoringOn && score.status === 'needs-mic' && (
            <button type="button" className="score-status as-button" onClick={() => void engine.enableMic()}>
              <Icon name="mic" size={16} /> เปิดไมค์เพื่อเริ่มนับคะแนน
            </button>
          )}
          {scoringOn && feedback && (
            <div key={feedback.at} className={`line-feedback ${feedback.line.score >= 75 ? 'hi' : feedback.line.score >= 45 ? 'mid' : 'lo'}`}>
              {battle?.ownerName?.(feedback.line.index) && <span className="feedback-who">{battle.ownerName(feedback.line.index)}</span>}
              {feedback.line.label} <strong>{feedback.line.silent ? '' : feedback.line.score}</strong>
            </div>
          )}
          <div className="stage-badges">
            <span className="badge">YouTube</span>
            {battle && <span className="badge battle-badge">⚔️ {battle.label}</span>}
          </div>
          {battle && (
            <div className="battle-board">
              {battle.scoreboard.map((p) => (
                <div key={p.name} className="battle-board-row" style={{ borderColor: p.color }}>
                  <span className="dot" style={{ background: p.color }} />
                  <span className="name">{p.name}</span>
                  <strong>{p.score ?? '–'}</strong>
                </div>
              ))}
            </div>
          )}
          <KaraokeLyrics
            timeline={timeline}
            getTime={getTime}
            mode={prefs.lyricMode}
            title={song.title}
            artist={song.artist}
            decorate={battle?.decorate}
          />
          {countdown !== null && (
            <div className="start-countdown" key={countdown}>
              <span>{countdown}</span>
              <small>เตรียมร้อง!</small>
            </div>
          )}
        </div>
        <div className="transport">
          <button type="button" className="play-btn" onClick={togglePlay} aria-label={playing ? 'หยุดชั่วคราว' : 'เล่น'}>
            <Icon name={playing ? 'pause' : 'play'} size={26} />
          </button>
          <span className="time">{formatTime(Math.max(0, current))}</span>
          <div className="yt-progress" aria-hidden="true">
            <span style={{ width: `${duration > 0 ? Math.min(100, (current / duration) * 100) : 0}%` }} />
          </div>
          <span className="time">{formatTime(duration)}</span>
          <div className="seg">
            <button type="button" className={prefs.lyricMode === 'classic' ? 'on' : ''} onClick={() => updateLyricMode('classic')}>
              2 บรรทัด
            </button>
            <button type="button" className={prefs.lyricMode === 'scroll' ? 'on' : ''} onClick={() => updateLyricMode('scroll')}>
              เลื่อน
            </button>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleFullscreen}
            aria-label={fullscreen || theater ? 'ออกจากเต็มจอ' : 'เต็มจอ'}
            title="เต็มจอ (F)"
          >
            <Icon name={fullscreen || theater ? 'minimize' : 'maximize'} />
          </button>
        </div>
      </div>

      {error && <p className="alert error">{error} — ลองเลือกวิดีโออื่น</p>}
      {stuck && !error && (
        <p className="alert yt-tap">
          <Icon name="play" size={18} /> วิดีโอยังไม่เล่น — แตะที่วิดีโอ หรือปุ่มเล่นด้านล่างเพื่อเริ่ม
        </p>
      )}

      {onOffsetChange && (
        <div className="yt-sync card">
          <div className="yt-sync-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!timeline.length}
              onClick={() => {
                // ท่อนแรกตามฐานข้อมูลเนื้อเพลง (ก่อนเลื่อนเวลา) ควรเริ่มที่เวลาปัจจุบันของวิดีโอ
                const first = timeline[0].start - offset;
                changeOffset(clock.time() - first);
              }}
            >
              <Icon name="mic" size={18} /> กดตอนท่อนแรกเริ่มร้อง
            </button>
            <Stepper
              icon="clock"
              label="เลื่อนเวลาเนื้อ"
              value={`${offset > 0 ? '+' : ''}${offset.toFixed(1)} วิ`}
              onDec={() => changeOffset(offset - 0.2)}
              onInc={() => changeOffset(offset + 0.2)}
              onReset={() => changeOffset(0)}
            />
          </div>
          <p className="muted small">
            เล่นวิดีโอ แล้วกดปุ่มสีชมพูตอนที่นักร้องเริ่มร้องท่อนแรก "{timeline[0]?.text ?? ''}" — หรือปรับละเอียดด้วย + / −
            (เนื้อขึ้นก่อนเสียงร้อง กด +)
          </p>
        </div>
      )}
    </div>
  );
}
