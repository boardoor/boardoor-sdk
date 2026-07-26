import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

const packageRoot = resolve(import.meta.dirname, '..');
const input = resolve(packageRoot, 'src/styles/ui.css');
const output = resolve(packageRoot, 'dist/styles/ui.css');
const source = readFileSync(input, 'utf8');
const dependencies: string[] = [];
const compiler = await compile(source, {
  base: dirname(input),
  from: input,
  onDependency(path) {
    dependencies.push(path);
  },
});
const sources = [
  ...(compiler.root === 'none'
    ? []
    : compiler.root === null
      ? [{ base: packageRoot, pattern: '**/*', negated: false }]
      : [{ ...compiler.root, negated: false }]),
  ...compiler.sources,
];
const candidates = new Scanner({ sources }).scan();
const css = compiler.build(candidates);
const optimized = optimize(css, { file: input, minify: true }).code;

if (candidates.length === 0 || dependencies.length === 0) {
  throw new Error('UI CSS build did not resolve Tailwind dependencies and component candidates');
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, optimized);
console.log(`Built compiled UI CSS from ${candidates.length} candidates.`);
