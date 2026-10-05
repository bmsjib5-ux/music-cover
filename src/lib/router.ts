import { useEffect, useState } from 'react';

export type Route =
  | { name: 'library' }
  | { name: 'new' }
  | { name: 'edit'; id: string }
  | { name: 'sync'; id: string }
  | { name: 'sing'; id: string }
  | { name: 'room' }
  | { name: 'notFound' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/';
  if (path === '/' || path === '') return { name: 'library' };
  if (path === '/room') return { name: 'room' };
  if (path === '/song/new') return { name: 'new' };
  const m = /^\/song\/([^/]+)\/(edit|sync|sing)$/.exec(path);
  if (m) return { name: m[2] as 'edit' | 'sync' | 'sing', id: decodeURIComponent(m[1]) };
  return { name: 'notFound' };
}

export const paths = {
  library: () => '#/',
  room: () => '#/room',
  newSong: () => '#/song/new',
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
