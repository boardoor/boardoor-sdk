import { describe, expect, it } from 'vitest';

import type { GameLogEntry, GameLogStateShape } from '../game-log';
import { validateReplayPackage } from '../replay';
import { createReplayRecorder } from '../replay-recorder';
import type { State } from '../types';

interface TestG extends GameLogStateShape {
  board: string[];
}

function log(sequence: number, publicMessageKey = `log.${sequence}`): GameLogEntry {
  return {
    id: `log-${sequence}`,
    sequence,
    turn: sequence,
    playerId: `${sequence % 2}`,
    publicMessageKey,
  };
}

function state(
  stateId: number,
  G: TestG,
  options: {
    turn?: number;
    phase?: string | null;
    deltalog?: State<TestG>['deltalog'];
    seed?: string | number;
  } = {},
): State<TestG> {
  return {
    G,
    ctx: {
      numPlayers: 2,
      playOrder: ['0', '1'],
      playOrderPos: 0,
      activePlayers: null,
      currentPlayer: '0',
      turn: options.turn ?? stateId,
      phase: options.phase === undefined ? 'play' : options.phase,
      _random: options.seed === undefined ? undefined : { seed: options.seed },
    },
    deltalog: options.deltalog,
    plugins: {},
    _undo: [],
    _redo: [],
    _stateID: stateId,
  };
}

function buildOptions() {
  return {
    matchId: 'match-1',
    slug: 'reversi',
    createdAt: 100,
    finishedAt: 200,
    participants: [
      { playerId: '0', userId: 'user-0', isAi: false },
      { playerId: '1', isAi: true },
    ],
    resultSummary: { winner: '0' },
    engineVersion: '1.0.0',
    gameVersion: '2026-05-15',
  };
}

describe('replay recorder', () => {
  it('appends snapshot steps in increasing stateId and index order', () => {
    const recorder = createReplayRecorder();
    const firstState = state(
      1,
      {
        board: ['a'],
        gameLog: [log(1)],
        gameLogSequence: 1,
        logConfig: { enabled: true, level: 'action' },
      },
      {
        deltalog: [
          {
            _stateID: 0,
            turn: 1,
            phase: 'play',
            action: { type: 'MAKE_MOVE', payload: { type: 'place', playerID: '0' } },
          },
        ],
        seed: 'seed-1',
      },
    );

    const first = recorder.append({ state: firstState });
    firstState.G.board.push('mutated-after-record');
    const second = recorder.append({
      state: state(2, {
        board: ['a', 'b'],
        gameLog: [log(1), log(2)],
        gameLogSequence: 2,
        logConfig: { enabled: true, level: 'action' },
      }),
      action: { type: 'GAME_EVENT', payload: { type: 'endTurn' } },
    });

    expect(first).toMatchObject({
      index: 0,
      stateId: 1,
      actorPlayerId: '0',
      gameLogDelta: [log(1)],
      gameLogDeltaMeta: {
        fromSequenceExclusive: 0,
        toSequence: 1,
        truncated: false,
      },
    });
    expect(second).toMatchObject({
      index: 1,
      stateId: 2,
      gameLogDelta: [log(2)],
      gameLogDeltaMeta: {
        fromSequenceExclusive: 1,
        toSequence: 2,
        truncated: false,
      },
    });
    expect((first.state as State<TestG>).G.board).toEqual(['a']);
  });

  it('rejects out-of-order state IDs', () => {
    const recorder = createReplayRecorder();
    recorder.append({ state: state(3, { board: [], gameLog: [], gameLogSequence: 0 }) });

    expect(() =>
      recorder.append({ state: state(2, { board: [], gameLog: [], gameLogSequence: 0 }) }),
    ).toThrow('replay steps must be appended in increasing stateId order');
  });

  it('marks game-log truncation metadata when a delta has fallen out of the ring buffer', () => {
    const recorder = createReplayRecorder();
    const step = recorder.append({
      state: state(5, {
        board: [],
        gameLog: [log(4), log(5)],
        gameLogSequence: 5,
      }),
    });

    expect(step.gameLogDelta).toEqual([log(4), log(5)]);
    expect(step.gameLogDeltaMeta).toEqual({
      fromSequenceExclusive: 0,
      toSequence: 5,
      truncated: true,
    });
    expect(recorder.metadata).toEqual({
      gameLogDeltaTruncated: true,
      truncatedGameLogDeltas: [
        {
          index: 0,
          stateId: 5,
          fromSequenceExclusive: 0,
          toSequence: 5,
          truncated: true,
        },
      ],
    });
  });

  it('builds a validated finished replay package with participant-pro access', () => {
    const recorder = createReplayRecorder();
    recorder.append({
      state: state(
        1,
        {
          board: ['x'],
          gameLog: [log(1)],
          gameLogSequence: 1,
          logConfig: { enabled: true, level: 'detail' },
        },
        { seed: 'seed-1' },
      ),
    });

    const pkg = recorder.buildPackage(buildOptions());

    expect(validateReplayPackage(pkg).ok).toBe(true);
    expect(pkg.manifest).toMatchObject({
      status: 'finished',
      recordingMode: 'snapshot',
      stepCount: 1,
      visibilityModes: ['full-reveal'],
      accessPolicy: 'participant-pro',
      logConfig: { enabled: true, level: 'detail' },
      seed: 'seed-1',
    });
    expect(pkg.recorderMetadata.gameLogDeltaTruncated).toBe(false);
    expect(pkg.steps[0].gameLogDeltaMeta.toSequence).toBe(1);
  });

  it('preserves manifest and per-step state provenance', () => {
    const recorder = createReplayRecorder();
    recorder.append({
      state: state(1, { board: [], gameLog: [], gameLogSequence: 0 }),
      gameStateVersion: 0,
    });
    recorder.append({
      state: state(2, { board: ['x'], gameLog: [], gameLogSequence: 0 }),
      gameStateVersion: 1,
    });

    const pkg = recorder.buildPackage({
      ...buildOptions(),
      engineVersion: undefined,
      gameVersion: undefined,
      engineStateVersion: 1,
      gameStateVersion: 0,
      release: { slug: 'reversi', version: 'release-1', serverScriptHash: 'hash-1' },
    });

    expect(validateReplayPackage(pkg).ok).toBe(true);
    expect(pkg.manifest).toMatchObject({
      engineStateVersion: 1,
      gameStateVersion: 0,
      release: { slug: 'reversi', version: 'release-1', serverScriptHash: 'hash-1' },
    });
    expect(pkg.steps.map((step) => step.gameStateVersion)).toEqual([0, 1]);
  });

  it('records and packages null phase snapshots for games without phases', () => {
    const recorder = createReplayRecorder();
    const step = recorder.append({
      state: state(
        1,
        {
          board: ['x'],
          gameLog: [log(1)],
          gameLogSequence: 1,
        },
        { phase: null },
      ),
    });

    const pkg = recorder.buildPackage(buildOptions());

    expect(step.phase).toBeNull();
    expect(validateReplayPackage(pkg).ok).toBe(true);
    expect(pkg.steps[0].phase).toBeNull();
  });
});
