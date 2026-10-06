import { useEffect, useState } from 'react';

export type Route =
  | { name: 'library' }
  | { name: 'new'; youtube: boolean }
  | { name: 'edit'; id: string }
  | { name: 'sync'; id: string }
  | { name: 'sing'; id: string }
  | { name: 'room' }
  | { name: 'battle'; songId?: string }
  | { name: 'online'; code?: string; local: boolean }
  | { name: 'notFound' };

export function parseRoute(hash: string): Route {
  const [rawPath, query = ''] = (hash.replace(/^#/, '') || '/').split('?');
  const path = rawPath || '/';
  if (path === '/' || path === '') return { name: 'library' };
  if (path === '/room') return { name: 'room' };
  if (path === '/battle') return { name: 'battle' };
  const local = new URLSearchParams(query).has('local');
  if (path === '/online') return { name: 'online', local };
  const o = /^\/online\/([^/]+)$/.exec(path);
  if (o) return { name: 'online', code: decodeURIComponent(o[1]), local };
  const b = /^\/battle\/([^/]+)$/.exec(path);
  if (b) return { name: 'battle', songId: decodeURIComponent(b[1]) };
  if (path === '/song/new') return { name: 'new', youtube: new URLSearchParams(query).has('youtube') };
  const m = /^\/song\/([^/]+)\/(edit|sync|sing)$/.exec(path);
  if (m) return { name: m[2] as 'edit' | 'sync' | 'sing', id: decodeURIComponent(m[1]) };
  return { name: 'notFound' };
}

export const paths = {
  library: () => '#/',
  room: () => '#/room',
  battle: (songId?: string) => (songId ? `#/battle/${encodeURIComponent(songId)}` : '#/battle'),
  online: (code?: string) => (code ? `#/online/${encodeURIComponent(code)}` : '#/online'),
  newSong: (youtube?: boolean) => (youtube ? '#/song/new?youtube' : '#/song/new'),
  edit: (id: string) => `#/song/${encodeURIComponent(id)}/edit`,
  sync: (id: string) => `#/song/${encodeURIComponent(id)}/sync`,
  sing: (id: string) => `#/song/${encodeURIComponent(id)}/sing`,
};

export function navigate(hash: string): void {
  window.location.hash = hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
