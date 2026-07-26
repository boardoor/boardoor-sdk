/*
 * Copyright 2018 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import { CreateGameReducer } from '../core/reducer';
import type { Game, PlayerID, Ctx, State, Reducer } from '../types';
import { Bot } from './bot';
import type { BotAction } from './bot';

export interface Node {
  /** Game state at this node. */
  state: State;
  /** Parent of the node. */
  parent?: Node;
  /** Move used to get to this node. */
  parentAction?: BotAction;
  /** Unexplored actions. */
  actions: BotAction[];
  /** Current objectives. */
  objectives: Objectives | Objectives[];
  /** Children of the node. */
  children: Node[];
  /** Number of simulations that pass through this node. */
  visits: number;
  /** Number of wins for this node. */
  value: number;
  /** True when play() stopped because the wall-clock budget expired. */
  budgetExpired?: boolean;
  /** Wall-clock time spent in play(), when available. */
  elapsedMs?: number;
  /** Number of MCTS iterations completed in play(). */
  completedIterations?: number;
}

interface Objective {
  checker: (G: any, ctx: Ctx) => boolean;
  weight: number;
}

type Objectives = Record<string, Objective>;
type SchedulerGlobal = typeof globalThis & {
  scheduler?: {
    yield?: () => Promise<void> | void;
  };
};

/**
 * The number of iterations to run before yielding to
 * the JS event loop (in async mode).
 */
const CHUNK_SIZE = 25;

async function cooperativeYield(): Promise<void> {
  await (((globalThis as SchedulerGlobal).scheduler?.yield?.() as Promise<void> | void) ??
    new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

/**
 * Bot that uses Monte-Carlo Tree Search to find promising moves.
 */
export class MCTSBot extends Bot {
  private objectives: (G: any, ctx: Ctx, playerID: PlayerID) => Objectives;
  private iterationCallback: (data: {
    iterationCounter: number;
    numIterations: number;
    metadata: Node;
  }) => void;
  private reducer: Reducer;
  iterations: number | ((G: any, ctx: Ctx, playerID?: PlayerID) => number);
  playoutDepth?: number | ((G: any, ctx: Ctx, playerID?: PlayerID) => number);
  timeBudgetMs?: number | ((G: any, ctx: Ctx, playerID?: PlayerID) => number);

  constructor({
    enumerate,
    seed,
    objectives,
    game,
    iterations,
    playoutDepth,
    timeBudgetMs,
    iterationCallback,
  }: {
    enumerate: NonNullable<Game['ai']>['enumerate'];
    seed?: string | number;
    game: Game;
    objectives?: (G: any, ctx: Ctx, playerID?: PlayerID) => Objectives;
    iterations?: number | ((G: any, ctx: Ctx, playerID?: PlayerID) => number);
    playoutDepth?: number | ((G: any, ctx: Ctx, playerID?: PlayerID) => number);
    timeBudgetMs?: number | ((G: any, ctx: Ctx, playerID?: PlayerID) => number);
    iterationCallback?: (data: {
      iterationCounter: number;
      numIterations: number;
      metadata: Node;
    }) => void;
  }) {
    super({ enumerate, seed });

    if (objectives === undefined) {
      objectives = () => ({});
    }

    this.objectives = objectives;
    this.iterationCallback = iterationCallback || (() => {});
    this.reducer = CreateGameReducer({ game });
    this.iterations = iterations;
    this.playoutDepth = playoutDepth;
    this.timeBudgetMs = timeBudgetMs;

    this.addOpt({
      key: 'iterations',
      initial: typeof iterations === 'number' ? iterations : 1000,
      range: { min: 1, max: 2000 },
    });

    this.addOpt({
      key: 'playoutDepth',
      initial: typeof playoutDepth === 'number' ? playoutDepth : 50,
      range: { min: 1, max: 100 },
    });

    this.addOpt({
      key: 'timeBudgetMs',
      initial: typeof timeBudgetMs === 'number' ? timeBudgetMs : 0,
      range: { min: 0, max: 10_000 },
    });
  }

  private createNode({
    state,
    parentAction,
    parent,
    playerID,
  }: {
    state: State;
    parentAction?: BotAction;
    parent?: Node;
    playerID?: PlayerID;
  }): Node {
    const { G, ctx } = state;

    let actions: BotAction[] = [];
    let objectives: Objectives | Objectives[] = [];

    if (playerID !== undefined) {
      actions = this.enumerate(G, ctx, playerID);
      objectives = this.objectives(G, ctx, playerID);
    } else if (ctx.activePlayers) {
      for (const playerID in ctx.activePlayers) {
        actions.push(...this.enumerate(G, ctx, playerID));
        objectives.push(this.objectives(G, ctx, playerID));
      }
    } else {
      actions = this.enumerate(G, ctx, ctx.currentPlayer);
      objectives = this.objectives(G, ctx, ctx.currentPlayer);
    }

    return {
      state,
      parent,
      parentAction,
      actions,
      objectives,
      children: [],
      visits: 0,
      value: 0,
    };
  }

  private select(node: Node) {
    // This node has unvisited children.
    if (node.actions.length > 0) {
      return node;
    }

    // This is a terminal node.
    if (node.children.length === 0) {
      return node;
    }

    let selectedChild = null;
    let best = 0;

    for (const child of node.children) {
      const childVisits = child.visits + Number.EPSILON;
      const uct = child.value / childVisits + Math.sqrt((2 * Math.log(node.visits)) / childVisits);
      if (selectedChild == null || uct > best) {
        best = uct;
        selectedChild = child;
      }
    }

    return this.select(selectedChild);
  }

  private expand(node: Node) {
    const actions = node.actions;

    if (actions.length === 0 || node.state.ctx.gameover !== undefined) {
      return node;
    }

    const id = this.random(actions.length);
    const action = actions[id];
    node.actions.splice(id, 1);
    const childState = this.reducer(node.state, action);
    const childNode = this.createNode({
      state: childState,
      parentAction: action,
      parent: node,
    });
    node.children.push(childNode);
    return childNode;
  }

  playout({ state }: Node, deadline = Number.POSITIVE_INFINITY) {
    let playoutDepth = this.getOpt('playoutDepth');
    if (typeof this.playoutDepth === 'function') {
      playoutDepth = this.playoutDepth(state.G, state.ctx);
    }

    for (let i = 0; i < playoutDepth && state.ctx.gameover === undefined; i++) {
      // Bound a single expensive playout: past the wall-clock deadline, stop
      // stepping and let backpropagation use whatever this partial rollout found.
      if (performance.now() >= deadline) {
        return undefined;
      }
      const { G, ctx } = state;
      let playerID = ctx.currentPlayer;
      if (ctx.activePlayers) {
        playerID = Object.keys(ctx.activePlayers)[0];
      }
      const moves = this.enumerate(G, ctx, playerID);

      // Check if any objectives are met.
      const objectives = this.objectives(G, ctx, playerID);
      const score = Object.keys(objectives).reduce((score, key) => {
        const objective = objectives[key];
        if (objective.checker(G, ctx)) {
          return score + objective.weight;
        }
        return score;
      }, 0);

      // If so, stop and return the score with the player who achieved it.
      if (score > 0) {
        return { score, scoringPlayerID: playerID };
      }

      if (!moves || moves.length === 0) {
        return undefined;
      }

      const move = this.weightedRandom(moves);
      if (!move) {
        return undefined;
      }
      const childState = this.reducer(state, move);
      state = childState;
    }

    return state.ctx.gameover;
  }

  private backpropagate(
    node: Node,
    result: { score?: number; scoringPlayerID?: PlayerID; draw?: boolean; winner?: PlayerID } = {},
  ) {
    node.visits++;

    if (result.score !== undefined) {
      // Only credit the score to nodes belonging to the player who achieved the objective
      if (
        result.scoringPlayerID !== undefined &&
        node.parentAction &&
        result.scoringPlayerID === node.parentAction.payload.playerID
      ) {
        node.value += result.score;
      } else if (result.scoringPlayerID === undefined) {
        // Backward compatible: no scoringPlayerID → add to all (single-player / cooperative)
        node.value += result.score;
      }
    }

    if (result.draw === true) {
      node.value += 0.5;
    }

    if (node.parentAction && result.winner === node.parentAction.payload.playerID) {
      node.value++;
    }

    if (node.parent) {
      this.backpropagate(node.parent, result);
    }
  }

  async play(state: State, playerID: PlayerID): Promise<{ action?: BotAction; metadata: Node }> {
    const root = this.createNode({ state, playerID });
    const startedAt = performance.now();

    // Forced move: when only one action is legal there is nothing to search.
    // Skipping the playouts avoids a multi-second main-thread block on trivial
    // decisions like round-end confirmation moves (the playout would otherwise
    // simulate entire future rounds just to pick the sole legal action).
    if (root.actions.length === 1) {
      root.budgetExpired = false;
      root.elapsedMs = performance.now() - startedAt;
      root.completedIterations = 0;
      return { action: root.actions[0], metadata: root };
    }

    // Local counter: play() yields cooperatively, so instance-level state would
    // let two concurrent play() calls corrupt each other's iteration accounting.
    let iterationCounter = 0;
    let numIterations = this.getOpt('iterations');
    if (typeof this.iterations === 'function') {
      numIterations = this.iterations(state.G, state.ctx, playerID);
    }

    let timeBudgetMs = this.getOpt('timeBudgetMs');
    if (typeof this.timeBudgetMs === 'function') {
      timeBudgetMs = this.timeBudgetMs(state.G, state.ctx, playerID);
    }
    const hasBudget = Number.isFinite(timeBudgetMs) && timeBudgetMs > 0;
    const deadline = hasBudget ? startedAt + timeBudgetMs : Number.POSITIVE_INFINITY;
    let budgetExpired = false;

    const getResult = () => {
      let selectedChild: Node | null = null;
      for (const child of root.children) {
        if (selectedChild == null || child.visits > selectedChild.visits) {
          selectedChild = child;
        }
      }

      const action = selectedChild?.parentAction;
      const metadata = root;
      metadata.budgetExpired = budgetExpired;
      metadata.elapsedMs = performance.now() - startedAt;
      metadata.completedIterations = iterationCounter;
      return { action, metadata };
    };

    while (iterationCounter < numIterations) {
      if (hasBudget && performance.now() >= deadline) {
        budgetExpired = true;
        break;
      }
      for (let i = 0; i < CHUNK_SIZE && iterationCounter < numIterations; i++) {
        if (hasBudget && performance.now() >= deadline) {
          budgetExpired = true;
          break;
        }
        const leaf = this.select(root);
        const child = this.expand(leaf);
        const result = this.playout(child, deadline);
        this.backpropagate(child, result);
        iterationCounter++;
      }
      this.iterationCounter = iterationCounter;
      this.iterationCallback({
        iterationCounter,
        numIterations,
        metadata: root,
      });
      if (iterationCounter < numIterations && !budgetExpired) {
        await cooperativeYield();
      }
    }

    const result = getResult();
    this.iterationCounter = 0;
    return result;
  }
}
