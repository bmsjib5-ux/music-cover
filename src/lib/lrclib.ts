/** ค้นหาเนื้อเพลง (มีเวลาซิงก์) จาก LRCLIB — ฐานข้อมูลเนื้อเพลงฟรี มีเพลงไทยจำนวนหนึ่ง */
export interface LrclibResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export async function searchLrclib(title: string, artist: string, signal?: AbortSignal): Promise<LrclibResult[]> {
  const params = new URLSearchParams();
  if (artist.trim()) {
    params.set('track_name', title.trim());
    params.set('artist_name', artist.trim());
  } else {
    params.set('q', title.trim());
  }
  const res = await fetch(`https://lrclib.net/api/search?${params}`, { signal });
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  let results = (await res.json()) as LrclibResult[];
  // ถ้าค้นแบบแยกชื่อ/ศิลปินแล้วไม่เจอ ลองค้นรวม
  if (results.length === 0 && artist.trim()) {
    const res2 = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${title} ${artist}`.trim() })}`, { signal });
    if (res2.ok) results = (await res2.json()) as LrclibResult[];
  }
  return results
    .filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics))
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics))
    .slice(0, 12);
}
