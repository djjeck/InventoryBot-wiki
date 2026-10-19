/**
 * The generic Telegram-bot layer (`src/telegram/`, `src/lib/`) must stay reusable for any
 * bot: none of its files may import from the InventoryBot layer (`src/inventorybot/`) or
 * from the command line that wires the two (`src/cli.ts`). Its tests may also import the
 * test helpers (`test/`). Reads only `src/`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const GENERIC = ['telegram', 'lib'].map((d) => path.join(SRC, d));
const TEST = path.join(SRC, '..', 'test');

function tsFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? tsFiles(path.join(dir, e.name))
        : e.name.endsWith('.ts')
          ? [path.join(dir, e.name)]
          : []
    )
    .sort();
}

/** Module specifiers of static imports and re-exports (`from '…'`), bare `import '…'` and dynamic `import('…')`. */
function specifiers(source: string): string[] {
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/gu;
  return [...source.matchAll(re)].map((m) => m[2] as string);
}

const isInside = (file: string, dir: string): boolean => {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

describe('layers', () => {
  const files = GENERIC.flatMap(tsFiles);

  it('generic_layer_has_files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('generic_layer_imports_only_generic_code', () => {
    const bad: string[] = [];
    for (const file of files) {
      for (const spec of specifiers(fs.readFileSync(file, 'utf-8'))) {
        // Node built-ins and packages are skipped; #src/* and #test/* (package.json
        // "imports") are aliases of src/* and test/*.
        const alias = /^#(src|test)\//u.exec(spec);
        const target = alias
          ? path.join(SRC, '..', alias[1] as string, spec.slice(alias[0].length))
          : spec.startsWith('.')
            ? path.resolve(path.dirname(file), spec)
            : null;
        if (target === null) continue;
        if (file.endsWith('.test.ts') && isInside(target, TEST)) continue;
        if (!GENERIC.some((dir) => isInside(target, dir)))
          bad.push(`${path.relative(SRC, file)} -> ${spec}`);
      }
    }
    expect(bad).toStrictEqual([]);
  });

  it('import_scanner_sees_every_form', () => {
    const src =
      'import { a } from \'../x.js\';\nimport type { B } from "./y.js";\n' +
      "export { c } from '../../z.js';\nimport './side.js';\nconst d = import('../w.js');";
    expect(specifiers(src)).toStrictEqual([
      '../x.js',
      './y.js',
      '../../z.js',
      './side.js',
      '../w.js',
    ]);
  });
});
