import type { Melody } from './melody';

export interface LyricLine {
  text: string;
  /** วินาทีนับจากต้นเพลง; null = ยังไม่ได้ซิงก์ */
  start: number | null;
  /** วินาที; null = ให้ระบบคำนวณจากบรรทัดถัดไป */
  end: number | null;
}

export interface MusicKey {
  /** 0 = C … 11 = B */
  root: number;
  mode: 'major' | 'minor';
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  createdAt: number;
  updatedAt: number;
  audio: Blob | null;
  audioName: string;
  duration: number;
  /** false = ไฟล์โมโน (ตัดเสียงร้องไม่ได้), null = ไม่ทราบ */
  stereo: boolean | null;
  /** waveform ย่อ (0..1) สำหรับหน้าซิงก์ */
  peaks: number[];
  key: MusicKey | null;
  /** เส้นทำนองเสียงร้องที่ถอดจากเพลง (ใช้ให้คะแนน) — undefined = ยังไม่ได้ถอด */
  melody?: Melody | null;
  lines: LyricLine[];
  /** วินาที — บวกเข้ากับเวลาเนื้อเพลงตอนเล่น */
  offset: number;
  demo?: boolean;
}

export interface Cover {
  id: string;
  songId: string;
  songTitle: string;
  createdAt: number;
  blob: Blob;
  mimeType: string;
  duration: number;
  keyShift: number;
  autotune: boolean;
}

export type QueueItem =
  | { key: string; kind: 'local'; songId: string; title: string; artist: string }
  | { key: string; kind: 'youtube'; videoId: string; title: string; channel: string };
