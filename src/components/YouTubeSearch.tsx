import { useState } from 'react';
import { getPrefs, setPrefs } from '../lib/prefs';
import { toast } from '../lib/toast';
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
import { Icon } from './Icon';

interface Props {
  /** เลือกวิดีโอ (จากผลค้นหาหรือวางลิงก์) */
  onPick: (video: YouTubeVideo) => void;
  /** ข้อความบนปุ่มเลือก เช่น "คิว" หรือ "เลือก" */
  actionLabel: string;
}

/** ค้นหาวิดีโอ YouTube (API key ที่ฝังไว้/ของผู้ใช้) หรือวางลิงก์ */
export function YouTubeSearch({ onPick, actionLabel }: Props) {
  const [prefs, setPrefsState] = useState(getPrefs);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<YouTubeVideo[] | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState(prefs.ytApiKey);
  /** คำค้นที่ค้นในเว็บไม่สำเร็จ → แสดงปุ่มไปค้นบน YouTube แทน */
  const [fallback, setFallback] = useState<string | null>(null);
  const apiKey = prefs.ytApiKey || BUILTIN_YT_KEY;

  const addVideo = onPick;

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
                <Icon name="plus" size={16} /> {actionLabel}
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
