import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getEngine, type EngineState } from '../audio/engine';

export function useEngineState(): EngineState {
  const engine = getEngine();
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}

/** ฟังก์ชัน callback ถูกเรียกทุกเฟรม (requestAnimationFrame) จนกว่า component จะ unmount */
export function useAnimationFrame(cb: (now: number) => void, active = true): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const loop = (now: number) => {
      ref.current(now);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}
