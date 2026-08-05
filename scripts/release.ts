import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

type JsonObject = Record<string, unknown>;
type PackageConfig = {
  selector: 'core' | 'ui';
  directory: string;
  expectedName: string;
  packageFiles: string[];
  expectedExports: JsonObject;
};

const packages: PackageConfig[] = [
  {
    selector: 'core',
    directory: 'packages/boardgame-core',
    expectedName: '@boardoor/core',
    packageFiles: ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'EMBEDDED_COMPONENTS.json', 'README.md'],
    expectedExports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        default: './dist/index.js',
      },
      './app': {
        types: './dist/app/index.d.ts',
        import: './dist/app/index.js',
        default: './dist/app/index.js',
      },
      './app/test-utils': {
        types: './dist/app/test-utils.d.ts',
        import: './dist/app/test-utils.js',
        default: './dist/app/test-utils.js',
      },
      './testing/game-harness': {
        types: './dist/testing/game-harness/index.d.ts',
        import: './dist/testing/game-harness/index.js',
        default: './dist/testing/game-harness/index.js',
      },
    },
  },
  {
    selector: 'ui',
    directory: 'packages/boardgame-ui',
    expectedName: '@boardoor/ui',
    packageFiles: ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'GENERATED_COMPONENTS.json', 'README.md'],
    expectedExports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        default: './dist/index.js',
      },
      './playing-cards': {
        types: './dist/playing-cards/index.d.ts',
        import: './dist/playing-cards/index.js',
        default: './dist/playing-cards/index.js',
      },
      './layout': {
        types: './dist/layout/index.d.ts',
        import: './dist/layout/index.js',
        default: './dist/layout/index.js',
      },
      './genre': {
        types: './dist/genre/index.d.ts',
        import: './dist/genre/index.js',
        default: './dist/genre/index.js',
      },
      './locales': {
        types: './dist/locales/index.d.ts',
        import: './dist/locales/index.js',
        default: './dist/locales/index.js',
      },
      './audio': {
        types: './dist/audio/index.d.ts',
        import: './dist/audio/index.js',
        default: './dist/audio/index.js',
      },
      './styles/ui.css': './dist/styles/ui.css',
    },
  },
];

const root = process.cwd();
const npmCli = join(root, 'node_modules/.bin/npm');

function npmEnvironment(cacheRoot: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: cacheRoot,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    CI: 'true',
    npm_config_cache: join(cacheRoot, 'npm-cache'),
    npm_config_ignore_scripts: 'true',
    npm_config_userconfig: '/dev/null',
  };
}

function json(path: string): JsonObject {
  return JSON.parse(readFileSync(path, 'utf8')) as JsonObject;
}

function stable(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as JsonObject)
          .toSorted(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, sort(nested)]),
      );
    }
    return input;
  };
  return JSON.stringify(sort(value));
}

function record(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertProjection(source: JsonObject, published: JsonObject, config: PackageConfig): void {
  if (source.name !== config.expectedName || published.name !== config.expectedName) {
    throw new Error(`${config.directory}: package name drifted`);
  }
  if (source.version !== published.version) {
    throw new Error(`${config.directory}: source/publish version drifted`);
  }
  for (const field of ['license', 'dependencies', 'peerDependencies', 'peerDependenciesMeta']) {
    if (stable(source[field] ?? null) !== stable(published[field] ?? null)) {
      throw new Error(`${config.directory}: source/publish ${field} drifted`);
    }
  }
  if (source.private !== true || published.private !== undefined) {
    throw new Error(
      `${config.directory}: source must stay private and publish manifest must omit private`,
    );
  }
  if (
    published.type !== 'module' ||
    published.main !== './dist/index.js' ||
    published.types !== './dist/index.d.ts' ||
    stable(published.files ?? null) !== stable(['dist', ...config.packageFiles]) ||
    stable(published.exports ?? null) !== stable(config.expectedExports)
  ) {
    throw new Error(`${config.directory}: published files or ESM entrypoints drifted`);
  }
  const publishConfig = record(published.publishConfig);
  if (publishConfig.access !== 'public' || publishConfig.provenance !== true) {
    throw new Error(`${config.directory}: public/provenance metadata is missing`);
  }
}

function stage(): Array<{ config: PackageConfig; directory: string }> {
  if (!existsSync(npmCli)) {
    throw new Error('pinned npm CLI is missing; run the frozen install before release staging');
  }
  const npmVersion = execFileSync(npmCli, ['--version'], {
    encoding: 'utf8',
    env: npmEnvironment('/nonexistent'),
  }).trim();
  if (npmVersion !== '12.0.2') {
    throw new Error(`release staging requires pinned npm 12.0.2, found ${npmVersion}`);
  }
  const stageRoot = resolve(root, '.release');
  if (dirname(stageRoot) !== root || !stageRoot.startsWith(`${root}${sep}`)) {
    throw new Error('release staging must be the fixed .release child of the repository root');
  }
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });
  const staged: Array<{ config: PackageConfig; directory: string }> = [];
  for (const config of packages) {
    const packageRoot = join(root, config.directory);
    const source = json(join(packageRoot, 'package.json'));
    const published = json(join(packageRoot, 'package.publish.json'));
    assertProjection(source, published, config);
    if (!existsSync(join(packageRoot, 'dist'))) {
      throw new Error(`${config.directory}: dist is missing; build before staging`);
    }
    const target = join(stageRoot, config.expectedName.split('/').at(-1)!);
    mkdirSync(target, { recursive: true });
    cpSync(join(packageRoot, 'dist'), join(target, 'dist'), { recursive: true });
    for (const packageFile of config.packageFiles) {
      copyFileSync(join(packageRoot, packageFile), join(target, packageFile));
    }
    writeFileSync(join(target, 'package.json'), `${JSON.stringify(published, null, 2)}\n`);
    execFileSync(npmCli, ['pack', '--ignore-scripts', '--dry-run', '--json'], {
      cwd: target,
      env: npmEnvironment(stageRoot),
      stdio: 'pipe',
    });
    staged.push({ config, directory: target });
  }
  return staged;
}

function pack(staged: Array<{ config: PackageConfig; directory: string }>, selector: string): void {
  const selected = staged.find(({ config }) => config.selector === selector);
  if (!selected) {
    throw new Error('--pack requires exactly one package selector: core or ui');
  }
  const artifactRoot = resolve(root, '.release/artifacts');
  mkdirSync(artifactRoot, { recursive: true });
  const output = execFileSync(
    npmCli,
    ['pack', '--ignore-scripts', '--json', '--pack-destination', artifactRoot],
    {
      cwd: selected.directory,
      encoding: 'utf8',
      env: npmEnvironment(resolve(root, '.release')),
    },
  );
  // npm 12 reports `pack --json` as an object keyed by package name; npm 11 emitted an array.
  // `Object.values` reads either shape, so the single-tarball assertion below stays the contract.
  const records = Object.values(JSON.parse(output) as Record<string, { filename?: string }>);
  if (records.length !== 1 || !records[0]?.filename) {
    throw new Error(`${selected.config.expectedName}: npm pack returned an unexpected result`);
  }
  const tarball = resolve(artifactRoot, records[0].filename);
  if (dirname(tarball) !== artifactRoot || !existsSync(tarball)) {
    throw new Error(`${selected.config.expectedName}: packed tarball is outside the artifact root`);
  }
  console.log(
    JSON.stringify({
      package: selected.config.expectedName,
      selector: selected.config.selector,
      tarball,
      sha256: sha256(tarball),
    }),
  );
}

const staged = stage();
const packIndex = process.argv.indexOf('--pack');
if (packIndex >= 0) {
  if (packIndex !== process.argv.length - 2) {
    throw new Error('usage: release.ts [--pack core|ui]');
  }
  pack(staged, process.argv[packIndex + 1]!);
} else {
  if (process.argv.length !== 2) throw new Error('usage: release.ts [--pack core|ui]');
  console.log(
    `Staged and validated: ${staged.map(({ directory }) => directory.split('/').at(-1)).join(', ')}`,
  );
  console.log(`Files: ${staged.flatMap(({ directory }) => readdirSync(directory)).length}`);
}
