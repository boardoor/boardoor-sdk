import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { assertRegistryOnlyDependencyPolicy } from './creator-template-policy';

const root = resolve(process.cwd());
const fixturesRoot = join(root, 'scripts/fixtures/creator-template-policy');
const safeManifest = JSON.stringify({
  dependencies: {
    '@boardoor/core': '0.1.0-alpha.0',
    '@boardoor/ui': '0.1.0-alpha.0',
    fixture: '1.2.3',
  },
});
const safeLock = `lockfileVersion: '9.0'
packages:
  fixture@1.2.3:
    resolution: {integrity: sha512-registry}
`;
const fixtures = readdirSync(fixturesRoot).toSorted();

assert.doesNotThrow(() => assertRegistryOnlyDependencyPolicy(safeManifest, safeLock));
for (const fixture of fixtures) {
  const fixtureText = readFileSync(join(fixturesRoot, fixture), 'utf8');
  const extension = extname(fixture);
  assert.throws(
    () =>
      extension === '.json'
        ? assertRegistryOnlyDependencyPolicy(fixtureText, safeLock)
        : assertRegistryOnlyDependencyPolicy(safeManifest, fixtureText),
    undefined,
    `${fixture} must fail closed`,
  );
}

console.log(`Creator registry policy rejected ${fixtures.length} negative fixtures.`);
