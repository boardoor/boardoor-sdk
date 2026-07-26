import { stripTransients } from '../../core/action-creators';
import { InitializeGame } from '../../core/initialize';
import { CreateGameReducer } from '../../core/reducer';
import type { Game, State, TransientState } from '../../types';
import { stableHash } from './actions';

export interface HarnessStateContext {
  game: Game;
  state: State;
  reducer: ReturnType<typeof CreateGameReducer>;
}

export interface SerializationProblem {
  path: string;
  reason: string;
}

export function createHarnessState({
  game,
  seed,
  numPlayers,
  setupData,
}: {
  game: Game;
  seed: string;
  numPlayers: number;
  setupData?: unknown;
}): HarnessStateContext {
  const harnessGame: Game = {
    ...game,
    seed,
    disableUndo: true,
  };

  return {
    game: harnessGame,
    state: InitializeGame({ game: harnessGame, numPlayers, setupData }),
    reducer: CreateGameReducer({ game: harnessGame }),
  };
}

export function stripHarnessTransients(
  reducer: ReturnType<typeof CreateGameReducer>,
  state: TransientState,
): State {
  return reducer(state, stripTransients()) as State;
}

export function sanitizeStateForHash(state: State | TransientState): unknown {
  const rest = { ...(state as TransientState & { deltalog?: unknown }) };
  delete rest['_undo'];
  delete rest['_redo'];
  delete rest.deltalog;
  delete rest.transients;
  return rest;
}

export function stateHash(state: State | TransientState): string {
  return stableHash(sanitizeStateForHash(state));
}

export function setupDataHash(setupData: unknown): string {
  return stableHash(setupData ?? null);
}

export function cloneForProbe<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value) as T;

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const entry of value) out.push(cloneForProbe(entry, seen));
    return out as T;
  }

  if (value instanceof Map) {
    const out = new Map<unknown, unknown>();
    seen.set(value, out);
    for (const [key, entry] of value.entries()) {
      out.set(cloneForProbe(key, seen), cloneForProbe(entry, seen));
    }
    return out as T;
  }

  if (value instanceof Set) {
    const out = new Set<unknown>();
    seen.set(value, out);
    for (const entry of value.values()) out.add(cloneForProbe(entry, seen));
    return out as T;
  }

  const proto = Object.getPrototypeOf(value);
  const out = Object.create(proto) as Record<PropertyKey, unknown>;
  seen.set(value, out);
  for (const key of Reflect.ownKeys(value)) {
    out[key] = cloneForProbe((value as Record<PropertyKey, unknown>)[key], seen);
  }
  return out as T;
}

export function findJsonSerializationProblems(value: unknown): SerializationProblem[] {
  const problems: SerializationProblem[] = [];
  visitForSerialization(value, '$', problems, new WeakSet<object>());
  return problems;
}

function visitForSerialization(
  value: unknown,
  path: string,
  problems: SerializationProblem[],
  seen: WeakSet<object>,
) {
  if (value === undefined) {
    problems.push({ path, reason: 'undefined is not preserved by JSON serialization' });
    return;
  }
  if (typeof value === 'function') {
    problems.push({ path, reason: 'function is not JSON-serializable' });
    return;
  }
  if (typeof value === 'symbol') {
    problems.push({ path, reason: 'symbol is not JSON-serializable' });
    return;
  }
  if (typeof value === 'bigint') {
    problems.push({ path, reason: 'bigint throws during JSON serialization' });
    return;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    problems.push({ path, reason: 'non-finite number is serialized as null by JSON' });
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) {
    problems.push({ path, reason: 'circular reference is not JSON-serializable' });
    return;
  }
  seen.add(value);

  if (value instanceof Map) {
    problems.push({ path, reason: 'Map is serialized as an empty object by JSON' });
    seen.delete(value);
    return;
  }
  if (value instanceof Set) {
    problems.push({ path, reason: 'Set is serialized as an empty object by JSON' });
    seen.delete(value);
    return;
  }

  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    problems.push({ path, reason: 'class instance is not plain JSON data' });
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      visitForSerialization(entry, `${path}[${index}]`, problems, seen),
    );
    seen.delete(value);
    return;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    visitForSerialization(entry, `${path}.${key}`, problems, seen);
  }
  seen.delete(value);
}
