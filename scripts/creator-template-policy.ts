const dependencyFields = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const exactRegistryVersion =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const forbiddenProtocol = /(?:^|[\s"'(])(workspace|link|file|portal|catalog|patch|git\+file):/im;
const localPath = /^(?:\.{1,2}[\\/]|[/\\]|~[\\/]|[A-Za-z]:[\\/]|\\\\|[^:@\s]+[\\/][^:\s]+$)/;
const localArchive = /(?:^|[\\/])[^/\\\s]+\.(?:tgz|tar|tar\.gz)$/i;
const forbiddenLockPatterns: ReadonlyArray<[label: string, pattern: RegExp]> = [
  ['patchedDependencies', /^\s*['"]?patchedDependencies['"]?\s*:/im],
  ['patch hash', /(?:^|[\s(])patch_hash=/im],
  ['local resolution field', /(?:^|[{,\s])['"]?(directory|path|tarball)['"]?\s*:/im],
  [
    'local path resolution',
    /^\s*['"]?(specifier|version|resolution)['"]?\s*:\s*['"]?(?:\.{1,2}[\\/]|[/\\]|~[\\/]|[A-Za-z]:[\\/]|\\\\)/im,
  ],
  [
    'local tarball resolution',
    /^\s*['"]?(specifier|version|resolution)['"]?\s*:.*(?:^|[\\/])?[^/\\\s]+\.(?:tgz|tar|tar\.gz)(?:['"}\s]|$)/im,
  ],
];

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactDependencyMap(value: unknown, path: string): void {
  if (!isObject(value)) throw new Error(`${path} must be an object`);
  for (const [packageName, specifier] of Object.entries(value)) {
    if (typeof specifier !== 'string' || !exactRegistryVersion.test(specifier)) {
      throw new Error(
        `${path}.${packageName} must use an exact registry version, received ${String(specifier)}`,
      );
    }
  }
}

function assertExactResolutionValues(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (!exactRegistryVersion.test(value)) {
      throw new Error(`${path} must use an exact registry version, received ${value}`);
    }
    return;
  }
  if (!isObject(value)) throw new Error(`${path} must contain registry-version mappings`);
  for (const [key, nested] of Object.entries(value)) {
    assertExactResolutionValues(nested, `${path}.${key}`);
  }
}

function inspectManifestObject(value: JsonObject, path = 'package.json'): void {
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (key === 'patchedDependencies') {
      throw new Error(`${nestedPath} is forbidden in the registry-only creator template`);
    }
    if (key === 'bundledDependencies' || key === 'bundleDependencies') {
      throw new Error(`${nestedPath} is forbidden in the registry-only creator template`);
    }
    if (dependencyFields.has(key)) {
      assertExactDependencyMap(nested, nestedPath);
    } else if (key === 'overrides' || key === 'resolutions') {
      assertExactResolutionValues(nested, nestedPath);
    } else if (isObject(nested)) {
      inspectManifestObject(nested, nestedPath);
    }
  }
}

function assertNoLocalManifestMechanism(value: unknown, path = 'package.json'): void {
  if (typeof value === 'string') {
    if (forbiddenProtocol.test(value) || localPath.test(value) || localArchive.test(value.trim())) {
      throw new Error(`${path} contains a forbidden patch or local artifact reference: ${value}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((nested, index) => assertNoLocalManifestMechanism(nested, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'scripts') continue;
    assertNoLocalManifestMechanism(nested, `${path}.${key}`);
  }
}

export function assertRegistryOnlyDependencyPolicy(manifestText: string, lockText: string): void {
  const manifest = JSON.parse(manifestText) as unknown;
  if (!isObject(manifest)) throw new Error('creator template package.json must be an object');

  inspectManifestObject(manifest);
  assertNoLocalManifestMechanism(manifest);

  const protocol = forbiddenProtocol.exec(lockText);
  if (protocol) {
    throw new Error(`pnpm-lock.yaml contains forbidden ${protocol[1]}: resolution`);
  }
  for (const [label, pattern] of forbiddenLockPatterns) {
    if (pattern.test(lockText)) {
      throw new Error(`pnpm-lock.yaml contains forbidden ${label}`);
    }
  }
}
