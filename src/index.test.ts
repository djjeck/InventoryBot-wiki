import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classify, type Knowledge, normalizeReply, resolveDrop } from './index.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** What the caller of the module knows, invented as the universe is (scripts/universe.md). */
const KNOWN: Knowledge = {
  items: new Set(['un sasso', 'una spada']),
  prefixes: ['nel bosco trovi '],
  titles: ['il fornaio', 'il gran cuoco'],
};

/** A reply read as a live bot reads it: normalised, classified, its drop resolved. */
function read(text: string): unknown {
  const ev = classify(normalizeReply(text, KNOWN), '/avventura');
  return ev.type === 'drop' && ev.kind === 'adventure' ? resolveDrop(ev.raw, KNOWN) : ev;
}

describe('the entry', () => {
  it('a_drop_of_a_known_item', () => {
    expect(read('@mario_r il fornaio, nella grotta trovi una spada [C]!')).toStrictEqual({
      item: 'una spada',
      sure: true,
      prefix: 'nella grotta trovi ',
    });
  });

  it('a_drop_of_an_item_not_known_after_a_known_prefix', () => {
    expect(read('@mario_r, nel bosco trovi un dado di legno [R]!')).toStrictEqual({
      item: 'un dado di legno',
      sure: false,
      prefix: 'nel bosco trovi ',
    });
  });

  it('a_drop_nothing_known_resolves', () => {
    expect(read('@mario_r, sulla spiaggia raccogli una conchiglia [C]!')).toBeNull();
  });

  it('other_replies_are_their_events', () => {
    expect(read('Troppo presto, riposati ancora un po!')).toStrictEqual({ type: 'cooldown' });
  });

  it('titles_longest_first_in_any_order_and_the_admin_prefix', () => {
    const text = '@u il gran cuoco, possiedi:';
    expect(normalizeReply(text, { titles: ['il gran', 'il gran cuoco'] })).toBe('@u, possiedi:');
    expect(normalizeReply('Sua Maestà @msx80 il fornaio, possiedi:', KNOWN)).toBe(
      '@msx80, possiedi:'
    );
    expect(normalizeReply(text, {})).toBe(text);
  });
});

describe('the module', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'module.json'), 'utf-8')) as {
    provides: string;
    plugins: string[];
    files: string[];
  };

  /** Every module Node loads to import the entry, as it runs it: files by their paths, others as named. */
  function loaded(): string[] {
    const trace = `
      import { registerHooks } from 'node:module';
      const seen = new Set();
      registerHooks({ resolve(s, c, next) { const r = next(s, c); seen.add(r.url); return r; } });
      await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'src/index.ts')).href)});
      console.log(JSON.stringify([...seen]));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', trace], {
      encoding: 'utf-8',
    });
    const root = pathToFileURL(ROOT).href + '/';
    return (JSON.parse(out) as string[])
      .map((u) => (u.startsWith(root) ? u.slice(root.length) : u))
      .sort();
  }

  it('is_a_library_whose_entry_is_this_file', () => {
    expect(manifest.plugins).toStrictEqual([]);
    expect(manifest.provides).toBe('@inventorybot-wiki/grammar');
    // `<provides>` alone is src/index.ts; its `#src/*` imports need the package.json shipped.
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
      imports: Record<string, string>;
    };
    expect(pkg.imports['#src/*']).toBe('./src/*');
  });

  it('ships_exactly_what_its_entry_loads', () => {
    // No npm package nor Node API: only files of src/, each of them listed in `files`.
    expect(manifest.files.filter((f) => f.startsWith('src/')).sort()).toStrictEqual(loaded());
    expect(manifest.files.filter((f) => !f.startsWith('src/'))).toStrictEqual([
      'LICENSE',
      'package.json',
    ]);
  });
});
