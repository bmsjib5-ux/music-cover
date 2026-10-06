import workletUrl from './worklet.ts?worker&url';
import { scaleMask } from './dsp/autotune';
import type { PitchInfo } from './dsp/autotune';
import type { MusicKey } from '../lib/types';

export type { PitchInfo };

export interface MicSettings {
  gain: number;
  monitor: boolean;
  /**
   * full = ได้ยินเสียงร้อง + เอฟเฟกต์, fx = ได้ยินเฉพาะเสียงก้อง/เอคโค่
   * (เสียงจริงได้ยินเองทันที — ไม่รู้สึกว่าเสียงช้ากว่าเพลงบนเครื่องที่หน่วงมาก เช่น มือถือ/หูฟังบลูทูธ)
   */
  monitorMode: 'full' | 'fx';
  reverb: number;
  echo: number;
  autotune: boolean;
  /** 0..1 */
  strength: number;
  /** 0 = ธรรมชาติ … 1 = หุ่นยนต์ */
  robot: number;
  /** chromatic = ทุกโน้ต, song = ตามคีย์เพลง (เลื่อนตามการปรับคีย์), manual = เลือกเอง */
  scaleSource: 'chromatic' | 'song' | 'manual';
  scaleRoot: number;
  scaleMode: 'major' | 'minor';
  echoCancellation: boolean;
}

/** มือถือหน่วงไมค์→ลำโพงมากกว่าคอม จึงเริ่มที่โหมดเฉพาะเสียงก้อง */
const TOUCH_DEVICE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export const DEFAULT_MIC: MicSettings = {
  gain: 1,
  monitor: false,
  monitorMode: TOUCH_DEVICE ? 'fx' : 'full',
  reverb: 0.25,
  echo: 0,
  autotune: false,
  strength: 0.8,
  robot: 0.3,
  scaleSource: 'song',
  scaleRoot: 0,
  scaleMode: 'major',
  echoCancellation: false,
};

export interface EngineState {
  workletsOk: boolean | null;
  micOn: boolean;
  micError: string | null;
  recording: boolean;
}

interface MicChain {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  input: GainNode;
  tuner: AudioWorkletNode | null;
  tunerWet: GainNode;
  tunerDry: GainNode;
  post: GainNode;
  reverbSend: GainNode;
  echoSend: GainNode;
  vocalBus: GainNode;
  /** เสียงร้อง (ไม่รวมเอฟเฟกต์) ที่ส่งไปหูฟัง */
  monitorDry: GainNode;
  monitor: GainNode;
  meter: AnalyserNode;
  nodes: AudioNode[];
}

interface RecSession {
  recorder: MediaRecorder;
  chunks: Blob[];
  dest: MediaStreamAudioDestinationNode;
  musicDelay: DelayNode;
  musicGain: GainNode;
  mimeType: string;
  startedAt: number;
}

export interface Recording {
  blob: Blob;
  mimeType: string;
  duration: number;
}

const MIC_KEY = 'rongloei.mic.v1';

function loadMicSettings(): MicSettings {
  try {
    const raw = localStorage.getItem(MIC_KEY);
    if (raw) return { ...DEFAULT_MIC, ...(JSON.parse(raw) as Partial<MicSettings>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_MIC };
}

function robotToSeconds(robot: number): number {
  // 1 → 0 วินาที (หุ่นยนต์), 0 → 0.25 วินาที (ธรรมชาติ)
  const r = Math.max(0, Math.min(1, robot));
  return r >= 0.98 ? 0 : 0.25 * Math.pow(1 - r, 2);
}

function pickMimeType(): string {
  const types = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder === 'undefined') return '';
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const pre = Math.floor(ctx.sampleRate * 0.015);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = pre; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

function setAudioSession(type: 'playback' | 'play-and-record'): void {
  const nav = navigator as AudioSessionNavigator;
  if (nav.audioSession) {
    try {
      nav.audioSession.type = type;
    } catch {
      /* ignore */
    }
  }
}

/**
 * เอนจินเสียงตัวเดียวของทั้งแอป (ใช้ <audio> ตัวเดียว — iOS จะอนุญาตให้เล่นต่อเนื่องในคิวได้)
 *
 * เพลง:  audio → [ต้นฉบับ | ตัดเสียงร้อง (L−R + เบสเดิม)] → [ปรับคีย์] → musicBus → volume → ลำโพง
 * ไมค์:   mic → gain → [Auto-Tune] → dry + reverb + echo → vocalBus (อัดเสียง)
 *        ได้ยินเสียงตัวเอง: [dry ถ้าโหมด full] + reverb + echo → monitor → ลำโพง
 * อัดเสียง: musicBus (ชดเชยดีเลย์) + vocalBus → MediaRecorder
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly el: HTMLAudioElement;
  readonly analyser: AnalyserNode;
  readonly ready: Promise<boolean>;

  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly direct: GainNode;
  private readonly shifted: GainNode;
  private readonly voiceMix: GainNode;
  private readonly musicBus: GainNode;
  private readonly volumeNode: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly echoDelay: DelayNode;
  private readonly echoFeedback: GainNode;
  private readonly fxReturn: GainNode;
  private pitchNode: AudioWorkletNode | null = null;
  private url: string | null = null;
  private voiceLevel = 1;
  private stereo = true;
  private semitones = 0;
  private songKey: MusicKey | null = null;
  private mic: MicChain | null = null;
  private rec: RecSession | null = null;
  private pitchListeners = new Set<(p: PitchInfo) => void>();
  private listeners = new Set<() => void>();

  micSettings: MicSettings = loadMicSettings();
  state: EngineState = { workletsOk: null, micOn: false, micError: null, recording: false };

  constructor() {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;

    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.setAttribute('playsinline', '');
    this.setPreservesPitch(true);

    const gain = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const filter = (type: BiquadFilterType, freq: number) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = 0.707;
      return f;
    };

    const source = ctx.createMediaElementSource(this.el);

    // ทางเสียงต้นฉบับ
    this.dry = gain(1);
    source.connect(this.dry);

    // ทางตัดเสียงร้อง: ซ้าย − ขวา จะหักล้างเสียงที่อยู่ตรงกลาง (ปกติคือเสียงร้อง)
    // แล้วเติมย่านเสียงต่ำ (เบส/กลองกระเดื่อง ที่มักอยู่ตรงกลางเช่นกัน) กลับเข้าไป
    const splitter = ctx.createChannelSplitter(2);
    source.connect(splitter);
    const left = gain(1);
    const right = gain(-1);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    const side = ctx.createGain();
    side.channelCount = 1;
    side.channelCountMode = 'explicit';
    left.connect(side);
    right.connect(side);
    const sideHp = filter('highpass', 120);
    side.connect(sideHp);
    const lp1 = filter('lowpass', 160);
    const lp2 = filter('lowpass', 160);
    source.connect(lp1);
    lp1.connect(lp2);
    this.wet = gain(0);
    sideHp.connect(this.wet);
    lp2.connect(this.wet);

    this.voiceMix = gain(1);
    this.dry.connect(this.voiceMix);
    this.wet.connect(this.voiceMix);

    // ทางปรับคีย์ (เชื่อม worklet ภายหลังเมื่อโหลดเสร็จ)
    this.direct = gain(1);
    this.shifted = gain(0);
    this.voiceMix.connect(this.direct);

    this.musicBus = gain(1);
    this.direct.connect(this.musicBus);
    this.shifted.connect(this.musicBus);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.8;
    this.musicBus.connect(this.analyser);

    this.volumeNode = gain(1);
    this.musicBus.connect(this.volumeNode);
    this.volumeNode.connect(ctx.destination);

    // เอฟเฟกต์ไมค์ที่ใช้ร่วมกัน
    this.fxReturn = gain(1);
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx, 2.2, 3);
    this.convolver.connect(this.fxReturn);
    this.echoDelay = ctx.createDelay(1.5);
    this.echoDelay.delayTime.value = 0.28;
    this.echoFeedback = gain(0.35);
    this.echoDelay.connect(this.echoFeedback);
    this.echoFeedback.connect(this.echoDelay);
    this.echoDelay.connect(this.fxReturn);

    this.ready = this.loadWorklets();
  }

  private async loadWorklets(): Promise<boolean> {
    let ok = false;
    try {
      if (this.ctx.audioWorklet) {
        await this.ctx.audioWorklet.addModule(workletUrl);
        this.pitchNode = new AudioWorkletNode(this.ctx, 'pitch-shift', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
        });
        this.voiceMix.connect(this.pitchNode);
        this.pitchNode.connect(this.shifted);
        ok = true;
      }
    } catch (err) {
      console.warn('AudioWorklet unavailable', err);
    }
    this.setState({ workletsOk: ok });
    if (ok) this.setSemitones(this.semitones);
    return ok;
  }

  // ---------- state ----------
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): EngineState => this.state;

  private setState(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  onPitch(fn: (p: PitchInfo) => void): () => void {
    this.pitchListeners.add(fn);
    return () => this.pitchListeners.delete(fn);
  }

  async unlock(): Promise<void> {
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore */
      }
    }
  }

  // ---------- เพลง ----------
  load(blob: Blob, stereo: boolean | null): void {
    this.el.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.el.src = this.url;
    this.el.load();
    this.stereo = stereo !== false;
    this.applyVoice();
  }

  unload(): void {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  async play(): Promise<void> {
    setAudioSession(this.mic ? 'play-and-record' : 'playback');
    await this.unlock();
    await this.el.play();
  }

  pause(): void {
    this.el.pause();
  }

  seek(t: number): void {
    const d = this.el.duration;
    this.el.currentTime = Math.max(0, Number.isFinite(d) ? Math.min(t, d - 0.05) : t);
  }

  /** เวลาที่ใช้แสดงเนื้อเพลง: ชดเชยดีเลย์ของลำโพง/บลูทูธ และตัวปรับคีย์ */
  get lyricTime(): number {
    const out = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    const pitch = this.semitones !== 0 && this.pitchNode ? 1536 / this.ctx.sampleRate : 0;
    return this.el.currentTime - out - pitch;
  }

  setVolume(v: number): void {
    this.volumeNode.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** 1 = เสียงร้องต้นฉบับเต็ม, 0 = ตัดเสียงร้องออก */
  setVoiceLevel(v: number): void {
    this.voiceLevel = v;
    this.applyVoice();
  }

  private applyVoice(): void {
    const v = this.stereo ? this.voiceLevel : 1;
    const t = this.ctx.currentTime;
    this.dry.gain.setTargetAtTime(v, t, 0.03);
    this.wet.gain.setTargetAtTime(1 - v, t, 0.03);
  }

  setRate(rate: number): void {
    this.setPreservesPitch(true);
    this.el.defaultPlaybackRate = rate;
    this.el.playbackRate = rate;
  }

  private setPreservesPitch(on: boolean): void {
    const el = this.el as HTMLAudioElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
    el.preservesPitch = on;
    el.webkitPreservesPitch = on;
    el.mozPreservesPitch = on;
  }

  /** ปรับคีย์เป็นครึ่งเสียง (−12..+12) */
  setSemitones(n: number): void {
    this.semitones = n;
    if (!this.pitchNode) return;
    const t = this.ctx.currentTime;
    this.pitchNode.parameters.get('semitones')?.setValueAtTime(n, t);
    const on = n !== 0;
    this.direct.gain.setTargetAtTime(on ? 0 : 1, t + (on ? 0.04 : 0), 0.015);
    this.shifted.gain.setTargetAtTime(on ? 1 : 0, t + (on ? 0.04 : 0), 0.015);
    this.applyMicSettings();
  }

  /** คีย์ของเพลงที่กำลังเล่น (ใช้กับสเกล Auto-Tune แบบ "ตามคีย์เพลง") */
  setSongKey(key: MusicKey | null): void {
    this.songKey = key;
    this.applyMicSettings();
  }

  /** สเกลที่ Auto-Tune ใช้จริง ณ ตอนนี้ (null = ทุกโน้ต) */
  effectiveScale(): MusicKey | null {
    const s = this.micSettings;
    if (s.scaleSource === 'manual') return { root: s.scaleRoot, mode: s.scaleMode };
    if (s.scaleSource === 'song' && this.songKey) {
      return { root: (((this.songKey.root + this.semitones) % 12) + 12) % 12, mode: this.songKey.mode };
    }
    return null;
  }

  // ---------- ไมค์ ----------
  get micMeter(): AnalyserNode | null {
    return this.mic?.meter ?? null;
  }

  async enableMic(): Promise<boolean> {
    if (this.mic) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setState({ micError: 'เบราว์เซอร์นี้ไม่รองรับไมโครโฟน (ต้องเปิดผ่าน https)' });
      return false;
    }
    try {
      await this.ready;
      await this.unlock();
      const s = this.micSettings;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: s.echoCancellation,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          // ขอความหน่วงต่ำที่สุดที่อุปกรณ์ทำได้ (Chrome/Android)
          latency: 0,
        } as MediaTrackConstraints,
      });
      setAudioSession('play-and-record');
      const ctx = this.ctx;
      const source = ctx.createMediaStreamSource(stream);
      const input = ctx.createGain();
      const meter = ctx.createAnalyser();
      meter.fftSize = 1024;
      const tunerDry = ctx.createGain();
      const tunerWet = ctx.createGain();
      const post = ctx.createGain();
      const reverbSend = ctx.createGain();
      const echoSend = ctx.createGain();
      const vocalBus = ctx.createGain();
      const monitorDry = ctx.createGain();
      const monitor = ctx.createGain();

      source.connect(input);
      input.connect(meter);
      input.connect(tunerDry);
      tunerDry.connect(post);

      let tuner: AudioWorkletNode | null = null;
      if (this.state.workletsOk) {
        tuner = new AudioWorkletNode(ctx, 'autotune', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: 'explicit',
        });
        tuner.port.onmessage = (e: MessageEvent<PitchInfo>) => {
          this.pitchListeners.forEach((fn) => fn(e.data));
        };
        input.connect(tuner);
        tuner.connect(tunerWet);
        tunerWet.connect(post);
      }

      post.connect(vocalBus);
      post.connect(reverbSend);
      reverbSend.connect(this.convolver);
      post.connect(echoSend);
      echoSend.connect(this.echoDelay);
      this.fxReturn.connect(vocalBus);
      // หูฟัง: เสียงร้อง (เลือกได้) + เอฟเฟกต์
      post.connect(monitorDry);
      monitorDry.connect(monitor);
      this.fxReturn.connect(monitor);
      monitor.connect(ctx.destination);

      this.mic = {
        stream,
        source,
        input,
        tuner,
        tunerWet,
        tunerDry,
        post,
        reverbSend,
        echoSend,
        vocalBus,
        monitorDry,
        monitor,
        meter,
        nodes: [source, input, meter, tunerDry, tunerWet, post, reverbSend, echoSend, vocalBus, monitorDry, monitor, ...(tuner ? [tuner] : [])],
      };
      this.applyMicSettings();
      this.setState({ micOn: true, micError: null });
      return true;
    } catch (err) {
      const name = (err as DOMException)?.name;
      const msg =
        name === 'NotAllowedError'
          ? 'ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน — กดอนุญาตที่แถบที่อยู่ของเบราว์เซอร์'
          : name === 'NotFoundError'
            ? 'ไม่พบไมโครโฟน'
            : 'เปิดไมโครโฟนไม่สำเร็จ';
      this.setState({ micError: msg });
      return false;
    }
  }

  disableMic(): void {
    if (this.rec) this.cancelRecording();
    const mic = this.mic;
    if (!mic) return;
    mic.nodes.forEach((n) => n.disconnect());
    for (const node of [mic.vocalBus, mic.monitor]) {
      try {
        this.fxReturn.disconnect(node);
      } catch {
        /* ignore */
      }
    }
    mic.stream.getTracks().forEach((t) => t.stop());
    this.mic = null;
    setAudioSession('playback');
    this.setState({ micOn: false });
  }

  updateMicSettings(patch: Partial<MicSettings>): void {
    const prevEc = this.micSettings.echoCancellation;
    this.micSettings = { ...this.micSettings, ...patch };
    try {
      localStorage.setItem(MIC_KEY, JSON.stringify(this.micSettings));
    } catch {
      /* ignore */
    }
    if (this.mic && patch.echoCancellation !== undefined && patch.echoCancellation !== prevEc) {
      // ต้องเปิดไมค์ใหม่จึงจะมีผล
      const recording = !!this.rec;
      if (!recording) {
        this.disableMic();
        void this.enableMic();
        return;
      }
    }
    this.applyMicSettings();
    this.listeners.forEach((fn) => fn());
  }

  private applyMicSettings(): void {
    const mic = this.mic;
    if (!mic) return;
    const s = this.micSettings;
    const t = this.ctx.currentTime;
    mic.input.gain.setTargetAtTime(s.gain, t, 0.02);
    mic.monitor.gain.setTargetAtTime(s.monitor ? 1 : 0, t, 0.02);
    mic.monitorDry.gain.setTargetAtTime(s.monitorMode === 'fx' ? 0 : 1, t, 0.02);
    mic.reverbSend.gain.setTargetAtTime(s.reverb * 0.9, t, 0.02);
    mic.echoSend.gain.setTargetAtTime(s.echo * 0.6, t, 0.02);
    const tune = s.autotune && !!mic.tuner;
    mic.tunerWet.gain.setTargetAtTime(tune ? 1 : 0, t, 0.02);
    mic.tunerDry.gain.setTargetAtTime(tune ? 0 : 1, t, 0.02);
    if (mic.tuner) {
      mic.tuner.parameters.get('strength')?.setValueAtTime(tune ? s.strength : 0, t);
      mic.tuner.parameters.get('speed')?.setValueAtTime(robotToSeconds(s.robot), t);
      const scale = this.effectiveScale();
      mic.tuner.port.postMessage({ type: 'scale', allowed: scaleMask(scale?.root ?? null, scale?.mode ?? 'major') });
    }
  }

  // ---------- อัดเสียง ----------
  /** ประมาณความหน่วงไป-กลับ (ลำโพง + ไมค์) เป็นมิลลิวินาที */
  estimateLatencyMs(): number {
    const track = this.mic?.stream.getAudioTracks()[0];
    const inLatency = (track?.getSettings() as MediaTrackSettings & { latency?: number })?.latency ?? 0.02;
    const out = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return Math.round((out + inLatency) * 1000);
  }

  /**
   * ความหน่วงของเสียงที่ได้ยินผ่าน "ได้ยินเสียงตัวเอง" (ไมค์ → ลำโพง/หูฟัง) เป็นมิลลิวินาที
   * null = เบราว์เซอร์ไม่บอกค่าความหน่วง (เช่น Safari บางรุ่น)
   */
  monitorLatencyMs(): number | null {
    const track = this.mic?.stream.getAudioTracks()[0];
    const inLatency = (track?.getSettings() as MediaTrackSettings & { latency?: number })?.latency;
    const out = this.ctx.outputLatency;
    if (typeof inLatency !== 'number' && !(typeof out === 'number' && out > 0)) return null;
    const tune = this.micSettings.autotune && this.mic?.tuner ? 0.01 : 0;
    const quantum = 128 / this.ctx.sampleRate;
    return Math.round(((inLatency ?? 0.02) + (out || 0) + (this.ctx.baseLatency || 0) + tune + quantum) * 1000);
  }

  async startRecording(latencyMs: number, musicLevel = 0.8): Promise<boolean> {
    if (this.rec) return true;
    if (!(await this.enableMic()) || !this.mic) return false;
    if (typeof MediaRecorder === 'undefined') {
      this.setState({ micError: 'เบราว์เซอร์นี้ไม่รองรับการอัดเสียง' });
      return false;
    }
    const ctx = this.ctx;
    const dest = ctx.createMediaStreamDestination();
    const musicDelay = ctx.createDelay(2);
    musicDelay.delayTime.value = Math.max(0, Math.min(1.9, latencyMs / 1000));
    const musicGain = ctx.createGain();
    musicGain.gain.value = musicLevel;
    this.musicBus.connect(musicDelay);
    musicDelay.connect(musicGain);
    musicGain.connect(dest);
    this.mic.vocalBus.connect(dest);

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(dest.stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.start(500);
    this.rec = { recorder, chunks, dest, musicDelay, musicGain, mimeType: recorder.mimeType || mimeType, startedAt: performance.now() };
    this.setState({ recording: true });
    return true;
  }

  setRecordingMusicLevel(v: number): void {
    this.rec?.musicGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  stopRecording(): Promise<Recording | null> {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.recorder.onstop = () => {
        this.teardownRecording(rec);
        const type = rec.mimeType || 'audio/webm';
        resolve({
          blob: new Blob(rec.chunks, { type }),
          mimeType: type,
          duration: (performance.now() - rec.startedAt) / 1000,
        });
      };
      rec.recorder.stop();
    });
  }

  cancelRecording(): void {
    const rec = this.rec;
    if (!rec) return;
    rec.recorder.onstop = null;
    if (rec.recorder.state !== 'inactive') rec.recorder.stop();
    this.teardownRecording(rec);
  }

  private teardownRecording(rec: RecSession): void {
    try {
      this.musicBus.disconnect(rec.musicDelay);
    } catch {
      /* ignore */
    }
    rec.musicDelay.disconnect();
    rec.musicGain.disconnect();
    try {
      this.mic?.vocalBus.disconnect(rec.dest);
    } catch {
      /* ignore */
    }
    if (this.rec === rec) this.rec = null;
    this.setState({ recording: false });
  }
}

let engine: AudioEngine | null = null;

export function getEngine(): AudioEngine {
  if (!engine) engine = new AudioEngine();
  return engine;
}

export function peekEngine(): AudioEngine | null {
  return engine;
}

export function extensionFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}
