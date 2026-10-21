/**
 * Place names. The bot names a place with the preposition of the sentence it is in
 * ("arrivi nella valle ventosa 🏞", "al porto dei pescatori 🎣"), and other sources with
 * the bare article ("la valle ventosa 🏞"). A place is known by its article form: an
 * articulated preposition at the start (nel, sul, al and their forms) becomes its
 * article, so every source names a place the same way. Pure logic, no Node APIs.
 */
import { WS_CLASS } from '#src/lib/text.ts';

/** Articulated preposition -> its article (the `nel`, `sul` and `al` families). */
const ARTICLES: ReadonlyMap<string, string> = new Map(
  ['ne', 'su', 'a'].flatMap((p) => [
    [`${p}l`, 'il'],
    [`${p}llo`, 'lo'],
    [`${p}lla`, 'la'],
    [`${p}ll'`, "l'"],
    [`${p}i`, 'i'],
    [`${p}gli`, 'gli'],
    [`${p}lle`, 'le'],
  ])
);

/** The leading articulated preposition: a whole word, or elided ("nell'alcova"). */
const PREPOSITION = new RegExp(`^(\\p{L}+['’]|\\p{L}+(?=${WS_CLASS}))${WS_CLASS}*`, 'u');

/** A place name in its article form: "nella valle ventosa 🏞" -> "la valle ventosa 🏞". */
export function placeName(name: string): string {
  const m = PREPOSITION.exec(name);
  if (m === null) return name;
  const word = m[1] as string;
  const article = ARTICLES.get(word.toLowerCase().replaceAll('’', "'"));
  if (article === undefined) return name;
  const rest = name.slice(m[0].length);
  const head = word[0] === (word[0] as string).toUpperCase() ? capitalize(article) : article;
  return head.endsWith("'") ? head + rest : `${head} ${rest}`;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The name a page shows for a place: its article form, capitalised. */
export function placeLabel(name: string): string {
  return capitalize(placeName(name));
}
