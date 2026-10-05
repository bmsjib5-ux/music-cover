import { decodeBlob } from './wav';
import { analyzeChannels, type AudioInfo } from './analyze';
import { songsDb } from './db';
import { createDemoSong } from './demoSong';

export async function analyzeFile(blob: Blob): Promise<AudioInfo> {
  const buf = await decodeBlob(blob);
  const channels = [buf.getChannelData(0)];
  if (buf.numberOfChannels > 1) channels.push(buf.getChannelData(1));
  return analyzeChannels({ sampleRate: buf.sampleRate, channels });
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
