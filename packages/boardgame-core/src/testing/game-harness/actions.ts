import { makeMove, gameEvent } from '../../core/action-creators';
import { GAME_EVENT, MAKE_MOVE } from '../../core/action-types';
import type { AiEnumerate, ActionShape, PlayerID } from '../../types';
import type { WeightedHarnessAction } from './types';

export interface NormalizeActionsResult {
  actions: WeightedHarnessAction[];
  invalidShapes: unknown[];
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(toStableJson(value));
}

export function stableHash(value: unknown): string {
  let hash = 0xcbf29ce484222325n;
  const text = stableStringify(value);
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function previewValue(value: unknown, maxLength = 240): unknown {
  const stable = toStableJson(value, new WeakSet(), 3);
  const text = JSON.stringify(stable);
  if (text.length <= maxLength) return stable;
  return { truncated: true, hash: stableHash(value), preview: text.slice(0, maxLength) };
}

export function normalizeEnumeratedActions(
  enumerated: AiEnumerate,
  playerID: PlayerID,
): NormalizeActionsResult {
  const actions: WeightedHarnessAction[] = [];
  const invalidShapes: unknown[] = [];

  if (!Array.isArray(enumerated)) {
    return { actions, invalidShapes: [enumerated] };
  }

  for (const candidate of enumerated) {
    const action = normalizeAction(candidate, playerID);
    if (action) {
      actions.push(action);
    } else {
      invalidShapes.push(candidate);
    }
  }

  return { actions, invalidShapes };
}

export function normalizePolicyAction(
  action: ActionShape.MakeMove | ActionShape.GameEvent,
  playerID: PlayerID,
): WeightedHarnessAction | undefined {
  return normalizeAction(action, playerID);
}

function normalizeAction(
  candidate: unknown,
  playerID: PlayerID,
): WeightedHarnessAction | undefined {
  if (!candidate || typeof candidate !== 'object') return undefined;
  const shape = candidate as Record<string, unknown>;

  if (shape.type === MAKE_MOVE || shape.type === GAME_EVENT) {
    const payload = shape.payload;
    if (!payload || typeof payload !== 'object') return undefined;
    const typedPayload = payload as Record<string, unknown>;
    if (typeof typedPayload.type !== 'string') return undefined;
    return {
      ...(candidate as ActionShape.MakeMove | ActionShape.GameEvent),
      payload: {
        ...(candidate as ActionShape.MakeMove | ActionShape.GameEvent).payload,
        playerID:
          (candidate as ActionShape.MakeMove | ActionShape.GameEvent).payload.playerID ?? playerID,
      },
      weight: typeof shape.weight === 'number' ? shape.weight : undefined,
    } as WeightedHarnessAction;
  }

  if (typeof shape.move === 'string') {
    const action = makeMove(shape.move, shape.args as unknown[] | undefined, playerID);
    return {
      ...action,
      weight: typeof shape.weight === 'number' ? shape.weight : undefined,
    };
  }

  if (typeof shape.event === 'string') {
    const action = gameEvent(shape.event, shape.args as unknown[] | undefined, playerID);
    return {
      ...action,
      weight: typeof shape.weight === 'number' ? shape.weight : undefined,
    };
  }

  return undefined;
}

function toStableJson(value: unknown, seen = new WeakSet<object>(), depth = 12): unknown {
  if (depth < 0) return '[MaxDepth]';
  if (value === undefined) return { __type: 'undefined' };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { __type: 'NaN' };
    if (value === Infinity) return { __type: 'Infinity' };
    if (value === -Infinity) return { __type: '-Infinity' };
    return value;
  }
  if (typeof value === 'bigint') return { __type: 'bigint', value: value.toString() };
  if (typeof value === 'function') return { __type: 'function', name: value.name };
  if (typeof value === 'symbol') return { __type: 'symbol', value: String(value) };
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return { __type: 'circular' };
  seen.add(value);

  if (Array.isArray(value)) {
    const out = value.map((entry) => toStableJson(entry, seen, depth - 1));
    seen.delete(value);
    return out;
  }

  if (value instanceof Map) {
    const out = {
      __type: 'Map',
      entries: [...value.entries()].map(([k, v]) => [
        toStableJson(k, seen, depth - 1),
        toStableJson(v, seen, depth - 1),
      ]),
    };
    seen.delete(value);
    return out;
  }

  if (value instanceof Set) {
    const out = {
      __type: 'Set',
      values: [...value.values()].map((entry) => toStableJson(entry, seen, depth - 1)),
    };
    seen.delete(value);
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = toStableJson((value as Record<string, unknown>)[key], seen, depth - 1);
  }
  seen.delete(value);
  return out;
}
