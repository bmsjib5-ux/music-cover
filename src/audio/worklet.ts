/**
 * AudioWorklet processors — ไฟล์นี้ถูก bundle แยก (import ด้วย ?worker&url)
 * แล้วโหลดเข้า AudioContext ด้วย audioWorklet.addModule()
 */
import { PhaseVocoderShifter } from './dsp/phaseVocoder';
import { AutoTuner } from './dsp/autotune';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

type Params = Record<string, Float32Array>;

class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'semitones', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' }];
  }

  private shifters: PhaseVocoderShifter[] = [];
  private active = false;

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Params): boolean {
    const input = inputs[0];
    const output = outputs[0];
    const semis = params.semitones[0];
    if (Math.abs(semis) < 0.01 || !input || input.length === 0) {
      if (this.active && Math.abs(semis) < 0.01) {
        for (const s of this.shifters) s.reset();
        this.active = false;
      }
      for (const ch of output) ch.fill(0);
      return true;
    }
    this.active = true;
    const ratio = Math.pow(2, semis / 12);
    for (let c = 0; c < output.length; c++) {
      if (!this.shifters[c]) this.shifters[c] = new PhaseVocoderShifter(2048, 4);
      this.shifters[c].process(input[c] ?? input[0], output[c], ratio);
    }
    return true;
  }
}

class AutoTuneProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'strength', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 0.04, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  private tuner = new AutoTuner(sampleRate);
  private sinceReport = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      const data = e.data as { type: string; allowed?: boolean[] };
      if (data.type === 'scale' && data.allowed) this.tuner.allowed = data.allowed;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Params): boolean {
    const inp = inputs[0]?.[0];
    const out = outputs[0];
    if (!inp) {
      for (const ch of out) ch.fill(0);
      return true;
    }
    this.tuner.strength = params.strength[0];
    this.tuner.retuneSeconds = params.speed[0];
    this.tuner.process(inp, out[0]);
    for (let c = 1; c < out.length; c++) out[c].set(out[0]);
    this.sinceReport += inp.length;
    if (this.sinceReport >= sampleRate * 0.05) {
      this.sinceReport = 0;
      this.port.postMessage({ ...this.tuner.info });
    }
    return true;
  }
}

registerProcessor('pitch-shift', PitchShiftProcessor);
registerProcessor('autotune', AutoTuneProcessor);
