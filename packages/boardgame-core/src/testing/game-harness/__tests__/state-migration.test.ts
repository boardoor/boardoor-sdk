import { describe, expect, it } from 'vitest';

import { makeMove } from '../../../core/action-creators';
import { InitializeGame } from '../../../core/initialize';
import { applyStateMigrations, StateMigrationError } from '../../../core/state-migrations';
import type { Game, GameMigrationMeta, State } from '../../../types';
import { runStateMigrationHarness } from '../migration';

function counterState(): State<{ value: number }> {
  const game: Game<{ value: number }> = { setup: () => ({ value: 1 }) };
  const state = InitializeGame({ game, numPlayers: 2 });
  const snapshot = { G: { value: 2 }, ctx: state.ctx, plugins: state.plugins };
  return { ...state, _undo: [snapshot], _redo: [{ ...snapshot, G: { value: 3 } }] };
}

describe('applyStateMigrations', () => {
  it('chains State.G plus undo and redo G with slot-only metadata', () => {
    const calls: GameMigrationMeta[] = [];
    const state = counterState();
    const migrated = applyStateMigrations({
      state,
      fromVersion: 0,
      numPlayers: 2,
      game: {
        stateSchema: {
          version: 2,
          migrations: {
            0: (G, meta) => {
              calls.push(meta);
              return { value: (G as { value: number }).value + 1 };
            },
            1: (G, meta) => {
              calls.push(meta);
              return { value: (G as { value: number }).value * 2 };
            },
          },
        },
      },
    });

    expect(migrated.promoted).toBe(true);
    expect(migrated.state.G).toEqual({ value: 4 });
    expect(migrated.state._undo[0].G).toEqual({ value: 6 });
    expect(migrated.state._redo[0].G).toEqual({ value: 8 });
    expect(
      calls.map(({ fromVersion, toVersion, numPlayers, slot }) => ({
        fromVersion,
        toVersion,
        numPlayers,
        slot,
      })),
    ).toEqual([
      { fromVersion: 0, toVersion: 1, numPlayers: 2, slot: 'state' },
      { fromVersion: 0, toVersion: 1, numPlayers: 2, slot: 'undo' },
      { fromVersion: 0, toVersion: 1, numPlayers: 2, slot: 'redo' },
      { fromVersion: 1, toVersion: 2, numPlayers: 2, slot: 'state' },
      { fromVersion: 1, toVersion: 2, numPlayers: 2, slot: 'undo' },
      { fromVersion: 1, toVersion: 2, numPlayers: 2, slot: 'redo' },
    ]);
    expect(state.G).toEqual({ value: 1 });
  });

  it('fails closed with typed errors for missing, ahead, and throwing chains', () => {
    const state = counterState();
    const cases = [
      () =>
        applyStateMigrations({
          state,
          fromVersion: 0,
          numPlayers: 2,
          game: { stateSchema: { version: 1, migrations: {} } },
        }),
      () =>
        applyStateMigrations({
          state,
          fromVersion: 2,
          numPlayers: 2,
          game: { stateSchema: { version: 1, migrations: {} } },
        }),
      () =>
        applyStateMigrations({
          state,
          fromVersion: 0,
          numPlayers: 2,
          game: {
            stateSchema: {
              version: 1,
              migrations: {
                0: () => {
                  throw new Error('bad migration');
                },
              },
            },
          },
        }),
    ];

    expect(
      cases.map((run) => {
        try {
          run();
          return null;
        } catch (error) {
          expect(error).toBeInstanceOf(StateMigrationError);
          return (error as StateMigrationError).code;
        }
      }),
    ).toEqual(['missing_migration', 'version_ahead', 'migration_threw']);
    expect(state.G).toEqual({ value: 1 });
  });

  it('treats a game without stateSchema as current v0', () => {
    const state = counterState();
    const result = applyStateMigrations({
      state,
      game: {},
      fromVersion: 0,
      numPlayers: 2,
    });

    expect(result).toEqual({ state, promoted: false });
    expect(result.state).toBe(state);
  });
});

describe('state migration harness', () => {
  it('checks fixture equality and current-game survival probes', () => {
    const game: Game<{ value: number }> = {
      setup: () => ({ value: 1 }),
      moves: {
        increment: ({ G }) => {
          G.value += 1;
        },
      },
      playerView: ({ G }) => ({ value: G.value }),
      stateSchema: {
        version: 1,
        migrations: { 0: (G) => ({ value: (G as { value: number }).value + 1 }) },
      },
      ai: {
        enumerate: () => [{ move: 'increment' }],
        domainInvariants: (G) => (G.value < 0 ? [{ id: 'non-negative', message: 'negative' }] : []),
      },
    };
    const state = InitializeGame({ game, numPlayers: 2 });
    const expectedState = {
      ...structuredClone(state),
      G: { value: 2 },
      _undo: state._undo.map((entry) => ({
        ...structuredClone(entry),
        G: { value: entry.G.value + 1 },
      })),
      _redo: state._redo.map((entry) => ({
        ...structuredClone(entry),
        G: { value: entry.G.value + 1 },
      })),
    };
    const result = runStateMigrationHarness({
      slug: 'counter',
      game,
      numPlayers: 2,
      fixtures: [
        {
          name: 'synthetic-v0',
          source: 'synthetic',
          fromVersion: 0,
          state,
          expectedState,
          scriptedActions: [makeMove('increment', [], '0')],
        },
      ],
    });

    expect(result.issues).toEqual([]);
  });

  it('enforces exact JSON, prototype, size, time, purity, determinism, and no-op checks', () => {
    let nonce = 0;
    const state = counterState();
    const game: Game = {
      stateSchema: {
        version: 1,
        migrations: {
          0: (G) => ({
            ...(G as object),
            nonce: nonce++,
            dropped: undefined,
            constructor: 'blocked',
          }),
        },
      },
    };
    const result = runStateMigrationHarness({
      slug: 'bad',
      game,
      numPlayers: 2,
      maxStateBytes: 1,
      maxStepMs: -1,
      maxChainMs: -1,
      fixtures: [
        {
          name: 'bad-v0',
          source: 'synthetic',
          fromVersion: 0,
          state,
          expectedState: state,
          currentShapeNoOp: true,
        },
      ],
    });

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'NON_DETERMINISTIC_MIGRATION',
        'JSON_ROUND_TRIP_FAILED',
        'PROTOTYPE_KEY_REJECTED',
        'STEP_TIMEOUT',
        'CHAIN_TIMEOUT',
        'FIXTURE_MISMATCH',
        'CURRENT_SHAPE_NOT_NOOP',
      ]),
    );
  });

  it('enforces the per-step state size limit for valid JSON output', () => {
    const state = counterState();
    const result = runStateMigrationHarness({
      slug: 'large-output',
      game: {
        stateSchema: {
          version: 1,
          migrations: { 0: () => ({ payload: 'too large' }) },
        },
      },
      numPlayers: 2,
      maxStateBytes: 1,
      fixtures: [
        {
          name: 'large-output-v0',
          source: 'synthetic',
          fromVersion: 0,
          state,
          expectedState: state,
        },
      ],
    });

    expect(result.issues.map((issue) => issue.code)).toContain('STATE_TOO_LARGE');
  });

  it('detects a migration that mutates frozen input', () => {
    const state = counterState();
    const result = runStateMigrationHarness({
      slug: 'mutating',
      game: {
        stateSchema: {
          version: 1,
          migrations: {
            0: (G) => {
              (G as { value: number }).value += 1;
              return G;
            },
          },
        },
      },
      numPlayers: 2,
      fixtures: [
        {
          name: 'mutating-v0',
          source: 'synthetic',
          fromVersion: 0,
          state,
          expectedState: state,
        },
      ],
    });

    expect(result.issues[0]?.code).toBe('MIGRATION_MUTATED_INPUT');
  });

  it('reports circular migration output without crashing the harness', () => {
    const state = counterState();
    const result = runStateMigrationHarness({
      slug: 'circular',
      game: {
        stateSchema: {
          version: 1,
          migrations: {
            0: () => {
              const circular: Record<string, unknown> = {};
              circular.self = circular;
              return circular;
            },
          },
        },
      },
      numPlayers: 2,
      fixtures: [
        {
          name: 'circular-v0',
          source: 'synthetic',
          fromVersion: 0,
          state,
          expectedState: state,
        },
      ],
    });

    expect(result.issues.map((issue) => issue.code)).toContain('JSON_ROUND_TRIP_FAILED');
  });

  it('checks every step before a later migration can clean invalid output', () => {
    const state = counterState();
    const result = runStateMigrationHarness({
      slug: 'invalid-intermediate',
      game: {
        stateSchema: {
          version: 2,
          migrations: {
            0: (G) => ({ ...(G as object), dropped: undefined }),
            1: (G) => {
              const { dropped: _dropped, ...clean } = G as Record<string, unknown>;
              return clean;
            },
          },
        },
      },
      numPlayers: 2,
      fixtures: [
        {
          name: 'invalid-intermediate-v0',
          source: 'synthetic',
          fromVersion: 0,
          state,
          expectedState: state,
        },
      ],
    });

    expect(result.issues.map((issue) => issue.code)).toContain('JSON_ROUND_TRIP_FAILED');
  });

  it('freezes each step input so later migrations cannot mutate prior output', () => {
    const state = counterState();
    const result = runStateMigrationHarness({
      slug: 'mutating-later-step',
      game: {
        stateSchema: {
          version: 2,
          migrations: {
            0: (G) => ({ ...(G as object), migrated: true }),
            1: (G) => {
              (G as Record<string, unknown>).mutated = true;
              return G;
            },
          },
        },
      },
      numPlayers: 2,
      fixtures: [
        {
          name: 'mutating-later-step-v0',
          source: 'synthetic',
          fromVersion: 0,
          state,
          expectedState: state,
        },
      ],
    });

    expect(result.issues[0]?.code).toBe('MIGRATION_MUTATED_INPUT');
  });

  it('rejects accessor output without executing a throwing getter', () => {
    const state = counterState();
    let getterCalls = 0;
    const result = runStateMigrationHarness({
      slug: 'accessor-output',
      game: {
        stateSchema: {
          version: 1,
          migrations: {
            0: () =>
              Object.defineProperty({}, 'secret', {
                enumerable: true,
                get: () => {
                  getterCalls += 1;
                  throw new Error('getter must not run');
                },
              }),
          },
        },
      },
      numPlayers: 2,
      fixtures: [
        {
          name: 'accessor-output-v0',
          source: 'synthetic',
          fromVersion: 0,
          state,
          expectedState: state,
        },
      ],
    });

    expect(result.issues.map((issue) => issue.code)).toContain('JSON_ROUND_TRIP_FAILED');
    expect(getterCalls).toBe(0);
  });

  it.each([
    [
      'sparse array',
      () => {
        const sparse: unknown[] = [];
        sparse.length = 1;
        return sparse;
      },
    ],
    [
      'non-enumerable property',
      () => Object.defineProperty({ visible: true }, 'hidden', { value: true }),
    ],
    ['negative zero', () => ({ value: -0 })],
  ])('rejects JSON-lossy %s output', (_name, output) => {
    const state = counterState();
    const result = runStateMigrationHarness({
      slug: 'json-lossy-output',
      game: {
        stateSchema: {
          version: 1,
          migrations: { 0: output },
        },
      },
      numPlayers: 2,
      fixtures: [
        {
          name: 'json-lossy-output-v0',
          source: 'synthetic',
          fromVersion: 0,
          state,
          expectedState: state,
        },
      ],
    });

    expect(result.issues.map((issue) => issue.code)).toContain('JSON_ROUND_TRIP_FAILED');
  });
});
