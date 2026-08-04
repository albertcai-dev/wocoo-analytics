// Assembles src/ into a single dist/index.html.
//
// Babel standalone cannot resolve module specifiers in the browser, so the build
// strips import/export syntax and concatenates the modules in dependency order
// into one scope. Order matters: dates before jiraClient, jiraClient before dayCache.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(root, 'src', f), 'utf8');

const MODULE_ORDER = ['dates.js', 'aggregate.js', 'jiraClient.js', 'dayCache.js'];

/** Remove ESM syntax so the modules can share one browser scope. */
function stripModuleSyntax(code) {
  return code
    .replace(/^\s*import[^;]+;\s*$/gm, '')
    .replace(/^export\s+(const|function|class)\s/gm, '$1 ')
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '');
}

function indent(code) {
  return code
    .split('\n')
    .map((line) => (line ? `    ${line}` : line))
    .join('\n');
}

const modules = indent(
  MODULE_ORDER
    .map((f) => `// ---- ${f} ----\n${stripModuleSyntax(src(f))}`)
    .join('\n\n'),
);

const components = indent(src('components.js'));

const html = src('shell.html')
  .replace('__TOKENS__', () => src('tokens.css'))
  .replace('__MODULES__', () => modules)
  .replace('__COMPONENTS__', () => components);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), html);

const kb = (html.length / 1024).toFixed(1);
console.log(`dist/index.html written — ${kb} KB`);
