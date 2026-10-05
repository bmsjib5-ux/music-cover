import type { LyricLine, MusicKey } from '../types';
import type { Melody } from '../melody';
import { PLAYER_COLORS, MAX_PLAYERS, lineOwner } from '../battle';

/** together = ร้องพร้อมกันทั้งเพลง, lines = สลับท่อน (แต่ละเครื่องนับเฉพาะท่อนของตัวเอง) */
export type OnlineMode = 'together' | 'lines';

export const ONLINE_MODES: { id: OnlineMode; label: string; hint: string }[] = [
  { id: 'together', label: 'ร้องพร้อมกันทั้งเพลง', hint: 'ทุกคนร้องทั้งเพลงบนเครื่องของตัวเอง เหมาะกับเล่นคนละที่ (ใส่หูฟัง)' },
  { id: 'lines', label: 'สลับท่อน', hint: 'ผลัดกันร้องทีละท่อนตามสีของเนื้อเพลง แต่ละเครื่องนับเฉพาะท่อนของตัวเอง' },
];

export type PeerStatus = 'lobby' | 'loading' | 'loaded' | 'ready' | 'singing' | 'done';

export interface PeerInfo {
  id: string;
  name: string;
  host: boolean;
  status: PeerStatus;
  /** 0–100 ระหว่างโหลดเพลง */
  progress?: number;
  joinedAt: number;
}

/** ข้อมูลเพลงที่โฮสต์แชร์เข้าห้อง (ไฟล์เสียงอยู่ใน storage) */
export interface SharedSong {
  shareId: string;
  title: string;
  artist: string;
  duration: number;
  stereo: boolean | null;
  key: MusicKey | null;
  lines: LyricLine[];
  offset: number;
  melody: Melody | null;
  /** ว่าง = เพลงจาก YouTube (ไม่มีไฟล์เสียง) */
  audioUrl: string;
  audioType: string;
  /** เพลงจากวิดีโอ YouTube — ทุกเครื่องเปิดวิดีโอเอง ไม่ต้องอัปโหลด/ดาวน์โหลดไฟล์ */
  youtube?: { videoId: string; channel: string };
}

/** คะแนนรายท่อนแบบย่อสำหรับส่งผ่านเครือข่าย */
export interface NetLine {
  index: number;
  text: string;
  score: number;
  weight: number;
  label: string;
  silent: boolean;
}

export type RoomMessage =
  | { type: 'song'; song: SharedSong; mode: OnlineMode }
  | { type: 'hello' }
  | { type: 'start'; round: number; order: string[]; mode: OnlineMode; countdownMs: number }
  | { type: 'line'; round: number; playerId: string; line: NetLine }
  | { type: 'final'; round: number; playerId: string; lines: NetLine[] }
  | { type: 'abort'; round: number };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

/** รับรหัสที่ผู้ใช้พิมพ์ (ตัวเล็ก/เว้นวรรค/ขีด) หรือวางทั้งลิงก์ก็ได้ */
export function normalizeRoomCode(input: string): string {
  const fromLink = /online\/([A-Za-z0-9]{6})/.exec(input);
  const raw = (fromLink ? fromLink[1] : input).toUpperCase();
  return [...raw].filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, 6);
}

export function isRoomCode(code: string): boolean {
  return code.length === 6 && [...code].every((c) => CODE_ALPHABET.includes(c));
}

/** เรียงผู้เล่นตามลำดับที่เข้าห้อง (เหมือนกันทุกเครื่อง) */
export function sortPeers(peers: PeerInfo[]): PeerInfo[] {
  return [...peers].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
}

/** ผู้ร้อง = 4 คนแรกที่เข้าห้อง คนที่เหลือเป็นผู้ชม */
export function singersOf(peers: PeerInfo[]): PeerInfo[] {
  return sortPeers(peers).slice(0, MAX_PLAYERS);
}

export function colorAt(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

/** เจ้าของท่อน (id ผู้เล่น) — null = ทุกคนร้อง */
export function ownerId(mode: OnlineMode, order: string[], lineIndex: number): string | null {
  if (mode === 'together') return null;
  const i = lineOwner('lines1', lineIndex, order.length);
  return i === null ? null : order[i];
}
