import { decodeBlob } from './wav';
import { analyzeChannels, type AudioInfo } from './analyze';
import { songsDb } from './db';
import { createDemoSong, demoMelody } from './demoSong';
import { extractMelody, type Melody } from './melody';
import type { Song } from './types';

/** วิเคราะห์ไฟล์เพลง + ถอดเส้นทำนองเสียงร้อง (ไฟล์โมโนแยกเสียงร้องไม่ได้ → melody = null) */
export async function analyzeFile(blob: Blob, onProgress?: (p: number) => void): Promise<AudioInfo & { melody: Melody | null }> {
  const buf = await decodeBlob(blob);
  const channels = [buf.getChannelData(0)];
  if (buf.numberOfChannels > 1) channels.push(buf.getChannelData(1));
  const info = analyzeChannels({ sampleRate: buf.sampleRate, channels });
  const melody = info.stereo ? await extractMelody(buf.sampleRate, channels[0], channels[1], onProgress) : null;
  return { ...info, melody };
}

/** คืนเส้นทำนองของเพลง ถ้ายังไม่มีจะถอดจากไฟล์เสียงแล้วบันทึกไว้ */
export async function ensureMelody(song: Song, onProgress?: (p: number) => void): Promise<Melody | null> {
  if (song.melody !== undefined) return song.melody;
  let melody: Melody | null = null;
  if (song.demo) melody = demoMelody();
  else if (song.audio && song.stereo !== false) {
    const buf = await decodeBlob(song.audio);
    if (buf.numberOfChannels > 1) {
      melody = await extractMelody(buf.sampleRate, buf.getChannelData(0), buf.getChannelData(1), onProgress);
    }
  }
  const latest = await songsDb.get(song.id);
  if (latest) await songsDb.put({ ...latest, melody });
  return melody;
}

/** ระยะเวลาจาก metadata (เร็ว ไม่ต้องถอดรหัสทั้งไฟล์) */
export function quickDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    a.preload = 'metadata';
    const done = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    a.src = url;
  });
}

const DEMO_FLAG = 'rongloei.demoSeeded.v1';
let seeding: Promise<boolean> | null = null;

/** สร้างเพลงตัวอย่างครั้งแรกที่เปิดแอป (กันเรียกซ้อนกัน) */
export function seedDemoIfNeeded(): Promise<boolean> {
  if (!seeding) seeding = seed();
  return seeding;
}

async function seed(): Promise<boolean> {
  try {
    if (localStorage.getItem(DEMO_FLAG)) return false;
    localStorage.setItem(DEMO_FLAG, '1');
    const existing = await songsDb.all();
    if (existing.length > 0) return false;
    await songsDb.put(await createDemoSong());
    return true;
  } catch (err) {
    console.warn('seed demo failed', err);
    return false;
  }
}

export async function addDemoSong(): Promise<void> {
  await songsDb.put(await createDemoSong());
}
