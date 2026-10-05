import { useSyncExternalStore } from 'react';
import type { QueueItem } from './types';

export interface QueueState {
  now: QueueItem | null;
  next: QueueItem[];
}

const KEY = 'rongloei.queue.v1';
const listeners = new Set<() => void>();

function load(): QueueState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as QueueState;
      return { now: s.now ?? null, next: Array.isArray(s.next) ? s.next : [] };
    }
  } catch {
    /* ignore */
  }
  return { now: null, next: [] };
}

let state: QueueState = typeof localStorage === 'undefined' ? { now: null, next: [] } : load();

function set(next: QueueState) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

if (typeof window !== 'undefined') {
  // ซิงก์คิวระหว่างแท็บ (เช่น เปิดจอใหญ่ไว้แท็บหนึ่ง แล้วเลือกเพลงจากอีกแท็บ)
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      state = load();
      listeners.forEach((fn) => fn());
    }
  });
}

export const queue = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  add(item: QueueItem) {
    set({ ...state, next: [...state.next, item] });
  },
  addNext(item: QueueItem) {
    set({ ...state, next: [item, ...state.next] });
  },
  remove(key: string) {
    set({ ...state, next: state.next.filter((i) => i.key !== key) });
  },
  move(key: string, dir: -1 | 1) {
    const next = [...state.next];
    const i = next.findIndex((x) => x.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set({ ...state, next });
  },
  playNow(key: string) {
    const item = state.next.find((i) => i.key === key);
    if (!item) return;
    set({ now: item, next: state.next.filter((i) => i.key !== key) });
  },
  /** ไปเพลงถัดไป */
  advance() {
    const [head, ...rest] = state.next;
    set({ now: head ?? null, next: rest });
  },
  stop() {
    set({ ...state, now: null });
  },
  clear() {
    set({ now: null, next: [] });
  },
};

export function useQueue(): QueueState {
  return useSyncExternalStore(queue.subscribe, queue.get, queue.get);
}
