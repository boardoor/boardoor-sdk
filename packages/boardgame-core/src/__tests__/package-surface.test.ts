import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as root from '../index';
import type {
  ApplyStateMigrationsOptions,
  ApplyStateMigrationsResult,
  IntermediateTransportData,
  StateMigrationErrorCode,
  TransportData,
} from '../index';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testDir, '..', '..');

function readPackageFile(path: string): string {
  return readFileSync(join(packageRoot, path), 'utf8');
}

function listSourceFiles(path: string): string[] {
  return readdirSync(join(packageRoot, path), { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    return entry.isDirectory() ? listSourceFiles(entryPath) : [entryPath];
  });
}

describe('@boardoor/core package surface', () => {
  const transportTypeCheck: TransportData | IntermediateTransportData | undefined = undefined;
  const migrationTypeCheck:
    | ApplyStateMigrationsOptions
    | ApplyStateMigrationsResult
    | StateMigrationErrorCode
    | undefined = undefined;
  void transportTypeCheck;
  void migrationTypeCheck;

  it('uses self-owned semver for the private package', () => {
    const pkg = JSON.parse(readPackageFile('package.json')) as { version: string };

    expect(pkg.version).toBe('0.1.0-alpha.0');
  });

  it('does not expose ts-toolbelt in package metadata or source imports', () => {
    const pkg = readPackageFile('package.json');
    const types = readPackageFile('src/types.ts');

    expect(pkg).not.toContain('ts-toolbelt');
    expect(types).not.toContain('ts-toolbelt');
  });

  it('exposes only the classified package entry points', () => {
    const pkg = JSON.parse(readPackageFile('package.json')) as {
      exports: Record<string, string>;
    };
    const published = JSON.parse(readPackageFile('package.publish.json')) as {
      boardoor: { stability: Record<string, string> };
      exports: Record<string, unknown>;
    };

    expect(pkg.exports['./testing/game-harness']).toBe('./src/testing/game-harness/index.ts');
    expect(pkg.exports['.']).toBe('./src/index.ts');
    expect(pkg.exports).not.toHaveProperty('./internal');
    expect(published.exports).not.toHaveProperty('./internal');
    expect(published.boardoor.stability).toEqual({
      '.': 'supported',
      './app': 'supported',
      './app/test-utils': 'experimental',
      './testing/game-harness': 'experimental',
    });
    expect(existsSync(join(packageRoot, 'src/internal'))).toBe(false);
  });

  it('owns the former engine seam at the root without server authority', () => {
    for (const name of [
      'CreateGameReducer',
      'InitializeGame',
      'IsLongFormMove',
      'MAKE_MOVE',
      'ProcessGameConfig',
      'REDO',
      'StateMigrationError',
      'TransientHandlingMiddleware',
      'UNDO',
      'applyStateMigrations',
      'getFilterPlayerView',
      'redactLog',
    ]) {
      expect(root).toHaveProperty(name);
    }
    expect(root).not.toHaveProperty('Master');
    expect(root).not.toHaveProperty('Auth');
    expect(root).not.toHaveProperty('Async');
    expect(root).not.toHaveProperty('Sync');
    expect(root).not.toHaveProperty('createMatch');
  });

  it('keeps server authority out of the public root', () => {
    for (const name of ['Master', 'Auth', 'Async', 'Sync', 'createMatch', 'StorageAPI']) {
      expect(root).not.toHaveProperty(name);
    }

    const rootSource = readPackageFile('src/index.ts');
    expect(rootSource).not.toMatch(/(?:master|server)\//);
  });

  it('keeps the client graph independent from master and server modules', () => {
    const clientSource = listSourceFiles('src/client')
      .filter((path) => /\.[cm]?[jt]sx?$/.test(path) && !path.includes('__tests__'))
      .map(readPackageFile)
      .join('\n');

    expect(clientSource).not.toMatch(/from\s+['"][^'"]*(?:master|server)\//);
    expect(clientSource).not.toMatch(/import\(['"][^'"]*(?:master|server)\//);
  });
});
