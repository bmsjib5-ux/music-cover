import { describe, expect, it } from 'vitest';
import { isRoomCode, makeRoomCode, normalizeRoomCode, ownerId, singersOf, sortPeers, type PeerInfo } from './protocol';

const peer = (id: string, joinedAt: number): PeerInfo => ({ id, name: id, host: false, status: 'lobby', joinedAt });

describe('online protocol', () => {
  it('makes and validates room codes', () => {
    for (let i = 0; i < 50; i++) expect(isRoomCode(makeRoomCode())).toBe(true);
    expect(normalizeRoomCode(' abc-234 ')).toBe('ABC234');
    expect(normalizeRoomCode('https://rong-loei.onrender.com/#/online/XyZ789')).toBe('XYZ789');
    expect(isRoomCode('ABC1O0')).toBe(false); // 1, O, 0 ไม่อยู่ในชุดตัวอักษร (กันสับสน)
  });

  it('orders peers by join time and caps singers at 4', () => {
    const peers = [peer('e', 5), peer('a', 1), peer('c', 3), peer('b', 1), peer('d', 4)];
    expect(sortPeers(peers).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(singersOf(peers).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('assigns line owners in alternate-line mode only', () => {
    const order = ['host', 'guest'];
    expect([0, 1, 2, 3].map((i) => ownerId('lines', order, i))).toEqual(['host', 'guest', 'host', 'guest']);
    expect(ownerId('together', order, 3)).toBeNull();
  });
});
