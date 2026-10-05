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
  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value;
}

/** ค้นหาผ่าน YouTube Data API v3 (ต้องใช้ API key ของผู้ใช้เอง) */
export async function searchYouTube(query: string, apiKey: string, karaokeOnly: boolean): Promise<YouTubeVideo[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: '15',
    regionCode: 'TH',
    relevanceLanguage: 'th',
    q: karaokeOnly ? `${query} คาราโอเกะ` : query,
    key: apiKey,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(err?.error?.message ?? `YouTube API ${res.status}`);
  }
  const data = (await res.json()) as {
    items: { id: { videoId: string }; snippet: { title: string; channelTitle: string; thumbnails: { medium?: { url: string } } } }[];
  };
  return data.items.map((it) => ({
    videoId: it.id.videoId,
    title: decodeEntities(it.snippet.title),
    channel: decodeEntities(it.snippet.channelTitle),
    thumbnail: it.snippet.thumbnails.medium?.url ?? thumbnailUrl(it.id.videoId),
  }));
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
  playVideo(): void;
  pauseVideo(): void;
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

export const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2 } as const;

export function youtubeErrorMessage(code: number): string {
  if (code === 101 || code === 150) return 'เจ้าของวิดีโอไม่อนุญาตให้เล่นนอก YouTube';
  if (code === 100) return 'ไม่พบวิดีโอ (อาจถูกลบหรือเป็นส่วนตัว)';
  if (code === 2) return 'ลิงก์วิดีโอไม่ถูกต้อง';
  return 'เล่นวิดีโอไม่ได้';
}
