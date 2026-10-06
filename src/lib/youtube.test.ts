import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanVideoTitle, lyricsQueryFromTitle, searchYouTube, YouTubeApiError } from './youtube';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const okBody = {
  items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'คิดถึง &amp; คาราโอเกะ', channelTitle: 'ช่อง &quot;เพลง&quot;', thumbnails: {} } }],
};

describe('searchYouTube', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes results and caches repeated queries', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(okBody), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await searchYouTube('คิดถึง', 'KEY', true);
    expect(first[0]).toMatchObject({ videoId: 'abcdefghijk', title: 'คิดถึง & คาราโอเกะ', channel: 'ช่อง "เพลง"' });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('q')).toBe('คิดถึง คาราโอเกะ');
    expect(url.searchParams.get('key')).toBe('KEY');
    await searchYouTube('คิดถึง', 'KEY', true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await searchYouTube('คิดถึง', 'KEY', false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports quota exhaustion', async () => {
    const body = { error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded' }] } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 403 })));
    const err = await searchYouTube('ลอยกระทง', 'KEY', true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YouTubeApiError);
    expect((err as YouTubeApiError).quotaExceeded).toBe(true);
  });

  it('reports a blocked key without treating it as quota', async () => {
    const body = { error: { code: 403, message: 'Requests from referer are blocked.', details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 403 })));
    const err = (await searchYouTube('x', 'KEY', false).catch((e: unknown) => e)) as YouTubeApiError;
    expect(err.reason).toBe('API_KEY_HTTP_REFERRER_BLOCKED');
    expect(err.quotaExceeded).toBe(false);
  });
});

describe('video title cleanup', () => {
  it('drops bracketed tags and noise words', () => {
    expect(cleanVideoTitle('Bodyslam - ความรักทำให้คนตาบอด [Official MV]')).toBe('Bodyslam - ความรักทำให้คนตาบอด');
    expect(cleanVideoTitle('คิดถึงจัง (คาราโอเกะ) - ศิลปิน')).toBe('คิดถึงจัง - ศิลปิน');
    expect(cleanVideoTitle('คาราโอเกะ ทางของฝุ่น - อะตอม #karaoke')).toBe('ทางของฝุ่น - อะตอม');
    expect(cleanVideoTitle('Numb - Linkin Park (Karaoke Version)')).toBe('Numb - Linkin Park');
  });

  it('keeps words that merely contain "ft"', () => {
    expect(cleanVideoTitle('Taylor Swift - Love Story (Lyrics)')).toBe('Taylor Swift - Love Story');
    expect(cleanVideoTitle('Song ft. Someone - Artist')).toBe('Song - Artist');
  });

  it('builds a lyrics query from all parts', () => {
    expect(lyricsQueryFromTitle('ฤดูที่แตกต่าง | บอย โกสิยพงษ์ 【Official MV】')).toBe('ฤดูที่แตกต่าง บอย โกสิยพงษ์');
  });
});
