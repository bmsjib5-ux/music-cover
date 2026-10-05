import { useEffect, useMemo, useState } from 'react';
import { onSongsChanged, songsDb } from '../lib/db';
import { queue, useQueue } from '../lib/queue';
import { getPrefs, setPrefs } from '../lib/prefs';
import { newId } from '../lib/id';
import { toast } from '../lib/toast';
import { paths } from '../lib/router';
import { syncedCount } from '../lib/lyrics';
import {
  BUILTIN_YT_KEY,
  YouTubeApiError,
  fetchVideoInfo,
  parseYouTubeId,
  searchYouTube,
  thumbnailUrl,
  youtubeSearchUrl,
  type YouTubeVideo,
} from '../lib/youtube';
import type { QueueItem, Song } from '../lib/types';
import { KaraokePlayer } from '../components/KaraokePlayer';
import { YouTubePlayer } from '../components/YouTubePlayer';
import { MicPanel } from '../components/MicPanel';
import { getEngine } from '../audio/engine';
import { Icon } from '../components/Icon';

const YT_RATES = [0.75, 1, 1.25];

function QueueRow({ item, index, total }: { item: QueueItem; index: number; total: number }) {
  return (
    <li className="queue-row">
      <span className="queue-num">{index + 1}</span>
      {item.kind === 'youtube' ? (
        <img className="queue-thumb" src={thumbnailUrl(item.videoId)} alt="" loading="lazy" />
      ) : (
        <span className="queue-thumb local">
          <Icon name="music" size={18} />
        </span>
      )}
      <div className="queue-info">
        <strong>{item.title}</strong>
        <small className="muted">{item.kind === 'youtube' ? `YouTube · ${item.channel}` : `ในเครื่อง · ${item.artist || 'ไม่ระบุศิลปิน'}`}</small>
      </div>
      <div className="queue-actions">
        <button type="button" className="icon-btn" onClick={() => queue.playNow(item.key)} title="เล่นเลย" aria-label="เล่นเลย">
          <Icon name="play" size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => queue.move(item.key, -1)} disabled={index === 0} aria-label="เลื่อนขึ้น">
          <Icon name="up" size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => queue.move(item.key, 1)} disabled={index === total - 1} aria-label="เลื่อนลง">
          <Icon name="down" size={16} />
        </button>
        <button type="button" className="icon-btn danger" onClick={() => queue.remove(item.key)} aria-label="ลบออกจากคิว">
          <Icon name="x" size={16} />
        </button>
      </div>
    </li>
  );
}

function LibraryPicker() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    const load = () => void songsDb.all().then(setSongs);
    load();
    return onSongsChanged(load);
  }, []);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? songs.filter((x) => `${x.title} ${x.artist}`.toLowerCase().includes(s)) : songs;
  }, [songs, q]);
  if (songs.length === 0) {
    return (
      <p className="muted">
        ยังไม่มีเพลงในคลัง — <a href={paths.newSong()}>เพิ่มเพลง</a>
      </p>
    );
  }
  return (
    <>
      {songs.length > 5 && (
        <label className="search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาในคลัง" />
        </label>
      )}
      <ul className="pick-list">
        {list.map((s) => {
          const ready = s.lines.length > 0 && syncedCount(s.lines) === s.lines.length;
          return (
            <li key={s.id}>
              <div>
                <strong>{s.title}</strong>
                <small className="muted">
                  {s.artist || 'ไม่ระบุศิลปิน'}
                  {!ready && ' · ยังซิงก์ไม่ครบ'}
                </small>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  queue.add({ key: newId(), kind: 'local', songId: s.id, title: s.title, artist: s.artist });
                  toast(`เพิ่ม "${s.title}" เข้าคิวแล้ว`, 'success');
                }}
              >
                <Icon name="plus" size={16} /> คิว
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function YouTubePicker() {
  const [prefs, setPrefsState] = useState(getPrefs);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<YouTubeVideo[] | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState(prefs.ytApiKey);
  /** คำค้นที่ค้นในเว็บไม่สำเร็จ → แสดงปุ่มไปค้นบน YouTube แทน */
  const [fallback, setFallback] = useState<string | null>(null);
  const apiKey = prefs.ytApiKey || BUILTIN_YT_KEY;

  const addVideo = (v: YouTubeVideo) => {
    queue.add({ key: newId(), kind: 'youtube', videoId: v.videoId, title: v.title, channel: v.channel });
    toast(`เพิ่ม "${v.title}" เข้าคิวแล้ว`, 'success');
  };

  const submit = async () => {
    const text = input.trim();
    if (!text) return;
    const id = parseYouTubeId(text);
    setBusy(true);
    try {
      if (id) {
        const info = await fetchVideoInfo(id);
        if (!info) toast('วิดีโอนี้อาจเป็นส่วนตัวหรือไม่อนุญาตให้ฝัง แต่จะลองเล่นให้', 'error');
        addVideo(info ?? { videoId: id, title: `YouTube ${id}`, channel: '', thumbnail: thumbnailUrl(id) });
        setInput('');
      } else if (apiKey) {
        setFallback(null);
        try {
          setResults(await searchYouTube(text, apiKey, prefs.ytKaraokeOnly));
        } catch (err) {
          setResults(null);
          setFallback(text);
          if (err instanceof YouTubeApiError && err.quotaExceeded) {
            toast('โควตาค้นหาของวันนี้หมดแล้ว — กดปุ่มด้านล่างเพื่อค้นบน YouTube แทน', 'info', 6000);
          } else {
            toast(`ค้นหาในเว็บไม่สำเร็จ: ${(err as Error).message}`, 'error', 6000);
          }
        }
      } else {
        window.open(youtubeSearchUrl(text, prefs.ytKaraokeOnly), '_blank', 'noopener');
        toast('เปิดผลค้นหาบน YouTube แล้ว — คัดลอกลิงก์วิดีโอมาวางที่นี่', 'info', 5000);
      }
    } catch (err) {
      toast((err as Error).message || 'ค้นหาไม่สำเร็จ', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="yt-picker">
      <form
        className="yt-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={apiKey ? 'พิมพ์ชื่อเพลง หรือวางลิงก์ YouTube' : 'วางลิงก์ YouTube (หรือพิมพ์ชื่อเพลงเพื่อค้นใน YouTube)'}
          aria-label="ลิงก์หรือชื่อเพลง"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
          {parseYouTubeId(input) ? <Icon name="plus" size={18} /> : <Icon name="search" size={18} />}
        </button>
      </form>
      <label className="check">
        <input
          type="checkbox"
          checked={prefs.ytKaraokeOnly}
          onChange={(e) => setPrefsState(setPrefs({ ytKaraokeOnly: e.target.checked }))}
        />
        ค้นหาเฉพาะเวอร์ชันคาราโอเกะ
      </label>

      {fallback && (
        <a className="btn btn-ghost btn-sm yt-fallback" href={youtubeSearchUrl(fallback, prefs.ytKaraokeOnly)} target="_blank" rel="noopener noreferrer">
          <Icon name="youtube" size={16} /> ค้นหา "{fallback}" บน YouTube
        </a>
      )}

      {results && (
        <ul className="yt-results">
          {results.length === 0 && <li className="muted">ไม่พบวิดีโอ</li>}
          {results.map((v) => (
            <li key={v.videoId}>
              <img src={v.thumbnail} alt="" loading="lazy" />
              <div>
                <strong>{v.title}</strong>
                <small className="muted">{v.channel}</small>
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => addVideo(v)}>
                <Icon name="plus" size={16} /> คิว
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="help">
        <summary>{BUILTIN_YT_KEY ? 'ใช้ API key ของตัวเอง (ไม่บังคับ)' : 'ค้นหาใน YouTube ได้ทันที (ใส่ API key)'}</summary>
        <p className="muted small">
          {BUILTIN_YT_KEY
            ? 'เว็บนี้ค้นหาได้ทันทีอยู่แล้ว โดยทุกคนใช้โควตาร่วมกันวันละประมาณ 100 ครั้ง ถ้าโควตาหมดบ่อย ใส่ key ของคุณเองได้ (สร้างฟรีที่ Google Cloud Console → YouTube Data API v3)'
            : 'ถ้าไม่มี key ระบบจะเปิดหน้าค้นหาของ YouTube ให้แทน หากต้องการค้นในหน้านี้เลย ให้สร้าง API key ฟรีที่ Google Cloud Console (เปิดใช้ YouTube Data API v3) แล้วนำมาวาง'}{' '}
          — key ของคุณจะเก็บไว้ในเบราว์เซอร์นี้เท่านั้น
        </p>
        <div className="yt-form">
          <input value={apiKeyDraft} onChange={(e) => setApiKeyDraft(e.target.value)} placeholder="YouTube Data API key" aria-label="API key" />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setPrefsState(setPrefs({ ytApiKey: apiKeyDraft.trim() }));
              toast(apiKeyDraft.trim() ? 'บันทึก API key แล้ว' : 'ลบ API key แล้ว', 'success');
            }}
          >
            บันทึก
          </button>
        </div>
      </details>
    </div>
  );
}

function NowPlaying({ item }: { item: QueueItem }) {
  const [song, setSong] = useState<Song | null>(null);
  const [ytRate, setYtRate] = useState(1);
  const [keyShift, setKeyShift] = useState(0);

  useEffect(() => {
    setSong(null);
    if (item.kind !== 'local') {
      // วิดีโอ YouTube ไม่ทราบคีย์ → Auto-Tune ใช้ทุกโน้ต
      getEngine().setSongKey(null);
      return;
    }
    void songsDb.get(item.songId).then((s) => {
      if (s) setSong(s);
      else {
        toast('ไม่พบเพลงนี้ในคลังแล้ว ข้ามไปเพลงถัดไป', 'error');
        queue.advance();
      }
    });
  }, [item]);

  const skip = (
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => queue.advance()} title="ข้ามเพลง (N)">
      <Icon name="skip" size={18} /> ข้าม
    </button>
  );

  return (
    <>
      {item.kind === 'youtube' ? (
        <div className="player">
          <div className="yt-stage">
            <YouTubePlayer
              videoId={item.videoId}
              rate={ytRate}
              onEnded={() => queue.advance()}
              onError={(msg) => {
                toast(`${msg} — ข้ามไปเพลงถัดไป`, 'error', 4000);
                setTimeout(() => {
                  if (queue.get().now?.key === item.key) queue.advance();
                }, 2500);
              }}
            />
          </div>
          <div className="transport">
            <div className="np-title">
              <strong>{item.title}</strong>
              <small className="muted">{item.channel}</small>
            </div>
            <div className="seg" title="ความเร็ว (คีย์ไม่เปลี่ยน)">
              {YT_RATES.map((r) => (
                <button key={r} type="button" className={ytRate === r ? 'on' : ''} onClick={() => setYtRate(r)}>
                  {r}x
                </button>
              ))}
            </div>
            {skip}
          </div>
          <p className="muted small yt-note">
            วิดีโอ YouTube ปรับคีย์/ตัดเสียงร้องไม่ได้ (ข้อจำกัดของ YouTube) แต่ใช้ไมค์ + Auto-Tune ร้องทับได้ — อยากปรับคีย์ ให้เพิ่มเพลงเป็นไฟล์ในคลัง
          </p>
        </div>
      ) : song ? (
        <KaraokePlayer song={song} autoPlay onEnded={() => queue.advance()} onKeyShift={setKeyShift} extraActions={skip} />
      ) : (
        <div className="card muted">กำลังโหลดเพลง…</div>
      )}
      <MicPanel keyShift={item.kind === 'local' ? keyShift : 0} songKey={item.kind === 'local' ? (song?.key ?? null) : null} />
    </>
  );
}

export function RoomPage() {
  const { now, next } = useQueue();
  const [tab, setTab] = useState<'library' | 'youtube'>('youtube');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'KeyN' && queue.get().now) queue.advance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>ห้องคาราโอเกะ</h1>
          <p className="muted">ต่อคิวเพลงจากคลังของคุณและ YouTube แล้วร้องต่อกันยาวๆ — เพลงจบจะเล่นเพลงถัดไปให้เอง</p>
        </div>
      </div>
      <div className="room-layout">
        <div className="room-main">
          {now ? (
            <NowPlaying key={now.key} item={now} />
          ) : (
            <div className="card room-idle">
              <Icon name="mic" size={44} />
              {next.length > 0 ? (
                <>
                  <h2>พร้อมร้องแล้ว! มี {next.length} เพลงในคิว</h2>
                  <button type="button" className="btn btn-primary btn-lg" onClick={() => queue.advance()}>
                    <Icon name="play" /> เริ่มเพลงแรก
                  </button>
                </>
              ) : (
                <>
                  <h2>ยังไม่มีเพลงในคิว</h2>
                  <p className="muted">เพิ่มเพลงจากแผงด้านข้าง — วางลิงก์ YouTube หรือเลือกจากคลังเพลงของคุณ</p>
                </>
              )}
            </div>
          )}
        </div>

        <aside className="room-side">
          <section className="card">
            <header className="card-head">
              <h2>
                <Icon name="queue" /> คิวเพลง {next.length > 0 && <span className="count">{next.length}</span>}
              </h2>
              {(next.length > 0 || now) && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (confirm('ล้างคิวทั้งหมด?')) queue.clear();
                  }}
                >
                  ล้างคิว
                </button>
              )}
            </header>
            {now && (
              <div className="now-row">
                <span className="eq" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <div>
                  <small className="muted">กำลังเล่น</small>
                  <strong>{now.title}</strong>
                </div>
              </div>
            )}
            {next.length === 0 ? (
              <p className="muted small">คิวว่าง</p>
            ) : (
              <ol className="queue-list">
                {next.map((item, i) => (
                  <QueueRow key={item.key} item={item} index={i} total={next.length} />
                ))}
              </ol>
            )}
            <p className="muted small">💡 เปิดหน้านี้อีกแท็บ/อีกหน้าต่างเพื่อเลือกเพลง คิวจะซิงก์กันอัตโนมัติ</p>
          </section>

          <section className="card">
            <div className="tabs">
              <button type="button" className={tab === 'youtube' ? 'on' : ''} onClick={() => setTab('youtube')}>
                <Icon name="youtube" size={18} /> YouTube
              </button>
              <button type="button" className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>
                <Icon name="music" size={18} /> คลังเพลง
              </button>
            </div>
            {tab === 'youtube' ? <YouTubePicker /> : <LibraryPicker />}
          </section>
        </aside>
      </div>
    </div>
  );
}
