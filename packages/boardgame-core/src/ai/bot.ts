/*
 * Copyright 2018 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import { makeMove, gameEvent } from '../core/action-creators';
import { alea } from '../plugins/random/random.alea';
import type { AleaState } from '../plugins/random/random.alea';
import type { ActionShape, Game, Ctx, PlayerID, State } from '../types';

export type BotAction = ActionShape.GameEvent | ActionShape.MakeMove;
export type WeightedBotAction = BotAction & { weight?: number };

/**
 * Base class that bots can extend.
 */
export abstract class Bot {
  private enumerateFn: NonNullable<Game['ai']>['enumerate'];
  private seed?: string | number;
  protected iterationCounter: number;
  private _opts: Record<
    string,
    {
      range?: { min: number; max: number };
      value: any;
    }
  >;
  private prngstate?: AleaState;

  constructor({
    enumerate,
    seed,
  }: {
    enumerate: NonNullable<Game['ai']>['enumerate'];
    seed?: string | number;
  }) {
    this.enumerateFn = enumerate;
    this.seed = seed;
    this.iterationCounter = 0;
    this._opts = {};
  }

  abstract play(state: State, playerID: PlayerID): Promise<{ action?: BotAction; metadata?: any }>;

  addOpt({
    key,
    range,
    initial,
  }: {
    key: string;
    range?: { min: number; max: number };
    initial: any;
  }) {
    this._opts[key] = {
      range,
      value: initial,
    };
  }

  getOpt(key: string) {
    return this._opts[key].value;
  }

  setOpt(key: string, value: any) {
    if (key in this._opts) {
      this._opts[key].value = value;
    }
  }

  opts() {
    return this._opts;
  }

  enumerate(G: any, ctx: Ctx, playerID: PlayerID): WeightedBotAction[] {
    const actions = this.enumerateFn(G, ctx, playerID);
    return actions.map((a) => {
      if ('payload' in a) {
        return a;
      }

      if ('move' in a) {
        const action = makeMove(a.move, a.args, playerID);
        if (a.weight !== undefined) {
          (action as WeightedBotAction).weight = a.weight;
        }
        return action;
      }

      if ('event' in a) {
        const action = gameEvent(a.event, a.args, playerID);
        if (a.weight !== undefined) {
          (action as WeightedBotAction).weight = a.weight;
        }
        return action;
      }
    });
  }

  weightedRandom(actions: WeightedBotAction[]): WeightedBotAction | undefined {
    if (actions.length === 0) return undefined;
    const totalWeight = actions.reduce((sum, a) => sum + (a.weight ?? 1), 0);
    let roll = this.random() * totalWeight;
    for (const action of actions) {
      roll -= action.weight ?? 1;
      if (roll <= 0) return action;
    }
    return actions[actions.length - 1];
  }

  random<T extends any = any>(arg: T[]): T;
  random(arg?: number): number;
  random<T extends any = any>(arg?: number | T[]) {
    let number: number;

    if (this.seed !== undefined) {
      const seed = this.prngstate ? '' : this.seed;
      const rand = alea(seed, this.prngstate);

      number = rand();
      this.prngstate = rand.state();
    } else {
      number = Math.random();
    }

    if (arg) {
      if (Array.isArray(arg)) {
        const id = Math.floor(number * arg.length);
        return arg[id];
      } else {
        return Math.floor(number * arg);
      }
    }

    return number;
  }
}
