import { useCallback, useEffect, useState } from 'react';
import { coversDb, onSongsChanged, songsDb } from '../lib/db';
import { paths } from '../lib/router';
import { syncedCount } from '../lib/lyrics';
import { downloadBlob, formatDate, formatTime, safeFileName } from '../lib/format';
import { formatShift } from '../lib/music';
import { extensionFor } from '../audio/engine';
import { toWav } from '../lib/wav';
import { queue } from '../lib/queue';
import { newId } from '../lib/id';
import { toast } from '../lib/toast';
import type { Cover, Song } from '../lib/types';
import { getBestScore, SCORE_EVENT } from '../lib/scoring';
import { KaraokePlayer } from '../components/KaraokePlayer';
import { MicPanel } from '../components/MicPanel';
import { Icon } from '../components/Icon';

function CoverItem({ cover, onDelete }: { cover: Cover; onDelete: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  useEffect(() => {
    const u = URL.createObjectURL(cover.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [cover.blob]);
  const base = safeFileName(`${cover.songTitle} - cover ${new Date(cover.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}`);
  const downloadWav = async () => {
    setConverting(true);
    try {
      downloadBlob(await toWav(cover.blob), `${base}.wav`);
    } catch {
      toast('แปลงเป็น WAV ไม่สำเร็จ', 'error');
    } finally {
      setConverting(false);
    }
  };
  return (
    <li className="cover-item">
      <div className="cover-meta">
        <strong>{formatDate(cover.createdAt)}</strong>
        <span className="muted small">
          {formatTime(cover.duration)}
          {cover.keyShift !== 0 && ` · คีย์ ${formatShift(cover.keyShift)}`}
          {cover.autotune && ' · Auto-Tune'}
        </span>
      </div>
      {url && <audio controls src={url} preload="metadata" />}
      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadBlob(cover.blob, `${base}.${extensionFor(cover.mimeType)}`)}>
          <Icon name="download" size={16} /> {extensionFor(cover.mimeType).toUpperCase()}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadWav()} disabled={converting}>
          <Icon name="download" size={16} /> {converting ? 'กำลังแปลง…' : 'WAV'}
        </button>
        <button type="button" className="icon-btn danger" onClick={onDelete} aria-label="ลบคัฟเวอร์">
          <Icon name="trash" size={18} />
        </button>
      </div>
    </li>
  );
}

export function SingPage({ id }: { id: string }) {
  const [song, setSong] = useState<Song | null>(null);
  const [missing, setMissing] = useState(false);
  const [covers, setCovers] = useState<Cover[]>([]);
  const [keyShift, setKeyShift] = useState(0);
  const [best, setBest] = useState(() => getBestScore(id));

  useEffect(() => {
    const onScore = () => setBest(getBestScore(id));
    window.addEventListener(SCORE_EVENT, onScore);
    return () => window.removeEventListener(SCORE_EVENT, onScore);
  }, [id]);

  useEffect(() => {
    const load = () =>
      void songsDb.get(id).then((s) => {
        if (s) setSong((prev) => (prev && prev.updatedAt === s.updatedAt ? prev : s));
        else setMissing(true);
      });
    load();
    return onSongsChanged(load);
  }, [id]);

  const loadCovers = useCallback(() => void coversDb.bySong(id).then(setCovers), [id]);
  useEffect(loadCovers, [loadCovers]);

  if (missing) return <div className="page">ไม่พบเพลงนี้</div>;
  if (!song) return <div className="page muted">กำลังโหลด…</div>;

  const done = syncedCount(song.lines);
  const unsynced = song.lines.length - done;

  return (
    <div className="page">
      <a className="back-link" href={paths.library()}>
        <Icon name="back" size={18} /> คลังเพลง
      </a>
      <div className="page-head">
        <div>
          <h1>{song.title}</h1>
          <p className="muted">
            {song.artist || 'ไม่ระบุศิลปิน'}
            {best && (
              <span className="badge best-badge" style={{ marginLeft: 8 }}>
                🏆 สถิติสูงสุด {best.best} คะแนน
              </span>
            )}
          </p>
        </div>
        <div className="row">
          <a className="btn btn-ghost" href={paths.sync(song.id)}>
            <Icon name="clock" size={18} /> ซิงก์เนื้อ
          </a>
          <a className="btn btn-ghost" href={paths.edit(song.id)}>
            <Icon name="edit" size={18} /> แก้ไข
          </a>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              queue.add({ key: newId(), kind: 'local', songId: song.id, title: song.title, artist: song.artist });
              toast('เพิ่มเข้าคิวแล้ว', 'success');
            }}
          >
            <Icon name="queue" size={18} /> เข้าคิว
          </button>
        </div>
      </div>

      {unsynced > 0 && (
        <p className="alert">
          {done === 0 ? 'เพลงนี้ยังไม่ได้ซิงก์เนื้อเพลง' : `ยังมี ${unsynced} บรรทัดที่ยังไม่ได้ซิงก์`} —{' '}
          <a href={paths.sync(song.id)}>ไปซิงก์เนื้อเพลง</a>
        </p>
      )}

      <KaraokePlayer song={song} onKeyShift={setKeyShift} />
      <MicPanel song={song} keyShift={keyShift} onSaved={loadCovers} />

      <section className="card">
        <header className="card-head">
          <h2>
            <Icon name="music" /> คัฟเวอร์ของฉัน {covers.length > 0 && <span className="count">{covers.length}</span>}
          </h2>
        </header>
        {covers.length === 0 ? (
          <p className="muted">ยังไม่มีคัฟเวอร์ — เปิดไมค์แล้วกด "อัดคัฟเวอร์" ด้านบน</p>
        ) : (
          <ul className="cover-list">
            {covers.map((c) => (
              <CoverItem
                key={c.id}
                cover={c}
                onDelete={async () => {
                  if (!confirm('ลบคัฟเวอร์นี้?')) return;
                  await coversDb.delete(c.id);
                  loadCovers();
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
