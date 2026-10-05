import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3200): void {
  const t = { id: ++seq, text, kind };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, ms);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => toasts,
    () => toasts,
  );
}
