import { describe, expect, it, vi } from 'vitest';

import { makeMove } from '../../../core/action-creators';
import { INVALID_MOVE } from '../../../core/constants';
import type { Game } from '../../../types';
import { stableHash } from '../actions';
import {
  bestMovePolicy,
  type HarnessCaseResult,
  renderHarnessJsonReport,
  renderHarnessMarkdownReport,
  runHarnessCase,
} from '../index';

describe('game harness', () => {
  it('uses 64-bit hex hashes for trace and state summaries', () => {
    expect(stableHash({ same: ['input'] })).toMatch(/^[0-9a-f]{16}$/);
  });

  it('injects fixed seeds through a cloned game and disables undo', async () => {
    const game: Game<{ roll: number }> = {
      setup: ({ random }) => ({ roll: random.D6() }),
      moves: {
        done: ({ events }) => events.endGame({ done: true }),
      },
      ai: { enumerate: () => [{ move: 'done' }] },
    };

    const first = await runHarnessCase({
      slug: 'seeded-counter',
      game,
      seed: 'slice-1-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 4,
    });
    const second = await runHarnessCase({
      slug: 'seeded-counter',
      game,
      seed: 'slice-1-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 4,
    });

    expect(game.seed).toBeUndefined();
    expect(first.trace.initialStateHash).toBe(second.trace.initialStateHash);
    expect(first.trace.steps).toEqual(second.trace.steps);
    expect(first.trace.terminal.completed).toBe(true);
    expect(first.trace.issues).toEqual([]);
  });

  it('processes activePlayers in sorted player order', async () => {
    const game: Game<{ moves: string[] }> = {
      setup: () => ({ moves: [] }),
      turn: {
        activePlayers: { value: { '1': 'stage', '0': 'stage' }, minMoves: 1, maxMoves: 1 },
        stages: {
          stage: {
            moves: {
              mark: ({ G, playerID }) => {
                G.moves.push(playerID);
              },
            },
          },
        },
      },
      endIf: ({ G }) => (G.moves.length >= 2 ? { moves: G.moves } : undefined),
      ai: { enumerate: (_G, _ctx, playerID) => [{ move: 'mark', args: [playerID] }] },
    };

    const result = await runHarnessCase({
      slug: 'active-order',
      game,
      seed: 'active-order-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 4,
    });

    expect(result.trace.steps.map((step) => step.playerID)).toEqual(['0', '1']);
    expect(result.trace.issues).toEqual([]);
  });

  it('turns reducer transient errors into structured issues and strips them', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const game: Game<{ attempted: number }> = {
      setup: () => ({ attempted: 0 }),
      moves: {
        bad: ({ G }) => {
          G.attempted += 1;
          return INVALID_MOVE;
        },
      },
      ai: { enumerate: () => [{ move: 'bad' }] },
    };

    const result = await runHarnessCase({
      slug: 'invalid-enumerate',
      game,
      seed: 'bad-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    expect(result.trace.issues[0]).toMatchObject({
      code: 'ENUMERATED_ACTION_REJECTED',
      severity: 'fail',
      slug: 'invalid-enumerate',
      seed: 'bad-seed',
      numPlayers: 2,
      setupVariant: 'default',
      step: 0,
      playerID: '0',
    });
    expect(result.finalState).not.toHaveProperty('transients');
    consoleError.mockRestore();
  });

  it('turns reducer exceptions into structured issues with action context', async () => {
    const game: Game<{ attempted: number }> = {
      setup: () => ({ attempted: 0 }),
      moves: {
        explode: ({ G }) => {
          G.attempted += 1;
          throw new Error('boom from move');
        },
      },
      ai: { enumerate: () => [{ move: 'explode', args: ['arg'] }] },
    };

    const result = await runHarnessCase({
      slug: 'throwing-move',
      game,
      seed: 'throw-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    expect(result.trace.issues[0]).toMatchObject({
      code: 'REDUCER_THREW',
      severity: 'fail',
      slug: 'throwing-move',
      seed: 'throw-seed',
      step: 0,
      playerID: '0',
      actionHash: expect.any(String),
      data: {
        policySource: 'enumerate-random',
        errorMessage: 'boom from move',
      },
    });
    expect(result.trace.steps).toEqual([]);
  });

  it('reports first divergence details for non-deterministic traces', async () => {
    let enumerateCalls = 0;
    const game: Game<{ n: number }> = {
      setup: () => ({ n: 0 }),
      moves: {
        a: ({ G }) => {
          G.n += 1;
        },
        b: ({ G }) => {
          G.n += 2;
        },
      },
      endIf: ({ G }) => (G.n >= 2 ? { n: G.n } : undefined),
      ai: {
        enumerate: () => {
          enumerateCalls += 1;
          return enumerateCalls % 2 === 0 ? [{ move: 'a' }] : [{ move: 'b' }];
        },
      },
    };

    const result = await runHarnessCase({
      slug: 'nondeterministic-enumerate',
      game,
      seed: 'same-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 4,
      determinismRetries: 3,
    });

    expect(result.trace.issues.some((issue) => issue.code === 'NON_DETERMINISTIC_TRACE')).toBe(
      true,
    );
    expect(
      result.trace.issues.find((issue) => issue.code === 'NON_DETERMINISTIC_TRACE')?.data,
    ).toMatchObject({ firstDivergence: expect.any(Object) });
  });

  it('reports non-deterministic initial state even when later trace and terminal state match', async () => {
    let setupNonce = 0;
    const result = await runHarnessCase({
      slug: 'nondeterministic-setup',
      game: {
        setup: () => ({ nonce: setupNonce++ }),
        moves: {
          normalize: ({ G, events }) => {
            G.nonce = 0;
            events.endGame({ done: true });
          },
        },
        ai: { enumerate: () => [{ move: 'normalize' }] },
      },
      seed: 'same-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
      determinismRetries: 2,
    });

    expect(
      result.trace.issues.find((issue) => issue.code === 'NON_DETERMINISTIC_TRACE'),
    ).toMatchObject({
      step: 0,
      message: 'Same seed produced a different initial state.',
      data: {
        expectedInitialStateHash: expect.any(String),
        actualInitialStateHash: expect.any(String),
      },
    });
  });

  it('ignores policy timing metadata when comparing deterministic traces', async () => {
    let elapsedMs = 0;
    const result = await runHarnessCase({
      slug: 'timing-insensitive-trace',
      game: {
        setup: () => ({}),
        moves: { done: ({ events }) => events.endGame({ done: true }) },
      },
      seed: 'timing-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
      determinismRetries: 2,
      mode: 'arena-strength',
      policy: ({ playerID }) => ({
        source: 'bestMove',
        elapsedMs: elapsedMs++,
        action: makeMove('done', [], playerID),
      }),
    });

    expect(result.trace.issues.map((issue) => issue.code)).not.toContain('NON_DETERMINISTIC_TRACE');
  });

  it('recomputes active actors after each applied move', async () => {
    const enumerateCalls: string[] = [];
    const game: Game<{ moves: string[] }> = {
      setup: () => ({ moves: [] }),
      turn: {
        activePlayers: { value: { '0': 'play', '1': 'play' } },
        stages: {
          play: {
            moves: {
              mark: ({ G, events, playerID }) => {
                G.moves.push(playerID);
                if (G.moves.length === 1) {
                  events.setActivePlayers({ value: { '0': 'play' } });
                  return;
                }
                events.endGame({ moves: [...G.moves] });
              },
            },
          },
        },
      },
      ai: {
        enumerate: (G, _ctx, playerID) => {
          enumerateCalls.push(`${playerID}:${G.moves.length}`);
          if (playerID === '1' && G.moves.length > 0) {
            throw new Error('stale actor should not be queried');
          }
          return [{ move: 'mark' }];
        },
      },
    };

    const result = await runHarnessCase({
      slug: 'active-actors-change',
      game,
      seed: 'active-actors-change',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 4,
    });

    expect(enumerateCalls).toEqual(['0:0', '0:1']);
    expect(result.trace.issues).toEqual([]);
    expect(result.trace.terminal.completed).toBe(true);
  });

  it('runs enumerate on a probe state and reports mutations', async () => {
    const result = await runHarnessCase({
      slug: 'enumerate-mutates',
      game: {
        setup: () => ({ count: 0 }),
        moves: { done: ({ events }) => events.endGame({ done: true }) },
        ai: {
          enumerate: (G) => {
            G.count = 99;
            return [{ move: 'done' }];
          },
        },
      },
      seed: 'enumerate-mutates',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    expect(result.trace.issues[0]).toMatchObject({
      code: 'ENUMERATE_MUTATED_STATE',
      severity: 'fail',
      playerID: '0',
      data: {
        beforeHash: expect.any(String),
        afterHash: expect.any(String),
      },
    });
    expect(result.trace.steps).toEqual([]);
    expect(result.finalState?.G).toEqual({ count: 0 });
  });

  it('emits warn issues for playerView mutation and JSON serialization gaps', async () => {
    const game: Game<{ values: unknown[]; touched?: boolean }> = {
      setup: () => ({ values: [undefined] }),
      moves: { done: ({ events }) => events.endGame({ done: true }) },
      playerView: ({ G }) => {
        G.touched = true;
        return G;
      },
      ai: {
        enumerate: () => [{ move: 'done' }],
        sampleHiddenState: (G) => G,
      },
    };

    const result = await runHarnessCase({
      slug: 'purity',
      game,
      seed: 'purity-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    expect(result.trace.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['PLAYER_VIEW_MUTATED_STATE', 'STATE_NOT_JSON_SERIALIZABLE']),
    );
    expect(result.finalState?.G).not.toHaveProperty('touched');
  });

  it('reports non-finite numbers as JSON serialization gaps', async () => {
    const result = await runHarnessCase({
      slug: 'non-finite-json',
      game: {
        setup: () => ({ values: [NaN, Infinity, -Infinity] }),
        moves: { done: ({ events }) => events.endGame({ done: true }) },
        ai: { enumerate: () => [{ move: 'done' }] },
      },
      seed: 'non-finite-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    const issue = result.trace.issues.find((entry) => entry.code === 'STATE_NOT_JSON_SERIALIZABLE');

    expect(issue).toMatchObject({
      severity: 'warn',
      data: {
        problems: expect.arrayContaining([
          {
            path: '$.G.values[0]',
            reason: 'non-finite number is serialized as null by JSON',
          },
          {
            path: '$.G.values[1]',
            reason: 'non-finite number is serialized as null by JSON',
          },
          {
            path: '$.G.values[2]',
            reason: 'non-finite number is serialized as null by JSON',
          },
        ]),
      },
    });
  });

  it('probes playerView and sampleHiddenState for inactive seats', async () => {
    const result = await runHarnessCase({
      slug: 'inactive-view-probe',
      game: {
        setup: () => ({ touchedBy: [] as string[] }),
        turn: {
          activePlayers: { value: { '0': 'play' } },
          stages: {
            play: {
              moves: {
                done: ({ events }) => events.endGame({ done: true }),
              },
            },
          },
        },
        playerView: ({ playerID }) => {
          if (playerID === '1') throw new Error('inactive view failed');
          return {};
        },
        ai: {
          enumerate: () => [{ move: 'done' }],
          sampleHiddenState: (G, playerID) => {
            if (playerID === '1') G.touchedBy.push(playerID);
            return G;
          },
        },
      },
      seed: 'inactive-view-probe',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    expect(result.trace.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLAYER_VIEW_THREW',
          playerID: '1',
        }),
        expect.objectContaining({
          code: 'SAMPLE_HIDDEN_STATE_MUTATED_STATE',
          playerID: '1',
        }),
      ]),
    );
  });

  it('probes spectator playerView with null playerID', async () => {
    const result = await runHarnessCase({
      slug: 'spectator-view-probe',
      game: {
        setup: () => ({}),
        moves: { done: ({ events }) => events.endGame({ done: true }) },
        playerView: ({ playerID }) => {
          if (playerID === null) throw new Error('spectator view failed');
          return {};
        },
        ai: { enumerate: () => [{ move: 'done' }] },
      },
      seed: 'spectator-view-probe',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    expect(result.trace.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PLAYER_VIEW_THREW',
          playerID: null,
        }),
      ]),
    );
  });

  it('keeps sampleHiddenState mutation probes isolated from final state', async () => {
    const game: Game<{ secret: string; probeTouched?: boolean }> = {
      setup: () => ({ secret: 'value' }),
      moves: { done: ({ events }) => events.endGame({ done: true }) },
      ai: {
        enumerate: () => [{ move: 'done' }],
        sampleHiddenState: (G) => {
          G.probeTouched = true;
          return G;
        },
      },
    };

    const result = await runHarnessCase({
      slug: 'sample-hidden-isolation',
      game,
      seed: 'hidden-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    expect(result.trace.issues.map((issue) => issue.code)).toContain(
      'SAMPLE_HIDDEN_STATE_MUTATED_STATE',
    );
    expect(result.finalState?.G).not.toHaveProperty('probeTouched');
  });

  it('turns domain invariant violations into structured fail issues', async () => {
    const game: Game<{ count: number }> = {
      setup: () => ({ count: 0 }),
      moves: {
        done: ({ G, events }) => {
          G.count += 1;
          events.endGame({ done: true });
        },
      },
      ai: {
        enumerate: () => [{ move: 'done' }],
        domainInvariants: (G, _ctx, meta) =>
          G.count === 0
            ? [
                {
                  id: 'counter/nonzero-after-setup',
                  message: `counter was ${G.count} at step ${meta.step}`,
                  data: { count: G.count },
                },
              ]
            : [],
      },
    };

    const result = await runHarnessCase({
      slug: 'domain-invariant',
      game,
      seed: 'domain-invariant-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    expect(result.trace.issues[0]).toMatchObject({
      code: 'DOMAIN_INVARIANT_VIOLATED',
      severity: 'fail',
      slug: 'domain-invariant',
      seed: 'domain-invariant-seed',
      step: 0,
      message: 'counter was 0 at step 0',
      data: {
        invariantId: 'counter/nonzero-after-setup',
        count: 0,
      },
    });
  });

  it('normalizes domain invariant data before rendering JSON reports', async () => {
    const circular: Record<string, unknown> = { amount: 123n };
    circular.self = circular;

    const result = await runHarnessCase({
      slug: 'domain-invariant-data',
      game: {
        setup: () => ({}),
        moves: { done: ({ events }) => events.endGame({ done: true }) },
        ai: {
          enumerate: () => [{ move: 'done' }],
          domainInvariants: () => [
            {
              id: 'domain/non-json-data',
              message: 'domain invariant included non-json data',
              data: circular,
            },
          ],
        },
      },
      seed: 'domain-invariant-data-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    const report = JSON.parse(renderHarnessJsonReport([result]));

    expect(report.issues[0].data).toMatchObject({
      invariantId: 'domain/non-json-data',
      amount: { __type: 'bigint', value: '123' },
      self: {
        self: { __type: 'circular' },
      },
    });
  });

  it('renders JSON and Markdown reports from the same structured result', async () => {
    const game: Game<{ done: boolean }> = {
      setup: () => ({ done: false }),
      moves: {
        done: ({ G, events }) => {
          G.done = true;
          events.endGame({ done: true });
        },
      },
      ai: { enumerate: () => [{ move: 'done' }] },
    };

    const result = await runHarnessCase({
      slug: 'reportable',
      game,
      seed: 'report-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    expect(JSON.parse(renderHarnessJsonReport([result])).version).toBe(1);
    expect(renderHarnessMarkdownReport([result])).toContain('reportable');
  });

  it('renders reports without including final state payloads', async () => {
    const normalResult = await runHarnessCase({
      slug: 'report-final-state-stripped',
      game: {
        setup: () => ({ done: false }),
        moves: { done: ({ events }) => events.endGame({ done: true }) },
        ai: { enumerate: () => [{ move: 'done' }] },
      },
      seed: 'unsafe-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    const result: HarnessCaseResult = {
      ...normalResult,
      finalState: {
        G: { leaked: true },
        ctx: normalResult.finalState!.ctx,
        plugins: normalResult.finalState!.plugins,
        _undo: [],
        _redo: [],
        _stateID: normalResult.finalState!['_stateID'],
      },
    };

    let threw = false;
    let rendered = '';
    try {
      rendered = renderHarnessJsonReport([result]);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    const reportResult = JSON.parse(rendered).results[0] as Record<string, unknown>;
    expect(Object.hasOwn(reportResult, 'finalState')).toBe(false);
  });

  it('summarizes completed and step-limited case counts', async () => {
    const completed = await runHarnessCase({
      slug: 'summary',
      game: {
        setup: () => ({}),
        moves: { done: ({ events }) => events.endGame({ done: true }) },
        ai: { enumerate: () => [{ move: 'done' }] },
      },
      seed: 'completed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });
    const limited = await runHarnessCase({
      slug: 'summary',
      game: {
        setup: () => ({}),
        moves: { pass: () => undefined },
        ai: { enumerate: () => [{ move: 'pass' }] },
      },
      seed: 'limited',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 1,
    });

    const report = JSON.parse(renderHarnessJsonReport([completed, limited]));
    expect(report.summaries[0]).toMatchObject({
      slug: 'summary',
      cases: 2,
      completed: 1,
      stepLimitReached: 1,
      completionRate: 0.5,
    });
    expect(renderHarnessMarkdownReport([completed, limited])).toContain('completion');
  });

  it('puts mode, maxSteps, and failure-step stateHash on issues', async () => {
    const result = await runHarnessCase({
      slug: 'issue-context',
      game: {
        setup: () => ({}),
        moves: { pass: () => undefined },
        ai: { enumerate: () => [{ move: 'pass' }] },
      },
      seed: 'issue-context-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 1,
    });

    expect(result.trace.issues[0]).toMatchObject({
      code: 'STEP_LIMIT_REACHED',
      mode: 'fuzz-random',
      maxSteps: 1,
      stateHash: expect.any(String),
    });
  });

  it('distinguishes step-0 empty enumerate from a mid-game no-action dead end', async () => {
    const emptyAtStart = await runHarnessCase({
      slug: 'empty-at-start',
      game: {
        setup: () => ({}),
        moves: { pass: () => undefined },
        ai: { enumerate: () => [] },
      },
      seed: 'empty-start',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
    });

    expect(emptyAtStart.trace.issues[0]?.code).toBe('NO_ENUMERATOR_OR_EMPTY_ENUMERATE_AT_STEP_0');

    let calls = 0;
    const midGame = await runHarnessCase({
      slug: 'mid-game-empty',
      game: {
        setup: () => ({ count: 0 }),
        moves: {
          pass: ({ G }) => {
            G.count += 1;
          },
        },
        ai: {
          enumerate: () => {
            calls += 1;
            return calls === 1 ? [{ move: 'pass' }] : [];
          },
        },
      },
      seed: 'mid-game-empty',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 4,
    });

    expect(midGame.trace.issues.at(-1)?.code).toBe('NO_LEGAL_ACTION_AND_NOT_GAMEOVER');
  });

  it('bestMovePolicy awaits ai.init once and records policy metadata', async () => {
    const init = vi.fn(async () => {});
    const bestMove = vi.fn(() => ({ move: 'done', args: [] }));
    const result = await runHarnessCase({
      slug: 'best-move',
      game: {
        setup: () => ({}),
        moves: { done: ({ events }) => events.endGame({ done: true }) },
        ai: {
          init,
          enumerate: () => [{ move: 'done' }],
          bestMove,
        },
      },
      seed: 'best-move-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 4,
      mode: 'arena-strength',
      policy: bestMovePolicy({ defaultStrength: 'strong' }),
    });

    expect(init).toHaveBeenCalledTimes(1);
    expect(bestMove).toHaveBeenCalledWith(expect.anything(), expect.anything(), '0', 'strong');
    expect(result.trace.steps[0]).toMatchObject({
      policySource: 'bestMove',
      policyStrength: 'strong',
      policyElapsedMs: expect.any(Number),
    });
  });

  it('bestMovePolicy can assign strengths per player', async () => {
    const strengths: string[] = [];
    const result = await runHarnessCase({
      slug: 'per-seat-best-move',
      game: {
        setup: () => ({ moves: 0 }),
        moves: {
          done: ({ G }) => {
            G.moves += 1;
          },
        },
        endIf: ({ G }) => (G.moves >= 2 ? { done: true } : undefined),
        turn: {
          activePlayers: { value: { '0': 'play', '1': 'play' }, minMoves: 1, maxMoves: 1 },
          stages: {
            play: {
              moves: {
                done: ({ G }) => {
                  G.moves += 1;
                },
              },
            },
          },
        },
        ai: {
          enumerate: () => [{ move: 'done' }],
          bestMove: (_G, _ctx, _playerID, strength) => {
            strengths.push(strength ?? 'weak');
            return { move: 'done', args: [] };
          },
        },
      },
      seed: 'per-seat',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 4,
      mode: 'arena-strength',
      policy: bestMovePolicy({ strengths: { '0': 'strong', '1': 'medium' } }),
    });

    expect(strengths).toEqual(['strong', 'medium']);
    expect(result.trace.terminal.completed).toBe(true);
  });

  it('attributes structurally invalid custom policy actions to the policy', async () => {
    const game: Game<{ done: boolean }> = {
      setup: () => ({ done: false }),
      moves: { done: ({ G }) => (G.done = true) },
      ai: { enumerate: () => [{ move: 'done' }] },
    };

    const result = await runHarnessCase({
      slug: 'bad-policy',
      game,
      seed: 'policy-seed',
      numPlayers: 2,
      setupVariant: 'default',
      maxSteps: 2,
      mode: 'arena-strength',
      policy: () => ({
        source: 'bestMove',
        action: { type: 'MAKE_MOVE', payload: { type: 123, args: [] } } as never,
      }),
    });

    expect(result.trace.issues[0]).toMatchObject({
      code: 'POLICY_RETURNED_ILLEGAL_ACTION',
      severity: 'fail',
      slug: 'bad-policy',
      step: 0,
      playerID: '0',
    });
    expect(result.trace.issues.map((issue) => issue.code)).not.toContain(
      'NO_LEGAL_ACTION_AND_NOT_GAMEOVER',
    );
  });
});
