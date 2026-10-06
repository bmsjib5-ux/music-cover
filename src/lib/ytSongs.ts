import type { LyricLine, Song } from './types';

/** เพลงจาก YouTube ที่จับคู่เนื้อเพลง (มีเวลา) แล้ว — ใช้แข่งร้องได้ทันที */
export interface YtSong {
  videoId: string;
  title: string;
  channel: string;
  lines: LyricLine[];
  /** วินาที — เลื่อนเนื้อให้ตรงกับวิดีโอ */
  offset: number;
  /** ความยาวเพลงตามฐานข้อมูลเนื้อเพลง (วินาที, 0 = ไม่ทราบ) */
  duration: number;
  /** ที่มาของเนื้อเพลง เช่น "LRCLIB · ชื่อเพลง — ศิลปิน" */
  lyricsFrom: string;
  usedAt: number;
}

const KEY = 'rongloei.ytSongs.v1';
const MAX = 12;

export function recentYtSongs(): YtSong[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as YtSong[];
    return Array.isArray(list) ? list.filter((s) => s && s.videoId && Array.isArray(s.lines)) : [];
  } catch {
    return [];
  }
}

/** จำเพลงไว้ใช้ครั้งหน้า (เพลงเดิมจะถูกแทนที่และย้ายขึ้นบนสุด) */
export function rememberYtSong(song: YtSong): void {
  const list = [{ ...song, usedAt: Date.now() }, ...recentYtSongs().filter((s) => s.videoId !== song.videoId)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function forgetYtSong(videoId: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(recentYtSongs().filter((s) => s.videoId !== videoId)));
  } catch {
    /* ignore */
  }
}

/** แปลงเป็น Song (ไม่มีไฟล์เสียง/ทำนอง/คีย์) เพื่อใช้กับระบบเนื้อเพลงและการให้คะแนนเดิม */
export function ytSongToSong(y: YtSong): Song {
  return {
    id: `yt-${y.videoId}`,
    title: y.title,
    artist: y.channel,
    createdAt: y.usedAt,
    updatedAt: y.usedAt,
    audio: null,
    audioName: '',
    duration: y.duration,
    stereo: null,
    peaks: [],
    key: null,
    melody: null,
    lines: y.lines,
    offset: y.offset,
    youtube: { videoId: y.videoId, channel: y.channel },
  };
}
