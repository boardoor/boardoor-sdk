import type { Game, PlayerID, Ctx, State } from '../types';
import { Bot } from './bot';
import type { BotAction } from './bot';
import { MCTSBot } from './mcts-bot';

/**
 * Bot that uses Determinized MCTS for incomplete-information games.
 *
 * Algorithm:
 * 1. Sample N "complete-information" states via sampleHiddenState
 * 2. Run MCTSBot on each sample with iterations/samples budget
 * 3. Vote on the best action across all samples
 *
 * For complete-information games (no sampleHiddenState), falls back to
 * a single MCTSBot run with the full iteration budget.
 */
export class DeterminizedBot extends Bot {
  private game: Game;
  private sampleHiddenState?: (G: any, playerID: PlayerID) => any;
  private objectives?: (
    G: any,
    ctx: Ctx,
    playerID?: PlayerID,
  ) => Record<string, { checker: (G: any, ctx: Ctx) => boolean; weight: number }>;
  private iterations: number;
  private playoutDepth: number;
  private samples: number;
  private timeBudgetMs?: number;

  constructor({
    enumerate,
    seed,
    game,
    sampleHiddenState,
    objectives,
    iterations = 800,
    playoutDepth = 50,
    samples = 5,
    timeBudgetMs,
  }: {
    enumerate: NonNullable<Game['ai']>['enumerate'];
    seed?: string | number;
    game: Game;
    sampleHiddenState?: (G: any, playerID: PlayerID) => any;
    objectives?: (
      G: any,
      ctx: Ctx,
      playerID?: PlayerID,
    ) => Record<string, { checker: (G: any, ctx: Ctx) => boolean; weight: number }>;
    iterations?: number;
    playoutDepth?: number;
    samples?: number;
    timeBudgetMs?: number;
  }) {
    super({ enumerate, seed });
    this.game = game;
    this.sampleHiddenState = sampleHiddenState;
    this.objectives = objectives;
    this.iterations = iterations;
    this.playoutDepth = playoutDepth;
    this.samples = samples;
    this.timeBudgetMs = timeBudgetMs;
  }

  async play(state: State, playerID: PlayerID): Promise<{ action?: BotAction; metadata: any }> {
    const startedAt = performance.now();
    const hasBudget =
      this.timeBudgetMs !== undefined &&
      Number.isFinite(this.timeBudgetMs) &&
      this.timeBudgetMs > 0;
    const deadline = hasBudget ? startedAt + this.timeBudgetMs! : Number.POSITIVE_INFINITY;

    if (!this.sampleHiddenState) {
      // No hidden state — single MCTSBot run with full budget
      const mcts = new MCTSBot({
        game: this.game,
        enumerate: this.enumerate.bind(this) as unknown as NonNullable<Game['ai']>['enumerate'],
        seed: this.random(),
        objectives: this.objectives,
        iterations: this.iterations,
        playoutDepth: this.playoutDepth,
        timeBudgetMs: this.timeBudgetMs,
      });
      return mcts.play(state, playerID);
    }

    const iterPerSample = Math.max(1, Math.floor(this.iterations / this.samples));
    const votes = new Map<string, { action: BotAction; count: number }>();
    let completedSamples = 0;
    let budgetExpired = false;

    for (let s = 0; s < this.samples; s++) {
      if (hasBudget && performance.now() >= deadline) {
        budgetExpired = true;
        break;
      }
      const sampledG = this.sampleHiddenState(state.G, playerID);
      const sampledState: State = { ...state, G: sampledG };
      // Sampling itself can consume the remaining budget — recheck before
      // launching another MCTS run instead of starting one with a spent clock.
      if (hasBudget && performance.now() >= deadline) {
        budgetExpired = true;
        break;
      }
      const remainingBudgetMs = hasBudget ? Math.max(1, deadline - performance.now()) : undefined;

      const mcts = new MCTSBot({
        game: this.game,
        enumerate: this.enumerate.bind(this) as unknown as NonNullable<Game['ai']>['enumerate'],
        seed: this.random(),
        objectives: this.objectives,
        iterations: iterPerSample,
        playoutDepth: this.playoutDepth,
        timeBudgetMs: remainingBudgetMs,
      });

      // oxlint-disable-next-line no-await-in-loop -- each sample casts one vote into the running tally
      const result = await mcts.play(sampledState, playerID);
      completedSamples++;
      if (result.metadata?.budgetExpired) {
        budgetExpired = true;
      }
      if (result?.action) {
        const key = actionKey(result.action);
        const existing = votes.get(key);
        if (existing) {
          existing.count++;
        } else {
          votes.set(key, { action: result.action, count: 1 });
        }
      }
    }

    // Pick the action with the most votes
    let best: { action: BotAction; count: number } | undefined;
    for (const entry of votes.values()) {
      if (!best || entry.count > best.count) {
        best = entry;
      }
    }

    if (!best) {
      return {
        metadata: {
          votes: 0,
          samples: this.samples,
          completedSamples,
          budgetExpired,
          elapsedMs: performance.now() - startedAt,
        },
      };
    }
    return {
      action: best.action,
      metadata: {
        votes: votes.size,
        samples: this.samples,
        completedSamples,
        budgetExpired,
        elapsedMs: performance.now() - startedAt,
      },
    };
  }
}

function actionKey(action: BotAction): string {
  return action.payload.type + '|' + JSON.stringify(action.payload.args);
}
