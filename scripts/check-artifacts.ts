import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

type Candidate = {
  kind: 'core' | 'ui';
  packageName: '@boardoor/core' | '@boardoor/ui';
  packageDirectory: string;
  publishManifest: string;
  inventory: string;
  packageFiles: string[];
};

type PackageManifest = {
  name?: string;
  version?: string;
  private?: boolean;
  license?: string;
  type?: string;
  main?: string;
  types?: string;
  files?: string[];
  repository?: { type?: string; url?: string; directory?: string };
  publishConfig?: { access?: string; provenance?: boolean };
  sideEffects?: string[];
  exports?: Record<string, string | Record<string, string>>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  boardoor?: { stability?: Record<string, string> };
};

const candidates: Candidate[] = [
  {
    kind: 'core',
    packageName: '@boardoor/core',
    packageDirectory: 'packages/boardgame-core',
    publishManifest: 'packages/boardgame-core/package.publish.json',
    inventory: 'packages/boardgame-core/etc/pack-inventory.txt',
    packageFiles: ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'EMBEDDED_COMPONENTS.json', 'README.md'],
  },
  {
    kind: 'ui',
    packageName: '@boardoor/ui',
    packageDirectory: 'packages/boardgame-ui',
    publishManifest: 'packages/boardgame-ui/package.publish.json',
    inventory: 'packages/boardgame-ui/etc/pack-inventory.txt',
    packageFiles: ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'GENERATED_COMPONENTS.json', 'README.md'],
  },
];

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), 'boardoor-public-sdk-pack-'));
const violations: string[] = [];
const npmCli = join(root, 'node_modules/.bin/npm');
const npmEnvironment: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME: tempRoot,
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  CI: 'true',
  npm_config_cache: join(tempRoot, 'npm-cache'),
  npm_config_ignore_scripts: 'true',
  npm_config_userconfig: '/dev/null',
};

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function normalizeInventory(tarball: string): string[] {
  return execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, '').replace(/\/$/, ''))
    .filter(Boolean)
    .toSorted();
}

function dependencyName(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
}

function isValidSemVer(version: string): boolean {
  const match =
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version,
    );
  if (!match) return false;
  return !(match[1] ?? '')
    .split('.')
    .some(
      (identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier[0] === '0',
    );
}

function normalizeObject(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(normalizeObject);
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeObject(nested)]),
    );
  }
  return input;
}

function stable(value: unknown): string {
  return JSON.stringify(normalizeObject(value));
}

function rootStaticDependencies(
  packageRoot: string,
  exports: Record<string, string | Record<string, string>>,
): Set<string> {
  const rootExport = exports['.'];
  const entry =
    typeof rootExport === 'string' ? rootExport : (rootExport?.import ?? rootExport?.default);
  if (!entry?.endsWith('.js')) return new Set();

  const dependencies = new Set<string>();
  const visited = new Set<string>();
  const visit = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)(['"])([^'"]+)\1/g)) {
      const specifier = match[2]!;
      if (specifier.startsWith('.')) {
        const imported = resolve(dirname(file), specifier);
        if (!existsSync(imported)) {
          violations.push(`${file}: unresolved static import ${specifier}`);
        } else {
          visit(imported);
        }
      } else {
        dependencies.add(dependencyName(specifier));
      }
    }
  };
  visit(join(packageRoot, entry));
  return dependencies;
}

function assertManifest(
  candidate: Candidate,
  manifest: PackageManifest,
  packageRoot: string,
  expectedVersion: string,
): void {
  const expectedFiles = ['dist', ...candidate.packageFiles];
  if (
    manifest.name !== candidate.packageName ||
    manifest.version !== expectedVersion ||
    manifest.private !== undefined
  ) {
    violations.push(`${candidate.packageName}: staged manifest identity/private flag is invalid`);
  }
  if (
    manifest.license !== 'MIT' ||
    manifest.type !== 'module' ||
    manifest.main !== './dist/index.js' ||
    manifest.types !== './dist/index.d.ts' ||
    manifest.repository?.type !== 'git' ||
    manifest.repository.url !== 'git+https://github.com/boardoor/boardoor-sdk.git' ||
    manifest.repository.directory !== candidate.packageDirectory ||
    manifest.publishConfig?.access !== 'public' ||
    manifest.publishConfig.provenance !== true
  ) {
    violations.push(`${candidate.packageName}: publication metadata is incomplete`);
  }
  if (JSON.stringify(manifest.files) !== JSON.stringify(expectedFiles)) {
    violations.push(`${candidate.packageName}: files allowlist is invalid`);
  }

  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    for (const artifact of typeof target === 'string' ? [target] : Object.values(target)) {
      if (!artifact.startsWith('./dist/')) {
        violations.push(`${candidate.packageName}${subpath}: export is not built: ${artifact}`);
      } else if (!existsSync(join(packageRoot, artifact))) {
        violations.push(`${candidate.packageName}${subpath}: missing packed export ${artifact}`);
      }
    }
  }

  const rootDependencies = rootStaticDependencies(packageRoot, manifest.exports ?? {});
  for (const [dependency, metadata] of Object.entries(manifest.peerDependenciesMeta ?? {})) {
    if (metadata.optional && rootDependencies.has(dependency)) {
      violations.push(
        `${candidate.packageName}: root statically imports optional peer ${dependency}`,
      );
    }
  }

  if (candidate.kind === 'core') {
    const expectedExports = {
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
    };
    const expectedStability = [
      ['.', 'supported'],
      ['./app', 'supported'],
      ['./app/test-utils', 'experimental'],
      ['./testing/game-harness', 'experimental'],
    ];
    if (stable(manifest.exports ?? {}) !== stable(expectedExports)) {
      violations.push(`${candidate.packageName}: package exports are not the approved surface`);
    }
    if (
      JSON.stringify(Object.entries(manifest.boardoor?.stability ?? {}).toSorted()) !==
      JSON.stringify(expectedStability)
    ) {
      violations.push(`${candidate.packageName}: surface stability metadata is invalid`);
    }
  } else {
    const expectedExports = {
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
    };
    if (stable(manifest.exports ?? {}) !== stable(expectedExports)) {
      violations.push(`${candidate.packageName}: package exports are not the approved surface`);
    }
    if (JSON.stringify(manifest.sideEffects) !== JSON.stringify(['./dist/styles/*.css'])) {
      violations.push(`${candidate.packageName}: CSS side-effects declaration is invalid`);
    }
  }
}

try {
  if (!existsSync(npmCli)) {
    violations.push('pinned npm CLI is missing; run the frozen install before artifact validation');
  } else {
    const npmVersion = execFileSync(npmCli, ['--version'], {
      encoding: 'utf8',
      env: npmEnvironment,
    }).trim();
    if (npmVersion !== '11.5.1') {
      violations.push(`artifact validation requires pinned npm 11.5.1, found ${npmVersion}`);
    }
  }
  for (const candidate of candidates) {
    const safeName = candidate.kind;
    const staging = join(tempRoot, `${safeName}-staging`);
    const output = join(tempRoot, `${safeName}-output`);
    mkdirSync(staging, { recursive: true });
    mkdirSync(output, { recursive: true });
    const sourceManifest = JSON.parse(
      readFileSync(join(root, candidate.packageDirectory, 'package.json'), 'utf8'),
    ) as PackageManifest;
    const publishManifest = JSON.parse(
      readFileSync(join(root, candidate.publishManifest), 'utf8'),
    ) as PackageManifest;
    const expectedVersion = sourceManifest.version;
    if (sourceManifest.name !== candidate.packageName || sourceManifest.private !== true) {
      violations.push(`${candidate.packageName}: source manifest identity/private flag is invalid`);
    }
    if (typeof expectedVersion !== 'string' || !isValidSemVer(expectedVersion)) {
      violations.push(`${candidate.packageName}: source version is not valid SemVer`);
    }
    if (publishManifest.version !== expectedVersion) {
      violations.push(`${candidate.packageName}: source/publish version drifted`);
    }
    cpSync(join(root, candidate.packageDirectory, 'dist'), join(staging, 'dist'), {
      recursive: true,
    });
    for (const file of candidate.packageFiles) {
      copyFileSync(join(root, candidate.packageDirectory, file), join(staging, file));
    }
    copyFileSync(join(root, candidate.publishManifest), join(staging, 'package.json'));
    execFileSync(npmCli, ['pack', '--ignore-scripts', '--pack-destination', output], {
      cwd: staging,
      env: npmEnvironment,
      stdio: 'pipe',
    });

    const tarballs = readdirSync(output).filter((name) => name.endsWith('.tgz'));
    if (tarballs.length !== 1) {
      violations.push(`${candidate.packageName}: expected one tarball, found ${tarballs.length}`);
      continue;
    }
    const tarball = join(output, tarballs[0]!);
    const inventory = normalizeInventory(tarball);
    const expectedInventory = readFileSync(join(root, candidate.inventory), 'utf8');
    if (`${inventory.join('\n')}\n` !== expectedInventory) {
      violations.push(`${candidate.packageName}: pack inventory drifted`);
    }
    for (const path of inventory) {
      if (
        /(^|\/)(?:src|__tests__|tests?|private|server)(?:\/|$)/i.test(path) ||
        /(?:\.test\.|\.spec\.|(?<!\.d)\.tsx?$|\.map$)/i.test(path)
      ) {
        violations.push(`${candidate.packageName}: forbidden packed path ${path}`);
      }
      if (candidate.kind === 'core' && /(^|\/)internal(?:\/|$)/i.test(path)) {
        violations.push(`${candidate.packageName}: forbidden packed internal path ${path}`);
      }
    }

    const extracted = join(output, 'extracted');
    mkdirSync(extracted, { recursive: true });
    execFileSync('tar', ['-xzf', tarball, '-C', extracted]);
    const packageRoot = join(extracted, 'package');
    const artifactFiles = filesBelow(packageRoot);
    const text = artifactFiles
      .filter((path) => /\.(?:js|d\.ts|json|css|md)$/i.test(path))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    // This checker ships in the public repository, so every pattern here becomes public.
    // Keep it to structural shapes that name no private account, host, or repository:
    // any absolute home path is rejected regardless of user name. Private-source-specific
    // tokens stay in the private-side scripts/check-sdk-artifacts.ts, which gates the same
    // candidate before it is ever exported.
    for (const pattern of [
      /@boardoor\/core-server/,
      /@boardoor\/core\/internal/,
      /boardgame-core\/src\//,
      /\/home\/[^/]+\//,
      /packages\/boardgame-core-server/,
      /apps\/web\//,
    ]) {
      if (pattern.test(text)) {
        violations.push(`${candidate.packageName}: content matched ${pattern}`);
      }
    }

    const manifest = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf8'),
    ) as PackageManifest;
    assertManifest(candidate, manifest, packageRoot, expectedVersion ?? '');

    for (const required of candidate.packageFiles) {
      if (!inventory.includes(required)) {
        violations.push(`${candidate.packageName}: missing packed ${required}`);
      }
    }
    if (candidate.kind === 'ui') {
      const cssPath = join(packageRoot, 'dist/styles/ui.css');
      if (!existsSync(cssPath)) {
        violations.push(`${candidate.packageName}: missing compiled styles/ui.css`);
      } else {
        const css = readFileSync(cssPath, 'utf8');
        for (const pattern of [
          /@source\b/,
          /@import\s+['"]?tailwindcss/,
          /packages\/boardgame-ui/,
          /src\//,
        ]) {
          if (pattern.test(css))
            violations.push(`${candidate.packageName}: compiled CSS matched ${pattern}`);
        }
        for (const pattern of [
          /short\\:gap-1/,
          /reconnect-pulse/,
          /user-select:none/,
          /animate-reconnect-pulse/,
        ]) {
          if (!pattern.test(css)) {
            violations.push(`${candidate.packageName}: compiled CSS lost sentinel ${pattern}`);
          }
        }
      }
    }
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (violations.length > 0) {
  console.error('Public SDK artifact check failed:');
  for (const violation of violations.toSorted()) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('Public SDK artifact check passed.');
}
