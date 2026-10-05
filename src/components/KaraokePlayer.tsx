import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getEngine } from '../audio/engine';
import { buildTimeline } from '../lib/lyrics';
import { formatShift, keyName } from '../lib/music';
import { formatTime } from '../lib/format';
import { getPrefs, getSongPrefs, setPrefs, setSongPrefs } from '../lib/prefs';
import { songsDb } from '../lib/db';
import type { Song } from '../lib/types';
import { useEngineState } from '../hooks/useEngine';
import { useScoring, type FinalScore } from '../hooks/useScoring';
import type { LineScore } from '../lib/scoring';
import type { LineDecor } from './KaraokeLyrics';
import { toast } from '../lib/toast';
import { KaraokeLyrics } from './KaraokeLyrics';
import { Visualizer } from './Visualizer';
import { PitchLane } from './PitchLane';
import { ScoreResult } from './ScoreResult';
import { Icon } from './Icon';
import { Slider, Stepper } from './Controls';

interface Props {
  song: Song;
  autoPlay?: boolean;
  onEnded?: () => void;
  /** เรียกเมื่อผู้ใช้ปรับคีย์ (ให้แผงไมค์แสดงสเกลถูกต้อง) */
  onKeyShift?: (n: number) => void;
  /** ปุ่มเพิ่มเติมบนแถบควบคุม เช่น "ข้ามเพลง" ในห้องคาราโอเกะ */
  extraActions?: ReactNode;
  /** โหมดแข่งร้อง: นับคะแนนเสมอ, ส่งคะแนนรายท่อน/ผลรวมให้หน้าแข่ง */
  battle?: BattleProps;
  /** เริ่มเล่นพร้อมกันที่เวลานี้ (performance.now()) พร้อมนับถอยหลังบนจอ — ใช้กับการแข่งข้ามเครื่อง */
  startAt?: number | null;
}

export interface BattleProps {
  /** ป้ายมุมจอ เช่น "รอบที่ 1/3 · มด" */
  label: string;
  /** สี/ชื่อของเจ้าของแต่ละท่อน */
  decorate?: LineDecor;
  /** ชื่อผู้เล่นของท่อน (ใช้กับข้อความบอกผลรายท่อน) */
  ownerName?: (lineIndex: number) => string | null;
  /** กระดานคะแนนสด */
  scoreboard: { name: string; color: string; score: number | null }[];
  onLine: (line: LineScore) => void;
  onFinish: (result: FinalScore | null) => void;
  /** แสดงผลรายท่อนเฉพาะท่อนที่คืนค่า true (แข่งข้ามเครื่อง: เฉพาะท่อนของเรา) */
  feedbackFor?: (lineIndex: number) => boolean;
  /** ล็อกความเร็วไว้ 100% (แข่งข้ามเครื่องต้องเล่นพร้อมกัน) */
  lockTempo?: boolean;
}

const KEY_RANGE = 7;

export function KaraokePlayer({ song, autoPlay, onEnded, onKeyShift, extraActions, battle, startAt }: Props) {
  const engine = getEngine();
  const { workletsOk } = useEngineState();
  const shellRef = useRef<HTMLDivElement>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const finishScoreRef = useRef<() => FinalScore | null>(() => null);
  const battleRef = useRef(battle);
  battleRef.current = battle;

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(song.duration || 0);
  const [needsTap, setNeedsTap] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState(getPrefs);
  const [songPrefs, setSongPrefsState] = useState(() => getSongPrefs(song.id));
  const [offset, setOffset] = useState(song.offset || 0);
  const [fullscreen, setFullscreen] = useState(false);
  const [theater, setTheater] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const stereoOk = song.stereo !== false;
  const tempoLocked = !!battle?.lockTempo;

  // โหลดเพลงเข้าเอนจิน
  useEffect(() => {
    const sp = getSongPrefs(song.id);
    setSongPrefsState(sp);
    setOffset(song.offset || 0);
    setLoadError(null);
    setCurrent(0);
    if (!song.audio) {
      setLoadError('เพลงนี้ยังไม่มีไฟล์เสียง');
      return;
    }
    engine.load(song.audio, song.stereo);
    engine.setRate(battle?.lockTempo ? 1 : sp.tempo);
    engine.setSemitones(sp.key);
    engine.setSongKey(song.key);
    onKeyShift?.(sp.key);
    const p = getPrefs();
    engine.setVoiceLevel(p.voice);
    engine.setVolume(p.volume);
    if (autoPlay) {
      engine.play().catch(() => setNeedsTap(true));
    }
    return () => {
      engine.pause();
    };
    // โหลดใหม่เฉพาะเมื่อเปลี่ยนเพลง/ไฟล์ (Blob จาก IndexedDB เป็น object ใหม่ทุกครั้งที่อ่าน)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, song.audioName, song.audio?.size]);

  // นับถอยหลังแล้วเริ่มพร้อมกัน (แข่งข้ามเครื่อง)
  useEffect(() => {
    if (startAt === null || startAt === undefined) return;
    let raf = 0;
    let started = false;
    engine.pause();
    engine.seek(0);
    const tick = () => {
      const remain = startAt - performance.now();
      if (remain <= 0) {
        setCountdown(null);
        if (!started) {
          started = true;
          engine.play().catch(() => setNeedsTap(true));
        }
        return;
      }
      setCountdown(Math.ceil(remain / 1000));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [startAt, engine]);

  useEffect(() => {
    const el = engine.el;
    const onPlay = () => {
      setPlaying(true);
      setNeedsTap(false);
    };
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration)) setDuration(el.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      // ถ้ามีผลคะแนน ให้แสดงก่อน แล้วค่อยไปเพลงถัดไปจากหน้าผลคะแนน
      const result = finishScoreRef.current();
      if (battleRef.current) battleRef.current.onFinish(result);
      else if (!result) onEndedRef.current?.();
    };
    const onError = () => setLoadError('เล่นไฟล์เสียงนี้ไม่ได้ — ลองแปลงเป็น MP3 แล้วอัปโหลดใหม่');
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('seeked', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('seeked', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onError);
    };
  }, [engine]);

  const timeline = useMemo(() => buildTimeline(song.lines, offset, duration), [song.lines, offset, duration]);
  const getTime = useCallback(() => engine.lyricTime, [engine]);
  const scoringOn = (battle ? true : prefs.scoring) && workletsOk !== false && timeline.length > 0;
  const score = useScoring(song, timeline, songPrefs.key, scoringOn, { recordBest: !battle });
  finishScoreRef.current = score.finish;

  // ส่งคะแนนรายท่อนให้หน้าแข่ง
  useEffect(() => {
    if (score.lastLine) battleRef.current?.onLine(score.lastLine.line);
  }, [score.lastLine]);

  const toggleScoring = async () => {
    const next = !prefs.scoring;
    updatePrefs({ scoring: next });
    if (next && !(await engine.enableMic())) toast('ต้องอนุญาตให้ใช้ไมโครโฟนก่อนจึงจะนับคะแนนได้', 'error', 5000);
  };

  const retry = () => {
    score.dismissResult();
    engine.seek(0);
    score.restart(0);
    engine.play().catch(() => setNeedsTap(true));
  };

  const togglePlay = useCallback(() => {
    if (engine.el.paused) engine.play().catch(() => setNeedsTap(true));
    else engine.pause();
  }, [engine]);

  const updateSongPrefs = (patch: Partial<typeof songPrefs>) => {
    const next = { ...songPrefs, ...patch };
    setSongPrefsState(next);
    setSongPrefs(song.id, next);
    if (patch.key !== undefined) {
      engine.setSemitones(next.key);
      onKeyShift?.(next.key);
    }
    if (patch.tempo !== undefined) engine.setRate(next.tempo);
  };

  function updatePrefs(patch: Partial<typeof prefs>) {
    const next = setPrefs(patch);
    setPrefsState(next);
    if (patch.voice !== undefined) engine.setVoiceLevel(next.voice);
    if (patch.volume !== undefined) engine.setVolume(next.volume);
  }

  const changeOffset = (delta: number) => {
    const next = Math.round((offset + delta) * 10) / 10;
    setOffset(next);
    void songsDb.put({ ...song, offset: next, updatedAt: Date.now() });
  };

  // เต็มจอ
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === shellRef.current);
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

  // คีย์ลัด
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        engine.seek(engine.el.currentTime - 5);
      } else if (e.code === 'ArrowRight') {
        engine.seek(engine.el.currentTime + 5);
      } else if (e.code === 'KeyF') {
        toggleFullscreen();
      } else if (e.code === 'Escape' && theater) {
        setTheater(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, togglePlay, toggleFullscreen, theater]);

  const keyLabel = song.key ? ` · ${keyName(song.key, songPrefs.key)}` : '';
  const voicePct = Math.round(prefs.voice * 100);

  return (
    <div className="player">
      <div ref={shellRef} className={`player-shell ${fullscreen ? 'is-full' : ''} ${theater ? 'theater' : ''}`}>
        <div className={`stage ${scoringOn ? 'scoring' : ''} ${battle ? 'battle' : ''}`} onDoubleClick={toggleFullscreen}>
          <Visualizer />
          {scoringOn && score.status === 'ready' && (
            <PitchLane
              melody={score.melody}
              showMelody={score.mode === 'melody'}
              keyShift={songPrefs.key}
              getTime={getTime}
              trailRef={score.trailRef}
            />
          )}
          {scoringOn && score.status === 'preparing' && (
            <div className="score-status">กำลังถอดทำนองเพลงเพื่อให้คะแนน… {Math.round(score.progress * 100)}%</div>
          )}
          {scoringOn && score.status === 'needs-mic' && (
            <button type="button" className="score-status as-button" onClick={() => void engine.enableMic()}>
              <Icon name="mic" size={16} /> เปิดไมค์เพื่อเริ่มนับคะแนน
            </button>
          )}
          {scoringOn && score.lastLine && (battle?.feedbackFor?.(score.lastLine.line.index) ?? true) && (
            <div
              key={score.lastLine.at}
              className={`line-feedback ${score.lastLine.line.score >= 75 ? 'hi' : score.lastLine.line.score >= 45 ? 'mid' : 'lo'}`}
            >
              {battle?.ownerName?.(score.lastLine.line.index) && (
                <span className="feedback-who">{battle.ownerName(score.lastLine.line.index)}</span>
              )}
              {score.lastLine.line.label} <strong>{score.lastLine.line.silent ? '' : score.lastLine.line.score}</strong>
            </div>
          )}
          <div className="stage-meta">
            <span className="stage-meta-title">{song.title}</span>
            {song.artist && <span className="stage-meta-artist"> — {song.artist}</span>}
          </div>
          <div className="stage-badges">
            {songPrefs.key !== 0 && <span className="badge">คีย์ {formatShift(songPrefs.key)}</span>}
            {!tempoLocked && songPrefs.tempo !== 1 && <span className="badge">{Math.round(songPrefs.tempo * 100)}%</span>}
            {stereoOk && prefs.voice < 1 && <span className="badge">ตัดเสียงร้อง</span>}
            {!battle && scoringOn && score.running !== null && <span className="badge score-badge">🎯 {score.running}</span>}
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
          {(needsTap || loadError) && (
            <div className="stage-overlay">
              {loadError ? (
                <p>{loadError}</p>
              ) : (
                <button type="button" className="btn btn-primary btn-lg" onClick={togglePlay}>
                  <Icon name="play" /> แตะเพื่อเริ่มเพลง
                </button>
              )}
            </div>
          )}
        </div>

        <div className="transport">
          <button type="button" className="icon-btn" onClick={() => engine.seek(0)} aria-label="เริ่มใหม่">
            <Icon name="restart" />
          </button>
          <button
            type="button"
            className="play-btn"
            onClick={togglePlay}
            aria-label={playing ? 'หยุดชั่วคราว' : 'เล่น'}
            disabled={!!loadError}
          >
            <Icon name={playing ? 'pause' : 'play'} size={26} />
          </button>
          <span className="time">{formatTime(current)}</span>
          <input
            className="seek"
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(current, duration || 1)}
            onChange={(e) => engine.seek(parseFloat(e.target.value))}
            aria-label="ตำแหน่งเพลง"
          />
          <span className="time">{formatTime(duration)}</span>
          {!battle && (
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
          <button type="button" className="icon-btn" onClick={toggleFullscreen} aria-label="เต็มจอ">
            <Icon name={fullscreen || theater ? 'minimize' : 'maximize'} />
          </button>
        </div>
      </div>

      <div className="mixer">
        <Slider
          icon="mic"
          label="เสียงนักร้องต้นฉบับ"
          value={stereoOk ? prefs.voice : 1}
          onChange={(v) => updatePrefs({ voice: v })}
          display={stereoOk ? (voicePct === 0 ? 'ตัดออก' : `${voicePct}%`) : '—'}
          disabled={!stereoOk}
          ends={['ตัดออก', 'ต้นฉบับ']}
          hint={!stereoOk ? 'ไฟล์นี้เป็นเสียงโมโน จึงตัดเสียงร้องไม่ได้' : undefined}
        />
        <Stepper
          icon="key"
          label="คีย์"
          value={
            <>
              {formatShift(songPrefs.key)}
              <small>{keyLabel || (songPrefs.key === 0 ? ' ต้นฉบับ' : ' ครึ่งเสียง')}</small>
            </>
          }
          onDec={() => updateSongPrefs({ key: songPrefs.key - 1 })}
          onInc={() => updateSongPrefs({ key: songPrefs.key + 1 })}
          onReset={() => updateSongPrefs({ key: 0 })}
          decDisabled={songPrefs.key <= -KEY_RANGE}
          incDisabled={songPrefs.key >= KEY_RANGE}
          disabled={workletsOk === false}
          hint={workletsOk === false ? 'เบราว์เซอร์นี้ปรับคีย์ไม่ได้ (ต้องเปิดผ่าน https)' : 'เสียงผู้ชาย/ผู้หญิง ลองปรับ ±3–5'}
        />
        <Stepper
          icon="gauge"
          label="ความเร็ว"
          value={tempoLocked ? '100%' : `${Math.round(songPrefs.tempo * 100)}%`}
          disabled={tempoLocked}
          onDec={() => updateSongPrefs({ tempo: Math.max(0.5, Math.round((songPrefs.tempo - 0.05) * 100) / 100) })}
          onInc={() => updateSongPrefs({ tempo: Math.min(1.5, Math.round((songPrefs.tempo + 0.05) * 100) / 100) })}
          onReset={() => updateSongPrefs({ tempo: 1 })}
          decDisabled={songPrefs.tempo <= 0.5}
          incDisabled={songPrefs.tempo >= 1.5}
          hint={tempoLocked ? 'ล็อกไว้ 100% ระหว่างแข่งออนไลน์' : 'เปลี่ยนความเร็วโดยคีย์ไม่เปลี่ยน'}
        />
        <Slider
          icon="volume"
          label="ระดับเสียงเพลง"
          value={prefs.volume}
          onChange={(v) => updatePrefs({ volume: v })}
          display={`${Math.round(prefs.volume * 100)}%`}
        />
        <div className="ctl">
          <div className="ctl-label">
            <Icon name="list" size={16} /> เนื้อเพลง
          </div>
          <div className="seg">
            <button
              type="button"
              className={prefs.lyricMode === 'classic' ? 'on' : ''}
              onClick={() => updatePrefs({ lyricMode: 'classic' })}
            >
              2 บรรทัด
            </button>
            <button type="button" className={prefs.lyricMode === 'scroll' ? 'on' : ''} onClick={() => updatePrefs({ lyricMode: 'scroll' })}>
              เลื่อน
            </button>
          </div>
        </div>
        <Stepper
          icon="clock"
          label="เลื่อนเวลาเนื้อ"
          value={`${offset > 0 ? '+' : ''}${offset.toFixed(1)} วิ`}
          onDec={() => changeOffset(-0.1)}
          onInc={() => changeOffset(0.1)}
          onReset={() => changeOffset(-offset)}
          hint="เนื้อขึ้นเร็วไป กด + / ช้าไป กด −"
        />
      </div>
    </div>
  );
}
