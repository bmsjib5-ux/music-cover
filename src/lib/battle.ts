import type { LineScore } from './scoring';

export interface Player {
  id: string;
  name: string;
  color: string;
}

/** lines1 = สลับทีละท่อน, lines2 = สลับทีละ 2 ท่อน, turns = ผลัดกันร้องทั้งเพลง */
export type BattleMode = 'lines1' | 'lines2' | 'turns';

export const BATTLE_MODES: { id: BattleMode; label: string; hint: string }[] = [
  { id: 'lines1', label: 'สลับทีละท่อน', hint: 'ผลัดกันร้องคนละท่อนในเพลงเดียว ดูสีเนื้อเพลงว่าตาใคร' },
  { id: 'lines2', label: 'สลับทีละ 2 ท่อน', hint: 'ได้ร้องต่อเนื่องนานขึ้น เหมาะกับเพลงช้า' },
  { id: 'turns', label: 'ร้องคนละรอบ', hint: 'แต่ละคนร้องทั้งเพลง แล้วเทียบคะแนนรวม' },
];

export const PLAYER_COLORS = ['#ff4fa3', '#39d5ff', '#ffd166', '#3ddc97'];
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** ท่อนที่ i (ลำดับในไทม์ไลน์) เป็นตาของผู้เล่นคนไหน — null = โหมดร้องคนละรอบ */
export function lineOwner(mode: BattleMode, lineIndex: number, players: number): number | null {
  if (mode === 'turns' || players < 1) return null;
  const per = mode === 'lines2' ? 2 : 1;
  return Math.floor(lineIndex / per) % players;
}

export interface Tally {
  weight: number;
  sum: number;
  lines: number;
  /** จำนวนท่อนที่ได้ 90 ขึ้นไป */
  great: number;
  best: LineScore | null;
}

export function emptyTally(): Tally {
  return { weight: 0, sum: 0, lines: 0, great: 0, best: null };
}

export function addLine(t: Tally, line: LineScore): Tally {
  return {
    weight: t.weight + line.weight,
    sum: t.sum + line.score * line.weight,
    lines: t.lines + 1,
    great: t.great + (line.score >= 90 ? 1 : 0),
    best: !t.best || line.score > t.best.score ? line : t.best,
  };
}

export function tallyScore(t: Tally): number | null {
  return t.weight > 0 ? Math.round(t.sum / t.weight) : null;
}

/** แบ่งคะแนนรายท่อนให้ผู้เล่นแต่ละคน (โหมดสลับท่อน) */
export function tallyByOwner(lines: LineScore[], mode: BattleMode, players: number): Tally[] {
  const tallies = Array.from({ length: players }, emptyTally);
  for (const line of lines) {
    const owner = lineOwner(mode, line.index, players);
    if (owner !== null) tallies[owner] = addLine(tallies[owner], line);
  }
  return tallies;
}

export interface Standing {
  player: Player;
  score: number;
  /** 1 = ชนะ (เสมอได้หลายคน) */
  rank: number;
  great: number;
  lines: number;
  best: LineScore | null;
}

export function rankPlayers(players: Player[], tallies: Tally[]): Standing[] {
  const rows = players.map((player, i) => ({
    player,
    score: tallyScore(tallies[i]) ?? 0,
    great: tallies[i].great,
    lines: tallies[i].lines,
    best: tallies[i].best,
    rank: 0,
  }));
  rows.sort((a, b) => b.score - a.score || b.great - a.great);
  rows.forEach((r, i) => {
    r.rank = i > 0 && r.score === rows[i - 1].score && r.great === rows[i - 1].great ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

/** ทุกคนได้อันดับ 1 = เสมอกันหมด */
export function isDraw(standings: Standing[]): boolean {
  return standings.length > 1 && standings.every((s) => s.rank === 1);
}

// ---------- ทำเนียบแชมป์ ----------
export interface BoardEntry {
  name: string;
  wins: number;
  battles: number;
  best: number;
}

const BOARD_KEY = 'rongloei.battleBoard.v1';

export function getBoard(): BoardEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(BOARD_KEY) ?? '[]') as BoardEntry[];
    return raw.sort((a, b) => b.wins - a.wins || b.best - a.best);
  } catch {
    return [];
  }
}

export function recordBattle(standings: Standing[]): void {
  const board = getBoard();
  const draw = isDraw(standings);
  for (const s of standings) {
    const name = s.player.name.trim() || 'ไม่ระบุชื่อ';
    let entry = board.find((e) => e.name === name);
    if (!entry) {
      entry = { name, wins: 0, battles: 0, best: 0 };
      board.push(entry);
    }
    entry.battles++;
    entry.best = Math.max(entry.best, s.score);
    if (!draw && s.rank === 1) entry.wins++;
  }
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(board));
  } catch {
    /* ignore */
  }
}

export function clearBoard(): void {
  try {
    localStorage.removeItem(BOARD_KEY);
  } catch {
    /* ignore */
  }
}
