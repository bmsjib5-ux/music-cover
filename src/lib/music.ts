import type { MusicKey } from './types';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi: number): string {
  const n = Math.round(midi);
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

export function keyName(key: MusicKey | null, shift = 0): string {
  if (!key) return '';
  const root = (((key.root + shift) % 12) + 12) % 12;
  return `${NOTE_NAMES[root]}${key.mode === 'minor' ? 'm' : ''}`;
}

export function formatShift(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `${n}`;
}
