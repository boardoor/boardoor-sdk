import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type JsonObject = Record<string, unknown>;
type Version = readonly [number, number, number, string?];
type EmbeddedComponent = {
  bomRef: string;
  name: string;
  version: string;
  license: string;
  source: string;
  relationship: string;
  modifications: string;
};

function parseVersion(value: string): Version {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) throw new Error(`unsupported semantic version: ${value}`);
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0), match[4]];
}

function compareVersion(left: Version, right: Version): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return Number(left[index]) - Number(right[index]);
  }
  if (left[3] === right[3]) return 0;
  if (left[3] === undefined) return 1;
  if (right[3] === undefined) return -1;
  return left[3].localeCompare(right[3]);
}

function satisfies(versionText: string, range: string): boolean {
  const version = parseVersion(versionText);
  if (range.startsWith('>=')) return compareVersion(version, parseVersion(range.slice(2))) >= 0;
  if (range.startsWith('^')) {
    const minimum = parseVersion(range.slice(1));
    const maximum: Version =
      minimum[0] > 0
        ? [minimum[0] + 1, 0, 0]
        : minimum[1] > 0
          ? [0, minimum[1] + 1, 0]
          : [0, 0, minimum[2] + 1];
    return compareVersion(version, minimum) >= 0 && compareVersion(version, maximum) < 0;
  }
  return compareVersion(version, parseVersion(range)) === 0;
}

function importerDependency(
  lockText: string,
  importer: string,
  field: string,
  dependency: string,
): { specifier: string; version: string } {
  const lines = lockText.split('\n');
  const importerStart = lines.findIndex((line) => line === `  ${importer}:`);
  if (importerStart < 0) throw new Error(`lockfile is missing importer ${importer}`);
  const importerEnd = lines.findIndex(
    (line, index) => index > importerStart && /^  \S.*:$/.test(line),
  );
  const importerLines = lines.slice(importerStart, importerEnd < 0 ? undefined : importerEnd);
  const fieldStart = importerLines.findIndex((line) => line === `    ${field}:`);
  if (fieldStart < 0) throw new Error(`${importer}: lockfile is missing ${field}`);
  const fieldEnd = importerLines.findIndex(
    (line, index) => index > fieldStart && /^    \S.*:$/.test(line),
  );
  const fieldLines = importerLines.slice(fieldStart, fieldEnd < 0 ? undefined : fieldEnd);
  const dependencyStart = fieldLines.findIndex((line) => {
    const match = /^      (.+):$/.exec(line);
    return match?.[1].replace(/^['"]|['"]$/g, '') === dependency;
  });
  if (dependencyStart < 0)
    throw new Error(`${importer}: lockfile is missing ${field} ${dependency}`);
  const block = fieldLines.slice(dependencyStart + 1, dependencyStart + 3);
  const specifier = /^        specifier: (.+)$/.exec(block[0] ?? '')?.[1];
  const version = /^        version: (.+)$/.exec(block[1] ?? '')?.[1];
  if (!specifier || !version)
    throw new Error(`${importer}: malformed lock entry for ${dependency}`);
  return {
    specifier: specifier.replace(/^['"]|['"]$/g, ''),
    version: version.replace(/^['"]|['"]$/g, '').split('(')[0],
  };
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

type SnapshotNode = {
  dependencies: Map<string, string>;
  optionalDependencies: Map<string, string>;
};

function snapshotGraph(lockText: string): Map<string, SnapshotNode> {
  const lines = lockText.split('\n');
  const start = lines.findIndex((line) => line === 'snapshots:');
  if (start < 0) throw new Error('lockfile is missing snapshots');
  const graph = new Map<string, SnapshotNode>();
  let key: string | undefined;
  let dependencyField: keyof SnapshotNode | undefined;
  for (const line of lines.slice(start + 1)) {
    if (/^[^ ]/.test(line)) break;
    const keyMatch = /^  (\S.*?):(?: \{\})?$/.exec(line);
    if (keyMatch) {
      key = unquote(keyMatch[1]);
      graph.set(key, { dependencies: new Map(), optionalDependencies: new Map() });
      dependencyField = undefined;
      continue;
    }
    const fieldMatch = /^    (\S+):$/.exec(line);
    if (fieldMatch) {
      dependencyField = ['dependencies', 'optionalDependencies'].includes(fieldMatch[1])
        ? (fieldMatch[1] as keyof SnapshotNode)
        : undefined;
      continue;
    }
    if (!key || !dependencyField) continue;
    const dependencyMatch = /^      (.+?): (.+)$/.exec(line);
    if (dependencyMatch) {
      const snapshot = graph.get(key)!;
      snapshot[dependencyField].set(unquote(dependencyMatch[1]), unquote(dependencyMatch[2]));
    }
  }
  return graph;
}

function snapshotVersion(key: string, name: string): string | undefined {
  if (!key.startsWith(`${name}@`)) return undefined;
  return key.slice(name.length + 1).split('(')[0];
}

function expectedPurl(name: string, version: string): string {
  return `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${version}`;
}

const root = process.cwd();
const sbomPath = resolve(root, 'sbom.cdx.json');
const sbomText = readFileSync(sbomPath, 'utf8');
const privateServerName = ['@boardoor', 'core-server'].join('/');
if (sbomText.includes(privateServerName) || sbomText.includes('private-verifier')) {
  throw new Error('public SBOM contains private verifier metadata');
}
const sbom = JSON.parse(sbomText) as JsonObject;
if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.7') {
  throw new Error('public SBOM must be CycloneDX 1.7');
}
const components = sbom.components as JsonObject[];
const lockText = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
const snapshots = snapshotGraph(lockText);
const byName = new Map<string, JsonObject[]>();
for (const component of components) {
  const name = String(component.name);
  byName.set(name, [...(byName.get(name) ?? []), component]);
  const purl = expectedPurl(name, String(component.version));
  if (component.purl !== purl || component['bom-ref'] !== purl) {
    throw new Error(`${name}: SBOM version/PURL drifted`);
  }
}

const manifests = new Map<string, JsonObject>();
for (const directory of ['packages/boardgame-core', 'packages/boardgame-ui']) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, directory, 'package.publish.json'), 'utf8'),
  ) as JsonObject;
  manifests.set(directory, manifest);
  const packageComponents = byName.get(String(manifest.name)) ?? [];
  if (!packageComponents.some((component) => component.version === manifest.version)) {
    throw new Error(`${manifest.name}: SBOM package version drifted`);
  }
  for (const field of ['dependencies', 'peerDependencies']) {
    const dependencies = (manifest[field] ?? {}) as JsonObject;
    for (const [name, requestedValue] of Object.entries(dependencies)) {
      const requested = String(requestedValue);
      let resolvedComponents = (byName.get(name) ?? []).filter((component) =>
        satisfies(String(component.version), requested),
      );
      if (field === 'dependencies') {
        const locked = importerDependency(lockText, directory, field, name);
        if (locked.specifier !== requested || !satisfies(locked.version, requested)) {
          throw new Error(`${manifest.name}: lockfile range drifted for ${name}`);
        }
        resolvedComponents = resolvedComponents.filter(
          (component) => component.version === locked.version,
        );
      }
      if (resolvedComponents.length === 0) {
        throw new Error(
          `${manifest.name}: SBOM is missing compatible ${field} ${name}@${requested}`,
        );
      }
    }
  }
}

const metadataComponent = (sbom.metadata as JsonObject).component as JsonObject;
const rootRef = String(metadataComponent['bom-ref']);
const expectedEdges = new Map<string, Set<string>>();
const pending: Array<{ name: string; version: string }> = [];

function addEdge(from: string, name: string, version: string): void {
  const to = expectedPurl(name, version);
  const edges = expectedEdges.get(from) ?? new Set<string>();
  edges.add(to);
  expectedEdges.set(from, edges);
  if (!name.startsWith('@boardoor/')) pending.push({ name, version });
}

function resolvePeer(name: string, range: string): string {
  const versions = [...snapshots.keys()]
    .map((key) => snapshotVersion(key, name))
    .filter((version): version is string => version !== undefined && satisfies(version, range))
    .filter((version, index, all) => all.indexOf(version) === index)
    .toSorted((left, right) => compareVersion(parseVersion(left), parseVersion(right)));
  if (versions.length === 0) throw new Error(`lock graph cannot resolve peer ${name}@${range}`);
  return versions[0];
}

const packageRefs = new Map<string, string>();
for (const manifest of manifests.values()) {
  const name = String(manifest.name);
  const ref = expectedPurl(name, String(manifest.version));
  packageRefs.set(name, ref);
  expectedEdges.set(ref, new Set());
}
expectedEdges.set(rootRef, new Set(packageRefs.values()));

const bundledManifests = [
  {
    path: 'packages/boardgame-core/EMBEDDED_COMPONENTS.json',
    packageName: '@boardoor/core',
    relationship: 'modified-source',
  },
  {
    path: 'packages/boardgame-ui/GENERATED_COMPONENTS.json',
    packageName: '@boardoor/ui',
    relationship: 'generated-build-input',
  },
] as const;
for (const config of bundledManifests) {
  const manifest = JSON.parse(readFileSync(resolve(root, config.path), 'utf8')) as {
    schemaVersion: number;
    package: string;
    components: EmbeddedComponent[];
  };
  if (
    manifest.schemaVersion !== 1 ||
    manifest.package !== config.packageName ||
    !Array.isArray(manifest.components) ||
    manifest.components.length === 0
  ) {
    throw new Error(`${config.path}: bundled component manifest is missing or malformed`);
  }
  const packageRef = packageRefs.get(config.packageName)!;
  for (const bundled of manifest.components) {
    const expectedRef = expectedPurl(bundled.name, bundled.version);
    if (
      bundled.bomRef !== expectedRef ||
      bundled.license !== 'MIT' ||
      bundled.relationship !== config.relationship ||
      !/^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:tree|blob)\/[0-9a-f]{40}(?:\/|$)/.test(
        bundled.source,
      ) ||
      bundled.modifications.trim().length === 0
    ) {
      throw new Error(`${bundled.name}: bundled provenance is incomplete or mutable`);
    }
    const matches = (byName.get(bundled.name) ?? []).filter(
      (component) => component.version === bundled.version,
    );
    if (matches.length !== 1) {
      throw new Error(`${bundled.name}: SBOM must contain one bundled component`);
    }
    const component = matches[0];
    const licenses = (component.licenses ?? []) as Array<{ license?: { id?: string } }>;
    const properties = new Map(
      ((component.properties ?? []) as Array<{ name: string; value: string }>).map((property) => [
        property.name,
        property.value,
      ]),
    );
    if (
      licenses.length !== 1 ||
      licenses[0]?.license?.id !== bundled.license ||
      properties.get('boardoor:relationship') !== bundled.relationship ||
      properties.get('boardoor:source') !== bundled.source ||
      properties.get('boardoor:modifications') !== bundled.modifications
    ) {
      throw new Error(`${bundled.name}: SBOM bundled provenance drifted`);
    }
    expectedEdges.get(packageRef)!.add(expectedRef);
    expectedEdges.set(expectedRef, new Set());
  }
}

for (const [directory, manifest] of manifests) {
  const packageRef = packageRefs.get(String(manifest.name))!;
  for (const name of Object.keys((manifest.dependencies ?? {}) as JsonObject)) {
    const locked = importerDependency(lockText, directory, 'dependencies', name);
    addEdge(packageRef, name, locked.version);
  }
  for (const [name, requestedValue] of Object.entries(
    (manifest.peerDependencies ?? {}) as JsonObject,
  )) {
    if (packageRefs.has(name)) {
      expectedEdges.get(packageRef)!.add(packageRefs.get(name)!);
    } else {
      addEdge(packageRef, name, resolvePeer(name, String(requestedValue)));
    }
  }
}

const visited = new Set<string>();
while (pending.length > 0) {
  const current = pending.shift()!;
  const ref = expectedPurl(current.name, current.version);
  if (visited.has(ref)) continue;
  visited.add(ref);
  const matchingSnapshots = [...snapshots].filter(
    ([key]) => snapshotVersion(key, current.name) === current.version,
  );
  if (matchingSnapshots.length === 0) {
    throw new Error(`lock graph is missing snapshot ${current.name}@${current.version}`);
  }
  expectedEdges.set(ref, expectedEdges.get(ref) ?? new Set());
  for (const [, snapshot] of matchingSnapshots) {
    for (const [name, lockedValue] of snapshot.dependencies) {
      addEdge(ref, name, lockedValue.split('(')[0]);
    }
    for (const [name, lockedValue] of snapshot.optionalDependencies) {
      const version = lockedValue.split('(')[0];
      if (expectedEdges.has(expectedPurl(name, version))) addEdge(ref, name, version);
    }
  }
}

const expectedComponents = new Set([...expectedEdges.keys()].filter((ref) => ref !== rootRef));
const actualComponents = new Set(components.map((component) => String(component['bom-ref'])));
if (
  [...expectedComponents].some((ref) => !actualComponents.has(ref)) ||
  [...actualComponents].some((ref) => !expectedComponents.has(ref))
) {
  const missing = [...expectedComponents].filter((ref) => !actualComponents.has(ref));
  const unexpected = [...actualComponents].filter((ref) => !expectedComponents.has(ref));
  throw new Error(
    `SBOM components do not exactly match the reachable production lock graph; missing=${missing.join(',')}; unexpected=${unexpected.join(',')}`,
  );
}

const dependencyEntries = (sbom.dependencies ?? []) as JsonObject[];
const actualEdges = new Map(
  dependencyEntries.map((entry) => [
    String(entry.ref),
    new Set(((entry.dependsOn ?? []) as unknown[]).map(String)),
  ]),
);
if (
  actualEdges.size !== expectedEdges.size ||
  [...expectedEdges].some(([ref, edges]) => {
    const actual = actualEdges.get(ref);
    return (
      !actual ||
      actual.size !== edges.size ||
      [...edges].some((dependency) => !actual.has(dependency))
    );
  })
) {
  const drift = [...new Set([...expectedEdges.keys(), ...actualEdges.keys()])]
    .filter((ref) => {
      const expected = expectedEdges.get(ref) ?? new Set<string>();
      const actual = actualEdges.get(ref) ?? new Set<string>();
      return (
        expected.size !== actual.size || [...expected].some((dependency) => !actual.has(dependency))
      );
    })
    .map(
      (ref) =>
        `${ref}:expected=${[...(expectedEdges.get(ref) ?? [])].join('|')}:actual=${[...(actualEdges.get(ref) ?? [])].join('|')}`,
    );
  throw new Error(
    `SBOM dependency edges do not exactly match the reachable production lock graph; ${drift.join('; ')}`,
  );
}

console.log(`public SDK SBOM verified (${components.length} components)`);
