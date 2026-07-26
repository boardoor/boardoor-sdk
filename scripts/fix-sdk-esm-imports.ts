import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const directory = path.resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(directory)) {
  throw new Error('Usage: fix-sdk-esm-imports.ts <dist-directory>');
}

function filesBelow(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

function resolveSpecifier(importer: string, specifier: string): string {
  if (/\.(?:c|m)?js$|\.json$|\.node$/.test(specifier)) return specifier;
  const target = path.resolve(path.dirname(importer), specifier);
  if (existsSync(`${target}.js`)) return `${specifier}.js`;
  if (existsSync(path.join(target, 'index.js'))) return `${specifier}/index.js`;
  throw new Error(`${path.relative(directory, importer)}: unresolved relative import ${specifier}`);
}

for (const file of filesBelow(directory).filter(
  (candidate) => candidate.endsWith('.js') || candidate.endsWith('.d.ts'),
)) {
  let source = readFileSync(file, 'utf8');
  for (const pattern of [
    /(\bfrom\s*)(['"])(\.[^'"]+)\2/g,
    /(\bimport\s*\(\s*)(['"])(\.[^'"]+)\2/g,
    /(\bimport\s*)(['"])(\.[^'"]+)\2/g,
  ]) {
    source = source.replace(
      pattern,
      (_match, prefix: string, quote: string, specifier: string) =>
        `${prefix}${quote}${resolveSpecifier(file, specifier)}${quote}`,
    );
  }
  writeFileSync(file, source);
}

console.log(`Fixed ESM relative imports in ${path.relative(process.cwd(), directory)}.`);
