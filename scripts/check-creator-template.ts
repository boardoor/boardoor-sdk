import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { assertRegistryOnlyDependencyPolicy } from './creator-template-policy';

const expectedSDKVersions = {
  '@boardoor/core': '0.1.0-alpha.0',
  '@boardoor/ui': '0.1.0-alpha.0',
} as const;
const root = resolve(process.cwd());
const templateRoot = join(root, 'examples/sdk-tutorial');
const tempRoot = mkdtempSync(join(tmpdir(), 'boardoor-creator-check-'));
const projectRoot = join(tempRoot, 'last-stone');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function isWithin(parent: string, candidate: string): boolean {
  const relation = relative(parent, candidate);
  return relation === '' || (!relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

function run(args: string[]): void {
  execFileSync(pnpm, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      CI: 'true',
      npm_config_registry: 'https://registry.npmjs.org/',
    },
    stdio: 'inherit',
    timeout: 120_000,
  });
}

function assertCopiedLegalFiles(): void {
  const expectedLicense = readFileSync(join(root, 'LICENSE'), 'utf8');
  const copiedLicense = readFileSync(join(projectRoot, 'LICENSE'), 'utf8');
  if (copiedLicense !== expectedLicense) {
    throw new Error('creator template LICENSE must match the repository MIT license');
  }

  const notice = readFileSync(join(projectRoot, 'NOTICE'), 'utf8');
  if (
    !notice.includes('Copyright (c) 2026 Boardoor contributors') ||
    !notice.includes('accompanying MIT License') ||
    !notice.includes('THIRD_PARTY_NOTICES')
  ) {
    throw new Error('creator template NOTICE is missing required attribution or notice guidance');
  }
}

function assertRegistryOnlyManifest(): void {
  const manifestText = readFileSync(join(projectRoot, 'package.json'), 'utf8');
  const lockText = readFileSync(join(projectRoot, 'pnpm-lock.yaml'), 'utf8');
  assertRegistryOnlyDependencyPolicy(manifestText, lockText);
  const manifest = JSON.parse(manifestText) as {
    dependencies?: Record<string, string>;
  };
  for (const [packageName, expectedVersion] of Object.entries(expectedSDKVersions)) {
    if (manifest.dependencies?.[packageName] !== expectedVersion) {
      throw new Error(`${packageName} must be pinned to ${expectedVersion}`);
    }
  }
}

function assertInstalledSDK(): void {
  for (const [packageName, expectedVersion] of Object.entries(expectedSDKVersions)) {
    const packageRoot = join(projectRoot, 'node_modules', ...packageName.split('/'));
    const installedRoot = realpathSync(packageRoot);
    if (!isWithin(tempRoot, installedRoot) || isWithin(root, installedRoot)) {
      throw new Error(`${packageName} did not resolve inside the isolated clean-copy directory`);
    }

    const manifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8')) as {
      version?: string;
    };
    if (manifest.version !== expectedVersion) {
      throw new Error(`${packageName} resolved ${manifest.version}, expected ${expectedVersion}`);
    }
    for (const requiredFile of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      if (!existsSync(join(installedRoot, requiredFile))) {
        throw new Error(`${packageName} is missing installed ${requiredFile}`);
      }
    }
  }
}

try {
  if (isWithin(root, tempRoot)) {
    throw new Error('creator clean-copy check must run outside the pnpm workspace');
  }
  cpSync(templateRoot, projectRoot, {
    recursive: true,
    filter: (source) => {
      const relation = relative(templateRoot, source);
      if (relation === '') return true;
      return !relation
        .split(sep)
        .some((segment) => ['node_modules', 'dist', '.pnpm-store'].includes(segment));
    },
  });

  assertCopiedLegalFiles();
  assertRegistryOnlyManifest();
  run([
    'install',
    '--frozen-lockfile',
    '--ignore-workspace',
    '--store-dir',
    join(tempRoot, 'pnpm-store'),
  ]);
  assertInstalledSDK();
  run(['typecheck']);
  run(['test:run']);
  run(['build']);
  console.log('Standalone creator template registry check passed.');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
