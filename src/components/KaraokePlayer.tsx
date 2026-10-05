import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getEngine } from '../audio/engine';
import { buildTimeline } from '../lib/lyrics';
import { formatShift, keyName } from '../lib/music';
import { formatTime } from '../lib/format';
import { getPrefs, getSongPrefs, setPrefs, setSongPrefs } from '../lib/prefs';
import { songsDb } from '../lib/db';
import type { Song } from '../lib/types';
import { useEngineState } from '../hooks/useEngine';
import { useScoring } from '../hooks/useScoring';
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
}

const KEY_RANGE = 7;

export function KaraokePlayer({ song, autoPlay, onEnded, onKeyShift, extraActions }: Props) {
  const engine = getEngine();
  const { workletsOk } = useEngineState();
  const shellRef = useRef<HTMLDivElement>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const finishScoreRef = useRef<() => boolean>(() => false);

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

  const stereoOk = song.stereo !== false;

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
    engine.setRate(sp.tempo);
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
      if (!finishScoreRef.current()) onEndedRef.current?.();
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
  const scoringOn = prefs.scoring && workletsOk !== false && timeline.length > 0;
  const score = useScoring(song, timeline, songPrefs.key, scoringOn);
  finishScoreRef.current = score.finish;

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
        <div className={`stage ${scoringOn ? 'scoring' : ''}`} onDoubleClick={toggleFullscreen}>
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
          {scoringOn && score.lastLine && (
            <div
              key={score.lastLine.at}
              className={`line-feedback ${score.lastLine.line.score >= 75 ? 'hi' : score.lastLine.line.score >= 45 ? 'mid' : 'lo'}`}
            >
              {score.lastLine.line.label} <strong>{score.lastLine.line.silent ? '' : score.lastLine.line.score}</strong>
            </div>
          )}
          <div className="stage-meta">
            <span className="stage-meta-title">{song.title}</span>
            {song.artist && <span className="stage-meta-artist"> — {song.artist}</span>}
          </div>
          <div className="stage-badges">
            {songPrefs.key !== 0 && <span className="badge">คีย์ {formatShift(songPrefs.key)}</span>}
            {songPrefs.tempo !== 1 && <span className="badge">{Math.round(songPrefs.tempo * 100)}%</span>}
            {stereoOk && prefs.voice < 1 && <span className="badge">ตัดเสียงร้อง</span>}
            {scoringOn && score.running !== null && <span className="badge score-badge">🎯 {score.running}</span>}
          </div>
          <KaraokeLyrics timeline={timeline} getTime={getTime} mode={prefs.lyricMode} title={song.title} artist={song.artist} />
          {score.result && (
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
          <button type="button" className="play-btn" onClick={togglePlay} aria-label={playing ? 'หยุดชั่วคราว' : 'เล่น'} disabled={!!loadError}>
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
          value={`${Math.round(songPrefs.tempo * 100)}%`}
          onDec={() => updateSongPrefs({ tempo: Math.max(0.5, Math.round((songPrefs.tempo - 0.05) * 100) / 100) })}
          onInc={() => updateSongPrefs({ tempo: Math.min(1.5, Math.round((songPrefs.tempo + 0.05) * 100) / 100) })}
          onReset={() => updateSongPrefs({ tempo: 1 })}
          decDisabled={songPrefs.tempo <= 0.5}
          incDisabled={songPrefs.tempo >= 1.5}
          hint="เปลี่ยนความเร็วโดยคีย์ไม่เปลี่ยน"
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
            <button type="button" className={prefs.lyricMode === 'classic' ? 'on' : ''} onClick={() => updatePrefs({ lyricMode: 'classic' })}>
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
