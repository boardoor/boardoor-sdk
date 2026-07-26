import type { ActionShape, Game, PlayerID, State } from '../types';

export const DEFAULT_AI_MOVE_DELAY_MS = 600;

export type AIMoveDelayAction = ActionShape.MakeMove | ActionShape.GameEvent;

const TRICK_PLAY_MOVES = new Set(['playCard', 'playDomino', 'playTiles', 'playTile']);

function countPlayableEntries(players: unknown, trickPlayerIDs: Set<string>): number | null {
  if (players === null || typeof players !== 'object') return null;

  const entries = Array.isArray(players)
    ? players.map((hand, index) => [String(index), hand] as const)
    : Object.entries(players);
  if (entries.length === 0) return null;

  let count = 0;
  for (const [playerID, hand] of entries) {
    if (trickPlayerIDs.has(playerID)) {
      count += 1;
      continue;
    }
    if (!Array.isArray(hand)) return null;
    if (hand.some((item) => item !== null && item !== undefined)) count += 1;
  }
  return count > 0 ? count : null;
}

function isCompletingTrick(state: State, action: AIMoveDelayAction): boolean {
  if (action.type !== 'MAKE_MOVE') return false;
  if (!TRICK_PLAY_MOVES.has(action.payload.type)) return false;

  const G = state.G as Record<string, unknown>;
  const trick = Array.isArray(G.currentTrick)
    ? G.currentTrick
    : Array.isArray(G.trick)
      ? G.trick
      : null;
  if (!trick) return false;

  const trickPlayerIDs = new Set<string>();
  for (const entry of trick) {
    if (entry && typeof entry === 'object' && 'playerID' in entry) {
      const playerID = (entry as { playerID?: unknown }).playerID;
      if (playerID !== undefined) trickPlayerIDs.add(String(playerID));
    }
  }

  const playableCount = countPlayableEntries(G.players ?? G.hands, trickPlayerIDs);
  const participantCount =
    playableCount ?? (typeof state.ctx.numPlayers === 'number' ? state.ctx.numPlayers : null);

  return participantCount !== null && trick.length + 1 >= participantCount;
}

export function resolveAIMoveDelayMs(
  game: Game | undefined,
  state: State,
  playerID: PlayerID,
  action: AIMoveDelayAction,
): number {
  if (action.type === 'MAKE_MOVE' && action.payload.type === 'nextRound') return 0;
  if (isCompletingTrick(state, action)) return 0;

  const delay = game?.ai?.getMoveDelayMs?.({
    G: state.G,
    ctx: state.ctx,
    playerID,
    action,
  });

  if (delay === undefined) return DEFAULT_AI_MOVE_DELAY_MS;
  if (!Number.isFinite(delay)) return DEFAULT_AI_MOVE_DELAY_MS;
  return Math.max(0, delay);
}

export function getRemainingAIMoveDelayMs(delayMs: number, startedAt: number): number {
  return Math.max(0, delayMs - (Date.now() - startedAt));
}

export function applyAIMoveDelayMultiplier(
  delayMs: number,
  multiplier: number | undefined,
): number {
  if (delayMs <= 0) return 0;
  if (multiplier === undefined) return delayMs;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return delayMs;
  return Math.max(0, delayMs * multiplier);
}
