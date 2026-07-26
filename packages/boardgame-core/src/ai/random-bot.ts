/*
 * Copyright 2018 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import type { Ctx, PlayerID } from '../types';
import type { BotAction } from './bot';
import { Bot } from './bot';

/**
 * Bot that picks a move at random.
 */
export class RandomBot extends Bot {
  play(
    { G, ctx }: { G: any; ctx: Ctx },
    playerID: PlayerID,
  ): Promise<{ action?: BotAction; metadata?: any }> {
    const actions = this.enumerate(G, ctx, playerID);
    const result = this.weightedRandom(actions);
    if (!result) return Promise.resolve({});
    return Promise.resolve({ action: result });
  }
}
