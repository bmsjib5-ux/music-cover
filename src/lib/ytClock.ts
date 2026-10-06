import { YT_STATE, type YTPlayer } from './youtube';
import type { ScoreClock } from '../hooks/useScoring';

/**
 * นาฬิกาของวิดีโอ YouTube: getCurrentTime() อัปเดตเป็นช่วงๆ จึงประมาณเวลาระหว่างช่วงจาก performance.now()
 * ให้เนื้อเพลงไหลลื่น และแจ้ง play/seeked ให้ระบบให้คะแนน
 */
export class YtClock implements ScoreClock {
  player: YTPlayer | null = null;
  state: number = YT_STATE.UNSTARTED;
  /** ความเร็ววิดีโอ (ใช้ประมาณเวลาระหว่างช่วงที่ YouTube ยังไม่อัปเดต) */
  rate = 1;
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
    const predicted = this.anchorMedia + ((now - this.anchorPerf) / 1000) * this.rate;
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

  /** เปลี่ยนความเร็ว: ยึดเวลาปัจจุบันก่อน แล้วประมาณต่อด้วยความเร็วใหม่ */
  setRate(rate: number): void {
    const t = this.time();
    this.anchorMedia = t;
    this.anchorPerf = performance.now();
    this.rate = rate;
  }

  paused(): boolean {
    return this.state !== YT_STATE.PLAYING;
  }

  on(event: 'play' | 'seeked', fn: () => void): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }
}
