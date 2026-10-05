import { encodeWav } from './wav';
import { analyzeChannels } from './analyze';
import { newId } from './id';
import type { LyricLine, Song } from './types';

/**
 * เพลงตัวอย่างที่สังเคราะห์ขึ้นในเบราว์เซอร์ (เนื้อร้องแต่งใหม่ ไม่ติดลิขสิทธิ์)
 * "เสียงร้อง" เป็นซินธ์ที่วางไว้ตรงกลางพอดี ส่วนเครื่องดนตรีแพนซ้าย/ขวา
 * จึงใช้สาธิตปุ่มตัดเสียงร้องได้ชัดเจน
 */

const SR = 32000;
const BPM = 96;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const E8 = BEAT / 2;
const INTRO_BARS = 2;

const LYRICS = [
  'เปิดไมค์ขึ้นมา ร้องเพลงกันเถอะ',
  'ไม่ต้องเพราะเลิศ ขอแค่สนุก',
  'เสียงดนตรีดัง หัวใจก็ตื่น',
  'ร้องไปด้วยกัน ทุกคนยิ้มได้',
  'ถึงเสียงจะเพี้ยน ไปบ้างก็ช่าง',
  'แค่มีเพื่อนข้างๆ ก็อุ่นใจ',
  'คืนนี้ไม่ต้อง รีบกลับบ้านไป',
  'ร้องเพลงต่ออีก สักเพลงได้ไหม',
];

/** [เริ่ม (เขบ็ตหนึ่งชั้น), ความยาว, โน้ต MIDI] */
type Note = [number, number, number];
const MELODIES: Note[][] = [
  [[0, 2, 64], [2, 1, 67], [3, 1, 69], [4, 2, 67], [6, 2, 64], [8, 2, 62], [10, 1, 64], [11, 3, 67]],
  [[0, 2, 72], [2, 1, 71], [3, 1, 69], [4, 2, 67], [6, 2, 69], [8, 2, 65], [10, 1, 67], [11, 3, 69]],
  [[0, 2, 67], [2, 1, 72], [3, 1, 72], [4, 2, 71], [6, 2, 69], [8, 2, 67], [10, 1, 71], [11, 3, 74]],
  [[0, 2, 76], [2, 1, 74], [3, 1, 72], [4, 2, 69], [6, 2, 72], [8, 2, 69], [10, 1, 67], [11, 4, 65]],
];

const CHORDS: Record<string, { voicing: number[]; bass: number }> = {
  C: { voicing: [60, 64, 67], bass: 36 },
  G: { voicing: [59, 62, 67], bass: 43 },
  Am: { voicing: [57, 60, 64], bass: 45 },
  F: { voicing: [57, 60, 65], bass: 41 },
};
const PROGRESSION = ['C', 'G', 'Am', 'F'];
const TOTAL_BARS = INTRO_BARS + LYRICS.length * 2 + 2;

function chordAt(bar: number): string {
  if (bar < INTRO_BARS) return bar === 0 ? 'Am' : 'F';
  if (bar >= INTRO_BARS + LYRICS.length * 2) return 'C';
  return PROGRESSION[(bar - INTRO_BARS) % 4];
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function demoLines(): LyricLine[] {
  return LYRICS.map((text, k) => {
    const mel = MELODIES[k % MELODIES.length];
    const base = (INTRO_BARS + k * 2) * BAR;
    const last = mel[mel.length - 1];
    return {
      text,
      start: Math.round((base + mel[0][0] * E8) * 100) / 100,
      end: Math.round((base + (last[0] + last[1]) * E8) * 100) / 100,
    };
  });
}

export async function renderDemoAudio(): Promise<AudioBuffer> {
  const duration = TOTAL_BARS * BAR + 2;
  const oc = new OfflineAudioContext(2, Math.ceil(SR * duration), SR);
  const master = oc.createGain();
  master.gain.value = 0.8;
  master.connect(oc.destination);

  const panned = (pan: number) => {
    const p = oc.createStereoPanner();
    p.pan.value = pan;
    p.connect(master);
    return p;
  };
  const left = panned(-0.65);
  const right = panned(0.6);
  const slightR = panned(0.35);
  // เสียงตรงกลาง (โมโน → ซ้ายขวาเท่ากันพอดี)
  const center = oc.createGain();
  center.connect(master);

  const noise = oc.createBuffer(1, SR, SR);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const envelope = (g: GainNode, t: number, attack: number, peak: number, hold: number, release: number) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + Math.max(0, hold));
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + Math.max(0, hold) + release);
  };

  const osc = (type: OscillatorType, freq: number, t: number, stop: number, dest: AudioNode, detune = 0) => {
    const o = oc.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(stop);
    return o;
  };

  const lowpass = (freq: number, dest: AudioNode, q = 0.7) => {
    const f = oc.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  };

  const noiseHit = (t: number, type: BiquadFilterType, freq: number, peak: number, decay: number, dest: AudioNode) => {
    const src = oc.createBufferSource();
    src.buffer = noise;
    const f = oc.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 0.7;
    const g = oc.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  };

  const voice = (t: number, dur: number, midi: number) => {
    const f = mtof(midi);
    const g = oc.createGain();
    envelope(g, t, 0.04, 0.17, dur - 0.14, 0.12);
    g.connect(center);
    const lp = lowpass(2300, g, 1);
    const o1 = osc('sawtooth', f, t, t + dur + 0.1, lp);
    const o2 = osc('triangle', f, t, t + dur + 0.1, lp, 5);
    const lfo = oc.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = oc.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(dur, 0.4));
    lfo.connect(depth);
    depth.connect(o1.frequency);
    depth.connect(o2.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.1);
  };

  for (let bar = 0; bar < TOTAL_BARS; bar++) {
    const t0 = bar * BAR;
    const chord = CHORDS[chordAt(bar)];
    const outro = bar >= INTRO_BARS + LYRICS.length * 2;
    const last = bar === TOTAL_BARS - 1;

    // pad (ซ้าย)
    const padLen = last ? BAR * 1.6 : BAR;
    for (const m of chord.voicing) {
      const g = oc.createGain();
      envelope(g, t0, 0.25, 0.035, padLen - 0.35, 0.45);
      g.connect(left);
      const lp = lowpass(900, g);
      osc('triangle', mtof(m), t0, t0 + padLen + 0.5, lp);
      osc('sawtooth', mtof(m), t0, t0 + padLen + 0.5, lp, -7);
    }

    // arpeggio (ขวา)
    if (!outro) {
      const pattern = [0, 2, 1, 2, 0, 2, 1, 2];
      pattern.forEach((idx, e) => {
        const t = t0 + e * E8;
        const g = oc.createGain();
        envelope(g, t, 0.005, 0.045, 0, 0.22);
        g.connect(right);
        osc('square', mtof(chord.voicing[idx] + 12), t, t + 0.3, lowpass(2600, g));
      });
    }

    // hi-hat
    if (!outro) {
      for (let e = 0; e < 8; e++) noiseHit(t0 + e * E8, 'highpass', 7000, e % 2 ? 0.06 : 0.035, 0.05, slightR);
    }

    // เบส + กลอง (เริ่มหลังอินโทร)
    if (bar >= INTRO_BARS) {
      const steps: [number, number][] = outro ? [[0, 8]] : [[0, 2], [3, 1], [4, 2], [6, 2]];
      for (const [s, l] of steps) {
        const t = t0 + s * E8;
        const g = oc.createGain();
        envelope(g, t, 0.01, 0.3, l * E8 - 0.08, 0.1);
        g.connect(center);
        osc('triangle', mtof(chord.bass), t, t + l * E8 + 0.2, lowpass(500, g));
      }
      const kicks = outro ? (bar === INTRO_BARS + LYRICS.length * 2 ? [0] : []) : [0, 4];
      for (const e of kicks) {
        const t = t0 + e * E8;
        const o = oc.createOscillator();
        o.frequency.setValueAtTime(110, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        const g = oc.createGain();
        g.gain.setValueAtTime(0.8, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        o.connect(g);
        g.connect(center);
        o.start(t);
        o.stop(t + 0.4);
      }
      if (!outro) {
        for (const e of [2, 6]) {
          const t = t0 + e * E8;
          const sn = panned(0.25);
          noiseHit(t, 'bandpass', 1800, 0.3, 0.18, sn);
          const g = oc.createGain();
          g.gain.setValueAtTime(0.15, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
          g.connect(sn);
          osc('triangle', 185, t, t + 0.12, g);
        }
      }
    }
  }

  // ทำนองร้อง
  LYRICS.forEach((_, k) => {
    const base = (INTRO_BARS + k * 2) * BAR;
    for (const [s, l, m] of MELODIES[k % MELODIES.length]) voice(base + s * E8, l * E8 * 0.95, m);
  });

  return oc.startRendering();
}

export async function createDemoSong(): Promise<Song> {
  const buffer = await renderDemoAudio();
  const info = analyzeChannels({
    sampleRate: buffer.sampleRate,
    channels: [buffer.getChannelData(0), buffer.getChannelData(1)],
  });
  const now = Date.now();
  return {
    id: newId(),
    title: 'คืนนี้ร้องเพลงกัน (เพลงตัวอย่าง)',
    artist: 'ร้องเลย',
    createdAt: now,
    updatedAt: now,
    audio: encodeWav(buffer, true),
    audioName: 'demo.wav',
    duration: info.duration,
    stereo: info.stereo,
    peaks: info.peaks,
    key: { root: 0, mode: 'major' },
    lines: demoLines(),
    offset: 0,
    demo: true,
  };
}
