import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getEngine } from '../audio/engine';
import { buildTimeline } from '../lib/lyrics';
import { formatTime } from '../lib/format';
import { getPrefs, setPrefs } from '../lib/prefs';
import { YT_STATE, type YTPlayer } from '../lib/youtube';
import type { Song } from '../lib/types';
import { useEngineState } from '../hooks/useEngine';
import { useScoring } from '../hooks/useScoring';
import { YtClock } from '../lib/ytClock';
import { useFullscreen } from '../hooks/useFullscreen';
import type { BattleProps } from './KaraokePlayer';
import { YouTubePlayer } from './YouTubePlayer';
import { KaraokeLyrics } from './KaraokeLyrics';
import { PitchLane } from './PitchLane';
import { Stepper } from './Controls';
import { ScoreResult } from './ScoreResult';
import { toast } from '../lib/toast';
import { Icon } from './Icon';

/** จบการแข่งเองเมื่อเลยท่อนสุดท้ายไปเท่านี้ (วินาที) — ไม่ต้องรอช่วงท้าย MV */
const END_AFTER_LAST_LINE = 4;
/** สั่งเล่นแล้วยังไม่เล่นภายในเวลานี้ (มือถือบางรุ่นบล็อกการเล่นอัตโนมัติ) → บอกให้แตะวิดีโอ */
const STUCK_MS = 2500;

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
  /** เพลงจบ (ห้องคาราโอเกะ: ไปเพลงถัดไป) */
  onEnded?: () => void;
  /** ปุ่มเพิ่มเติมบนแถบควบคุม เช่น "ข้ามเพลง" */
  extraActions?: ReactNode;
  /** ร้องเดี่ยว: มีปุ่ม 🎯 เปิด/ปิดการนับคะแนน (ตามการตั้งค่าเดียวกับเพลงในคลัง) */
  allowScoring?: boolean;
}

/** คาราโอเกะจากวิดีโอ YouTube: วิดีโอ + เนื้อเพลงที่ซิงก์ + ให้คะแนน (จังหวะ + ความตรงคีย์) */
export function YouTubeKaraoke({ song, autoPlay = true, battle, startAt, onOffsetChange, onEnded, extraActions, allowScoring }: Props) {
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
  const full = useFullscreen();
  const battleRef = useRef(battle);
  battleRef.current = battle;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
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
  const scoringOn = (battle ? true : !!allowScoring && prefs.scoring) && workletsOk !== false && timeline.length > 0;
  const score = useScoring(song, timeline, 0, scoringOn, { recordBest: !battle, clock });
  const finishScore = useRef(score.finish);
  finishScore.current = score.finish;
  const scoringRef = useRef(scoringOn && score.status === 'ready');
  scoringRef.current = scoringOn && score.status === 'ready';

  useEffect(() => {
    if (score.lastLine) battleRef.current?.onLine(score.lastLine.line);
  }, [score.lastLine]);

  /** จบเพลง: แข่ง → ส่งผล, ร้องเดี่ยว → แสดงคะแนน (ถ้านับ) หรือไปเพลงถัดไป */
  const finish = useCallback(
    (ended: boolean) => {
      if (finishedRef.current) return;
      if (battleRef.current) {
        finishedRef.current = true;
        try {
          clock.player?.pauseVideo();
        } catch {
          /* ignore */
        }
        battleRef.current.onFinish(finishScore.current());
        return;
      }
      const result = finishScore.current();
      if (result) {
        finishedRef.current = true;
        try {
          clock.player?.pauseVideo();
        } catch {
          /* ignore */
        }
      } else if (ended) {
        onEndedRef.current?.();
      }
    },
    [clock],
  );

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
      // แข่ง/นับคะแนน: ไม่ต้องรอช่วงท้าย MV
      if ((battleRef.current || scoringRef.current) && clock.state === YT_STATE.PLAYING && t > lastEnd + END_AFTER_LAST_LINE) finish(false);
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

  const toggleScoring = async () => {
    const next = !prefs.scoring;
    setPrefsState(setPrefs({ scoring: next }));
    if (next && !(await engine.enableMic())) toast('ต้องอนุญาตให้ใช้ไมโครโฟนก่อนจึงจะนับคะแนนได้', 'error', 5000);
  };

  const retry = () => {
    score.dismissResult();
    finishedRef.current = false;
    clock.player?.seekTo(0, true);
    score.restart(0);
    play();
  };

  const updateLyricMode = (lyricMode: 'classic' | 'scroll') => setPrefsState(setPrefs({ lyricMode }));
  const feedback = score.lastLine && (battle?.feedbackFor?.(score.lastLine.line.index) ?? true) ? score.lastLine : null;

  return (
    <div className="player yt-karaoke">
      {/* เต็มจอ: ทั้งวิดีโอ + เนื้อเพลง + กระดานคะแนน */}
      <div ref={full.ref} className={`player-shell yt-shell ${full.className}`}>
        <div className="yt-stage">
          <YouTubePlayer
            videoId={yt.videoId}
            rate={1}
            autoplay={autoPlay && !useCountdown}
            onReady={onReady}
            onState={onState}
            onEnded={() => finish(true)}
            onError={setError}
          />
        </div>
        <div className={`stage yt-lyrics ${scoringOn ? 'scoring' : ''} ${battle ? 'battle' : ''}`} onDoubleClick={full.toggle}>
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
          {score.result && !battle && (
            <ScoreResult
              result={score.result}
              onRetry={retry}
              onClose={score.dismissResult}
              note="เพลง YouTube ไม่มีเส้นทำนองให้เทียบ จึงวัดจังหวะและความตรงคีย์จากเสียงที่คุณร้อง"
              onNext={
                onEnded
                  ? () => {
                      score.dismissResult();
                      onEndedRef.current?.();
                    }
                  : undefined
              }
            />
          )}
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
          {allowScoring && !battle && (
            <button
              type="button"
              className={`chip ${prefs.scoring ? 'on' : ''}`}
              onClick={() => void toggleScoring()}
              disabled={workletsOk === false || timeline.length === 0}
              aria-pressed={prefs.scoring}
              title={timeline.length === 0 ? 'ต้องซิงก์เนื้อเพลงก่อนจึงจะนับคะแนนได้' : 'นับคะแนนการร้อง (ใช้ไมค์)'}
            >
              🎯 <span>นับคะแนน</span>
            </button>
          )}
          {extraActions}
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
            onClick={full.toggle}
            aria-label={full.active ? 'ออกจากเต็มจอ' : 'เต็มจอ'}
            title="เต็มจอ (F)"
          >
            <Icon name={full.active ? 'minimize' : 'maximize'} />
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
