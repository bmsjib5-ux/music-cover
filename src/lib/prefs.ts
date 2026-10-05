/** ค่าที่ผู้ใช้ตั้งไว้ต่อเพลง (คีย์/ความเร็ว) และค่ารวม — เก็บใน localStorage */
export interface SongPrefs {
  key: number;
  tempo: number;
}

export interface GlobalPrefs {
  voice: number;
  volume: number;
  lyricMode: 'classic' | 'scroll';
  ytApiKey: string;
  ytKaraokeOnly: boolean;
}

const SONG_KEY = 'rongloei.songPrefs.v1';
const GLOBAL_KEY = 'rongloei.prefs.v1';

const DEFAULT_GLOBAL: GlobalPrefs = { voice: 0, volume: 1, lyricMode: 'classic', ytApiKey: '', ytKaraokeOnly: true };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    /* ignore */
  }
  return fallback;
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function getSongPrefs(songId: string): SongPrefs {
  const all = read<Record<string, SongPrefs>>(SONG_KEY, {});
  const p = all[songId] as Partial<SongPrefs> | undefined;
  return { key: p?.key ?? 0, tempo: p?.tempo ?? 1 };
}

export function setSongPrefs(songId: string, prefs: SongPrefs): void {
  const all = read<Record<string, SongPrefs>>(SONG_KEY, {});
  all[songId] = prefs;
  write(SONG_KEY, all);
}

export function getPrefs(): GlobalPrefs {
  return read(GLOBAL_KEY, DEFAULT_GLOBAL);
}

export function setPrefs(patch: Partial<GlobalPrefs>): GlobalPrefs {
  const next = { ...getPrefs(), ...patch };
  write(GLOBAL_KEY, next);
  return next;
}
