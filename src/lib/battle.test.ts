import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBoard, isDraw, lineOwner, rankPlayers, recordBattle, tallyByOwner, type Player } from './battle';
import type { LineScore } from './scoring';

const line = (index: number, score: number, weight = 2): LineScore => ({
  index,
  text: `ท่อน ${index}`,
  score,
  pitch: score / 100,
  timing: 1,
  stability: 1,
  label: '',
  silent: score === 0,
  weight,
});
const players: Player[] = [
  { id: 'a', name: 'มด', color: '#f00' },
  { id: 'b', name: 'บอล', color: '#0f0' },
  { id: 'c', name: 'ปุ้ย', color: '#00f' },
];

describe('battle', () => {
  it('assigns lines to players by mode', () => {
    expect([0, 1, 2, 3, 4].map((i) => lineOwner('lines1', i, 2))).toEqual([0, 1, 0, 1, 0]);
    expect([0, 1, 2, 3, 4, 5].map((i) => lineOwner('lines2', i, 3))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(lineOwner('turns', 3, 2)).toBeNull();
  });

  it('tallies weighted line scores per owner and ranks with ties', () => {
    const lines = [line(0, 90, 4), line(1, 60), line(2, 70, 2), line(3, 80), line(4, 0), line(5, 80)];
    const t = tallyByOwner(lines, 'lines1', 3);
    // มด: ท่อน 0 (90×4) + 3 (80×2) = 86.7 → 87, บอล: 60 + 0 = 30, ปุ้ย: 70 + 80 = 75
    const s = rankPlayers(players, t);
    expect(s.map((r) => [r.player.name, r.score, r.rank])).toEqual([
      ['มด', 87, 1],
      ['ปุ้ย', 75, 2],
      ['บอล', 30, 3],
    ]);
    expect(s[0].great).toBe(1);
    expect(isDraw(s)).toBe(false);
    const tie = rankPlayers(players.slice(0, 2), tallyByOwner([line(0, 70), line(1, 70)], 'lines1', 2));
    expect(isDraw(tie)).toBe(true);
  });
});

describe('champion board', () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('counts wins, battles and best scores (no win on a draw)', () => {
    const t = tallyByOwner([line(0, 90), line(1, 50)], 'lines1', 2);
    recordBattle(rankPlayers(players.slice(0, 2), t));
    recordBattle(rankPlayers(players.slice(0, 2), tallyByOwner([line(0, 70), line(1, 70)], 'lines1', 2)));
    const board = getBoard();
    expect(board[0]).toEqual({ name: 'มด', wins: 1, battles: 2, best: 90 });
    expect(board[1]).toEqual({ name: 'บอล', wins: 0, battles: 2, best: 70 });
  });
});
