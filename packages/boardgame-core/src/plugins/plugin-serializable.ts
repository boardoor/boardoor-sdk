import isPlainObject from 'lodash.isplainobject';

import type { Plugin } from '../types';

/** Check whether a move result stays within the JSON-shaped state contract. */
function isSerializable(value: unknown): boolean {
  if (
    value === undefined ||
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return true;
  }

  if (!isPlainObject(value) && !Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(isSerializable);
}

/**
 * Plugin that checks whether state is serializable, in order to avoid
 * network serialization bugs.
 */
const SerializablePlugin: Plugin = {
  name: 'plugin-serializable',

  fnWrap:
    (move) =>
    (context, ...args) => {
      const result = move(context, ...args);
      // Check state in non-production environments.
      if (process.env.NODE_ENV !== 'production' && !isSerializable(result)) {
        throw new Error(
          'Move state is not JSON-serializable.\n' +
            'See https://boardgame.io/documentation/#/?id=state for more information.',
        );
      }
      return result;
    },
};

export default SerializablePlugin;
