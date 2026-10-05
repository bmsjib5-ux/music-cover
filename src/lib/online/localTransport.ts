import { newId } from '../id';
import type { RoomTransport, UploadedAudio } from './transport';
import type { PeerInfo, RoomMessage } from './protocol';

type Packet =
  | { kind: 'msg'; from: string; msg: RoomMessage }
  | { kind: 'presence'; peer: PeerInfo; reply?: boolean }
  | { kind: 'leave'; id: string }
  | { kind: 'blob-req'; from: string; url: string }
  | { kind: 'blob-res'; to: string; url: string; blob: Blob | null };

const HEARTBEAT = 1500;
const TIMEOUT = 5000;
/** ไฟล์ที่ "อัปโหลด" ในโหมดทดสอบ เก็บไว้ในแท็บของโฮสต์ */
const blobs = new Map<string, Blob>();

/**
 * ห้องแข่งจำลองข้ามแท็บในเบราว์เซอร์เดียว (BroadcastChannel) — ใช้ทดสอบระบบแข่งออนไลน์โดยไม่ต้องมี Supabase
 * พฤติกรรมเหมือน Supabase: broadcast ไม่ส่งกลับหาตัวเอง และมี presence
 */
export class LocalTransport implements RoomTransport {
  readonly kind = 'local' as const;
  readonly selfId = newId();
  private bc: BroadcastChannel | null = null;
  private me: PeerInfo | null = null;
  private peers = new Map<string, { peer: PeerInfo; seen: number }>();
  private timer = 0;
  private msgListeners = new Set<(msg: RoomMessage, from: string) => void>();
  private peerListeners = new Set<(peers: PeerInfo[]) => void>();
  private pending = new Map<string, (b: Blob | null) => void>();

  async join(code: string, me: PeerInfo): Promise<void> {
    this.me = { ...me, id: this.selfId };
    this.bc = new BroadcastChannel(`rongloei-battle-${code}`);
    this.bc.onmessage = (e: MessageEvent<Packet>) => this.handle(e.data);
    this.peers.set(this.selfId, { peer: this.me, seen: Date.now() });
    this.post({ kind: 'presence', peer: this.me });
    this.timer = window.setInterval(() => {
      if (this.me) this.post({ kind: 'presence', peer: this.me });
      const now = Date.now();
      let changed = false;
      for (const [id, p] of this.peers) {
        if (id !== this.selfId && now - p.seen > TIMEOUT) {
          this.peers.delete(id);
          changed = true;
        }
      }
      if (changed) this.emitPeers();
    }, HEARTBEAT);
    this.emitPeers();
  }

  private post(p: Packet): void {
    this.bc?.postMessage(p);
  }

  private handle(p: Packet): void {
    switch (p.kind) {
      case 'msg':
        this.msgListeners.forEach((fn) => fn(p.msg, p.from));
        break;
      case 'presence': {
        const isNew = !this.peers.has(p.peer.id);
        this.peers.set(p.peer.id, { peer: p.peer, seen: Date.now() });
        this.emitPeers();
        if (isNew && !p.reply && this.me) this.post({ kind: 'presence', peer: this.me, reply: true });
        break;
      }
      case 'leave':
        this.peers.delete(p.id);
        this.emitPeers();
        break;
      case 'blob-req': {
        const blob = blobs.get(p.url);
        if (blob) this.post({ kind: 'blob-res', to: p.from, url: p.url, blob });
        break;
      }
      case 'blob-res':
        if (p.to === this.selfId) {
          this.pending.get(p.url)?.(p.blob);
          this.pending.delete(p.url);
        }
        break;
    }
  }

  private emitPeers(): void {
    const list = [...this.peers.values()].map((p) => p.peer);
    this.peerListeners.forEach((fn) => fn(list));
  }

  send(msg: RoomMessage): void {
    this.post({ kind: 'msg', from: this.selfId, msg });
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
    if (!this.me) return;
    this.me = { ...this.me, ...patch, id: this.selfId };
    this.peers.set(this.selfId, { peer: this.me, seen: Date.now() });
    this.post({ kind: 'presence', peer: this.me });
    this.emitPeers();
  }

  async uploadAudio(code: string, blob: Blob): Promise<UploadedAudio> {
    const url = `local://${code}/${newId()}`;
    blobs.set(url, blob);
    return { url, path: url };
  }

  async deleteAudio(path: string): Promise<void> {
    blobs.delete(path);
  }

  downloadAudio(url: string, onProgress?: (p: number) => void): Promise<Blob> {
    const own = blobs.get(url);
    if (own) return Promise.resolve(own);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ดาวน์โหลดเพลงไม่สำเร็จ')), 15000);
      this.pending.set(url, (b) => {
        clearTimeout(t);
        onProgress?.(1);
        if (b) resolve(b);
        else reject(new Error('ไม่พบไฟล์เพลง'));
      });
      this.post({ kind: 'blob-req', from: this.selfId, url });
    });
  }

  leave(): void {
    window.clearInterval(this.timer);
    this.post({ kind: 'leave', id: this.selfId });
    this.bc?.close();
    this.bc = null;
  }
}
