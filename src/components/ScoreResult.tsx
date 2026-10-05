import { useEffect, useState } from 'react';
import { getEngine } from '../audio/engine';
import type { FinalScore } from '../hooks/useScoring';
import { Icon } from './Icon';

interface Props {
  result: FinalScore;
  onRetry: () => void;
  onClose: () => void;
  /** มีเพลงถัดไปในคิว → นับถอยหลังแล้วไปต่ออัตโนมัติ */
  onNext?: () => void;
}

const NEXT_SECONDS = 12;

/** เสียงแตรสั้นๆ ตอนประกาศคะแนน */
export function fanfare(total: number): void {
  const ctx = getEngine().ctx;
  const notes = total >= 85 ? [72, 76, 79, 84] : total >= 55 ? [67, 72, 76] : [67, 64];
  const t0 = ctx.currentTime + 0.05;
  notes.forEach((m, i) => {
    const t = t0 + i * 0.12;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
    const len = i === notes.length - 1 ? 0.6 : 0.14;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + len + 0.05);
  });
}

function Bar({ label, value }: { label: string; value: number | null }) {
  const pct = value === null ? null : Math.round(value * 100);
  return (
    <div className="score-bar">
      <span>{label}</span>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <strong>{pct === null ? '—' : `${pct}%`}</strong>
    </div>
  );
}

export function ScoreResult({ result, onRetry, onClose, onNext }: Props) {
  const [shown, setShown] = useState(0);
  const [countdown, setCountdown] = useState(NEXT_SECONDS);

  // นับคะแนนขึ้นจาก 0 แบบตู้คาราโอเกะ
  useEffect(() => {
    const start = performance.now();
    const dur = 1600;
    let id = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      setShown(Math.round(result.total * (1 - Math.pow(1 - p, 3))));
      if (p < 1) id = requestAnimationFrame(tick);
      else fanfare(result.total);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [result.total]);

  useEffect(() => {
    if (!onNext) return;
    if (countdown <= 0) {
      onNext();
      return;
    }
    const h = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(h);
  }, [countdown, onNext]);

  const done = shown === result.total;
  const worst = [...result.lines].filter((l) => !l.silent).sort((a, b) => a.score - b.score)[0];

  return (
    <div className="score-result" role="dialog" aria-label="ผลคะแนน">
      <div className="score-card">
        {result.isBest && done && <div className="score-ribbon">🏆 สถิติใหม่!</div>}
        <div className="score-head">
          <div className={`score-grade grade-${result.grade}`}>{done ? result.grade : ''}</div>
          <div className="score-number">{shown}</div>
          <div className="score-of">คะแนน</div>
        </div>
        <p className="score-message">{done ? result.message : ' '}</p>
        <div className="score-bars">
          <Bar label={result.mode === 'melody' ? 'ความแม่นโน้ต' : 'ความตรงคีย์'} value={result.pitch} />
          <Bar label="ร้องตรงจังหวะ" value={result.timing} />
          <Bar label="ความนิ่งของเสียง" value={result.stability} />
        </div>
        <p className="score-note">
          {result.mode === 'melody' ? 'เทียบกับทำนองของเพลง' : 'ถอดทำนองจากเพลงนี้ได้ไม่ชัด จึงวัดความตรงโน้ตในคีย์ของเพลงแทน'}
          {result.best !== null && result.eligible && ` · สถิติสูงสุด ${result.best}`}
          {!result.eligible && ' · มีการข้ามหรือเริ่มกลางเพลง จึงไม่บันทึกสถิติ'}
          {worst && worst.score < 70 && ` · ท่อนที่ควรฝึก: "${worst.text}"`}
        </p>
        <div className="score-actions">
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            <Icon name="restart" size={18} /> ร้องอีกครั้ง
          </button>
          {onNext ? (
            <button type="button" className="btn btn-ghost" onClick={onNext}>
              <Icon name="skip" size={18} /> เพลงถัดไป ({countdown})
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              ปิด
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
