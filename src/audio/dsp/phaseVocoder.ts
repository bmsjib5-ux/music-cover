import { FFT } from './fft';

const TWO_PI = Math.PI * 2;

/**
 * ตัวเปลี่ยนคีย์ (pitch shift) แบบ phase vocoder สำหรับเพลงที่มีหลายเสียงพร้อมกัน
 * เปลี่ยนระดับเสียงโดยไม่เปลี่ยนความเร็ว — ประมวลผลทีละช่องสัญญาณ (channel)
 *
 * ใช้เทคนิคของ Laroche & Dolson: หา peak ในสเปกตรัม แล้วย้าย "ทั้งก้อน" ของแต่ละ peak
 * ไปยังความถี่ใหม่ พร้อมล็อกเฟสของ bin รอบข้างกับ peak (identity phase locking)
 * ทำให้เสียงไม่ก้อง/ไม่วูบวาบ และความดังคงที่ ทำงานในหน่วย bin จึงไม่ขึ้นกับ sample rate
 */
export class PhaseVocoderShifter {
  readonly frameSize: number;
  readonly hop: number;
  /** ความหน่วงของตัวประมวลผล (หน่วย sample) */
  readonly latency: number;
  private readonly osamp: number;
  private readonly fft: FFT;
  private readonly win: Float64Array;
  private readonly outScale: number;
  private readonly inFifo: Float32Array;
  private readonly outFifo: Float32Array;
  private readonly outAccum: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly lastPhase: Float64Array;
  private readonly sumPhase: Float64Array;
  private readonly anaMag: Float64Array;
  private readonly anaPhase: Float64Array;
  private readonly anaFreq: Float64Array;
  private readonly synMag: Float64Array;
  private readonly synPhase: Float64Array;
  private readonly written: Uint8Array;
  private readonly peaks: Int32Array;
  private readonly regionStart: Int32Array;
  private rover: number;

  constructor(frameSize = 2048, osamp = 4) {
    this.frameSize = frameSize;
    this.osamp = osamp;
    this.hop = frameSize / osamp;
    this.latency = frameSize - this.hop;
    this.fft = new FFT(frameSize);
    this.win = new Float64Array(frameSize);
    let winSq = 0;
    for (let k = 0; k < frameSize; k++) {
      const w = 0.5 - 0.5 * Math.cos((TWO_PI * k) / frameSize);
      this.win[k] = w;
      winSq += w * w;
    }
    // ชดเชยอัตราขยายจากการซ้อนหน้าต่าง (analysis × synthesis window)
    this.outScale = 1 / (frameSize * (winSq / this.hop));
    const bins = frameSize / 2 + 1;
    this.inFifo = new Float32Array(frameSize);
    this.outFifo = new Float32Array(frameSize);
    this.outAccum = new Float64Array(frameSize * 2);
    this.re = new Float64Array(frameSize);
    this.im = new Float64Array(frameSize);
    this.lastPhase = new Float64Array(bins);
    this.sumPhase = new Float64Array(bins);
    this.anaMag = new Float64Array(bins);
    this.anaPhase = new Float64Array(bins);
    this.anaFreq = new Float64Array(bins);
    this.synMag = new Float64Array(bins);
    this.synPhase = new Float64Array(bins);
    this.written = new Uint8Array(bins);
    this.peaks = new Int32Array(bins);
    this.regionStart = new Int32Array(bins);
    this.rover = this.latency;
  }

  reset(): void {
    this.inFifo.fill(0);
    this.outFifo.fill(0);
    this.outAccum.fill(0);
    this.lastPhase.fill(0);
    this.sumPhase.fill(0);
    this.rover = this.latency;
  }

  /** ratio = 2^(semitones/12) */
  process(input: Float32Array, output: Float32Array, ratio: number): void {
    const n = Math.min(input.length, output.length);
    for (let i = 0; i < n; i++) {
      this.inFifo[this.rover] = input[i];
      output[i] = this.outFifo[this.rover - this.latency];
      this.rover++;
      if (this.rover >= this.frameSize) {
        this.rover = this.latency;
        this.processFrame(ratio);
      }
    }
  }

  private processFrame(ratio: number): void {
    const { frameSize: N, hop, osamp, re, im, win, anaMag, anaPhase, anaFreq, synMag, synPhase } = this;
    const half = N / 2;
    const expct = (TWO_PI * hop) / N;

    for (let k = 0; k < N; k++) {
      re[k] = this.inFifo[k] * win[k];
      im[k] = 0;
    }
    this.fft.transform(re, im, false);

    // วิเคราะห์: ขนาด เฟส และความถี่จริงของแต่ละ bin (หน่วย bin)
    for (let k = 0; k <= half; k++) {
      const r = re[k];
      const m = im[k];
      const phase = Math.atan2(m, r);
      let d = phase - this.lastPhase[k] - k * expct;
      this.lastPhase[k] = phase;
      d -= TWO_PI * Math.round(d / TWO_PI);
      anaMag[k] = Math.sqrt(r * r + m * m);
      anaPhase[k] = phase;
      anaFreq[k] = k + (osamp * d) / TWO_PI;
    }

    // หา peak และขอบเขตของแต่ละ peak (ตัดที่จุดต่ำสุดระหว่าง peak)
    const peaks = this.peaks;
    const regionStart = this.regionStart;
    let np = 0;
    for (let k = 1; k < half; k++) {
      if (anaMag[k] > anaMag[k - 1] && anaMag[k] >= anaMag[k + 1]) peaks[np++] = k;
    }
    regionStart[0] = 0;
    for (let i = 1; i < np; i++) {
      let lo = peaks[i - 1] + 1;
      for (let k = lo + 1; k < peaks[i]; k++) if (anaMag[k] < anaMag[lo]) lo = k;
      regionStart[i] = lo;
    }

    synMag.fill(0);
    this.written.fill(0);
    for (let i = 0; i < np; i++) {
      const p = peaks[i];
      const shift = Math.round(p * ratio) - p;
      const jp = p + shift;
      const prev = jp <= half ? this.sumPhase[jp] : 0;
      const psi = prev + (TWO_PI * anaFreq[p] * ratio) / osamp;
      const end = i + 1 < np ? regionStart[i + 1] : half + 1;
      for (let k = regionStart[i]; k < end; k++) {
        const j = k + shift;
        if (j < 0 || j > half) continue;
        if (anaMag[k] > synMag[j]) {
          synMag[j] = anaMag[k];
          synPhase[j] = psi + anaPhase[k] - anaPhase[p];
          this.written[j] = 1;
        }
      }
    }

    for (let j = 0; j <= half; j++) {
      let ph = this.written[j] ? synPhase[j] : this.sumPhase[j] + (TWO_PI * j) / osamp;
      ph -= TWO_PI * Math.round(ph / TWO_PI);
      this.sumPhase[j] = ph;
      const mag = synMag[j];
      re[j] = mag * Math.cos(ph);
      im[j] = mag * Math.sin(ph);
    }
    // สเปกตรัมสมมาตรของสัญญาณจริง
    for (let j = 1; j < half; j++) {
      re[N - j] = re[j];
      im[N - j] = -im[j];
    }
    this.fft.transform(re, im, true);

    const scale = this.outScale;
    for (let k = 0; k < N; k++) this.outAccum[k] += win[k] * re[k] * scale;
    for (let k = 0; k < hop; k++) this.outFifo[k] = this.outAccum[k];
    this.outAccum.copyWithin(0, hop, hop + N);
    for (let k = 0; k < this.latency; k++) this.inFifo[k] = this.inFifo[k + hop];
  }
}
