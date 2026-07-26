import { describe, expect, it } from 'vitest';

import {
  appendGameLog,
  extractGameLogDelta,
  filterGameLogForPlayer,
  gameLogMessageParam,
  resolveGameLogText,
} from '../game-log';

describe('game log helpers', () => {
  it('appends log entries with sequence and turn', () => {
    const G = { gameLog: [], gameLogSequence: 0 };
    appendGameLog(
      G,
      { turn: 3 },
      {
        playerId: '0',
        publicMessageKey: 'log.public',
      },
      { enabled: true, level: 'detail' },
    );

    expect(G.gameLog).toHaveLength(1);
    expect(G.gameLog[0]).toMatchObject({
      id: 'log-1',
      sequence: 1,
      turn: 3,
      publicMessageKey: 'log.public',
    });
  });

  it('trims to max entries', () => {
    const G = { gameLog: [], gameLogSequence: 0 };
    for (let i = 0; i < 3; i++) {
      appendGameLog(
        G,
        { turn: i + 1 },
        { playerId: '0', publicMessageKey: `log.${i}` },
        { enabled: true, level: 'detail', maxEntries: 2 },
      );
    }

    expect(G.gameLog).toHaveLength(2);
    expect(G.gameLog[0].id).toBe('log-2');
    expect(G.gameLog[1].id).toBe('log-3');
  });

  it('extracts game-log delta after a known sequence', () => {
    const G = { gameLog: [], gameLogSequence: 0 };
    for (let i = 0; i < 3; i++) {
      appendGameLog(
        G,
        { turn: i + 1 },
        { playerId: '0', publicMessageKey: `log.${i}` },
        { enabled: true, level: 'detail' },
      );
    }

    expect(extractGameLogDelta(G, 1)).toEqual({
      entries: [G.gameLog[1], G.gameLog[2]],
      fromSequenceExclusive: 1,
      toSequence: 3,
      truncated: false,
    });
  });

  it('marks game-log delta truncated when the ring buffer dropped requested entries', () => {
    const G = { gameLog: [], gameLogSequence: 0 };
    for (let i = 0; i < 5; i++) {
      appendGameLog(
        G,
        { turn: i + 1 },
        { playerId: '0', publicMessageKey: `log.${i}` },
        { enabled: true, level: 'detail', maxEntries: 2 },
      );
    }

    expect(extractGameLogDelta(G, 1)).toEqual({
      entries: [G.gameLog[0], G.gameLog[1]],
      fromSequenceExclusive: 1,
      toSequence: 5,
      truncated: true,
    });
  });

  it('returns an empty non-truncated delta when already caught up', () => {
    const G = { gameLog: [], gameLogSequence: 0 };
    appendGameLog(
      G,
      { turn: 1 },
      { playerId: '0', publicMessageKey: 'log.0' },
      { enabled: true, level: 'detail' },
    );

    expect(extractGameLogDelta(G, 1)).toEqual({
      entries: [],
      fromSequenceExclusive: 1,
      toSequence: 1,
      truncated: false,
    });
  });

  it('filters private details for other players', () => {
    const [filtered] = filterGameLogForPlayer(
      [
        {
          id: 'log-1',
          sequence: 1,
          turn: 1,
          playerId: '0',
          publicMessageKey: 'log.public',
          privateMessageKey: 'log.private',
          privateParams: { card: 'A' },
          privatePlayerIds: { actorName: '0' },
          audience: 'self',
        },
      ],
      '1',
    );

    expect(filtered.privateMessageKey).toBeUndefined();
    expect(filtered.privateParams).toBeUndefined();
    expect(filtered.privatePlayerIds).toBeUndefined();
  });

  it('uses private text only for allowed viewer at detail level', () => {
    const entry = {
      id: 'log-1',
      sequence: 1,
      turn: 1,
      playerId: '0',
      publicMessageKey: 'log.public',
      publicParams: { kind: 'public' },
      privateMessageKey: 'log.private',
      privateParams: { kind: 'private' },
      audience: 'self' as const,
    };
    const t = (key: string, params?: Record<string, unknown>) => `${key}:${params?.kind ?? ''}`;

    expect(resolveGameLogText(entry, '0', 'detail', t)).toBe('log.private:private');
    expect(resolveGameLogText(entry, '1', 'detail', t)).toBe('log.public:public');
    expect(resolveGameLogText({ ...entry, detailOnly: true }, '0', 'action', t)).toBeNull();
  });

  it('resolves player names from matchData into log params', () => {
    const entry = {
      id: 'log-1',
      sequence: 1,
      turn: 1,
      playerId: '0',
      publicMessageKey: 'log.public',
      publicParams: { quantity: 2 },
      publicPlayerIds: { playerName: '0', targetName: '1' },
    };
    const t = (_key: string, params?: Record<string, unknown>) =>
      `${params?.playerName} -> ${params?.targetName} (${params?.quantity})`;

    expect(
      resolveGameLogText(entry, '0', 'detail', t, [
        { id: 0, name: 'Alice' },
        { id: 1, name: 'CPU 1' },
      ]),
    ).toBe('Alice -> CPU 1 (2)');
  });

  it('resolves nested translatable params before formatting the log line', () => {
    const entry = {
      id: 'log-1',
      sequence: 1,
      turn: 1,
      playerId: '0',
      publicMessageKey: 'log.roll',
      publicParams: {
        event: gameLogMessageParam('log.event', { n: 6 }),
        phase: gameLogMessageParam('log.phase'),
      },
    };
    const t = (key: string, params?: Record<string, unknown>) => {
      switch (key) {
        case 'log.roll':
          return `${params?.event} @ ${params?.phase}`;
        case 'log.event':
          return `Point ${params?.n}`;
        case 'log.phase':
          return 'Come Out Roll';
        default:
          return key;
      }
    };

    expect(resolveGameLogText(entry, '0', 'detail', t)).toBe('Point 6 @ Come Out Roll');
  });

  it('omits undefined nested params when creating a translatable param', () => {
    const param = gameLogMessageParam('log.phase');

    expect(param).toEqual({ __gameLogMessageKey: 'log.phase' });
    expect(Object.hasOwn(param, '__gameLogMessageParams')).toBe(false);
  });

  it('omits undefined log entry fields and nested param keys when appending', () => {
    const G = { gameLog: [], gameLogSequence: 0 };
    appendGameLog(
      G,
      { turn: 1 },
      {
        publicMessageKey: 'log.public',
        publicParams: {
          kept: 'value',
          omitted: undefined,
          nested: { kept: 1, omitted: undefined },
        },
        privateParams: undefined,
      },
      { enabled: true, level: 'detail' },
    );

    expect(G.gameLog[0]).not.toHaveProperty('privateParams');
    expect(G.gameLog[0].publicParams).toEqual({
      kept: 'value',
      nested: { kept: 1 },
    });
  });
});
