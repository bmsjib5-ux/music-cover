import { useEffect, useRef, useState } from 'react';
import { getEngine, type MicSettings, type PitchInfo } from '../audio/engine';
import { useAnimationFrame, useEngineState } from '../hooks/useEngine';
import { keyName, NOTE_NAMES, noteName } from '../lib/music';
import { coversDb } from '../lib/db';
import { newId } from '../lib/id';
import { formatTime } from '../lib/format';
import { toast } from '../lib/toast';
import type { MusicKey, Song } from '../lib/types';
import { Icon } from './Icon';
import { Slider, Toggle } from './Controls';

interface Props {
  /** ถ้าระบุ จะแสดงส่วนอัดเสียงคัฟเวอร์ */
  song?: Song;
  /** คีย์ของเพลงที่กำลังเล่น (ถ้าไม่ระบุใช้ของ song) */
  songKey?: MusicKey | null;
  keyShift: number;
  onSaved?: () => void;
}

function MicLevel() {
  const engine = getEngine();
  const barRef = useRef<HTMLDivElement>(null);
  const data = useRef<Float32Array<ArrayBuffer> | null>(null);
  useAnimationFrame(() => {
    const meter = engine.micMeter;
    const bar = barRef.current;
    if (!meter || !bar) return;
    if (!data.current || data.current.length !== meter.fftSize) data.current = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(data.current);
    let sum = 0;
    for (const v of data.current) sum += v * v;
    const rms = Math.sqrt(sum / data.current.length);
    const level = Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-6) + 60) / 54));
    bar.style.transform = `scaleX(${level.toFixed(3)})`;
    bar.classList.toggle('hot', level > 0.92);
  });
  return (
    <div className="mic-level" aria-hidden="true">
      <div ref={barRef} className="mic-level-bar" />
    </div>
  );
}

function PitchMeter({ autotune }: { autotune: boolean }) {
  const [p, setP] = useState<PitchInfo | null>(null);
  useEffect(() => getEngine().onPitch(setP), []);
  const voiced = p?.voiced;
  const cents = voiced ? Math.max(-50, Math.min(50, Math.round((p.midi - p.target) * 100))) : 0;
  return (
    <div className={`pitch-meter ${voiced ? 'live' : ''}`}>
      <div className="pitch-notes">
        <div>
          <small>คุณร้อง</small>
          <strong>{voiced ? noteName(p.midi) : '—'}</strong>
        </div>
        <Icon name="back" size={18} style={{ transform: 'rotate(180deg)', opacity: autotune ? 1 : 0.3 }} />
        <div>
          <small>{autotune ? 'แก้เป็น' : 'โน้ตใกล้สุด'}</small>
          <strong className="accent">{voiced ? noteName(p.target) : '—'}</strong>
        </div>
      </div>
      <div className="cents" title="เพี้ยนกี่เซ็นต์ (ครึ่งเสียง = 100)">
        <span className="cents-center" />
        <span className={`cents-dot ${Math.abs(cents) < 12 ? 'good' : ''}`} style={{ left: `${50 + cents}%`, opacity: voiced ? 1 : 0 }} />
      </div>
      <div className="cents-labels">
        <span>ต่ำไป</span>
        <span>{voiced ? `${cents > 0 ? '+' : ''}${cents} เซ็นต์` : 'ลองร้องดูสิ'}</span>
        <span>สูงไป</span>
      </div>
    </div>
  );
}

/** ได้ยินเสียงตัวเองแบบไหน + บอกความหน่วง (เสียงที่ได้ยินช้ากว่าเสียงจริงเสมอ เท่ากับเวลาไมค์ → ลำโพง) */
function MonitorOptions({ s, update }: { s: MicSettings; update: (patch: Partial<MicSettings>) => void }) {
  const engine = getEngine();
  const [latency, setLatency] = useState<number | null>(() => engine.monitorLatencyMs());
  useEffect(() => {
    // ค่าความหน่วงของลำโพงจะนิ่งหลังเล่นเสียงไปสักพัก
    const h = setInterval(() => setLatency(engine.monitorLatencyMs()), 2000);
    return () => clearInterval(h);
  }, [engine]);
  const laggy = latency === null || latency > 40;
  const setMode = (monitorMode: MicSettings['monitorMode']) => {
    // โหมดเฉพาะเสียงก้องต้องมีเสียงก้อง/เอคโค่ ไม่งั้นจะไม่ได้ยินอะไร
    if (monitorMode === 'fx' && s.reverb < 0.2 && s.echo < 0.1) update({ monitorMode, reverb: 0.35 });
    else update({ monitorMode });
  };
  return (
    <div className="monitor-options">
      <div className="ctl-label">เสียงที่ได้ยินในหูฟัง</div>
      <div className="seg">
        <button type="button" className={s.monitorMode === 'fx' ? 'on' : ''} onClick={() => setMode('fx')}>
          เฉพาะเสียงก้อง (ไม่ดีเลย์)
        </button>
        <button type="button" className={s.monitorMode === 'full' ? 'on' : ''} onClick={() => setMode('full')}>
          เสียงร้อง + เสียงก้อง
        </button>
      </div>
      <p className={`muted small ${laggy && s.monitorMode === 'full' ? 'monitor-warn' : ''}`}>
        {latency !== null ? `ความหน่วงไมค์ → หูฟังประมาณ ${latency} ms · ` : ''}
        {s.monitorMode === 'fx'
          ? 'คุณได้ยินเสียงจริงของตัวเองทันที เว็บเติมแค่เสียงก้อง/เอคโค่ให้ จึงไม่รู้สึกว่าเสียงช้ากว่าเพลง'
          : laggy
            ? 'ถ้ารู้สึกว่าเสียงตัวเองช้ากว่าเพลง ให้เลือก "เฉพาะเสียงก้อง" — มือถือและหูฟังบลูทูธหน่วงมาก (บลูทูธ ~0.2 วิ) หูฟังแบบสายจะดีที่สุด'
            : 'ความหน่วงต่ำ ร้องได้สบาย'}
      </p>
    </div>
  );
}

export function MicPanel({ song, songKey: songKeyProp, keyShift, onSaved }: Props) {
  const songKey = songKeyProp !== undefined ? songKeyProp : (song?.key ?? null);
  const engine = getEngine();
  const state = useEngineState();
  const [s, setS] = useState<MicSettings>(engine.micSettings);
  const [latency, setLatency] = useState<number | null>(null);
  const [musicLevel, setMusicLevel] = useState(0.8);
  const [recStart, setRecStart] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const recordingRef = useRef(false);
  recordingRef.current = state.recording;

  const update = (patch: Partial<MicSettings>) => {
    engine.updateMicSettings(patch);
    setS({ ...engine.micSettings });
  };

  useEffect(() => {
    if (state.micOn && latency === null) setLatency(engine.estimateLatencyMs());
  }, [state.micOn, latency, engine]);

  useEffect(() => {
    if (!state.recording) return;
    const id = setInterval(() => setElapsed((performance.now() - recStart) / 1000), 250);
    return () => clearInterval(id);
  }, [state.recording, recStart]);

  const stopAndSave = async () => {
    const rec = await engine.stopRecording();
    engine.pause();
    if (!rec || !song) return;
    if (rec.blob.size < 1000) {
      toast('ไฟล์อัดเสียงว่างเปล่า', 'error');
      return;
    }
    setSaving(true);
    try {
      await coversDb.put({
        id: newId(),
        songId: song.id,
        songTitle: song.title,
        createdAt: Date.now(),
        blob: rec.blob,
        mimeType: rec.mimeType,
        duration: rec.duration,
        keyShift,
        autotune: engine.micSettings.autotune,
      });
      toast('บันทึกคัฟเวอร์แล้ว 🎉', 'success');
      onSaved?.();
    } catch {
      toast('บันทึกไม่สำเร็จ (พื้นที่เก็บข้อมูลอาจเต็ม)', 'error');
    } finally {
      setSaving(false);
    }
  };

  // หยุดอัดอัตโนมัติเมื่อเพลงจบ
  useEffect(() => {
    const el = engine.el;
    const onEnd = () => {
      if (recordingRef.current) void stopAndSave();
    };
    el.addEventListener('ended', onEnd);
    return () => el.removeEventListener('ended', onEnd);
  });

  // ออกจากหน้าระหว่างอัด → ยกเลิก
  useEffect(() => () => engine.cancelRecording(), [engine]);

  const startRecording = async () => {
    const ok = await engine.enableMic();
    if (!ok) return;
    const lat = latency ?? engine.estimateLatencyMs();
    setLatency(lat);
    engine.pause();
    engine.seek(0);
    if (await engine.startRecording(lat, musicLevel)) {
      setRecStart(performance.now());
      setElapsed(0);
      try {
        await engine.play();
      } catch {
        engine.cancelRecording();
        toast('เริ่มเล่นเพลงไม่ได้', 'error');
      }
    }
  };

  const songScale = engine.effectiveScale();
  const scaleValue = s.scaleSource === 'manual' ? `${s.scaleRoot}-${s.scaleMode}` : s.scaleSource;
  const onScaleChange = (v: string) => {
    if (v === 'chromatic' || v === 'song') update({ scaleSource: v });
    else {
      const [root, mode] = v.split('-');
      update({ scaleSource: 'manual', scaleRoot: parseInt(root, 10), scaleMode: mode as 'major' | 'minor' });
    }
  };

  return (
    <section className="card mic-panel">
      <header className="card-head">
        <h2>
          <Icon name="mic" /> ไมค์ &amp; เอฟเฟกต์เสียงร้อง
        </h2>
        {state.micOn ? (
          <button type="button" className="btn btn-ghost" onClick={() => engine.disableMic()} disabled={state.recording}>
            <Icon name="micOff" size={18} /> ปิดไมค์
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void engine.enableMic()}>
            <Icon name="mic" size={18} /> เปิดไมค์
          </button>
        )}
      </header>

      {state.micError && <p className="alert error">{state.micError}</p>}

      {!state.micOn ? (
        <p className="muted">
          เปิดไมค์เพื่อร้องพร้อม Auto-Tune, เสียงก้อง และอัดเป็นคัฟเวอร์ได้ แนะนำให้<strong>ใส่หูฟัง</strong> จะได้ไม่มีเสียงหอน
        </p>
      ) : (
        <>
          <MicLevel />
          <div className="monitor-row">
            <Toggle
              label="ได้ยินเสียงตัวเอง"
              hint="เปิดเมื่อใส่หูฟังเท่านั้น"
              checked={s.monitor}
              onChange={(v) => update({ monitor: v })}
            />
            {s.monitor && <MonitorOptions s={s} update={update} />}
          </div>
          <div className="grid-controls">
            <Slider label="ระดับไมค์" value={s.gain} min={0} max={2.5} onChange={(v) => update({ gain: v })} display={`${Math.round(s.gain * 100)}%`} />
            <Slider label="เสียงก้อง (Reverb)" value={s.reverb} onChange={(v) => update({ reverb: v })} display={`${Math.round(s.reverb * 100)}%`} />
            <Slider label="เอคโค่" value={s.echo} onChange={(v) => update({ echo: v })} display={`${Math.round(s.echo * 100)}%`} />
          </div>
        </>
      )}

      <div className={`autotune ${s.autotune ? 'on' : ''}`}>
        <div className="autotune-head">
          <Toggle
            label={
              <>
                <Icon name="wand" size={18} /> Auto-Tune
              </>
            }
            hint="ดึงเสียงร้องให้ตรงโน้ตแบบเรียลไทม์"
            checked={s.autotune}
            disabled={state.workletsOk === false}
            onChange={(v) => update({ autotune: v })}
          />
          {state.workletsOk === false && <small className="muted">เบราว์เซอร์นี้ไม่รองรับ (ต้องเปิดผ่าน https)</small>}
        </div>
        <div className="grid-controls">
          <Slider
            label="ความแรง"
            value={s.strength}
            onChange={(v) => update({ strength: v })}
            display={`${Math.round(s.strength * 100)}%`}
            disabled={!s.autotune}
          />
          <Slider
            label="สไตล์"
            value={s.robot}
            onChange={(v) => update({ robot: v })}
            ends={['ธรรมชาติ', 'หุ่นยนต์ 🤖']}
            disabled={!s.autotune}
          />
          <label className="ctl">
            <div className="ctl-label">สเกลโน้ต</div>
            <select value={scaleValue} onChange={(e) => onScaleChange(e.target.value)} disabled={!s.autotune}>
              <option value="chromatic">ทุกโน้ต (โครมาติก)</option>
              <option value="song">
                ตามคีย์เพลง{songKey ? ` (${keyName(songKey, keyShift)})` : ' (ยังไม่ทราบคีย์)'}
              </option>
              {(['major', 'minor'] as const).flatMap((mode) =>
                NOTE_NAMES.map((n, root) => (
                  <option key={`${root}-${mode}`} value={`${root}-${mode}`}>
                    {n}
                    {mode === 'minor' ? 'm (ไมเนอร์)' : ' (เมเจอร์)'}
                  </option>
                )),
              )}
            </select>
            <div className="ctl-hint">
              {s.scaleSource === 'song' && !songScale ? 'ไม่ทราบคีย์เพลง จึงใช้ทุกโน้ต' : 'เลือกตามคีย์เพลงจะเสียงเข้ากับดนตรีที่สุด'}
            </div>
          </label>
        </div>
        {state.micOn && <PitchMeter autotune={s.autotune} />}
      </div>

      {song && (
        <div className="recorder">
          <div className="recorder-main">
            {state.recording ? (
              <button type="button" className="btn btn-rec recording" onClick={() => void stopAndSave()}>
                <Icon name="stop" /> หยุดอัด · {formatTime(elapsed)}
              </button>
            ) : (
              <button type="button" className="btn btn-rec" onClick={() => void startRecording()} disabled={saving || !song.audio}>
                <Icon name="record" /> อัดคัฟเวอร์ (เริ่มจากต้นเพลง)
              </button>
            )}
            <p className="muted small">
              ไฟล์อัดจะรวมดนตรี (ตามคีย์/ความเร็ว/การตัดเสียงร้องที่ตั้งไว้) กับเสียงร้องพร้อมเอฟเฟกต์ — หยุดเองหรือรอจนจบเพลง
            </p>
          </div>
          <details className="recorder-adv">
            <summary>ตั้งค่าการอัด</summary>
            <div className="grid-controls">
              <Slider
                label="ระดับดนตรีในไฟล์อัด"
                value={musicLevel}
                onChange={(v) => {
                  setMusicLevel(v);
                  engine.setRecordingMusicLevel(v);
                }}
                display={`${Math.round(musicLevel * 100)}%`}
              />
              <Slider
                label="ชดเชยความหน่วงไมค์"
                value={latency ?? 0}
                min={0}
                max={600}
                step={5}
                onChange={setLatency}
                display={`${latency ?? 0} ms`}
                disabled={state.recording}
                hint="ถ้าเสียงร้องในไฟล์อัดช้ากว่าดนตรี ให้เพิ่มค่านี้"
              />
              <Toggle
                label="ลดเสียงสะท้อน"
                hint="เปิดเมื่อร้องผ่านลำโพง (ไม่ใส่หูฟัง)"
                checked={s.echoCancellation}
                disabled={state.recording}
                onChange={(v) => update({ echoCancellation: v })}
              />
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
