import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { newId } from '../id';
import { SUPABASE_ANON_KEY, SUPABASE_BUCKET, SUPABASE_URL } from './config';
import { fetchWithProgress, guessAudioType, type RoomTransport, type UploadedAudio } from './transport';
import type { PeerInfo, RoomMessage } from './protocol';

const DAY = 24 * 60 * 60 * 1000;

let clientPromise: Promise<SupabaseClient> | null = null;

/** client เดียวทั้งแอป — ห้องแข่งและรายการห้องใช้ WebSocket เส้นเดียวกัน */
export function getSupabaseClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 20 } },
      }),
    );
    clientPromise.catch(() => (clientPromise = null));
  }
  return clientPromise;
}

/** subscribe channel แล้วรอจนเชื่อมต่อสำเร็จ */
export function subscribeChannel(channel: RealtimeChannel, what: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`เชื่อมต่อ${what}ไม่สำเร็จ (หมดเวลา)`)), 15000);
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(err ?? new Error(`เชื่อมต่อ${what}ไม่สำเร็จ (${status})`));
      }
    });
  });
}

/** ห้องแข่งผ่าน Supabase Realtime (broadcast + presence) และไฟล์เพลงใน Storage */
export class SupabaseTransport implements RoomTransport {
  readonly kind = 'supabase' as const;
  readonly selfId = newId();
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private me: PeerInfo | null = null;
  private msgListeners = new Set<(msg: RoomMessage, from: string) => void>();
  private peerListeners = new Set<(peers: PeerInfo[]) => void>();

  private async getClient(): Promise<SupabaseClient> {
    if (!this.client) this.client = await getSupabaseClient();
    return this.client;
  }

  async join(code: string, me: PeerInfo): Promise<void> {
    const client = await this.getClient();
    this.me = { ...me, id: this.selfId };
    const channel = client.channel(`rongloei-battle-${code}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.selfId } },
    });
    this.channel = channel;
    channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      const p = payload as { from: string; msg: RoomMessage };
      this.msgListeners.forEach((fn) => fn(p.msg, p.from));
    });
    channel.on('presence', { event: 'sync' }, () => this.emitPeers());
    await subscribeChannel(channel, 'ห้อง');
    await channel.track(this.me);
  }

  private emitPeers(): void {
    if (!this.channel) return;
    const state = this.channel.presenceState<PeerInfo>();
    const peers = Object.entries(state)
      .map(([key, metas]) => {
        const meta = metas[metas.length - 1] as unknown as PeerInfo;
        return meta ? { ...meta, id: key } : null;
      })
      .filter((p): p is PeerInfo => !!p);
    this.peerListeners.forEach((fn) => fn(peers));
  }

  send(msg: RoomMessage): void {
    void this.channel?.send({ type: 'broadcast', event: 'msg', payload: { from: this.selfId, msg } });
  }

  onMessage(fn: (msg: RoomMessage, from: string) => void): () => void {
    this.msgListeners.add(fn);
    return () => this.msgListeners.delete(fn);
  }

  onPeers(fn: (peers: PeerInfo[]) => void): () => void {
    this.peerListeners.add(fn);
    return () => this.peerListeners.delete(fn);
  }

  updateMe(patch: Partial<PeerInfo>): void {
    if (!this.me || !this.channel) return;
    this.me = { ...this.me, ...patch, id: this.selfId };
    void this.channel.track(this.me);
  }

  async uploadAudio(code: string, blob: Blob, fileName: string): Promise<UploadedAudio> {
    const client = await this.getClient();
    const type = guessAudioType(blob, fileName);
    const ext = (fileName.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
    const path = `rooms/${code}/${newId()}.${ext}`;
    const { error } = await client.storage.from(SUPABASE_BUCKET).upload(path, blob, { contentType: type, upsert: false, cacheControl: '3600' });
    if (error) throw new Error(`อัปโหลดเพลงไม่สำเร็จ: ${error.message}`);
    void this.cleanupOldRooms(code);
    return { url: client.storage.from(SUPABASE_BUCKET).getPublicUrl(path).data.publicUrl, path };
  }

  async deleteAudio(path: string): Promise<void> {
    const client = await this.getClient();
    await client.storage.from(SUPABASE_BUCKET).remove([path]);
  }

  /** ลบไฟล์เพลงของห้องที่เก่ากว่า 1 วัน (ทำแบบฉวยโอกาสตอนโฮสต์อัปเพลง) */
  private async cleanupOldRooms(currentCode: string): Promise<void> {
    try {
      const client = await this.getClient();
      const bucket = client.storage.from(SUPABASE_BUCKET);
      const { data: rooms } = await bucket.list('rooms', { limit: 100 });
      for (const room of rooms ?? []) {
        if (room.name === currentCode) continue;
        const { data: files } = await bucket.list(`rooms/${room.name}`, { limit: 50 });
        const old = (files ?? []).filter((f) => f.created_at && Date.now() - new Date(f.created_at).getTime() > DAY);
        if (old.length) await bucket.remove(old.map((f) => `rooms/${room.name}/${f.name}`));
      }
    } catch {
      /* ไม่สำคัญ */
    }
  }

  downloadAudio(url: string, onProgress?: (p: number) => void): Promise<Blob> {
    return fetchWithProgress(url, onProgress);
  }

  leave(): void {
    if (this.channel) {
      void this.channel.untrack();
      void this.client?.removeChannel(this.channel);
    }
    this.channel = null;
  }
}
