import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { GridBoard } from '../genre/GridBoard';
import { HandFan } from '../genre/HandFan';
import { ScorePanel } from '../genre/ScorePanel';
import { TrickTakingTable } from '../genre/TrickTakingTable';

function renderToDiv(element: React.ReactElement): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return container;
}

describe('GridBoard', () => {
  it('routes clicks by row and column and honours disabled cells', () => {
    const clicks: Array<[number, number]> = [];
    const el = renderToDiv(
      <GridBoard
        columns={2}
        isCellDisabled={(row, column) => row === 1 && column === 1}
        mode="cell"
        onCellClick={(row, column) => clicks.push([row, column])}
        renderCell={(row, column) => `${row},${column}`}
        rows={2}
      />,
    );
    const cells = el.querySelectorAll('button');
    expect(cells).toHaveLength(4);
    act(() => cells[1].click());
    act(() => cells[3].click());
    expect(clicks).toEqual([[0, 1]]);
    expect(cells[3].disabled).toBe(true);
  });

  it('renders intersection lines without exposing them as controls', () => {
    const el = renderToDiv(
      <GridBoard columns={3} mode="intersection" renderCell={() => null} rows={3} />,
    );
    expect(el.querySelector('svg')).toBeTruthy();
    expect(el.querySelectorAll('button')).toHaveLength(9);
    const cells = el.querySelectorAll('button');
    expect(cells[0]?.style.gridColumn).toBe('1');
    expect(cells[8]?.style.gridColumn).toBe('5');
    expect(cells[8]?.style.gridRow).toBe('5');
  });
});

describe('TrickTakingTable', () => {
  it('places the relative seats and center area', () => {
    const el = renderToDiv(
      <TrickTakingTable
        bottomPlayer={0}
        numPlayers={4}
        renderCenter={() => <span>trick</span>}
        renderSeat={(playerID, position) => <span>{`${position}:${playerID}`}</span>}
      />,
    );
    expect(el.textContent).toContain('bottom:0');
    expect(el.textContent).toContain('top:2');
    expect(el.textContent).toContain('left:1');
    expect(el.textContent).toContain('right:3');
    expect(el.textContent).toContain('trick');
  });
});

describe('HandFan', () => {
  it('owns card interaction and selected state', () => {
    const clicked: number[] = [];
    const el = renderToDiv(
      <HandFan
        cards={['a', 'b']}
        getCardKey={(card) => card}
        onCardClick={(_card, index) => clicked.push(index)}
        renderCard={(card) => card}
        selectedIndices={new Set([1])}
      />,
    );
    const cards = el.querySelectorAll('button');
    act(() => cards[1].click());
    expect(clicked).toEqual([1]);
    expect(cards[1].getAttribute('aria-pressed')).toBe('true');
  });
});

describe('ScorePanel', () => {
  it('renders active scores without overflowing labels structurally', () => {
    const el = renderToDiv(
      <ScorePanel
        entries={[{ id: 'p0', isActive: true, label: 'Player 0', score: 12, symbol: 'X' }]}
      />,
    );
    expect(el.textContent).toContain('Player 0: 12');
    expect(el.querySelector('.truncate')).toBeTruthy();
    expect(el.querySelector('.text-amber-200')).toBeTruthy();
  });
});
