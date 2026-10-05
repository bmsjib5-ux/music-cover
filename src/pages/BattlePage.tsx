import { useEffect, useMemo, useState } from 'react';
import { onSongsChanged, songsDb } from '../lib/db';
import { paths } from '../lib/router';
import { syncedCount } from '../lib/lyrics';
import { formatTime } from '../lib/format';
import { newId } from '../lib/id';
import { setPrefs } from '../lib/prefs';
import { toast } from '../lib/toast';
import { gradeFor, type LineScore } from '../lib/scoring';
import {
  BATTLE_MODES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  addLine,
  clearBoard,
  emptyTally,
  getBoard,
  isDraw,
  lineOwner,
  rankPlayers,
  recordBattle,
  tallyByOwner,
  tallyScore,
  type BattleMode,
  type Player,
  type Standing,
  type Tally,
} from '../lib/battle';
import { getEngine } from '../audio/engine';
import { ensureMelody } from '../lib/songs';
import { useEngineState } from '../hooks/useEngine';
import type { FinalScore } from '../hooks/useScoring';
import type { Song } from '../lib/types';
import { KaraokePlayer, type BattleProps } from '../components/KaraokePlayer';
import { fanfare } from '../components/ScoreResult';
import { Icon } from '../components/Icon';

type Phase = 'setup' | 'handoff' | 'playing' | 'result';

const SETUP_KEY = 'rongloei.battleSetup.v1';

function defaultPlayers(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({ id: newId(), name: `ผู้เล่น ${i + 1}`, color: PLAYER_COLORS[i] }));
}

function loadSetup(): { players: Player[]; mode: BattleMode } {
  try {
    const raw = JSON.parse(localStorage.getItem(SETUP_KEY) ?? 'null') as { names: string[]; mode: BattleMode } | null;
    if (raw && Array.isArray(raw.names) && raw.names.length >= MIN_PLAYERS) {
      return {
        players: raw.names.slice(0, MAX_PLAYERS).map((name, i) => ({ id: newId(), name, color: PLAYER_COLORS[i] })),
        mode: BATTLE_MODES.some((m) => m.id === raw.mode) ? raw.mode : 'lines1',
      };
    }
  } catch {
    /* ignore */
  }
  return { players: defaultPlayers(2), mode: 'lines1' };
}

function saveSetup(players: Player[], mode: BattleMode): void {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify({ names: players.map((p) => p.name), mode }));
  } catch {
    /* ignore */
  }
}

const isReady = (s: Song) => !!s.audio && s.lines.length > 0 && syncedCount(s.lines) > 0;

export function BattlePage({ songId }: { songId?: string }) {
  const { workletsOk } = useEngineState();
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [selected, setSelected] = useState<string | null>(songId ?? null);
  const initial = useMemo(loadSetup, []);
  const [players, setPlayers] = useState<Player[]>(initial.players);
  const [mode, setMode] = useState<BattleMode>(initial.mode);
  const [phase, setPhase] = useState<Phase>('setup');
  const [turn, setTurn] = useState(0);
  const [round, setRound] = useState(0);
  const [tallies, setTallies] = useState<Tally[]>([]);
  const [standings, setStandings] = useState<Standing[] | null>(null);
  const [board, setBoard] = useState(getBoard);
  /** เพลงที่ใช้แข่ง (เตรียมเส้นทำนองไว้แล้ว) */
  const [activeSong, setActiveSong] = useState<Song | null>(null);
  const [preparing, setPreparing] = useState<number | null>(null);

  useEffect(() => {
    const load = () =>
      void songsDb.all().then((all) => {
        const ready = all.filter(isReady);
        setSongs(ready);
        setSelected((cur) => (cur && ready.some((s) => s.id === cur) ? cur : (ready[0]?.id ?? null)));
      });
    load();
    return onSongsChanged(load);
  }, []);

  useEffect(() => saveSetup(players, mode), [players, mode]);

  // เปลี่ยนช่วง (ตั้งค่า → ส่งไมค์ → ร้อง → ผล) ให้เลื่อนขึ้นบนสุดเสมอ (สำคัญบนมือถือ)
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phase, turn]);

  const selectedSong = songs?.find((s) => s.id === selected) ?? null;
  const song = phase === 'setup' ? selectedSong : (activeSong ?? selectedSong);
  const n = players.length;

  const start = async () => {
    if (!song) return;
    if (players.some((p) => !p.name.trim())) {
      toast('ตั้งชื่อผู้เล่นให้ครบก่อน', 'error');
      return;
    }
    if (!(await getEngine().enableMic())) {
      toast('ต้องอนุญาตให้ใช้ไมโครโฟนก่อนจึงจะแข่งได้', 'error', 5000);
      return;
    }
    // ถอดทำนองให้เสร็จก่อนเริ่ม ไม่ให้ท่อนแรกๆ หลุดการนับคะแนน
    let prepared = song;
    if (song.melody === undefined) {
      setPreparing(0);
      try {
        prepared = { ...song, melody: await ensureMelody(song, setPreparing) };
      } finally {
        setPreparing(null);
      }
    }
    setActiveSong(prepared);
    // ตัดเสียงร้องต้นฉบับ เพื่อไม่ให้ไมค์ได้ยินเสียงนักร้องจริง
    setPrefs({ voice: 0 });
    setTallies(players.map(emptyTally));
    setStandings(null);
    setTurn(0);
    setRound((r) => r + 1);
    setPhase(mode === 'turns' ? 'handoff' : 'playing');
  };

  const finishBattle = (final: Tally[]) => {
    const s = rankPlayers(players, final);
    setTallies(final);
    setStandings(s);
    recordBattle(s);
    setBoard(getBoard());
    setPhase('result');
  };

  const battle: BattleProps | undefined =
    song && phase === 'playing'
      ? {
          label: mode === 'turns' ? `รอบ ${turn + 1}/${n} · ${players[turn].name}` : BATTLE_MODES.find((m) => m.id === mode)!.label,
          decorate:
            mode === 'turns'
              ? () => ({ color: players[turn].color, tag: '' })
              : (i) => {
                  const o = lineOwner(mode, i, n);
                  return o === null ? null : { color: players[o].color, tag: players[o].name };
                },
          ownerName: mode === 'turns' ? undefined : (i) => players[lineOwner(mode, i, n) ?? 0].name,
          scoreboard: players.map((p, i) => ({ name: p.name, color: p.color, score: tallies[i] ? tallyScore(tallies[i]) : null })),
          onLine: (line: LineScore) => {
            setTallies((prev) => {
              const owner = mode === 'turns' ? turn : lineOwner(mode, line.index, n);
              if (owner === null || !prev[owner]) return prev;
              const next = [...prev];
              next[owner] = addLine(next[owner], line);
              return next;
            });
          },
          onFinish: (result: FinalScore | null) => {
            const lines = result?.lines ?? [];
            if (mode === 'turns') {
              const final = [...tallies];
              final[turn] = lines.reduce(addLine, emptyTally());
              if (turn + 1 < n) {
                setTallies(final);
                setTurn(turn + 1);
                setPhase('handoff');
              } else {
                finishBattle(final);
              }
            } else {
              finishBattle(tallyByOwner(lines, mode, n));
            }
          },
        }
      : undefined;

  const cancel = () => {
    getEngine().pause();
    setPhase('setup');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            <Icon name="trophy" size={30} /> แข่งร้อง
          </h1>
          <p className="muted">ชวนเพื่อนมาประชันเสียง 2–4 คน ใช้ไมค์ตัวเดียวส่งต่อกัน ระบบให้คะแนนจากความแม่นโน้ตและจังหวะ</p>
        </div>
        {phase !== 'setup' && phase !== 'result' && (
          <button type="button" className="btn btn-ghost" onClick={cancel}>
            <Icon name="x" size={18} /> ยกเลิกการแข่ง
          </button>
        )}
      </div>

      {phase === 'setup' && (
        <Setup
          songs={songs}
          selected={selected}
          onSelect={setSelected}
          players={players}
          setPlayers={setPlayers}
          mode={mode}
          setMode={setMode}
          onStart={() => void start()}
          unsupported={workletsOk === false}
          preparing={preparing}
        />
      )}

      {phase === 'handoff' && song && (
        <div className="card handoff" style={{ borderColor: players[turn].color }}>
          <div className="handoff-mic" style={{ background: players[turn].color }}>
            <Icon name="mic" size={40} />
          </div>
          <p className="muted">รอบที่ {turn + 1} จาก {n}</p>
          <h2 className="handoff-name" style={{ color: players[turn].color }}>
            ตาของ {players[turn].name}
          </h2>
          <p className="muted">ส่งไมค์ให้ {players[turn].name} แล้วกดเริ่มร้อง — เพลง "{song.title}"</p>
          {turn > 0 && <MiniBoard players={players} tallies={tallies} upTo={turn} />}
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setPhase('playing')} style={{ background: players[turn].color }}>
            <Icon name="play" /> เริ่มร้อง
          </button>
        </div>
      )}

      {phase === 'playing' && song && battle && <KaraokePlayer key={`${round}-${turn}`} song={song} autoPlay battle={battle} />}

      {phase === 'result' && standings && song && (
        <BattleResult
          standings={standings}
          song={song}
          onAgain={() => void start()}
          onSetup={() => setPhase('setup')}
        />
      )}

      {(phase === 'setup' || phase === 'result') && (
        <section className="card">
          <header className="card-head">
            <h2>
              <Icon name="trophy" /> ทำเนียบแชมป์
            </h2>
            {board.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (!confirm('ล้างทำเนียบแชมป์ทั้งหมด?')) return;
                  clearBoard();
                  setBoard([]);
                }}
              >
                ล้าง
              </button>
            )}
          </header>
          {board.length === 0 ? (
            <p className="muted">ยังไม่มีการแข่ง — มาเปิดสนามกันเลย!</p>
          ) : (
            <ol className="champ-list">
              {board.slice(0, 10).map((e, i) => (
                <li key={e.name}>
                  <span className="champ-rank">{i === 0 ? '👑' : i + 1}</span>
                  <strong>{e.name}</strong>
                  <span className="muted small">
                    ชนะ {e.wins} จาก {e.battles} ครั้ง · สูงสุด {e.best}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

function Setup({
  songs,
  selected,
  onSelect,
  players,
  setPlayers,
  mode,
  setMode,
  onStart,
  unsupported,
  preparing,
}: {
  songs: Song[] | null;
  selected: string | null;
  onSelect: (id: string) => void;
  players: Player[];
  setPlayers: (p: Player[]) => void;
  mode: BattleMode;
  setMode: (m: BattleMode) => void;
  onStart: () => void;
  unsupported: boolean;
  preparing: number | null;
}) {
  const rename = (i: number, name: string) => setPlayers(players.map((p, j) => (j === i ? { ...p, name } : p)));
  return (
    <div className="battle-setup">
      <section className="card">
        <h2>
          <Icon name="music" /> 1. เลือกเพลง
        </h2>
        {songs === null ? (
          <p className="muted">กำลังโหลด…</p>
        ) : songs.length === 0 ? (
          <p className="muted">
            ยังไม่มีเพลงที่ซิงก์เนื้อแล้ว — <a href={paths.newSong()}>เพิ่มเพลง</a> หรือสร้างเพลงตัวอย่างที่<a href={paths.library()}>คลังเพลง</a>
          </p>
        ) : (
          <ul className="battle-songs">
            {songs.map((s) => (
              <li key={s.id}>
                <label className={`battle-song ${selected === s.id ? 'on' : ''}`}>
                  <input type="radio" name="battle-song" checked={selected === s.id} onChange={() => onSelect(s.id)} />
                  <span className="battle-song-icon">
                    <Icon name="music" size={18} />
                  </span>
                  <span className="battle-song-info">
                    <strong>{s.title}</strong>
                    <small className="muted">
                      {s.artist || 'ไม่ระบุศิลปิน'} · {formatTime(s.duration)} · {syncedCount(s.lines)} ท่อน
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>
          <Icon name="users" /> 2. ผู้เล่น
        </h2>
        <ul className="battle-players">
          {players.map((p, i) => (
            <li key={p.id}>
              <span className="player-dot" style={{ background: p.color }} />
              <input value={p.name} maxLength={20} onChange={(e) => rename(i, e.target.value)} aria-label={`ชื่อผู้เล่น ${i + 1}`} />
              {players.length > MIN_PLAYERS && (
                <button type="button" className="icon-btn danger" onClick={() => setPlayers(players.filter((_, j) => j !== i))} aria-label="ลบผู้เล่น">
                  <Icon name="x" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {players.length < MAX_PLAYERS && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              setPlayers([...players, { id: newId(), name: `ผู้เล่น ${players.length + 1}`, color: PLAYER_COLORS.find((c) => !players.some((p) => p.color === c))! }])
            }
          >
            <Icon name="plus" size={16} /> เพิ่มผู้เล่น
          </button>
        )}

        <h2 style={{ marginTop: 18 }}>
          <Icon name="settings" /> 3. รูปแบบการแข่ง
        </h2>
        <div className="battle-modes">
          {BATTLE_MODES.map((m) => (
            <label key={m.id} className={`battle-mode ${mode === m.id ? 'on' : ''}`}>
              <input type="radio" name="battle-mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
              <strong>{m.label}</strong>
              <small className="muted">{m.hint}</small>
            </label>
          ))}
        </div>

        <ul className="battle-tips muted small">
          <li>ใช้ไมค์/อุปกรณ์เดียว ส่งต่อกันตามสีของเนื้อเพลง — ท่อนถัดไปมีป้ายชื่อบอกว่าตาใคร</li>
          <li>ระบบตัดเสียงร้องต้นฉบับให้อัตโนมัติ · ใส่หูฟังหรือเปิดลำโพงเบาๆ จะได้คะแนนแม่นที่สุด</li>
          <li>ร้องสูง/ต่ำกว่าหนึ่งคู่แปดก็นับ — ผู้ชายกับผู้หญิงแข่งกันได้ยุติธรรม</li>
        </ul>

        {unsupported && <p className="alert error">เบราว์เซอร์นี้ไม่รองรับการให้คะแนน (ต้องเปิดผ่าน https บนเบราว์เซอร์รุ่นใหม่)</p>}
        <button type="button" className="btn btn-primary btn-lg battle-start" onClick={onStart} disabled={!selected || unsupported || preparing !== null}>
          <Icon name="trophy" /> {preparing !== null ? `กำลังเตรียมทำนองเพลง… ${Math.round(preparing * 100)}%` : 'เริ่มแข่ง!'}
        </button>
      </section>
    </div>
  );
}

function MiniBoard({ players, tallies, upTo }: { players: Player[]; tallies: Tally[]; upTo: number }) {
  return (
    <div className="mini-board">
      {players.slice(0, upTo).map((p, i) => (
        <span key={p.id} style={{ borderColor: p.color }}>
          {p.name} <strong>{tallies[i] ? (tallyScore(tallies[i]) ?? 0) : 0}</strong>
        </span>
      ))}
    </div>
  );
}

function BattleResult({ standings, song, onAgain, onSetup }: { standings: Standing[]; song: Song; onAgain: () => void; onSetup: () => void }) {
  const draw = isDraw(standings);
  const winners = standings.filter((s) => s.rank === 1);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1800);
      setShown(1 - Math.pow(1 - p, 3));
      if (p < 1) id = requestAnimationFrame(tick);
      else fanfare(draw ? 60 : 95);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [draw]);

  const done = shown >= 1;
  const confetti = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.2,
        dur: 2.4 + Math.random() * 1.8,
        color: [...PLAYER_COLORS, '#ffffff'][i % 5],
        rot: Math.random() * 360,
      })),
    [],
  );

  return (
    <section className="card battle-result">
      {done && !draw && (
        <div className="confetti" aria-hidden="true">
          {confetti.map((c, i) => (
            <i key={i} style={{ left: `${c.left}%`, background: c.color, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`, transform: `rotate(${c.rot}deg)` }} />
          ))}
        </div>
      )}
      <p className="muted">ผลการแข่ง · {song.title}</p>
      <h2 className="battle-winner">
        {!done ? 'กำลังนับคะแนน…' : draw ? '🤝 เสมอกัน!' : `👑 ${winners.map((w) => w.player.name).join(' & ')} ชนะ!`}
      </h2>
      <ol className="standings">
        {standings.map((s) => {
          const score = Math.round(s.score * shown);
          return (
            <li key={s.player.id} className={s.rank === 1 && done ? 'winner' : ''} style={{ borderColor: s.player.color }}>
              <span className="standing-rank">{s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : s.rank}</span>
              <span className="standing-main">
                <strong style={{ color: s.player.color }}>{s.player.name}</strong>
                <span className="standing-bar">
                  <span style={{ width: `${score}%`, background: s.player.color }} />
                </span>
                <small className="muted">
                  {s.lines} ท่อน · เยี่ยมมาก {s.great} ท่อน
                  {s.best && s.best.score > 0 && ` · ท่อนเด่น "${s.best.text}" (${s.best.score})`}
                </small>
              </span>
              <span className="standing-score">
                <strong>{score}</strong>
                <small>{done ? gradeFor(s.score).grade : ''}</small>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn btn-primary" onClick={onAgain}>
          <Icon name="restart" size={18} /> แข่งอีกรอบ
        </button>
        <button type="button" className="btn btn-ghost" onClick={onSetup}>
          <Icon name="settings" size={18} /> เปลี่ยนเพลง/ผู้เล่น
        </button>
        <a className="btn btn-ghost" href={paths.sing(song.id)}>
          <Icon name="mic" size={18} /> ฝึกร้องเพลงนี้
        </a>
      </div>
    </section>
  );
}
