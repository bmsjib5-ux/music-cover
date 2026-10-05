import { useEffect, useMemo, useState } from 'react';
import { onSongsChanged, songsDb } from '../lib/db';
import { paths } from '../lib/router';
import { syncedCount } from '../lib/lyrics';
import { formatTime } from '../lib/format';
import { newId } from '../lib/id';
import { setPrefs } from '../lib/prefs';
import { toast } from '../lib/toast';
import { emptyTally, tallyScore } from '../lib/battle';
import { localTransportAllowed, supabaseConfigured } from '../lib/online/config';
import {
  ONLINE_MODES,
  colorAt,
  isRoomCode,
  normalizeRoomCode,
  ownerId,
  singersOf,
  sortPeers,
  type PeerInfo,
} from '../lib/online/protocol';
import { useOnlineRoom, type OnlineRoom, type TransportKind } from '../hooks/useOnlineRoom';
import { getDirectory, type RoomListing } from '../lib/online/directory';
import { MAX_PLAYERS } from '../lib/battle';
import type { Song } from '../lib/types';
import { KaraokePlayer, type BattleProps } from '../components/KaraokePlayer';
import { YouTubeKaraoke } from '../components/YouTubeKaraoke';
import { YtSongPicker } from '../components/YtSongPicker';
import { ytSongToSong, type YtSong } from '../lib/ytSongs';
import { BattleResult } from '../components/BattleResult';
import { Icon } from '../components/Icon';

const NAME_KEY = 'rongloei.onlineName.v1';

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

const isReady = (s: Song) => !!s.audio && s.lines.length > 0 && syncedCount(s.lines) > 0;

export function BattleTabs({ active }: { active: 'local' | 'online' }) {
  return (
    <div className="seg battle-tabs">
      <a className={active === 'local' ? 'on' : ''} href={paths.battle()}>
        ⚔️ เครื่องเดียว
      </a>
      <a className={active === 'online' ? 'on' : ''} href={paths.online()}>
        🌐 ออนไลน์ (ข้ามเครื่อง)
      </a>
    </div>
  );
}

export function OnlinePage({ code: initialCode, local }: { code?: string; local?: boolean }) {
  const room = useOnlineRoom();
  const kind: TransportKind = local && localTransportAllowed() ? 'local' : 'supabase';
  const configured = kind === 'local' || supabaseConfigured();

  useEffect(() => {
    if (room.error) toast(room.error, 'error', 5000);
  }, [room.error]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            <Icon name="trophy" size={30} /> แข่งร้องออนไลน์
          </h1>
          <p className="muted">แข่งกับเพื่อนคนละเครื่อง/คนละที่ — โฮสต์แชร์เพลงเข้าห้อง ทุกคนร้องพร้อมกันและเห็นคะแนนกันสดๆ</p>
        </div>
        <BattleTabs active="online" />
      </div>
      {kind === 'local' && <p className="alert">โหมดทดสอบ: เชื่อมต่อข้ามแท็บในเบราว์เซอร์นี้ (ไม่ผ่าน Supabase)</p>}

      {!configured ? (
        <SetupHelp />
      ) : room.phase === 'idle' || room.phase === 'joining' ? (
        <Entry room={room} kind={kind} initialCode={initialCode} />
      ) : room.phase === 'lobby' ? (
        <Lobby room={room} local={kind === 'local'} />
      ) : room.phase === 'results' && room.standings ? (
        <Results room={room} />
      ) : (
        <Playing room={room} />
      )}
    </div>
  );
}

function SetupHelp() {
  return (
    <section className="card">
      <h2>
        <Icon name="settings" /> ต้องตั้งค่า Supabase ก่อน (ครั้งเดียว)
      </h2>
      <p className="muted">ระบบแข่งข้ามเครื่องใช้ Supabase (ฟรี) ส่งข้อมูลแบบเรียลไทม์และเก็บไฟล์เพลงของห้องชั่วคราว</p>
      <ol className="setup-steps">
        <li>
          สร้างโปรเจกต์ฟรีที่ <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">supabase.com</a>
        </li>
        <li>
          เปิด <strong>SQL Editor</strong> วางเนื้อหาไฟล์ <code>supabase/setup.sql</code> ใน repo แล้วกด Run (สร้างที่เก็บไฟล์ <code>battle-songs</code> และสิทธิ์)
        </li>
        <li>
          ไปที่ <strong>Project Settings → API</strong> คัดลอก <em>Project URL</em> และ <em>anon public key</em>
        </li>
        <li>
          ใน Render → service → <strong>Environment</strong> เพิ่ม <code>VITE_SUPABASE_URL</code> และ <code>VITE_SUPABASE_ANON_KEY</code> แล้วกด{' '}
          <strong>Save, rebuild, and deploy</strong>
        </li>
      </ol>
    </section>
  );
}

/** รายการห้องที่เปิดอยู่ (null = กำลังโหลด) */
function useRoomList(kind: TransportKind): { rooms: RoomListing[] | null; error: boolean } {
  const [rooms, setRooms] = useState<RoomListing[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let off: (() => void) | null = null;
    let cancelled = false;
    getDirectory(kind)
      .then((d) => {
        if (cancelled) return;
        off = d.onRooms(setRooms);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      off?.();
    };
  }, [kind]);
  return { rooms, error };
}

function sinceText(at: number): string {
  const min = Math.floor((Date.now() - at) / 60000);
  if (min < 1) return 'เพิ่งเปิด';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  return `${Math.floor(min / 60)} ชม. ที่แล้ว`;
}

function RoomList({ kind, joining, onJoin }: { kind: TransportKind; joining: boolean; onJoin: (code: string) => void }) {
  const { rooms, error } = useRoomList(kind);
  // รีเฟรชข้อความ "กี่นาทีที่แล้ว"
  const [, tick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(h);
  }, []);
  return (
    <section className="card room-list-card">
      <header className="card-head">
        <h2>
          <Icon name="list" /> ห้องที่เปิดอยู่ {rooms && rooms.length > 0 && <span className="count">{rooms.length}</span>}
        </h2>
        {rooms !== null && !error && <span className="live-dot">อัปเดตสด</span>}
      </header>
      {error ? (
        <p className="muted">โหลดรายการห้องไม่สำเร็จ — ยังเข้าห้องด้วยรหัสได้ตามปกติ</p>
      ) : rooms === null ? (
        <p className="muted">กำลังโหลดรายการห้อง…</p>
      ) : rooms.length === 0 ? (
        <p className="muted">ยังไม่มีห้องเปิดอยู่ตอนนี้ — สร้างห้องแรกเลย!</p>
      ) : (
        <ul className="room-list">
          {rooms.map((r) => {
            const full = r.players >= MAX_PLAYERS;
            return (
              <li key={r.code}>
                <div className="room-list-code">{r.code}</div>
                <div className="room-list-info">
                  <strong>👑 {r.hostName}</strong>
                  <small className="muted">
                    {r.songTitle ? (
                      <>
                        {r.youtube ? '📺 ' : '🎵 '}
                        {r.songTitle}
                      </>
                    ) : (
                      'ยังไม่เลือกเพลง'
                    )}{' '}
                    · {sinceText(r.createdAt)}
                  </small>
                </div>
                <span className={`peer-status ${r.playing ? 'loading' : full ? '' : 'ready'}`}>
                  {r.playing ? 'กำลังแข่ง' : full ? 'ผู้ร้องเต็ม' : 'รอผู้เล่น'} · {r.players}/{MAX_PLAYERS}
                </span>
                <button type="button" className="btn btn-sm btn-primary" disabled={joining} onClick={() => onJoin(r.code)}>
                  {full || r.playing ? 'เข้าชม' : 'เข้าร่วม'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Entry({ room, kind, initialCode }: { room: OnlineRoom; kind: TransportKind; initialCode?: string }) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState(normalizeRoomCode(initialCode ?? ''));
  const [publicRoom, setPublicRoom] = useState(true);
  const joining = room.phase === 'joining';

  const remember = () => {
    try {
      localStorage.setItem(NAME_KEY, name.trim());
    } catch {
      /* ignore */
    }
  };
  const checkName = () => {
    if (!name.trim()) {
      toast('ใส่ชื่อของคุณก่อน', 'error');
      return false;
    }
    remember();
    return true;
  };

  return (
    <div className="online-entry">
      <section className="card online-name">
        <label className="field">
          <span>ชื่อของคุณ (ใช้ทั้งตอนสร้างห้องและเข้าห้อง)</span>
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="เช่น มด" />
        </label>
      </section>
      <RoomList kind={kind} joining={joining} onJoin={(c) => checkName() && void room.joinRoom(c, name.trim(), kind)} />
      <section className="card">
        <h2>
          <Icon name="plus" /> สร้างห้องใหม่
        </h2>
        <p className="muted">คุณจะเป็นโฮสต์: เลือกเพลงจากคลังของคุณหรือจาก YouTube แล้วส่งลิงก์ห้องให้เพื่อน</p>
        <label className="check">
          <input type="checkbox" checked={publicRoom} onChange={(e) => setPublicRoom(e.target.checked)} />
          แสดงห้องในรายการ ให้ใครก็กดเข้าร่วมได้
        </label>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={joining}
          onClick={() => checkName() && void room.createRoom(name.trim(), kind, publicRoom)}
        >
          <Icon name="trophy" /> {joining ? 'กำลังเชื่อมต่อ…' : 'สร้างห้องแข่ง'}
        </button>
      </section>
      <section className="card">
        <h2>
          <Icon name="users" /> เข้าห้องของเพื่อน
        </h2>
        <label className="field">
          <span>รหัสห้อง 6 ตัว (หรือวางลิงก์)</span>
          <input
            className="code-input"
            value={code}
            onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
            placeholder="ABC234"
            autoCapitalize="characters"
            inputMode="text"
          />
        </label>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          disabled={joining || !isRoomCode(code)}
          onClick={() => checkName() && void room.joinRoom(code, name.trim(), kind)}
        >
          <Icon name="play" /> {joining ? 'กำลังเชื่อมต่อ…' : 'เข้าห้อง'}
        </button>
        <ul className="battle-tips muted small">
          <li>เพลงจะถูกส่งจากเครื่องโฮสต์มาให้อัตโนมัติ ไม่ต้องมีเพลงในเครื่อง</li>
          <li>ใส่หูฟังจะดีที่สุด (ไมค์จะได้ไม่ได้ยินเสียงเพลง/เพื่อน)</li>
        </ul>
      </section>
    </div>
  );
}

function statusLabel(p: PeerInfo): { text: string; cls: string } {
  switch (p.status) {
    case 'loading':
      return { text: `กำลังโหลดเพลง ${p.progress ?? 0}%`, cls: 'loading' };
    case 'loaded':
      return { text: 'โหลดเพลงแล้ว', cls: '' };
    case 'ready':
      return { text: 'พร้อม ✓', cls: 'ready' };
    case 'singing':
      return { text: 'กำลังร้อง 🎤', cls: 'loading' };
    case 'done':
      return { text: 'ร้องจบแล้ว', cls: 'ready' };
    default:
      return { text: 'อยู่ในห้อง', cls: '' };
  }
}

function PeerList({ room }: { room: OnlineRoom }) {
  const sorted = sortPeers(room.peers);
  const singers = new Set(singersOf(room.peers).map((p) => p.id));
  return (
    <ul className="peer-list">
      {sorted.map((p, i) => {
        const st = statusLabel(p);
        return (
          <li key={p.id} className={p.id === room.selfId ? 'me' : ''}>
            <span className="player-dot" style={{ background: singers.has(p.id) ? colorAt(i) : '#777' }} />
            <span className="peer-name">
              {p.host && '👑 '}
              {p.name}
              {p.id === room.selfId && <span className="muted"> (คุณ)</span>}
            </span>
            <span className={`peer-status ${st.cls}`}>{singers.has(p.id) ? st.text : 'ผู้ชม'}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Lobby({ room, local }: { room: OnlineRoom; local: boolean }) {
  const link = `${location.origin}${location.pathname}${paths.online(room.code ?? '')}${local ? '?local' : ''}`;
  const me = room.peers.find((p) => p.id === room.selfId);
  const singers = singersOf(room.peers);
  const notReady = singers.filter((p) => p.status !== 'ready' && p.id !== room.selfId);

  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'มาแข่งร้องเพลงกัน!', text: `เข้าห้องแข่งร้อง รหัส ${room.code}`, url: link });
        return;
      } catch {
        /* ยกเลิก */
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      toast('คัดลอกลิงก์ห้องแล้ว ส่งให้เพื่อนได้เลย', 'success');
    } catch {
      toast(link, 'info', 8000);
    }
  };

  return (
    <div className="lobby-layout">
      <section className="card">
        <div className="room-code-box">
          <div>
            <small className="muted">รหัสห้อง</small>
            <div className="room-code">{room.code}</div>
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void share()}>
              <Icon name="upload" size={16} /> ชวนเพื่อน
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={room.leave}>
              <Icon name="x" size={16} /> ออกจากห้อง
            </button>
          </div>
        </div>
        <p className="muted small">ส่งลิงก์หรือรหัสนี้ให้เพื่อน (ผู้ร้องได้สูงสุด 4 คน คนที่เกินเป็นผู้ชม)</p>
        {room.isHost && (
          <label className="check">
            <input type="checkbox" checked={room.isPublic} onChange={(e) => room.setIsPublic(e.target.checked)} />
            แสดงห้องนี้ในรายการห้องที่เปิดอยู่
          </label>
        )}
        <h2>
          <Icon name="users" /> ในห้อง ({room.peers.length})
        </h2>
        <PeerList room={room} />
        {!room.isHost && !room.hostPresent && <p className="alert">ยังไม่พบโฮสต์ในห้องนี้ — ตรวจสอบรหัสห้อง หรือรอโฮสต์สักครู่</p>}
      </section>

      <section className="card">
        {room.isHost ? (
          <HostPanel room={room} notReady={notReady.map((p) => p.name)} />
        ) : (
          <GuestPanel room={room} ready={me?.status === 'ready'} />
        )}
      </section>
    </div>
  );
}

function SongBox({ room }: { room: OnlineRoom }) {
  if (!room.song) return null;
  return (
    <div className="now-song">
      <Icon name={room.song.youtube ? 'youtube' : 'music'} size={26} />
      <div>
        <strong>{room.song.title}</strong>
        <small className="muted">
          {room.song.youtube ? 'YouTube' : room.song.artist || 'ไม่ระบุศิลปิน'}
          {room.song.duration > 0 && ` · ${formatTime(room.song.duration)}`} · {ONLINE_MODES.find((m) => m.id === room.mode)?.label}
        </small>
      </div>
    </div>
  );
}

function HostPanel({ room, notReady }: { room: OnlineRoom; notReady: string[] }) {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [source, setSource] = useState<'library' | 'youtube'>('library');
  const [ytSong, setYtSong] = useState<YtSong | null>(null);
  const ytAsSong = useMemo(() => (ytSong ? ytSongToSong(ytSong) : null), [ytSong]);
  useEffect(() => {
    const load = () =>
      void songsDb.all().then((all) => {
        const ready = all.filter(isReady);
        setSongs(ready);
        setSelected((cur) => cur ?? ready[0]?.id ?? null);
      });
    load();
    return onSongsChanged(load);
  }, []);
  const chosen = source === 'youtube' ? ytAsSong : (songs?.find((s) => s.id === selected) ?? null);
  const sharedIsChosen =
    !!room.song &&
    !!chosen &&
    (chosen.youtube
      ? room.song.youtube?.videoId === chosen.youtube.videoId && room.song.offset === chosen.offset
      : room.song.title === chosen.title && room.song.duration === chosen.duration);

  return (
    <>
      <h2>
        <Icon name="music" /> เลือกเพลงแข่ง
      </h2>
      <div className="tabs">
        <button type="button" className={source === 'library' ? 'on' : ''} onClick={() => setSource('library')}>
          <Icon name="music" size={18} /> คลังเพลง
        </button>
        <button type="button" className={source === 'youtube' ? 'on' : ''} onClick={() => setSource('youtube')}>
          <Icon name="youtube" size={18} /> YouTube
        </button>
      </div>
      {source === 'youtube' ? (
        <YtSongPicker value={ytSong} onChange={setYtSong} />
      ) : songs === null ? (
        <p className="muted">กำลังโหลด…</p>
      ) : songs.length === 0 ? (
        <p className="muted">
          ยังไม่มีเพลงที่ซิงก์เนื้อแล้ว — <a href={paths.newSong()}>เพิ่มเพลง</a>
        </p>
      ) : (
        <ul className="battle-songs">
          {songs.map((s) => (
            <li key={s.id}>
              <label className={`battle-song ${selected === s.id ? 'on' : ''}`}>
                <input type="radio" name="online-song" checked={selected === s.id} onChange={() => setSelected(s.id)} />
                <span className="battle-song-icon">
                  <Icon name="music" size={18} />
                </span>
                <span className="battle-song-info">
                  <strong>{s.title}</strong>
                  <small className="muted">
                    {s.artist || 'ไม่ระบุศิลปิน'} · {formatTime(s.duration)}
                  </small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="battle-modes" style={{ margin: '10px 0' }}>
        {ONLINE_MODES.map((m) => (
          <label key={m.id} className={`battle-mode ${room.mode === m.id ? 'on' : ''}`}>
            <input type="radio" name="online-mode" checked={room.mode === m.id} onChange={() => room.setMode(m.id)} />
            <strong>{m.label}</strong>
            <small className="muted">{m.hint}</small>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={!chosen || !!room.busy}
        onClick={() => chosen && void room.shareSong(chosen, room.mode)}
      >
        <Icon name="upload" size={18} /> {room.busy ?? (sharedIsChosen ? 'แชร์เพลงนี้ใหม่' : 'แชร์เพลงนี้เข้าห้อง')}
      </button>
      <div style={{ marginTop: 14 }}>
        <SongBox room={room} />
        {room.song && notReady.length > 0 && <p className="muted small">รอ: {notReady.join(', ')} กดพร้อม</p>}
        <button
          type="button"
          className="btn btn-primary btn-lg battle-start"
          disabled={!room.song || !room.localSong || notReady.length > 0}
          onClick={() => {
            if (!room.song?.youtube) setPrefs({ voice: 0 });
            room.startRound();
          }}
        >
          <Icon name="trophy" /> เริ่มแข่ง!
        </button>
      </div>
    </>
  );
}

function GuestPanel({ room, ready }: { room: OnlineRoom; ready: boolean }) {
  const saveToLibrary = async () => {
    if (!room.localSong) return;
    await songsDb.put({ ...room.localSong, id: newId(), audioName: `${room.localSong.title}.audio`, createdAt: Date.now(), updatedAt: Date.now() });
    toast('บันทึกเพลงนี้ลงคลังของคุณแล้ว', 'success');
  };
  return (
    <>
      <h2>
        <Icon name="music" /> เพลงที่จะแข่ง
      </h2>
      {!room.song ? (
        <p className="muted">รอโฮสต์เลือกเพลง…</p>
      ) : (
        <>
          <SongBox room={room} />
          {room.download !== null && (
            <>
              <p className="muted small">กำลังโหลดเพลงจากโฮสต์… {Math.round(room.download * 100)}%</p>
              <div className="progress">
                <span style={{ width: `${Math.round(room.download * 100)}%` }} />
              </div>
            </>
          )}
          {room.localSong && (
            <>
              <button
                type="button"
                className="btn btn-primary btn-lg battle-start"
                disabled={ready}
                onClick={() => {
                  if (!room.song?.youtube) setPrefs({ voice: 0 });
                  void room.ready();
                }}
              >
                {ready ? '✓ พร้อมแล้ว — รอโฮสต์เริ่ม' : '🎤 พร้อมแข่ง!'}
              </button>
              {room.localSong.youtube ? (
                <p className="muted small" style={{ marginTop: 8 }}>
                  เพลงจาก YouTube ตัดเสียงร้องไม่ได้ — ใส่หูฟังเพื่อไม่ให้ไมค์ได้ยินเสียงในวิดีโอ
                </p>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => void saveToLibrary()}>
                  <Icon name="download" size={16} /> บันทึกเพลงนี้ลงคลังของฉัน
                </button>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function battlePropsFor(room: OnlineRoom): BattleProps {
  const { mode, order, selfId, tallies } = room;
  const myIndex = Math.max(0, order.indexOf(selfId));
  return {
      label: `${ONLINE_MODES.find((m) => m.id === mode)?.label ?? ''} · ออนไลน์`,
      decorate:
        mode === 'together'
          ? () => ({ color: colorAt(myIndex), tag: '' })
          : (i) => {
              const o = ownerId(mode, order, i);
              if (!o) return null;
              return { color: colorAt(order.indexOf(o)), tag: o === selfId ? `${room.nameOf(o)} (คุณ)` : room.nameOf(o) };
            },
      ownerName: mode === 'together' ? undefined : (i) => room.nameOf(ownerId(mode, order, i) ?? ''),
      scoreboard: order.map((id, i) => ({
        name: id === selfId ? `${room.nameOf(id)} (คุณ)` : room.nameOf(id),
        color: colorAt(i),
        score: tallyScore(tallies[id] ?? emptyTally()),
      })),
      onLine: room.onLine,
      onFinish: room.onFinish,
      feedbackFor: room.isMine,
      lockTempo: true,
  };
}

function LiveBoard({ room }: { room: OnlineRoom }) {
  return (
    <div className="mini-board">
      {room.order.map((id, i) => (
        <span key={id} style={{ borderColor: colorAt(i) }}>
          {room.nameOf(id)} <strong>{tallyScore(room.tallies[id] ?? emptyTally()) ?? '–'}</strong>
          {id in room.finals ? ' ✓' : ''}
        </span>
      ))}
    </div>
  );
}

function Playing({ room }: { room: OnlineRoom }) {
  const battle = battlePropsFor(room);
  const waitingFor = room.order.filter((id) => !(id in room.finals)).length;
  return (
    <>
      {room.spectating ? (
        <section className="card spectator-board">
          <h2 style={{ justifyContent: 'center' }}>
            <Icon name="users" /> กำลังแข่ง — คุณเป็นผู้ชมรอบนี้
          </h2>
          <LiveBoard room={room} />
          <p className="muted small">รอบหน้ากดพร้อมให้ทันก่อนโฮสต์เริ่ม เพื่อร่วมแข่ง</p>
        </section>
      ) : (
        <>
          {room.phase === 'waiting' && (
            <div className="waiting-banner">
              <Icon name="clock" />
              <div>
                <strong>ร้องจบแล้ว!</strong> รอผลของเพื่อนอีก {waitingFor} คน…
                <LiveBoard room={room} />
              </div>
            </div>
          )}
          {room.localSong &&
            (room.localSong.youtube ? (
              <YouTubeKaraoke key={`online-${room.round}`} song={room.localSong} autoPlay={false} startAt={room.startAt} battle={battle} />
            ) : (
              <KaraokePlayer key={`online-${room.round}`} song={room.localSong} startAt={room.startAt} battle={battle} />
            ))}
        </>
      )}
      <div className="row" style={{ justifyContent: 'center' }}>
        {room.isHost && (
          <button type="button" className="btn btn-ghost" onClick={room.abortRound}>
            <Icon name="x" size={18} /> ยกเลิกรอบนี้
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={room.leave}>
          ออกจากห้อง
        </button>
      </div>
    </>
  );
}

function Results({ room }: { room: OnlineRoom }) {
  return (
    <BattleResult standings={room.standings!} title={room.song?.title ?? ''}>
      {room.isHost ? (
        <>
          <button type="button" className="btn btn-primary" onClick={room.startRound}>
            <Icon name="restart" size={18} /> แข่งอีกรอบ
          </button>
          <button type="button" className="btn btn-ghost" onClick={room.backToLobby}>
            <Icon name="music" size={18} /> เลือกเพลงใหม่
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-ghost" onClick={room.backToLobby}>
          <Icon name="back" size={18} /> กลับห้องรอ
        </button>
      )}
      <button type="button" className="btn btn-ghost" onClick={room.leave}>
        ออกจากห้อง
      </button>
    </BattleResult>
  );
}
