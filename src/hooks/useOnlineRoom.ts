import { useCallback, useEffect, useRef, useState } from 'react';
import { getEngine } from '../audio/engine';
import { ensureMelody } from '../lib/songs';
import { newId } from '../lib/id';
import { addLine, emptyTally, rankPlayers, recordBattle, type Player, type Standing, type Tally } from '../lib/battle';
import type { LineScore } from '../lib/scoring';
import type { Song } from '../lib/types';
import type { FinalScore } from './useScoring';
import type { RoomTransport } from '../lib/online/transport';
import {
  colorAt,
  makeRoomCode,
  ownerId,
  singersOf,
  type NetLine,
  type OnlineMode,
  type PeerInfo,
  type PeerStatus,
  type RoomMessage,
  type SharedSong,
} from '../lib/online/protocol';

export type RoomPhase = 'idle' | 'joining' | 'lobby' | 'playing' | 'waiting' | 'results';
export type TransportKind = 'supabase' | 'local';

const COUNTDOWN_MS = 5000;
const WAIT_TIMEOUT_MS = 30000;
/** ข้อความ realtime มีขนาดจำกัด — ถ้าใหญ่เกิน ไม่ส่งเส้นทำนอง (ให้แต่ละเครื่องถอดเอง) */
const MAX_SONG_PAYLOAD = 100_000;

function toNet(l: LineScore): NetLine {
  return { index: l.index, text: l.text, score: l.score, weight: l.weight, label: l.label, silent: l.silent };
}

function fromNet(l: NetLine): LineScore {
  return { ...l, pitch: null, timing: 0, stability: null };
}

function sharedToSong(s: SharedSong, audio: Blob | null): Song {
  const now = Date.now();
  return {
    id: `online-${s.shareId}`,
    title: s.title,
    artist: s.artist,
    createdAt: now,
    updatedAt: now,
    audio,
    audioName: 'online',
    duration: s.duration,
    stereo: s.stereo,
    peaks: [],
    key: s.key,
    melody: s.melody === undefined ? undefined : s.melody,
    lines: s.lines,
    offset: s.offset,
    youtube: s.youtube,
  };
}

async function makeTransport(kind: TransportKind): Promise<RoomTransport> {
  if (kind === 'local') {
    const { LocalTransport } = await import('../lib/online/localTransport');
    return new LocalTransport();
  }
  const { SupabaseTransport } = await import('../lib/online/supabaseTransport');
  return new SupabaseTransport();
}

export function useOnlineRoom() {
  const transportRef = useRef<RoomTransport | null>(null);
  const [phase, setPhase] = useState<RoomPhase>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [song, setSong] = useState<SharedSong | null>(null);
  const [localSong, setLocalSong] = useState<Song | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setModeState] = useState<OnlineMode>('together');
  const [round, setRound] = useState(0);
  const [order, setOrder] = useState<string[]>([]);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [spectating, setSpectating] = useState(false);
  const [tallies, setTallies] = useState<Record<string, Tally>>({});
  const [finals, setFinals] = useState<Record<string, NetLine[]>>({});
  const [standings, setStandings] = useState<Standing[] | null>(null);
  const names = useRef(new Map<string, string>());
  const uploadedPath = useRef<string | null>(null);
  const recordedRound = useRef(0);

  // ค่าล่าสุดสำหรับ callback ของ transport
  const st = useRef({ isHost, song, localSong, mode, round, order, phase, peers, finals });
  st.current = { isHost, song, localSong, mode, round, order, phase, peers, finals };

  const selfId = transportRef.current?.selfId ?? '';

  const updateMe = (patch: Partial<PeerInfo>) => transportRef.current?.updateMe(patch);
  const setMyStatus = (status: PeerStatus, extra: Partial<PeerInfo> = {}) => updateMe({ status, ...extra });

  const loadShared = useCallback(async (s: SharedSong) => {
    const t = transportRef.current;
    if (!t) return;
    setError(null);
    if (s.youtube) {
      // เพลง YouTube: ไม่มีไฟล์ให้โหลด แต่ละเครื่องเปิดวิดีโอเอง
      setLocalSong(sharedToSong(s, null));
      setMyStatus('loaded', { progress: 100 });
      return;
    }
    setDownload(0);
    setMyStatus('loading', { progress: 0 });
    let lastPct = 0;
    try {
      const blob = await t.downloadAudio(s.audioUrl, (p) => {
        setDownload(p);
        const pct = Math.floor(p * 10) * 10;
        if (pct !== lastPct) {
          lastPct = pct;
          t.updateMe({ progress: pct });
        }
      });
      let local = sharedToSong(s, blob);
      if (local.melody === undefined) local = { ...local, melody: await ensureMelody(local) };
      if (st.current.song?.shareId !== s.shareId) return;
      setLocalSong(local);
      setMyStatus('loaded', { progress: 100 });
    } catch (e) {
      setError((e as Error).message);
      setMyStatus('lobby');
    } finally {
      setDownload(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginRound = useCallback((msg: Extract<RoomMessage, { type: 'start' }>) => {
    const t = transportRef.current;
    if (!t) return;
    const singing = msg.order.includes(t.selfId) && !!st.current.localSong;
    setRound(msg.round);
    setOrder(msg.order);
    setModeState(msg.mode);
    setTallies(Object.fromEntries(msg.order.map((id) => [id, emptyTally()])));
    setFinals({});
    setStandings(null);
    setSpectating(!singing);
    setStartAt(singing ? performance.now() + msg.countdownMs : null);
    setPhase('playing');
    if (singing) t.updateMe({ status: 'singing' });
  }, []);

  const backToLobby = useCallback(() => {
    getEngine().pause();
    setStartAt(null);
    setSpectating(false);
    setPhase('lobby');
    transportRef.current?.updateMe({ status: st.current.localSong ? 'ready' : 'lobby' });
  }, []);

  const handle = useCallback(
    (msg: RoomMessage) => {
      const t = transportRef.current;
      const s = st.current;
      if (!t) return;
      switch (msg.type) {
        case 'hello':
          if (s.isHost && s.song) t.send({ type: 'song', song: s.song, mode: s.mode });
          break;
        case 'song':
          if (s.isHost) return;
          setModeState(msg.mode);
          if (s.song?.shareId === msg.song.shareId) return;
          setSong(msg.song);
          st.current.song = msg.song;
          setLocalSong(null);
          void loadShared(msg.song);
          break;
        case 'start':
          beginRound(msg);
          break;
        case 'line':
          if (msg.round !== s.round) return;
          setTallies((prev) => ({ ...prev, [msg.playerId]: addLine(prev[msg.playerId] ?? emptyTally(), fromNet(msg.line)) }));
          break;
        case 'final':
          if (msg.round !== s.round) return;
          setFinals((prev) => ({ ...prev, [msg.playerId]: msg.lines }));
          break;
        case 'abort':
          if (msg.round === s.round) backToLobby();
          break;
      }
    },
    [beginRound, backToLobby, loadShared],
  );

  const connect = useCallback(
    async (kind: TransportKind, roomCode: string, name: string, host: boolean) => {
      setPhase('joining');
      setError(null);
      let t: RoomTransport;
      try {
        t = await makeTransport(kind);
      } catch {
        setError('โหลดระบบออนไลน์ไม่สำเร็จ');
        setPhase('idle');
        return;
      }
      transportRef.current = t;
      t.onPeers((list) => {
        list.forEach((p) => names.current.set(p.id, p.name));
        setPeers(list);
      });
      t.onMessage((msg) => handle(msg));
      try {
        await t.join(roomCode, { id: t.selfId, name, host, status: 'lobby', joinedAt: Date.now() });
      } catch (e) {
        t.leave();
        transportRef.current = null;
        setError((e as Error).message || 'เข้าห้องไม่สำเร็จ');
        setPhase('idle');
        return;
      }
      setCode(roomCode);
      setIsHost(host);
      st.current.isHost = host;
      setPhase('lobby');
      if (!host) t.send({ type: 'hello' });
    },
    [handle],
  );

  const createRoom = (name: string, kind: TransportKind) => connect(kind, makeRoomCode(), name, true);
  const joinRoom = (roomCode: string, name: string, kind: TransportKind) => connect(kind, roomCode, name, false);

  const leave = useCallback(() => {
    const t = transportRef.current;
    getEngine().pause();
    if (t) {
      if (uploadedPath.current) void t.deleteAudio(uploadedPath.current);
      t.leave();
    }
    transportRef.current = null;
    uploadedPath.current = null;
    setPhase('idle');
    setCode(null);
    setPeers([]);
    setSong(null);
    setLocalSong(null);
    setIsHost(false);
    setStandings(null);
  }, []);

  useEffect(() => () => leave(), [leave]);

  /** โฮสต์: แชร์เพลงจากคลังเข้าห้อง (อัปไฟล์เสียง + ส่งเนื้อ/ทำนอง) */
  const shareSong = async (s: Song, newMode: OnlineMode) => {
    const t = transportRef.current;
    if (!t || !code || (!s.audio && !s.youtube)) return;
    setError(null);
    try {
      if (!(await getEngine().enableMic())) throw new Error('ต้องอนุญาตให้ใช้ไมโครโฟนก่อน');
      if (s.youtube) {
        if (uploadedPath.current) void t.deleteAudio(uploadedPath.current);
        uploadedPath.current = null;
        const shared: SharedSong = {
          shareId: newId(),
          title: s.title,
          artist: s.artist,
          duration: s.duration,
          stereo: null,
          key: null,
          lines: s.lines,
          offset: s.offset,
          melody: null,
          audioUrl: '',
          audioType: '',
          youtube: s.youtube,
        };
        setSong(shared);
        st.current.song = shared;
        setLocalSong(s);
        setModeState(newMode);
        t.send({ type: 'song', song: shared, mode: newMode });
        t.updateMe({ status: 'ready' });
        return;
      }
      if (!s.audio) return;
      setBusy('กำลังเตรียมทำนองเพลง…');
      const melody = s.melody !== undefined ? s.melody : await ensureMelody(s);
      setBusy('กำลังอัปโหลดเพลงเข้าห้อง…');
      const prev = uploadedPath.current;
      const up = await t.uploadAudio(code, s.audio, s.audioName || 'song.mp3');
      uploadedPath.current = up.path;
      if (prev) void t.deleteAudio(prev);
      let shared: SharedSong = {
        shareId: newId(),
        title: s.title,
        artist: s.artist,
        duration: s.duration,
        stereo: s.stereo,
        key: s.key,
        lines: s.lines,
        offset: s.offset,
        melody,
        audioUrl: up.url,
        audioType: s.audio.type,
      };
      if (JSON.stringify(shared).length > MAX_SONG_PAYLOAD) {
        const { melody: _drop, ...rest } = shared;
        void _drop;
        shared = rest as SharedSong;
      }
      setSong(shared);
      st.current.song = shared;
      setLocalSong({ ...s, melody });
      setModeState(newMode);
      t.send({ type: 'song', song: shared, mode: newMode });
      t.updateMe({ status: 'ready' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** โฮสต์: เปลี่ยนรูปแบบการแข่ง */
  const setMode = (m: OnlineMode) => {
    setModeState(m);
    const t = transportRef.current;
    if (t && isHost && song) t.send({ type: 'song', song, mode: m });
  };

  /** ผู้เล่น: กดพร้อม (เป็น gesture ที่ใช้ปลดล็อกเสียง/ไมค์บนมือถือ) */
  const ready = async () => {
    const engine = getEngine();
    await engine.unlock();
    if (!(await engine.enableMic())) {
      setError('ต้องอนุญาตให้ใช้ไมโครโฟนก่อน');
      return;
    }
    setMyStatus('ready');
  };

  /** โฮสต์: เริ่มรอบใหม่กับผู้เล่นที่พร้อม */
  const startRound = () => {
    const t = transportRef.current;
    if (!t) return;
    const ids = singersOf(peers)
      .filter((p) => p.status === 'ready' || p.id === t.selfId)
      .map((p) => p.id);
    const msg: Extract<RoomMessage, { type: 'start' }> = { type: 'start', round: round + 1, order: ids, mode, countdownMs: COUNTDOWN_MS };
    t.send(msg);
    beginRound(msg);
  };

  const abortRound = () => {
    transportRef.current?.send({ type: 'abort', round });
    backToLobby();
  };

  // ---------- คะแนนจากเครื่องตัวเอง ----------
  const isMine = (lineIndex: number) => {
    const o = ownerId(mode, order, lineIndex);
    return o === null || o === selfId;
  };

  const onLine = (line: LineScore) => {
    const t = transportRef.current;
    if (!t || !isMine(line.index)) return;
    setTallies((prev) => ({ ...prev, [t.selfId]: addLine(prev[t.selfId] ?? emptyTally(), line) }));
    t.send({ type: 'line', round, playerId: t.selfId, line: toNet(line) });
  };

  const onFinish = (result: FinalScore | null) => {
    const t = transportRef.current;
    if (!t) return;
    const mine = (result?.lines ?? []).filter((l) => isMine(l.index)).map(toNet);
    setFinals((prev) => ({ ...prev, [t.selfId]: mine }));
    t.send({ type: 'final', round, playerId: t.selfId, lines: mine });
    t.updateMe({ status: 'done' });
    setPhase('waiting');
  };

  // ---------- สรุปผลเมื่อทุกคนร้องจบ ----------
  const complete = useCallback(() => {
    const s = st.current;
    if (!s.order.length) return;
    const players: Player[] = s.order.map((id, i) => ({ id, name: names.current.get(id) ?? 'ผู้เล่น', color: colorAt(i) }));
    const t = s.order.map((id) => (s.finals[id] ?? []).map(fromNet).reduce(addLine, emptyTally()));
    const result = rankPlayers(players, t);
    setStandings(result);
    setPhase('results');
    if (recordedRound.current !== s.round) {
      recordedRound.current = s.round;
      recordBattle(result);
    }
    transportRef.current?.updateMe({ status: s.localSong ? 'ready' : 'lobby' });
  }, []);

  useEffect(() => {
    if ((phase !== 'waiting' && phase !== 'playing') || !order.length) return;
    const present = new Set(peers.map((p) => p.id));
    const anyFinal = order.some((id) => id in finals);
    const pending = order.filter((id) => !(id in finals) && present.has(id));
    if (anyFinal && pending.length === 0) complete();
  }, [phase, order, finals, peers, complete]);

  useEffect(() => {
    if (phase !== 'waiting') return;
    const h = setTimeout(complete, WAIT_TIMEOUT_MS);
    return () => clearTimeout(h);
  }, [phase, complete]);

  const hostPresent = peers.some((p) => p.host);

  return {
    phase,
    code,
    error,
    setError,
    peers,
    selfId,
    isHost,
    hostPresent,
    song,
    localSong,
    download,
    busy,
    mode,
    round,
    order,
    startAt,
    spectating,
    tallies,
    finals,
    standings,
    transportKind: transportRef.current?.kind ?? null,
    createRoom,
    joinRoom,
    leave,
    shareSong,
    setMode,
    ready,
    startRound,
    abortRound,
    backToLobby,
    isMine,
    onLine,
    onFinish,
    nameOf: (id: string) => names.current.get(id) ?? 'ผู้เล่น',
  };
}

export type OnlineRoom = ReturnType<typeof useOnlineRoom>;
