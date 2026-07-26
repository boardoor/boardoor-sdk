import { describe, it, expect } from 'vitest';

import { computeTablePositions } from '../layout/table-positions';

describe('computeTablePositions', () => {
  it('2 players: one top, no sides', () => {
    const pos = computeTablePositions(0, 2);
    expect(pos).toEqual({ bottom: '0', top: ['1'], left: null, right: null });
  });

  it('3 players: one top, one left', () => {
    const pos = computeTablePositions(0, 3);
    expect(pos).toEqual({ bottom: '0', top: ['2'], left: '1', right: null });
  });

  it('4 players: one top, left and right', () => {
    const pos = computeTablePositions(0, 4);
    expect(pos).toEqual({ bottom: '0', top: ['2'], left: '1', right: '3' });
  });

  it('5 players: two top, left and right', () => {
    const pos = computeTablePositions(0, 5);
    expect(pos).toEqual({ bottom: '0', top: ['2', '3'], left: '1', right: '4' });
  });

  it('6 players: three top, left and right', () => {
    const pos = computeTablePositions(0, 6);
    expect(pos).toEqual({ bottom: '0', top: ['2', '3', '4'], left: '1', right: '5' });
  });

  it('rotates positions based on bottomNum', () => {
    const pos = computeTablePositions(2, 4);
    expect(pos).toEqual({ bottom: '2', top: ['0'], left: '3', right: '1' });
  });

  it('wraps player IDs correctly', () => {
    const pos = computeTablePositions(3, 4);
    expect(pos).toEqual({ bottom: '3', top: ['1'], left: '0', right: '2' });
  });
});
