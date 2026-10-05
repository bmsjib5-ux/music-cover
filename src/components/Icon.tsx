import type { CSSProperties } from 'react';

const PATHS: Record<string, string> = {
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  skip: 'M5 5v14l10-7zM18 5v14',
  restart: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5',
  mic: 'M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
  micOff: 'M4 4l16 16M9 9v2a3 3 0 0 0 5 2.2M15 9.5V6a3 3 0 0 0-5.8-1M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11a6.5 6.5 0 0 1-.6 2.7M12 17.5V21',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5',
  edit: 'M4 20h4.5L19 9.5 14.5 5 4 15.5zM12.5 7l4.5 4.5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9.5l5-5 5 5M5 20h14',
  back: 'M15 5l-7 7 7 7',
  maximize: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  minimize: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  music: 'M9 18V5.5l11-2V16M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  youtube: 'M3 9a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM10 9.5v5l4.5-2.5z',
  volume: 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  wand: 'M12 3l1.6 3.9L17.5 8.5l-3.9 1.6L12 14l-1.6-3.9L6.5 8.5l3.9-1.6zM18.5 14l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8zM6 15.5l.8 1.7 1.7.8-1.7.8L6 20.5l-.8-1.7-1.7-.8 1.7-.8z',
  gauge: 'M12 14l4-4.5M3.5 18.5a9.5 9.5 0 1 1 17 0',
  key: 'M8 4v16M16 4v16M4 9h16M4 15h16',
  headphones: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  queue: 'M4 6h12M4 12h12M4 18h7M17 15v6M14 18h6',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  sparkle: 'M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M6.5 17.5L9 15M15 9l2.5-2.5',
};

const FILLED = new Set(['play', 'pause', 'record', 'stop']);

export function Icon({ name, size = 20, style, className }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  if (name === 'record') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className} style={style}>
        <circle cx="12" cy="12" r="7" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'stop') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className} style={style}>
        <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
      </svg>
    );
  }
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      style={style}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
