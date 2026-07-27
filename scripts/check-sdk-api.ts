import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript-api';
import type { Declaration } from 'typescript-api';

type Entry = {
  packageName: string;
  distDirectory: string;
  entry: string;
  report: string;
  stability: 'public-alpha' | 'supported';
  classifyExport?: (name: string) => ExportStability;
};

type ExportStability = 'experimental' | 'supported' | 'version-coupled';

const versionCoupledCoreExports = new Set([
  'MAKE_MOVE',
  'REDO',
  'UNDO',
  'IsLongFormMove',
  'ProcessGameConfig',
  'getFilterPlayerView',
  'redactLog',
  'InitializeGame',
  'CreateGameReducer',
  'TransientHandlingMiddleware',
  'IntermediateTransportData',
  'TransportData',
]);
const experimentalCoreExports = new Set([
  'applyStateMigrations',
  'StateMigrationError',
  'ApplyStateMigrationsOptions',
  'ApplyStateMigrationsResult',
  'StateMigrationErrorCode',
]);
const explicitlyClassifiedCoreExports = new Set([
  ...versionCoupledCoreExports,
  ...experimentalCoreExports,
]);

function classifyCoreExport(name: string): ExportStability {
  if (versionCoupledCoreExports.has(name)) return 'version-coupled';
  if (experimentalCoreExports.has(name)) return 'experimental';
  return 'supported';
}

const entries: Entry[] = [
  {
    packageName: '@boardoor/core',
    distDirectory: 'packages/boardgame-core/dist',
    entry: 'index.d.ts',
    report: 'packages/boardgame-core/etc/boardgame-core.api.json',
    stability: 'supported',
    classifyExport: classifyCoreExport,
  },
  {
    packageName: '@boardoor/core/app',
    distDirectory: 'packages/boardgame-core/dist',
    entry: 'app/index.d.ts',
    report: 'packages/boardgame-core/etc/boardgame-core-app.api.json',
    stability: 'supported',
  },
  {
    packageName: '@boardoor/ui',
    distDirectory: 'packages/boardgame-ui/dist',
    entry: 'index.d.ts',
    report: 'packages/boardgame-ui/etc/boardgame-ui.api.json',
    stability: 'public-alpha',
  },
];

const root = process.cwd();
const update = process.argv.includes('--update');
const violations: string[] = [];
const removedInternalReport = path.join(
  root,
  'packages/boardgame-core/etc/boardgame-core-internal.api.json',
);
if (existsSync(removedInternalReport)) {
  violations.push(
    '@boardoor/core/internal: obsolete API report exists; remove boardgame-core-internal.api.json',
  );
}

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

function reachableDeclarations(distDirectory: string, entryFile: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)(['"])(\.[^'"]+)\1/g)) {
      const specifier = match[2]!;
      const target = path.resolve(path.dirname(file), specifier.replace(/\.(?:c|m)?js$/, '.d.ts'));
      const resolved = existsSync(target)
        ? target
        : existsSync(`${target}.d.ts`)
          ? `${target}.d.ts`
          : path.join(target, 'index.d.ts');
      if (!existsSync(resolved) || !resolved.startsWith(distDirectory)) {
        throw new Error(
          `${path.relative(distDirectory, file)}: unresolved declaration ${specifier}`,
        );
      }
      visit(resolved);
    }
  };
  visit(entryFile);
  return [...seen].toSorted();
}

function declarationText(declaration: Declaration): string {
  return declaration
    .getText(declaration.getSourceFile())
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function createReport(entry: Entry): string {
  const distDirectory = path.join(root, entry.distDirectory);
  const declarationFiles = filesBelow(distDirectory)
    .filter((file) => file.endsWith('.d.ts'))
    .toSorted();
  const program = ts.createProgram(declarationFiles, {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2023,
  });
  const checker = program.getTypeChecker();
  const entryPath = path.join(distDirectory, entry.entry);
  const reachableFiles = reachableDeclarations(distDirectory, entryPath);
  const sourceFile = program.getSourceFile(entryPath);
  const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  if (!sourceFile || !moduleSymbol) throw new Error(`${entry.packageName}: missing ${entry.entry}`);

  const exported = checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const declarations = (target.declarations ?? [])
        .filter((declaration) => declaration.getSourceFile().fileName.startsWith(distDirectory))
        .map(declarationText)
        .toSorted();
      const name = symbol.getName();
      return entry.classifyExport
        ? { name, stability: entry.classifyExport(name), declarations }
        : { name, declarations };
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));

  if (entry.classifyExport) {
    const exportedNames = new Set(exported.map(({ name }) => name));
    const missingClassifiedExports = [...explicitlyClassifiedCoreExports].filter(
      (name) => !exportedNames.has(name),
    );
    if (missingClassifiedExports.length > 0) {
      throw new Error(
        `${entry.packageName}: classified exports are missing: ${missingClassifiedExports.join(', ')}`,
      );
    }
  }

  const report = {
    schemaVersion: 1,
    packageName: entry.packageName,
    entry: entry.entry,
    stability: entry.stability,
    exports: exported,
    declarationInventory: reachableFiles.map((file) => {
      const contents = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      return {
        path: path.relative(distDirectory, file).split(path.sep).join('/'),
        sha256: sha256(contents),
      };
    }),
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}

for (const entry of entries) {
  const expected = createReport(entry);
  const reportPath = path.join(root, entry.report);
  if (update) {
    writeFileSync(reportPath, expected);
  } else if (!existsSync(reportPath) || readFileSync(reportPath, 'utf8') !== expected) {
    violations.push(
      `${entry.packageName}: API report drifted; run pnpm sdk:api --update intentionally`,
    );
  }
}

if (violations.length > 0) {
  console.error('SDK API report check failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`SDK API report check passed${update ? ' (reports updated)' : ''}.`);
}
