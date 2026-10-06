import { newId } from '../id';
import { MAX_PLAYERS } from '../battle';
import { isRoomCode } from './protocol';

/** ข้อมูลห้องที่โฮสต์ประกาศให้คนอื่นเห็นในรายการห้อง */
export interface RoomListing {
  code: string;
  hostName: string;
  /** null = ยังไม่เลือกเพลง */
  songTitle: string | null;
  youtube: boolean;
  /** จำนวนคนในห้อง (รวมผู้ชม) */
  players: number;
  /** กำลังแข่งรอบหนึ่งอยู่ */
  playing: boolean;
  createdAt: number;
}

/**
 * รายการห้องที่เปิดอยู่: ทุกคนที่เปิดหน้าแข่งออนไลน์ฟังช่องกลางช่องเดียว
 * โฮสต์ของห้องสาธารณะประกาศข้อมูลห้องผ่าน presence — ปิดแท็บ/หลุดเน็ตแล้วห้องหายจากรายการเอง
 */
export interface RoomDirectory {
  onRooms(fn: (rooms: RoomListing[]) => void): () => void;
  /** ประกาศห้องของเรา (null = เลิกประกาศ) */
  publish(listing: RoomListing | null): void;
}

export type DirectoryKind = 'supabase' | 'local';

function isListing(x: unknown): x is RoomListing {
  const l = x as RoomListing | null;
  return !!l && typeof l.code === 'string' && isRoomCode(l.code) && typeof l.hostName === 'string' && typeof l.players === 'number';
}

/** ห้องที่รอผู้เล่นและยังไม่เต็มขึ้นก่อน แล้วเรียงห้องใหม่ก่อน */
export function sortListings(rooms: RoomListing[]): RoomListing[] {
  const open = (r: RoomListing) => (!r.playing && r.players < MAX_PLAYERS ? 0 : 1);
  const unique = new Map<string, RoomListing>();
  for (const r of rooms) {
    const prev = unique.get(r.code);
    if (!prev || r.createdAt > prev.createdAt) unique.set(r.code, r);
  }
  return [...unique.values()].sort((a, b) => open(a) - open(b) || b.createdAt - a.createdAt);
}

abstract class BaseDirectory implements RoomDirectory {
  protected listeners = new Set<(rooms: RoomListing[]) => void>();
  protected rooms: RoomListing[] = [];

  onRooms(fn: (rooms: RoomListing[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.rooms);
    return () => this.listeners.delete(fn);
  }

  protected emit(rooms: RoomListing[]): void {
    this.rooms = sortListings(rooms);
    this.listeners.forEach((fn) => fn(this.rooms));
  }

  abstract publish(listing: RoomListing | null): void;
}

class SupabaseDirectory extends BaseDirectory {
  private channel: import('@supabase/supabase-js').RealtimeChannel | null = null;
  private listing: RoomListing | null = null;
  private ready = false;

  async start(): Promise<void> {
    const { getSupabaseClient, subscribeChannel } = await import('./supabaseTransport');
    const client = await getSupabaseClient();
    const channel = client.channel('rongloei-lobby', { config: { presence: { key: newId() } } });
    this.channel = channel;
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const rooms = Object.values(state)
        .map((metas) => metas[metas.length - 1] as unknown)
        .filter(isListing);
      this.emit(rooms);
    });
    await subscribeChannel(channel, 'รายการห้อง');
    this.ready = true;
    if (this.listing) void channel.track(this.listing);
  }

  publish(listing: RoomListing | null): void {
    this.listing = listing;
    if (!this.ready || !this.channel) return;
    if (listing) void this.channel.track(listing);
    else void this.channel.untrack();
  }
}

/** โหมดทดสอบข้ามแท็บ (BroadcastChannel) */
class LocalDirectory extends BaseDirectory {
  private readonly id = newId();
  private readonly bc = new BroadcastChannel('rongloei-lobby');
  private listing: RoomListing | null = null;
  private seen = new Map<string, { listing: RoomListing; at: number }>();

  constructor() {
    super();
    this.bc.onmessage = (e: MessageEvent<{ id: string; listing: RoomListing | null; ask?: boolean }>) => {
      const { id, listing, ask } = e.data;
      if (ask) this.announce();
      if (listing && isListing(listing)) this.seen.set(id, { listing, at: Date.now() });
      else this.seen.delete(id);
      this.refresh();
    };
    window.setInterval(() => {
      this.announce();
      this.refresh();
    }, 1500);
    this.bc.postMessage({ id: this.id, listing: null, ask: true });
  }

  private announce(): void {
    if (this.listing) this.bc.postMessage({ id: this.id, listing: this.listing });
  }

  private refresh(): void {
    const now = Date.now();
    for (const [id, v] of this.seen) if (now - v.at > 5000) this.seen.delete(id);
    const rooms = [...this.seen.values()].map((v) => v.listing);
    if (this.listing) rooms.push(this.listing);
    this.emit(rooms);
  }

  publish(listing: RoomListing | null): void {
    this.listing = listing;
    this.bc.postMessage({ id: this.id, listing });
    this.refresh();
  }
}

const directories = new Map<DirectoryKind, Promise<RoomDirectory>>();

/** รายการห้องใช้ร่วมกันทั้งหน้า (เปิดครั้งเดียว ไม่ปิด — แค่เลิกประกาศห้อง) */
export function getDirectory(kind: DirectoryKind): Promise<RoomDirectory> {
  let p = directories.get(kind);
  if (!p) {
    p =
      kind === 'local'
        ? Promise.resolve(new LocalDirectory())
        : (async () => {
            const d = new SupabaseDirectory();
            await d.start();
            return d;
          })();
    p.catch(() => directories.delete(kind));
    directories.set(kind, p);
  }
  return p;
}
