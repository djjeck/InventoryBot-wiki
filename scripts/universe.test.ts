/**
 * The scanner of `npm run check:universe` (universe.ts, check-universe.ts); the check of
 * the repository itself is the npm script, not this test.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scannedFiles } from './check-universe.ts';
import { normalizeName, parseUniverse, type Universe, unknownEntities } from './universe.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNIVERSE = parseUniverse(fs.readFileSync(path.join(ROOT, 'scripts/universe.md'), 'utf-8'));

const universe = (names: Partial<Record<keyof Universe, string[]>>): Universe => ({
  item: new Set((names.item ?? []).map(normalizeName)),
  recipe: new Set((names.recipe ?? []).map(normalizeName)),
  place: new Set((names.place ?? []).map(normalizeName)),
  user: new Set((names.user ?? []).map(normalizeName)),
});

describe('the test universe', () => {
  it('scans_the_repository_text_files_but_not_its_own', () => {
    const files = scannedFiles(ROOT);
    expect(files).toContain('docs/bot-protocol.md');
    expect(files).toContain('src/telegram/export/parse-export.ts');
    const own = files.filter(
      (f) => /^(test|scripts)\/universe\./u.test(f) || f === 'package-lock.json'
    );
    expect(own).toStrictEqual([]);
  });

  it('universe_lists_are_parsed_by_section', () => {
    expect(UNIVERSE.item.has('un sasso')).toBe(true);
    expect(UNIVERSE.recipe.has('orto in vaso')).toBe(true);
    expect(UNIVERSE.place.has('nella valle ventosa 🏞')).toBe(true);
    expect(UNIVERSE.item.has("una moneta d'oro")).toBe(true); // listed with a public comment
    expect(parseUniverse('## Items\n- un sasso <!-- public: why -->\n').item).toStrictEqual(
      new Set(['un sasso'])
    );
  });
});

describe('unknownEntities', () => {
  const U = universe({
    item: ['un sasso', "una moneta d'oro"],
    recipe: ['Orto in vaso'],
    place: ['nella valle ventosa 🏞'],
    user: ['mario_r', 'u'],
  });

  it('items_before_a_rarity_tag_end_with_a_known_name', () => {
    expect(unknownEntities('@u, nel bosco trovi un sasso [C]!', U)).toStrictEqual([]);
    expect(unknownEntities("possiedi:\\n-una moneta d'oro [X] x41", U)).toStrictEqual([]);
    expect(unknownEntities('@u, possiedi:\n- una mela [N+] x1', U)).toStrictEqual([
      { kind: 'item', text: '- una mela', line: 2 },
    ]);
    // Only at a word boundary: "un sassolino" is not "un sasso".
    expect(unknownEntities('trovi un sassolino [C]', U)).toHaveLength(1);
  });

  it('tags_without_a_name_before_them_are_not_items', () => {
    for (const text of ['`[C]` comune', "text.startsWith('[N] ')", '`${name} [L3]`', '[R]'])
      expect(unknownEntities(text, U), text).toStrictEqual([]);
  });

  it('crafted_items_recipes_and_places', () => {
    const text = [
      'Ottieni: una torta!',
      '- Orto in vaso L1 [*]',
      '- Pane nero L2 [manca 3]',
      '@u, per fare la ricetta Pane nero ti manca:',
      '@u, ti trovi: nella valle ventosa 🏞',
      'esausto arrivi nella grotta 🦇',
    ].join('\n');
    expect(unknownEntities(text, U).map((x) => [x.kind, x.text, x.line])).toStrictEqual([
      ['item', 'una torta', 1],
      ['recipe', 'Pane nero', 3],
      ['recipe', 'Pane nero', 4],
      ['place', 'nella grotta 🦇', 6],
    ]);
  });

  it('source_string_escapes_and_patterns', () => {
    expect(unknownEntities("'@u, ecco una moneta d\\'oro [X]'", U)).toStrictEqual([]);
    expect(unknownEntities('/, per fare .* ti manca:/', U)).toStrictEqual([]);
    expect(
      unknownEntities('rx(`per fare (?:la ricetta )?(?<name>${DOT}+?) ti manca`)', U)
    ).toStrictEqual([]);
  });

  it('usernames_are_compared_whole', () => {
    expect(unknownEntities('@Mario_R, possiedi:', U)).toStrictEqual([]);
    expect(unknownEntities('ciao @mario_rossi e @gino', U).map((x) => x.text)).toStrictEqual([
      '@mario_rossi',
      '@gino',
    ]);
  });

  it('addresses_package_scopes_and_code_are_not_usernames', () => {
    for (const text of [
      'noreply@example.com',
      "import js from '@eslint/js';",
      'typescript-eslint and @typescript-eslint/parser',
      '`@${u}, nel bosco`',
    ])
      expect(unknownEntities(text, U), text).toStrictEqual([]);
  });
});
