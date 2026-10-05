import { useEffect, useMemo, useState } from 'react';
import { onSongsChanged, songsDb } from '../lib/db';
import { paths } from '../lib/router';
import { syncedCount } from '../lib/lyrics';
import { serializeLrc } from '../lib/lrc';
import { downloadBlob, formatTime, safeFileName } from '../lib/format';
import { keyName } from '../lib/music';
import { queue } from '../lib/queue';
import { newId } from '../lib/id';
import { toast } from '../lib/toast';
import { addDemoSong } from '../lib/songs';
import { getBestScores, type BestScore } from '../lib/scoring';
import type { Song } from '../lib/types';
import { Icon } from '../components/Icon';

function SyncBadge({ song }: { song: Song }) {
  const total = song.lines.length;
  const done = syncedCount(song.lines);
  if (total === 0) return <span className="badge warn">ยังไม่มีเนื้อเพลง</span>;
  if (done === total) return <span className="badge ok">✓ ซิงก์ครบ {total} บรรทัด</span>;
  return (
    <span className="badge warn">
      ซิงก์แล้ว {done}/{total}
    </span>
  );
}

function SongCard({ song, best }: { song: Song; best: BestScore | undefined }) {
  const ready = song.lines.length > 0 && syncedCount(song.lines) === song.lines.length;
  const addToQueue = () => {
    queue.add({ key: newId(), kind: 'local', songId: song.id, title: song.title, artist: song.artist });
    toast(`เพิ่ม "${song.title}" เข้าคิวแล้ว`, 'success');
  };
  const exportLrc = () => {
    const text = serializeLrc(song.lines, { title: song.title, artist: song.artist });
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${safeFileName(`${song.artist} - ${song.title}`)}.lrc`);
  };
  const remove = async () => {
    if (!confirm(`ลบเพลง "${song.title}" และคัฟเวอร์ทั้งหมดของเพลงนี้?`)) return;
    await songsDb.delete(song.id);
    toast('ลบเพลงแล้ว');
  };
  return (
    <article className="song-card">
      <a className="song-cover" href={ready ? paths.sing(song.id) : paths.sync(song.id)} aria-label={`ร้อง ${song.title}`}>
        <Icon name="music" size={28} />
        <span className="song-cover-play">
          <Icon name="play" size={22} />
        </span>
      </a>
      <div className="song-info">
        <h3>{song.title}</h3>
        <p className="muted">
          {song.artist || 'ไม่ระบุศิลปิน'}
          {song.duration > 0 && ` · ${formatTime(song.duration)}`}
          {song.key && ` · คีย์ ${keyName(song.key)}`}
        </p>
        <div className="badges">
          <SyncBadge song={song} />
          {song.stereo === false && <span className="badge">โมโน</span>}
          {song.demo && <span className="badge accent">ตัวอย่าง</span>}
          {best && <span className="badge best-badge">🏆 {best.best} คะแนน</span>}
        </div>
      </div>
      <div className="song-actions">
        <a className="btn btn-primary btn-sm" href={paths.sing(song.id)}>
          <Icon name="mic" size={16} /> ร้องเลย
        </a>
        <a className="btn btn-ghost btn-sm" href={paths.sync(song.id)}>
          <Icon name="clock" size={16} /> ซิงก์เนื้อ
        </a>
        <button type="button" className="btn btn-ghost btn-sm" onClick={addToQueue}>
          <Icon name="queue" size={16} /> เข้าคิว
        </button>
        <div className="song-actions-more">
          <a className="icon-btn" href={paths.edit(song.id)} title="แก้ไขเพลง" aria-label="แก้ไขเพลง">
            <Icon name="edit" size={18} />
          </a>
          <button type="button" className="icon-btn" onClick={exportLrc} title="ดาวน์โหลดไฟล์ .lrc" aria-label="ดาวน์โหลดไฟล์ .lrc">
            <Icon name="download" size={18} />
          </button>
          <button type="button" className="icon-btn danger" onClick={() => void remove()} title="ลบเพลง" aria-label="ลบเพลง">
            <Icon name="trash" size={18} />
          </button>
        </div>
      </div>
    </article>
  );
}

const STEPS = [
  { icon: 'upload', title: 'อัปโหลดเพลง', text: 'ไฟล์ MP3/M4A/WAV ของคุณ — ประมวลผลในเครื่อง ไม่ส่งขึ้นเซิร์ฟเวอร์' },
  { icon: 'file', title: 'ใส่เนื้อเพลง', text: 'วางเนื้อเอง หรือค้นจาก LRCLIB ซึ่งบางเพลงมีเวลาซิงก์มาให้แล้ว' },
  { icon: 'clock', title: 'แตะซิงก์', text: 'กด Space ค้างไว้ตามแต่ละท่อน ระบบจะจำเวลาเริ่ม-จบ' },
  { icon: 'mic', title: 'ร้องเลย!', text: 'ตัดเสียงร้อง ปรับคีย์ ปรับความเร็ว ใส่ Auto-Tune แล้วอัดคัฟเวอร์' },
];

export function LibraryPage() {
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [query, setQuery] = useState('');
  const [creatingDemo, setCreatingDemo] = useState(false);
  const bestScores = useMemo(getBestScores, [songs]);

  useEffect(() => {
    const load = () => void songsDb.all().then(setSongs);
    load();
    return onSongsChanged(load);
  }, []);

  const filtered = useMemo(() => {
    if (!songs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(q));
  }, [songs, query]);

  const makeDemo = async () => {
    setCreatingDemo(true);
    try {
      await addDemoSong();
    } finally {
      setCreatingDemo(false);
    }
  };

  return (
    <div className="page">
      <section className="hero">
        <div>
          <h1>
            คาราโอเกะเพลงไทย <span className="grad">ร้องได้ทุกที่</span>
          </h1>
          <p className="muted">
            อัปโหลดเพลง ใส่เนื้อ แล้วร้องพร้อมเนื้อไล่สีแบบตู้คาราโอเกะ ตัดเสียงร้อง ปรับคีย์ ปรับความเร็ว ใส่ Auto-Tune และอัดคัฟเวอร์เก็บไว้ได้ หรือเปิดห้องคาราโอเกะจาก
            YouTube พร้อมคิวเพลง
          </p>
        </div>
        <div className="hero-actions">
          <a className="btn btn-primary btn-lg" href={paths.newSong()}>
            <Icon name="plus" /> เพิ่มเพลง
          </a>
          <a className="btn btn-ghost btn-lg" href={paths.room()}>
            <Icon name="youtube" /> ห้องคาราโอเกะ
          </a>
          <a className="btn btn-ghost btn-lg" href={paths.battle()}>
            <Icon name="trophy" /> แข่งร้อง
          </a>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>
            คลังเพลงของฉัน {songs && songs.length > 0 && <span className="count">{songs.length}</span>}
          </h2>
          {songs && songs.length > 3 && (
            <label className="search">
              <Icon name="search" size={18} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหาชื่อเพลง/ศิลปิน" />
            </label>
          )}
        </div>

        {songs === null ? (
          <p className="muted">กำลังโหลด…</p>
        ) : songs.length === 0 ? (
          <div className="empty card">
            <Icon name="music" size={40} />
            <h3>ยังไม่มีเพลงในคลัง</h3>
            <p className="muted">เริ่มจากเพลงตัวอย่างเพื่อลองเล่นทุกฟีเจอร์ หรือเพิ่มเพลงของคุณเองได้เลย</p>
            <div className="row">
              <button type="button" className="btn btn-ghost" onClick={() => void makeDemo()} disabled={creatingDemo}>
                <Icon name="sparkle" size={18} /> {creatingDemo ? 'กำลังสร้าง…' : 'สร้างเพลงตัวอย่าง'}
              </button>
              <a className="btn btn-primary" href={paths.newSong()}>
                <Icon name="plus" size={18} /> เพิ่มเพลงแรก
              </a>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <p className="muted">ไม่พบเพลงที่ค้นหา</p>
        ) : (
          <div className="song-list">
            {filtered.map((s) => (
              <SongCard key={s.id} song={s} best={bestScores[s.id]} />
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>ใช้งานง่ายใน 4 ขั้นตอน</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="step card">
              <span className="step-num">{i + 1}</span>
              <Icon name={s.icon} size={22} />
              <strong>{s.title}</strong>
              <span className="muted">{s.text}</span>
            </li>
          ))}
        </ol>
        <p className="muted small">
          🔒 เพลงและเสียงอัดทั้งหมดเก็บไว้ในเบราว์เซอร์ของคุณเท่านั้น (IndexedDB) — ถ้าล้างข้อมูลเว็บไซต์ เพลงจะหายไปด้วย ควรดาวน์โหลดไฟล์ .lrc เก็บไว้
        </p>
      </section>
    </div>
  );
}
