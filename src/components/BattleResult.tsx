import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PLAYER_COLORS, isDraw, type Standing } from '../lib/battle';
import { gradeFor } from '../lib/scoring';
import { fanfare } from './ScoreResult';

/** ประกาศผลการแข่ง: นับคะแนนขึ้น, มงกุฎ/พลุ, อันดับพร้อมแถบคะแนน */
export function BattleResult({ standings, title, children }: { standings: Standing[]; title: string; children?: ReactNode }) {
  const draw = isDraw(standings);
  const winners = standings.filter((s) => s.rank === 1);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1800);
      setShown(1 - Math.pow(1 - p, 3));
      if (p < 1) id = requestAnimationFrame(tick);
      else fanfare(draw ? 60 : 95);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [draw]);

  const done = shown >= 1;
  const confetti = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.2,
        dur: 2.4 + Math.random() * 1.8,
        color: [...PLAYER_COLORS, '#ffffff'][i % 5],
        rot: Math.random() * 360,
      })),
    [],
  );

  return (
    <section className="card battle-result">
      {done && !draw && (
        <div className="confetti" aria-hidden="true">
          {confetti.map((c, i) => (
            <i key={i} style={{ left: `${c.left}%`, background: c.color, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`, transform: `rotate(${c.rot}deg)` }} />
          ))}
        </div>
      )}
      <p className="muted">ผลการแข่ง · {title}</p>
      <h2 className="battle-winner">
        {!done ? 'กำลังนับคะแนน…' : draw ? '🤝 เสมอกัน!' : `👑 ${winners.map((w) => w.player.name).join(' & ')} ชนะ!`}
      </h2>
      <ol className="standings">
        {standings.map((s) => {
          const score = Math.round(s.score * shown);
          return (
            <li key={s.player.id} className={s.rank === 1 && done ? 'winner' : ''} style={{ borderColor: s.player.color }}>
              <span className="standing-rank">{s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : s.rank}</span>
              <span className="standing-main">
                <strong style={{ color: s.player.color }}>{s.player.name}</strong>
                <span className="standing-bar">
                  <span style={{ width: `${score}%`, background: s.player.color }} />
                </span>
                <small className="muted">
                  {s.lines} ท่อน · เยี่ยมมาก {s.great} ท่อน
                  {s.best && s.best.score > 0 && ` · ท่อนเด่น "${s.best.text}" (${s.best.score})`}
                </small>
              </span>
              <span className="standing-score">
                <strong>{score}</strong>
                <small>{done ? gradeFor(s.score).grade : ''}</small>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="row" style={{ justifyContent: 'center' }}>
        {children}
      </div>
    </section>
  );
}
