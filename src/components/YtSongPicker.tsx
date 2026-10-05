import { useEffect, useMemo, useState } from 'react';
import { searchLrclib, type LrclibResult } from '../lib/lrclib';
import { parseLrc } from '../lib/lrc';
import { formatTime } from '../lib/format';
import { toast } from '../lib/toast';
import { cleanVideoTitle, lyricsQueryFromTitle, thumbnailUrl, type YouTubeVideo } from '../lib/youtube';
import { forgetYtSong, recentYtSongs, rememberYtSong, ytSongToSong, type YtSong } from '../lib/ytSongs';
import { YouTubeSearch } from './YouTubeSearch';
import { YouTubeKaraoke } from './YouTubeKaraoke';
import { Icon } from './Icon';

interface Props {
  value: YtSong | null;
  onChange: (song: YtSong | null) => void;
}

/** เลือกเพลงจาก YouTube สำหรับแข่ง: เลือกวิดีโอ → หาเนื้อเพลงที่มีเวลา → (ไม่บังคับ) ตั้งเวลาเนื้อให้ตรงวิดีโอ */
export function YtSongPicker({ value, onChange }: Props) {
  const [video, setVideo] = useState<YouTubeVideo | null>(null);
  const [recent, setRecent] = useState(recentYtSongs);

  if (value) return <Selected song={value} onChange={onChange} />;

  if (video) {
    return (
      <LyricsFinder
        video={video}
        onBack={() => setVideo(null)}
        onDone={(s) => {
          rememberYtSong(s);
          setRecent(recentYtSongs());
          setVideo(null);
          onChange(s);
        }}
      />
    );
  }

  return (
    <div className="yt-song-picker">
      {recent.length > 0 && (
        <>
          <h3 className="sub-head">เพลง YouTube ที่เคยใช้</h3>
          <ul className="battle-songs">
            {recent.map((s) => (
              <li key={s.videoId}>
                <div className="battle-song">
                  <img className="yt-thumb" src={thumbnailUrl(s.videoId)} alt="" loading="lazy" />
                  <span className="battle-song-info">
                    <strong>{s.title}</strong>
                    <small className="muted">
                      {s.channel} · {s.lines.length} ท่อน
                    </small>
                  </span>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => onChange(s)}>
                    เลือก
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label="ลบออกจากรายการ"
                    onClick={() => {
                      forgetYtSong(s.videoId);
                      setRecent(recentYtSongs());
                    }}
                  >
                    <Icon name="x" size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <h3 className="sub-head">หรือค้นหาวิดีโอใหม่</h3>
        </>
      )}
      <YouTubeSearch actionLabel="เลือก" onPick={setVideo} />
      <ul className="battle-tips muted small">
        <li>เลือกวิดีโอเวอร์ชันคาราโอเกะ (ไม่มีเสียงร้อง) จะแข่งได้ยุติธรรมที่สุด และควรใส่หูฟัง</li>
        <li>ระบบจะหาเนื้อเพลงที่มีเวลาซิงก์จาก LRCLIB ให้ — ให้คะแนนจากจังหวะการร้องและความตรงคีย์ (ไม่มีเส้นทำนองให้เทียบ)</li>
      </ul>
    </div>
  );
}

function Selected({ song, onChange }: { song: YtSong; onChange: (s: YtSong | null) => void }) {
  const [syncing, setSyncing] = useState(false);
  const preview = useMemo(() => ytSongToSong(song), [song]);
  return (
    <div className="yt-selected">
      <div className="now-song">
        <img className="yt-thumb" src={thumbnailUrl(song.videoId)} alt="" />
        <div>
          <strong>{song.title}</strong>
          <small className="muted">
            {song.channel} · {song.lines.length} ท่อน · เนื้อจาก {song.lyricsFrom}
            {song.offset !== 0 && ` · เลื่อนเนื้อ ${song.offset > 0 ? '+' : ''}${song.offset.toFixed(1)} วิ`}
          </small>
        </div>
      </div>
      <div className="row">
        <button type="button" className={`btn btn-sm ${syncing ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSyncing(!syncing)}>
          <Icon name="clock" size={16} /> {syncing ? 'ตั้งเวลาเสร็จแล้ว' : 'ทดลองเล่น / ตั้งเวลาเนื้อ'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
          <Icon name="youtube" size={16} /> เปลี่ยนเพลง
        </button>
      </div>
      {!syncing && <p className="muted small">แนะนำ: กด "ทดลองเล่น" ก่อนแข่ง เพื่อเช็กว่าเนื้อขึ้นตรงกับเสียงร้องในวิดีโอ (วิดีโอแต่ละเวอร์ชันมีอินโทรยาวไม่เท่ากัน)</p>}
      {syncing && (
        <YouTubeKaraoke
          song={preview}
          autoPlay={false}
          onOffsetChange={(offset) => {
            const next = { ...song, offset };
            rememberYtSong(next);
            onChange(next);
          }}
        />
      )}
    </div>
  );
}

function LyricsFinder({ video, onBack, onDone }: { video: YouTubeVideo; onBack: () => void; onDone: (s: YtSong) => void }) {
  const [query, setQuery] = useState(() => lyricsQueryFromTitle(video.title));
  const [results, setResults] = useState<LrclibResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState('');

  const search = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setResults(await searchLrclib(q, ''));
    } catch {
      setResults([]);
      toast('ค้นหาเนื้อเพลงไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต', 'error');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void search(query);
    // ค้นอัตโนมัติครั้งแรกเมื่อเลือกวิดีโอ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.videoId]);

  const base = { videoId: video.videoId, title: cleanVideoTitle(video.title), channel: video.channel, offset: 0, usedAt: Date.now() };

  const applyResult = (r: LrclibResult) => {
    const parsed = parseLrc(r.syncedLyrics ?? '');
    if (!parsed.timed || parsed.lines.length === 0) {
      toast('เนื้อเพลงนี้ไม่มีเวลาซิงก์', 'error');
      return;
    }
    onDone({ ...base, lines: parsed.lines, duration: r.duration, lyricsFrom: `LRCLIB · ${r.trackName} — ${r.artistName}` });
  };

  const applyPasted = () => {
    const parsed = parseLrc(paste);
    if (!parsed.timed || parsed.lines.length === 0) {
      toast('ต้องเป็นเนื้อเพลงแบบ LRC ที่มีเวลา เช่น [00:12.50] เนื้อเพลง', 'error', 5000);
      return;
    }
    onDone({ ...base, lines: parsed.lines, duration: 0, lyricsFrom: 'วางเอง' });
  };

  const synced = results?.filter((r) => r.syncedLyrics) ?? [];

  return (
    <div className="yt-lyrics-finder">
      <div className="now-song">
        <img className="yt-thumb" src={thumbnailUrl(video.videoId)} alt="" />
        <div>
          <strong>{video.title}</strong>
          <small className="muted">{video.channel}</small>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <Icon name="back" size={16} /> เลือกวิดีโออื่น
        </button>
      </div>
      <h3 className="sub-head">หาเนื้อเพลงที่มีเวลาซิงก์</h3>
      <form
        className="yt-form"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ชื่อเพลง ศิลปิน" aria-label="ค้นหาเนื้อเพลง" />
        <button type="submit" className="btn btn-primary" disabled={busy || !query.trim()} aria-label="ค้นหาเนื้อเพลง">
          <Icon name="search" size={18} />
        </button>
      </form>
      {busy && <p className="muted small">กำลังค้นหาเนื้อเพลง…</p>}
      {results && !busy && (
        <div className="lrclib-results">
          {synced.length === 0 ? (
            <p className="muted">
              ไม่พบเนื้อเพลงที่มีเวลาซิงก์ — ลองแก้คำค้น (เช่น ใส่แค่ชื่อเพลง) หรือวางเนื้อ LRC เองด้านล่าง
              {results.length > 0 && ` (เจอ ${results.length} รายการแต่เป็นเนื้ออย่างเดียว ใช้ให้คะแนนจังหวะไม่ได้)`}
            </p>
          ) : (
            synced.map((r) => (
              <div key={r.id} className="lrclib-item">
                <div>
                  <strong>{r.trackName}</strong>
                  <span className="muted">
                    {' '}
                    — {r.artistName} · {formatTime(r.duration)}
                  </span>
                </div>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => applyResult(r)}>
                  ใช้เนื้อนี้
                </button>
              </div>
            ))
          )}
        </div>
      )}
      <details className="help">
        <summary>วางเนื้อเพลงแบบ LRC เอง</summary>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder={'[00:12.50] ท่อนแรก\n[00:16.20] ท่อนที่สอง'} />
        <button type="button" className="btn btn-ghost btn-sm" disabled={!paste.trim()} onClick={applyPasted}>
          ใช้เนื้อนี้
        </button>
      </details>
    </div>
  );
}
