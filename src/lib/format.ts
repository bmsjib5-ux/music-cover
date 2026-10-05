export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** mm:ss.xx */
export function formatTimePrecise(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '--:--.--';
  const cs = Math.max(0, Math.round(sec * 100));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const x = cs % 100;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${x.toString().padStart(2, '0')}`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'song';
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
