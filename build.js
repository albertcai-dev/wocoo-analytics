// Assembles src/ into a single dist/index.html.
//
// Babel standalone cannot resolve module specifiers in the browser, so the build
// strips import/export syntax and concatenates the modules in dependency order
// into one scope. Order matters: dates before jiraClient, jiraClient before dayCache.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Babel from '@babel/standalone';

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

// Compile the JSX at build time purely to fail loudly on a syntax error. The
// browser compiles it again at run time via babel standalone; without this check
// a broken bundle deploys and only fails once someone opens the page.
const componentSource = src('components.js');
try {
  Babel.transform(componentSource, { presets: ['react'], filename: 'components.js' });
} catch (err) {
  console.error(`JSX does not compile:\n${err.message}`);
  process.exit(1);
}

const components = indent(componentSource);

const html = src('shell.html')
  .replace('__TOKENS__', () => src('tokens.css'))
  .replace('__MODULES__', () => modules)
  .replace('__COMPONENTS__', () => components);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), html);

const kb = (html.length / 1024).toFixed(1);
console.log(`dist/index.html written — ${kb} KB`);
