export interface YouTubeVideo {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
}

/** รองรับลิงก์ youtu.be, watch?v=, shorts, embed, live, music.youtube และรหัส 11 ตัว */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    const host = url.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1, 12);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(url.pathname);
      if (m) return m[1];
    }
  } catch {
    /* not a url */
  }
  return null;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined;
}

export async function fetchVideoInfo(videoId: string): Promise<YouTubeVideo | null> {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
    const res = await fetch(url, { signal: timeoutSignal(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { title: string; author_name: string };
    return { videoId, title: data.title, channel: data.author_name, thumbnail: thumbnailUrl(videoId) };
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  if (typeof document === 'undefined') {
    return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value;
}

/**
 * key ที่ฝังไว้ตอน build (ตั้งค่า VITE_YT_API_KEY บน Render) ให้ทุกคนค้นหาได้ทันที
 * key นี้จะมองเห็นได้ในไฟล์ JS ของเว็บ — ต้องจำกัดโดเมนใน Google Cloud Console เสมอ
 */
export const BUILTIN_YT_KEY: string = (import.meta.env.VITE_YT_API_KEY ?? '').trim();

export class YouTubeApiError extends Error {
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = 'YouTubeApiError';
    this.reason = reason;
  }
  get quotaExceeded(): boolean {
    return /quota|dailyLimit|rateLimit/i.test(this.reason);
  }
}

// จำผลค้นหาไว้ 1 วัน — ค้นคำเดิมซ้ำไม่กินโควตา (การค้นหา 1 ครั้ง = 100 จาก 10,000 หน่วยต่อวัน)
const CACHE_KEY = 'rongloei.ytSearchCache.v1';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_MAX = 80;
type SearchCache = Record<string, { at: number; items: YouTubeVideo[] }>;

function readCache(): SearchCache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as SearchCache;
  } catch {
    return {};
  }
}

function writeCache(cache: SearchCache): void {
  const now = Date.now();
  const fresh = Object.entries(cache)
    .filter(([, v]) => now - v.at < CACHE_TTL)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, CACHE_MAX);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(fresh)));
  } catch {
    /* ignore */
  }
}

/** ค้นหาผ่าน YouTube Data API v3 */
export async function searchYouTube(query: string, apiKey: string, karaokeOnly: boolean): Promise<YouTubeVideo[]> {
  const q = karaokeOnly ? `${query} คาราโอเกะ` : query;
  const cacheKey = q.trim().toLowerCase();
  const cache = readCache();
  const hit = cache[cacheKey];
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.items;

  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: '15',
    regionCode: 'TH',
    relevanceLanguage: 'th',
    q,
    key: apiKey,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as {
      error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] };
    } | null;
    const reason = err?.error?.errors?.[0]?.reason ?? err?.error?.details?.[0]?.reason ?? '';
    throw new YouTubeApiError(err?.error?.message ?? `YouTube API ${res.status}`, reason);
  }
  const data = (await res.json()) as {
    items: { id: { videoId: string }; snippet: { title: string; channelTitle: string; thumbnails: { medium?: { url: string } } } }[];
  };
  const items = data.items.map((it) => ({
    videoId: it.id.videoId,
    title: decodeEntities(it.snippet.title),
    channel: decodeEntities(it.snippet.channelTitle),
    thumbnail: it.snippet.thumbnails.medium?.url ?? thumbnailUrl(it.id.videoId),
  }));
  cache[cacheKey] = { at: Date.now(), items };
  writeCache(cache);
  return items;
}

export function youtubeSearchUrl(query: string, karaokeOnly: boolean): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(karaokeOnly ? `${query} คาราโอเกะ` : query)}`;
}

// ---------- IFrame API ----------
interface YTPlayerEvent {
  data: number;
  target: YTPlayer;
}
export interface YTPlayer {
  loadVideoById(id: string): void;
  cueVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(r: number): void;
  getAvailablePlaybackRates(): number[];
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: YTPlayerEvent) => void;
        onStateChange?: (e: YTPlayerEvent) => void;
        onError?: (e: YTPlayerEvent) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        if (window.YT) resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => {
        apiPromise = null;
        reject(new Error('โหลด YouTube ไม่สำเร็จ'));
      };
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

export function youtubeErrorMessage(code: number): string {
  if (code === 101 || code === 150) return 'เจ้าของวิดีโอไม่อนุญาตให้เล่นนอก YouTube';
  if (code === 100) return 'ไม่พบวิดีโอ (อาจถูกลบหรือเป็นส่วนตัว)';
  if (code === 2) return 'ลิงก์วิดีโอไม่ถูกต้อง';
  return 'เล่นวิดีโอไม่ได้';
}

// ---------- เดาชื่อเพลง/ศิลปินจากชื่อวิดีโอ ----------
const NOISE = [
  /\b(?:official|music|lyrics?|lyric video|mv|m\/v|audio|video|visualizer|hd|hq|4k|karaoke|instrumental)\b/gi,
  /(?:คาราโอเกะ|เนื้อเพลง|มิวสิควิดีโอ|ซับไทย|ไม่มีเสียงร้อง)/g,
];

function stripNoise(s: string): string {
  let out = s;
  for (const re of NOISE) out = out.replace(re, ' ');
  return out
    .replace(/[|/\\]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:|·]+|[\s\-–—:|·]+$/g, '')
    .trim();
}

/** ทำชื่อวิดีโอให้สะอาด เช่น "ศิลปิน - เพลง [Official MV] (คาราโอเกะ)" → "ศิลปิน - เพลง" */
export function cleanVideoTitle(videoTitle: string): string {
  const parts = videoTitle
    // ตัดส่วนในวงเล็บทุกแบบ เช่น [Official MV] (Karaoke) 【MV】 「...」
    .replace(/[\[(【「『{][^\])】」』}]*[\])】」』}]/g, ' ')
    .replace(/\s(?:feat\.?|ft\.)\s[^-–—|｜]*/gi, ' ')
    .replace(/#\S+/g, ' ')
    .split(/\s[-–—|:]\s|\s?[|｜]\s?|\s[-–—]|[-–—]\s/)
    .map(stripNoise)
    .filter(Boolean);
  return parts.length ? parts.join(' - ') : stripNoise(videoTitle) || videoTitle.trim();
}

/** คำค้นเนื้อเพลงจากชื่อวิดีโอ (LRCLIB ค้นทั้งชื่อเพลงและศิลปิน ลำดับคำไม่สำคัญ) */
export function lyricsQueryFromTitle(videoTitle: string): string {
  return cleanVideoTitle(videoTitle).replace(/\s-\s/g, ' ');
}
