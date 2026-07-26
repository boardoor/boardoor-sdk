import { playerLabel, type MatchDataEntry } from './player-label';

export type GameLogLevel = 'action' | 'detail';

export type GameLogAudience = 'public' | 'self' | { playerIds: string[] };

export interface GameLogEntry {
  id: string;
  sequence: number;
  turn: number;
  playerId?: string;
  publicMessageKey: string;
  publicParams?: Record<string, unknown>;
  publicPlayerIds?: Record<string, string>;
  privateMessageKey?: string;
  privateParams?: Record<string, unknown>;
  privatePlayerIds?: Record<string, string>;
  audience?: GameLogAudience;
  detailOnly?: boolean;
}

export interface GameLogStateShape {
  gameLog?: GameLogEntry[];
  gameLogSequence?: number;
  logConfig?: {
    enabled: boolean;
    level: GameLogLevel;
  };
}

export interface GameLogDelta {
  entries: GameLogEntry[];
  fromSequenceExclusive: number;
  toSequence: number;
  truncated: boolean;
}

export interface GameLogMessageParam {
  __gameLogMessageKey: string;
  __gameLogMessageParams?: Record<string, unknown>;
}

export interface ResolvedGameLogEntry {
  id: string;
  sequence: number;
  turn: number;
  playerId?: string;
  text: string;
}

export function gameLogMessageParam(
  key: string,
  params?: Record<string, unknown>,
): GameLogMessageParam {
  return params === undefined
    ? { __gameLogMessageKey: key }
    : {
        __gameLogMessageKey: key,
        __gameLogMessageParams: params,
      };
}

function resolvePlayerParams(
  params: Record<string, unknown> | undefined,
  playerIds: Record<string, string> | undefined,
  matchData: MatchDataEntry[] | undefined,
): Record<string, unknown> | undefined {
  if (!params && !playerIds) return params;
  const resolved = { ...params };
  for (const [paramKey, pid] of Object.entries(playerIds ?? {})) {
    resolved[paramKey] = playerLabel(pid, matchData);
  }
  return resolved;
}

function isGameLogMessageParam(value: unknown): value is GameLogMessageParam {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__gameLogMessageKey' in value &&
    typeof (value as GameLogMessageParam)['__gameLogMessageKey'] === 'string'
  );
}

function resolveNestedLogValue(
  value: unknown,
  t: (key: string, params?: Record<string, unknown>) => string,
): unknown {
  if (isGameLogMessageParam(value)) {
    return t(value['__gameLogMessageKey'], resolveLogParams(value['__gameLogMessageParams'], t));
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveNestedLogValue(item, t));
  }
  return value;
}

function resolveLogParams(
  params: Record<string, unknown> | undefined,
  t: (key: string, params?: Record<string, unknown>) => string,
): Record<string, unknown> | undefined {
  if (!params) return params;
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = resolveNestedLogValue(value, t);
  }
  return resolved;
}

function canViewPrivate(entry: GameLogEntry, viewerId: string | undefined): boolean {
  const audience = entry.audience ?? 'public';
  if (audience === 'public') return true;
  if (!viewerId) return false;
  if (audience === 'self') return viewerId === entry.playerId;
  return audience.playerIds.includes(viewerId);
}

export function appendGameLog(
  G: GameLogStateShape,
  ctx: { turn: number },
  entry: Omit<GameLogEntry, 'id' | 'sequence' | 'turn'>,
  config: { enabled: boolean; level: GameLogLevel; maxEntries?: number },
): void {
  if (!config.enabled) return;
  if (entry.detailOnly && config.level === 'action') return;

  const sequence = (G.gameLogSequence ?? 0) + 1;
  const nextEntry: GameLogEntry = {
    ...stripUndefinedObjectFields(entry),
    id: `log-${sequence}`,
    sequence,
    turn: ctx.turn,
  };
  const current = G.gameLog ?? [];
  const maxEntries = config.maxEntries ?? 50;
  const appended = [...current, nextEntry];
  G.gameLog = appended.slice(-maxEntries);
  G.gameLogSequence = sequence;
}

function stripUndefinedObjectFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedObjectFields(item)) as T;
  }
  if (value === null || typeof value !== 'object') return value;

  const stripped: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child === undefined) continue;
    stripped[key] = stripUndefinedObjectFields(child);
  }
  return stripped as T;
}

export function filterGameLogForPlayer(
  entries: GameLogEntry[] | undefined,
  viewerId: string | undefined,
): GameLogEntry[] {
  if (!entries) return [];
  return entries.map((entry) => {
    if (!entry.privateMessageKey) return entry;
    if (canViewPrivate(entry, viewerId)) return entry;
    const {
      privateMessageKey: _privateMessageKey,
      privateParams: _privateParams,
      privatePlayerIds: _privatePlayerIds,
      ...rest
    } = entry;
    return rest;
  });
}

export function extractGameLogDelta(G: GameLogStateShape, fromSequenceExclusive = 0): GameLogDelta {
  const entries = G.gameLog ?? [];
  const toSequence = G.gameLogSequence ?? entries.at(-1)?.sequence ?? 0;
  const deltaEntries = entries.filter((entry) => entry.sequence > fromSequenceExclusive);
  const firstAvailableSequence = entries[0]?.sequence;
  const truncated =
    firstAvailableSequence === undefined
      ? toSequence > fromSequenceExclusive
      : fromSequenceExclusive < firstAvailableSequence - 1;

  return {
    entries: deltaEntries,
    fromSequenceExclusive,
    toSequence,
    truncated,
  };
}

export function resolveGameLogText(
  entry: GameLogEntry,
  viewerId: string | undefined,
  level: GameLogLevel,
  t: (key: string, params?: Record<string, unknown>) => string,
  matchData?: MatchDataEntry[],
): string | null {
  if (entry.detailOnly && level === 'action') return null;

  const usePrivate =
    level === 'detail' && entry.privateMessageKey && canViewPrivate(entry, viewerId);
  const key = usePrivate ? entry.privateMessageKey! : entry.publicMessageKey;
  const params = usePrivate
    ? resolvePlayerParams(entry.privateParams, entry.privatePlayerIds, matchData)
    : resolvePlayerParams(entry.publicParams, entry.publicPlayerIds, matchData);
  return t(key, resolveLogParams(params, t));
}

export function resolveGameLogs(
  entries: GameLogEntry[] | undefined,
  viewerId: string | undefined,
  level: GameLogLevel,
  t: (key: string, params?: Record<string, unknown>) => string,
  matchData?: MatchDataEntry[],
): ResolvedGameLogEntry[] {
  const resolved: ResolvedGameLogEntry[] = [];
  for (const entry of filterGameLogForPlayer(entries, viewerId)) {
    const text = resolveGameLogText(entry, viewerId, level, t, matchData);
    if (text == null) continue;
    resolved.push({
      id: entry.id,
      sequence: entry.sequence,
      turn: entry.turn,
      playerId: entry.playerId,
      text,
    });
  }
  return resolved;
}
