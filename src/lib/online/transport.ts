import type { PeerInfo, RoomMessage } from './protocol';

export interface UploadedAudio {
  url: string;
  path: string;
}

/** ชั้นสื่อสารของห้องแข่ง — ใช้ Supabase จริง หรือ BroadcastChannel สำหรับทดสอบในเครื่อง */
export interface RoomTransport {
  readonly kind: 'supabase' | 'local';
  readonly selfId: string;
  join(code: string, me: PeerInfo): Promise<void>;
  send(msg: RoomMessage): void;
  onMessage(fn: (msg: RoomMessage, from: string) => void): () => void;
  onPeers(fn: (peers: PeerInfo[]) => void): () => void;
  updateMe(patch: Partial<PeerInfo>): void;
  uploadAudio(code: string, blob: Blob, fileName: string): Promise<UploadedAudio>;
  deleteAudio(path: string): Promise<void>;
  downloadAudio(url: string, onProgress?: (p: number) => void): Promise<Blob>;
  leave(): void;
}

/** ดาวน์โหลดพร้อมรายงานความคืบหน้า */
export async function fetchWithProgress(url: string, onProgress?: (p: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`ดาวน์โหลดเพลงไม่สำเร็จ (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    received += value.length;
    if (total) onProgress?.(received / total);
  }
  onProgress?.(1);
  return new Blob(chunks, { type: res.headers.get('content-type') ?? 'audio/mpeg' });
}

export function guessAudioType(blob: Blob, fileName: string): string {
  if (blob.type) return blob.type;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    webm: 'audio/webm',
    flac: 'audio/flac',
  };
  return map[ext] ?? 'audio/mpeg';
}
