import { useEffect, useRef, useState } from 'react';
import { songsDb } from '../lib/db';
import { navigate, paths } from '../lib/router';
import { parseLrc } from '../lib/lrc';
import { linesToText, mergeTimings, syncedCount, textToLines } from '../lib/lyrics';
import { searchLrclib, type LrclibResult } from '../lib/lrclib';
import { analyzeFile, quickDuration } from '../lib/songs';
import { formatTime } from '../lib/format';
import { keyName, NOTE_NAMES } from '../lib/music';
import { newId } from '../lib/id';
import { toast } from '../lib/toast';
import type { LyricLine, MusicKey, Song } from '../lib/types';
import { Icon } from '../components/Icon';

interface Props {
  id?: string;
}

/** "ศิลปิน - ชื่อเพลง.mp3" → { artist, title } */
function guessFromFileName(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  const m = /^(.+?)\s+[-–]\s+(.+)$/.exec(base);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base, artist: '' };
}

export function SongFormPage({ id }: Props) {
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileDuration, setFileDuration] = useState(0);
  const [lyrics, setLyrics] = useState('');
  /** เวลาซิงก์ที่ได้จากไฟล์ LRC / LRCLIB หรือของเดิม */
  const [timingSource, setTimingSource] = useState<LyricLine[]>([]);
  const [keyChoice, setKeyChoice] = useState<string>('auto');
  const [saving, setSaving] = useState<string | null>(null);
  const [results, setResults] = useState<LrclibResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const lrcInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    void songsDb.get(id).then((s) => {
      setLoading(false);
      if (!s) return;
      setSong(s);
      setTitle(s.title);
      setArtist(s.artist);
      setLyrics(linesToText(s.lines));
      setTimingSource(s.lines);
      setFileDuration(s.duration);
      setKeyChoice(s.key ? `${s.key.root}-${s.key.mode}` : 'auto');
    });
  }, [id]);

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|webm)$/i.test(f.name)) {
      toast('กรุณาเลือกไฟล์เสียง (MP3, M4A, WAV, OGG, FLAC)', 'error');
      return;
    }
    setFile(f);
    if (!title.trim()) {
      const g = guessFromFileName(f.name);
      setTitle(g.title);
      if (!artist.trim()) setArtist(g.artist);
    }
    setFileDuration(await quickDuration(f));
  };

  const applyLrcText = (text: string, source: string) => {
    const parsed = parseLrc(text);
    if (parsed.lines.length === 0) {
      toast('ไม่พบเนื้อเพลงในไฟล์', 'error');
      return;
    }
    setLyrics(linesToText(parsed.lines));
    setTimingSource(parsed.timed ? parsed.lines : []);
    if (parsed.title && !title.trim()) setTitle(parsed.title);
    if (parsed.artist && !artist.trim()) setArtist(parsed.artist);
    toast(parsed.timed ? `ใส่เนื้อพร้อมเวลาซิงก์จาก${source}แล้ว` : `ใส่เนื้อจาก${source}แล้ว (ยังไม่มีเวลา)`, 'success');
  };

  const search = async () => {
    if (!title.trim()) {
      toast('กรอกชื่อเพลงก่อนค้นหา', 'error');
      return;
    }
    setSearching(true);
    setResults(null);
    try {
      setResults(await searchLrclib(title, artist));
    } catch {
      toast('ค้นหาไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต', 'error');
    } finally {
      setSearching(false);
    }
  };

  const pickResult = (r: LrclibResult) => {
    applyLrcText(r.syncedLyrics ?? r.plainLyrics ?? '', ' LRCLIB ');
    if (!artist.trim()) setArtist(r.artistName);
    setResults(null);
  };

  const save = async () => {
    if (!title.trim()) {
      toast('กรุณาใส่ชื่อเพลง', 'error');
      return;
    }
    if (!file && !song?.audio) {
      toast('กรุณาเลือกไฟล์เพลง', 'error');
      return;
    }
    const lines = mergeTimings(timingSource, textToLines(lyrics));
    let info: Pick<Song, 'duration' | 'stereo' | 'peaks' | 'key'> = {
      duration: song?.duration ?? fileDuration,
      stereo: song?.stereo ?? null,
      peaks: song?.peaks ?? [],
      key: song?.key ?? null,
    };
    if (file) {
      setSaving('กำลังวิเคราะห์ไฟล์เพลง (หาคีย์, ตรวจสเตอริโอ)…');
      try {
        info = await analyzeFile(file);
      } catch {
        info = { duration: fileDuration, stereo: null, peaks: [], key: null };
        toast('วิเคราะห์ไฟล์ไม่สำเร็จ แต่ยังบันทึกได้', 'error');
      }
    }
    if (keyChoice !== 'auto') {
      const [root, mode] = keyChoice.split('-');
      info.key = { root: parseInt(root, 10), mode: mode as MusicKey['mode'] };
    }
    setSaving('กำลังบันทึก…');
    const now = Date.now();
    const next: Song = {
      id: song?.id ?? newId(),
      createdAt: song?.createdAt ?? now,
      updatedAt: now,
      title: title.trim(),
      artist: artist.trim(),
      audio: file ?? song?.audio ?? null,
      audioName: file?.name ?? song?.audioName ?? '',
      offset: song?.offset ?? 0,
      demo: song?.demo,
      lines,
      ...info,
    };
    try {
      await songsDb.put(next);
    } catch {
      setSaving(null);
      toast('บันทึกไม่สำเร็จ (พื้นที่เก็บข้อมูลอาจเต็ม)', 'error');
      return;
    }
    setSaving(null);
    const synced = lines.length > 0 && syncedCount(lines) === lines.length;
    toast('บันทึกเพลงแล้ว', 'success');
    navigate(synced ? paths.sing(next.id) : paths.sync(next.id));
  };

  if (loading) return <div className="page muted">กำลังโหลด…</div>;
  if (id && !song) return <div className="page">ไม่พบเพลงนี้</div>;

  const lineCount = textToLines(lyrics).length;
  const timedCount = syncedCount(mergeTimings(timingSource, textToLines(lyrics)));
  const audioName = file?.name ?? song?.audioName;

  return (
    <div className="page narrow">
      <a className="back-link" href={paths.library()}>
        <Icon name="back" size={18} /> คลังเพลง
      </a>
      <h1>{song ? 'แก้ไขเพลง' : 'เพิ่มเพลงใหม่'}</h1>

      <section className="card form">
        <div
          className={`dropzone ${dragOver ? 'over' : ''} ${audioName ? 'has-file' : ''}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void pickFile(e.dataTransfer.files[0]);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
        >
          <Icon name={audioName ? 'music' : 'upload'} size={30} />
          {audioName ? (
            <>
              <strong>{audioName}</strong>
              <span className="muted">{fileDuration > 0 && `${formatTime(fileDuration)} · `}แตะเพื่อเปลี่ยนไฟล์</span>
            </>
          ) : (
            <>
              <strong>เลือกไฟล์เพลง หรือลากมาวางที่นี่</strong>
              <span className="muted">MP3, M4A, WAV, OGG, FLAC — ไฟล์อยู่ในเครื่องคุณเท่านั้น</span>
            </>
          )}
          <input ref={fileInput} type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
        </div>

        <div className="form-row">
          <label className="field">
            <span>ชื่อเพลง *</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น คิดถึง" />
          </label>
          <label className="field">
            <span>ศิลปิน</span>
            <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="เช่น ปาล์มมี่" />
          </label>
          <label className="field small">
            <span>คีย์เพลง</span>
            <select value={keyChoice} onChange={(e) => setKeyChoice(e.target.value)}>
              <option value="auto">{song?.key ? `ตรวจพบ: ${keyName(song.key)}` : 'ตรวจอัตโนมัติ'}</option>
              {(['major', 'minor'] as const).flatMap((mode) =>
                NOTE_NAMES.map((n, root) => (
                  <option key={`${root}-${mode}`} value={`${root}-${mode}`}>
                    {n}
                    {mode === 'minor' ? 'm' : ''}
                  </option>
                )),
              )}
            </select>
          </label>
        </div>

        <div className="field">
          <div className="field-head">
            <span>เนื้อเพลง (บรรทัดละท่อน)</span>
            <div className="row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void search()} disabled={searching}>
                <Icon name="search" size={16} /> {searching ? 'กำลังค้นหา…' : 'ค้นเนื้อจาก LRCLIB'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => lrcInput.current?.click()}>
                <Icon name="file" size={16} /> นำเข้า .lrc / .txt
              </button>
              <input
                ref={lrcInput}
                type="file"
                accept=".lrc,.txt,text/plain"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) applyLrcText(await f.text(), 'ไฟล์');
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          {results && (
            <div className="lrclib-results">
              {results.length === 0 ? (
                <p className="muted">ไม่พบเนื้อเพลงนี้ใน LRCLIB — วางเนื้อเองได้เลย</p>
              ) : (
                results.map((r) => {
                  const close = fileDuration > 0 && Math.abs(r.duration - fileDuration) <= 3;
                  return (
                    <div key={r.id} className={`lrclib-item ${close ? 'match' : ''}`}>
                      <div>
                        <strong>{r.trackName}</strong>
                        <span className="muted">
                          {' '}
                          — {r.artistName}
                          {r.albumName ? ` (${r.albumName})` : ''} · {formatTime(r.duration)}
                        </span>
                        <div className="badges">
                          {r.syncedLyrics ? <span className="badge ok">มีเวลาซิงก์</span> : <span className="badge">เนื้ออย่างเดียว</span>}
                          {close && <span className="badge accent">ความยาวตรงกับไฟล์</span>}
                        </div>
                      </div>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => pickResult(r)}>
                        ใช้เนื้อนี้
                      </button>
                    </div>
                  );
                })
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResults(null)}>
                ปิด
              </button>
            </div>
          )}

          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            rows={14}
            placeholder={'วางเนื้อเพลงที่นี่ บรรทัดละหนึ่งท่อน\nเช่น\nคิดถึงเธอทุกที ที่อยู่คนเดียว\n…'}
          />
          <div className="field-foot muted small">
            {lineCount} บรรทัด
            {timedCount > 0 && ` · มีเวลาซิงก์ ${timedCount}/${lineCount}`}
            {' · '}แก้คำผิดได้โดยเวลาซิงก์ไม่หาย
          </div>
        </div>

        <div className="form-actions">
          <a className="btn btn-ghost" href={song ? paths.sing(song.id) : paths.library()}>
            ยกเลิก
          </a>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!!saving}>
            {saving ?? (
              <>
                บันทึก {lineCount > 0 && timedCount === lineCount ? 'แล้วร้องเลย' : 'แล้วไปซิงก์เนื้อ'} <Icon name="back" size={16} style={{ transform: 'rotate(180deg)' }} />
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}
