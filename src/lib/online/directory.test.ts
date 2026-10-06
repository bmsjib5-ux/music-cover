import { describe, expect, it } from 'vitest';
import { sortListings, type RoomListing } from './directory';

const room = (code: string, patch: Partial<RoomListing> = {}): RoomListing => ({
  code,
  hostName: 'host',
  songTitle: null,
  youtube: false,
  players: 1,
  playing: false,
  createdAt: 1000,
  ...patch,
});

describe('room list', () => {
  it('shows joinable rooms first, newest first', () => {
    const list = sortListings([
      room('AAAAAA', { createdAt: 1 }),
      room('BBBBBB', { createdAt: 3, playing: true }),
      room('CCCCCC', { createdAt: 2 }),
      room('DDDDDD', { createdAt: 4, players: 4 }),
    ]);
    expect(list.map((r) => r.code)).toEqual(['CCCCCC', 'AAAAAA', 'DDDDDD', 'BBBBBB']);
  });

  it('keeps one entry per room code (the newest)', () => {
    const list = sortListings([room('AAAAAA', { createdAt: 1, hostName: 'old' }), room('AAAAAA', { createdAt: 5, hostName: 'new' })]);
    expect(list).toHaveLength(1);
    expect(list[0].hostName).toBe('new');
  });
});
